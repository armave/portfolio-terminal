import { describe, expect, it } from 'vitest';
import { appendDailyPerformanceValuation, capturePortfolioPerformanceValuation, isPortfolioPerformanceValuationSnapshot } from './portfolioPerformanceCapture';
import { buildPortfolioPerformanceReport } from './portfolioPerformanceIntegration';
import type { PortfolioState, PortfolioPerformanceValuationSnapshot } from '../types/portfolio';

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.parse('2026-01-01T12:00:00.000Z');

function makeState(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    positions: {
      GOOGL: {
        ticker: 'GOOGL', shares: 2, currentPrice: 100, pt: 90, commBuy: 1,
        quoteDetails: { currency: 'USD', freshness: 'fresh', sourceTimestamp: BASE, provider: 'test' },
        tranches: [{ qty: 2, price: 90, date: '2026-01-01' }]
      }
    },
    cashCushion: { freeCash: 100, holdings: [] },
    balance: 0,
    portfolioEquity: 300,
    realizedMarginCharged: 0,
    activeView: 'COMBINED',
    closedTrades: [],
    cashflows: [],
    transactionEvents: [],
    brokerAccountInfo: {
      loaded: true,
      balances: [{ currency: 'USD', amount: 0, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 }],
      positions: [{ ticker: 'GOOGL', name: 'Alphabet', quantity: 2, currency: 'USD', marketPrice: 100, marketValue: 200, averagePrice: 90, profitClose: 20, accountPositionId: 1 }],
      status: 'current',
      provider: 'freedom-tradenet',
      quality: 'complete',
      observedAt: BASE,
      receivedAt: BASE,
      warnings: []
    },
    brokerAssumptions: {
      broker: 'Freedom', annualBorrowRate: 0.15, dayCountBasis: 365,
      rolloverHour: 4, rolloverMinute: 0, rolloverTimeZone: 'Asia/Yerevan',
      maintenanceEquityRatio: 0.25, stopOutRatio: 0.5,
      commissionMin: 0, commissionPerShare: 0, commissionRatePct: 0
    },
    cashBalance: 100,
    holdings: [],
    apiKeys: {},
    ...overrides
  };
}

function snapshot(
  timestamp: number,
  equity: number,
  cashflowHistoryComplete = true,
  items: Array<{ key: string; value: number }> = [
    { key: 'position:GOOGL', value: equity - 100 },
    { key: 'cash', value: 100 },
    { key: 'margin-debt', value: 0 }
  ],
  quality: 'current' | 'provisional' = 'current'
): PortfolioPerformanceValuationSnapshot {
  return {
    timestamp, equity, currency: 'USD', quality, cashflowHistoryComplete,
    items, pricedHoldings: 1, unpricedHoldings: 0,
    provider: 'freedom-tradenet', brokerObservedAt: timestamp, brokerReceivedAt: timestamp
  };
}

describe('capturePortfolioPerformanceValuation', () => {
  it('captures account-currency equity and reconciling attribution buckets', () => {
    const result = capturePortfolioPerformanceValuation(makeState(), BASE, true);
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      timestamp: BASE, equity: 300, currency: 'USD', quality: 'current',
      cashflowHistoryComplete: true
    });
    expect(result?.items.reduce((sum, item) => sum + item.value, 0)).toBeCloseTo(300, 10);
  });

  it('marks unverifiable quotes and stale account snapshots provisional', () => {
    const result = capturePortfolioPerformanceValuation(makeState({
      brokerAccountInfo: {
        ...makeState().brokerAccountInfo!,
        status: 'stale'
      }
    }), BASE, true);
    expect(result?.quality).toBe('provisional');
  });

  it('refuses mixed currencies, missing broker balances and unpriced holdings', () => {
    expect(capturePortfolioPerformanceValuation(makeState({
      brokerAccountInfo: { ...makeState().brokerAccountInfo!, balances: [
        { currency: 'USD', amount: 0, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 },
        { currency: 'AMD', amount: 0, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 }
      ] }
    }), BASE, true)).toBeNull();
    expect(capturePortfolioPerformanceValuation(makeState({
      positions: { GOOGL: { ...makeState().positions.GOOGL, quoteDetails: { currency: 'AMD' } } }
    }), BASE, true)).toBeNull();
    expect(capturePortfolioPerformanceValuation(makeState({
      positions: { GOOGL: { ...makeState().positions.GOOGL, currentPrice: 0 } }
    }), BASE, true)).toBeNull();
  });
});

describe('appendDailyPerformanceValuation', () => {
  it('stores one point per UTC day and upgrades provisional coverage when full history arrives', () => {
    const first = snapshot(BASE, 300, false, undefined, 'provisional');
    const nextDay = snapshot(BASE + DAY, 320);
    const upgradedSameDay = snapshot(BASE + 2 * 60 * 60 * 1000, 305, true);
    const withFirst = appendDailyPerformanceValuation([], first);
    expect(appendDailyPerformanceValuation(withFirst, snapshot(BASE + 30 * 60 * 1000, 310, false, undefined, 'provisional'))).toEqual(withFirst);
    const withUpgrade = appendDailyPerformanceValuation(withFirst, upgradedSameDay);
    expect(withUpgrade).toHaveLength(1);
    expect(withUpgrade[0]).toMatchObject({ cashflowHistoryComplete: true, equity: 305 });
    expect(appendDailyPerformanceValuation(withUpgrade, nextDay)).toHaveLength(2);
  });

  it('refreshes same-day observations without downgrading verified quality or cashflow coverage', () => {
    const first = snapshot(BASE, 300, false, undefined, 'provisional');
    const laterSameQuality = snapshot(BASE + 6 * 60 * 60 * 1000, 310, false, undefined, 'provisional');
    const upgraded = snapshot(BASE + 8 * 60 * 60 * 1000, 315, true, undefined, 'current');
    const withFirst = appendDailyPerformanceValuation([], first);
    const refreshed = appendDailyPerformanceValuation(withFirst, laterSameQuality);
    expect(refreshed).toMatchObject([
      { timestamp: laterSameQuality.timestamp, equity: 310, quality: 'provisional', cashflowHistoryComplete: false }
    ]);
    const withUpgrade = appendDailyPerformanceValuation(refreshed, upgraded);
    expect(withUpgrade).toMatchObject([
      { timestamp: upgraded.timestamp, equity: 315, quality: 'current', cashflowHistoryComplete: true }
    ]);

    const downgraded = snapshot(BASE + 10 * 60 * 60 * 1000, 320, false, undefined, 'provisional');
    expect(appendDailyPerformanceValuation(withUpgrade, downgraded)).toEqual(withUpgrade);
    const older = snapshot(BASE + 7 * 60 * 60 * 1000, 330, true, undefined, 'current');
    expect(appendDailyPerformanceValuation(withUpgrade, older)).toEqual(withUpgrade);
  });

  it('bounds retained daily history', () => {
    let values: PortfolioPerformanceValuationSnapshot[] = [];
    for (let day = 0; day < 5; day += 1) {
      values = appendDailyPerformanceValuation(values, snapshot(BASE + day * DAY, 300 + day), 3);
    }
    expect(values).toHaveLength(3);
    expect(values[0].timestamp).toBe(BASE + 2 * DAY);
  });

  it('validates persisted snapshot rows before using them', () => {
    expect(isPortfolioPerformanceValuationSnapshot(snapshot(BASE, 300))).toBe(true);
    expect(isPortfolioPerformanceValuationSnapshot({ ...snapshot(BASE, 300), items: [] })).toBe(false);
  });
});

describe('buildPortfolioPerformanceReport', () => {
  it('adapts verified deposit events and daily valuation snapshots into TWR, XIRR and account attribution', () => {
    const start = BASE;
    const end = BASE + DAY;
    const state = {
      performanceValuations: [
        snapshot(start, 1000, true, [
          { key: 'position:GOOGL', value: 800 }, { key: 'cash', value: 200 }, { key: 'margin-debt', value: 0 }
        ]),
        snapshot(end, 1200, true, [
          { key: 'position:GOOGL', value: 900 }, { key: 'cash', value: 300 }, { key: 'margin-debt', value: 0 }
        ])
      ],
      transactionEvents: [{
        id: 'deposit-1', schemaVersion: 1, type: 'cash.deposit',
        actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow',
        effectiveAt: start + DAY / 2, recordedAt: start + DAY / 2,
        currency: 'USD', externalCashFlowAmount: 100, grossAmount: 100,
        externalReferenceId: 'cashflow-1'
      }],
      cashflows: [{
        id: 'freedom-commission-1', date: new Date(start + DAY / 2).toISOString(),
        type: 'Commission', amount: -2, currency: 'USD',
        description: 'Broker commission', raw: { operation_type: 'Commission' }
      }]
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>;

    const report = buildPortfolioPerformanceReport(state);
    expect(report.status).toBe('available');
    expect(report.currency).toBe('USD');
    expect(report.timeWeighted?.status).toBe('available');
    if (report.timeWeighted && report.timeWeighted.status !== 'unavailable') {
      expect(report.timeWeighted.value.totalReturn).toBeCloseTo(100 / 1050, 12);
    }
    expect(report.incomeCosts?.status).toBe('available');
    if (report.incomeCosts && report.incomeCosts.status !== 'unavailable') {
      expect(report.incomeCosts.value.commissions).toBe(2);
    }
    expect(report.latestAttribution?.status).toBe('available');
    if (report.latestAttribution && report.latestAttribution.status !== 'unavailable') {
      expect(report.latestAttribution.value.items.find(item => item.key === 'position:GOOGL')?.profit).toBeCloseTo(100, 8);
      expect(report.latestAttribution.value.items.find(item => item.key === 'cash')?.profit).toBeCloseTo(0, 8);
    }
  });

  it('attributes manual buys from signed cash/debt movements and marks legacy currency metadata provisional', () => {
    const report = buildPortfolioPerformanceReport({
      performanceValuations: [
        snapshot(BASE, 1000, true, [
          { key: 'position:GOOGL', value: 0 },
          { key: 'cash', value: 1000 },
          { key: 'margin-debt', value: 0 }
        ]),
        snapshot(BASE + DAY, 999, true, [
          { key: 'position:GOOGL', value: 200 },
          { key: 'cash', value: 799 },
          { key: 'margin-debt', value: 0 }
        ])
      ],
      transactionEvents: [{
        id: 'manual-buy-1', schemaVersion: 1, type: 'trade.buy',
        actor: { type: 'user' }, source: 'manual',
        effectiveAt: BASE + DAY / 2, recordedAt: BASE + DAY / 2,
        ticker: 'GOOGL', quantity: 2, grossAmount: 200, fees: 1,
        cashDelta: -201, marginDebtDelta: 0
      }],
      cashflows: []
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);

    expect(report.status).toBe('provisional');
    expect(report.latestAttribution?.status).toBe('provisional');
    if (report.latestAttribution && report.latestAttribution.status !== 'unavailable') {
      expect(report.latestAttribution.value.profit).toBeCloseTo(-1, 8);
      expect(report.latestAttribution.value.items.find(item => item.key === 'position:GOOGL')?.profit).toBeCloseTo(0, 8);
      expect(report.latestAttribution.value.items.find(item => item.key === 'cash')?.profit).toBeCloseTo(-1, 8);
    }
    expect(report.warnings.some(warning => warning.includes('predate explicit currency metadata'))).toBe(true);
  });

  it('does not double-count allocated buy commission when attributing a margin-position sale', () => {
    const report = buildPortfolioPerformanceReport({
      performanceValuations: [
        snapshot(BASE, 999, true, [
          { key: 'position:GOOGL', value: 200 },
          { key: 'cash', value: 799 },
          { key: 'margin-debt', value: 0 }
        ]),
        snapshot(BASE + DAY, 998, true, [
          { key: 'position:GOOGL', value: 100 },
          { key: 'cash', value: 898 },
          { key: 'margin-debt', value: 0 }
        ])
      ],
      transactionEvents: [{
        id: 'manual-sale-1', schemaVersion: 1, type: 'trade.sell',
        actor: { type: 'user' }, source: 'manual',
        effectiveAt: BASE + DAY / 2, recordedAt: BASE + DAY / 2,
        ticker: 'GOOGL', quantity: 1, grossAmount: 100, fees: 6,
        cashDelta: 99, marginDebtDelta: 0, netAmount: 99, realizedPnl: 4
      }],
      cashflows: []
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);

    expect(report.status).toBe('provisional');
    expect(report.latestAttribution?.status).toBe('provisional');
    if (report.latestAttribution && report.latestAttribution.status !== 'unavailable') {
      expect(report.latestAttribution.value.profit).toBeCloseTo(-1, 8);
      expect(report.latestAttribution.value.items.find(item => item.key === 'position:GOOGL')?.profit).toBeCloseTo(0, 8);
      expect(report.latestAttribution.value.items.find(item => item.key === 'cash')?.profit).toBeCloseTo(-1, 8);
    }
  });

  it('attributes cash-holding sales when net proceeds reconcile and keeps unmodeled cash-holding buys unavailable', () => {
    const saleReport = buildPortfolioPerformanceReport({
      performanceValuations: [
        snapshot(BASE, 1000, true, [
          { key: 'cash-holding:VTI', value: 200 },
          { key: 'cash', value: 800 },
          { key: 'margin-debt', value: 0 }
        ]),
        snapshot(BASE + DAY, 999, true, [
          { key: 'cash-holding:VTI', value: 100 },
          { key: 'cash', value: 899 },
          { key: 'margin-debt', value: 0 }
        ])
      ],
      transactionEvents: [{
        id: 'cash-holding-sale-1', schemaVersion: 1, type: 'cash-holding.sell',
        actor: { type: 'user' }, source: 'manual-cash-holding',
        effectiveAt: BASE + DAY / 2, recordedAt: BASE + DAY / 2,
        ticker: 'VTI', quantity: 1, cashHoldingQuantityDelta: -1,
        grossAmount: 100, fees: 1, netAmount: 99, cashDelta: 99, marginDebtDelta: 0
      }],
      cashflows: []
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);

    expect(saleReport.latestAttribution?.status).toBe('provisional');
    if (saleReport.latestAttribution && saleReport.latestAttribution.status !== 'unavailable') {
      expect(saleReport.latestAttribution.value.items.find(item => item.key === 'cash-holding:VTI')?.profit).toBeCloseTo(0, 8);
      expect(saleReport.latestAttribution.value.items.find(item => item.key === 'cash')?.profit).toBeCloseTo(-1, 8);
    }

    const buyReport = buildPortfolioPerformanceReport({
      performanceValuations: [
        snapshot(BASE, 1000, true),
        snapshot(BASE + DAY, 1200, true)
      ],
      transactionEvents: [{
        id: 'cash-holding-buy-1', schemaVersion: 1, type: 'cash-holding.buy',
        actor: { type: 'user' }, source: 'manual-cash-holding',
        effectiveAt: BASE + DAY / 2, recordedAt: BASE + DAY / 2,
        ticker: 'VTI', quantity: 2, cashHoldingQuantityDelta: 2,
        grossAmount: 200, cashDelta: 0
      }],
      cashflows: []
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);
    expect(buyReport.status).toBe('unavailable');
    expect(buyReport.reason).toContain('cannot yet be classified');
  });

  it('rejects corrected or conflicting broker cashflow revisions instead of counting both versions', () => {
    const report = buildPortfolioPerformanceReport({
      performanceValuations: [
        snapshot(BASE, 1000, true),
        snapshot(BASE + DAY, 1100, true)
      ],
      transactionEvents: [
        {
          id: 'deposit-original', schemaVersion: 1, type: 'cash.deposit',
          actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow',
          effectiveAt: BASE + DAY / 3, recordedAt: BASE + DAY / 2,
          currency: 'USD', externalCashFlowAmount: 50, externalReferenceId: 'cashflow-1',
          requestFingerprint: 'cashflow-v1-original'
        },
        {
          id: 'deposit-correction', schemaVersion: 1, type: 'cash.deposit',
          actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow',
          effectiveAt: BASE + DAY / 3, recordedAt: BASE + DAY / 2,
          currency: 'USD', externalCashFlowAmount: 60, externalReferenceId: 'cashflow-1',
          requestFingerprint: 'cashflow-v1-corrected'
        }
      ],
      cashflows: []
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);

    expect(report.status).toBe('unavailable');
    expect(report.reason).toContain('corrected or conflicting source record');
  });

  it('marks non-Freedom income/cost rows provisional rather than presenting them as verified broker history', () => {
    const report = buildPortfolioPerformanceReport({
      performanceValuations: [snapshot(BASE, 1000), snapshot(BASE + DAY, 1100)],
      transactionEvents: [],
      cashflows: [{
        id: 'imported-fee-1', date: new Date(BASE + DAY / 2).toISOString(),
        type: 'Commission', amount: -2, currency: 'USD', description: 'Imported commission'
      }]
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);

    expect(report.incomeCosts?.status).toBe('provisional');
    expect(report.status).toBe('provisional');
    expect(report.warnings.some(warning => warning.includes('not verified Freedom broker-history records'))).toBe(true);
  });

  it('does not produce performance without verified cashflow history coverage', () => {
    const report = buildPortfolioPerformanceReport({
      performanceValuations: [snapshot(BASE, 1000, false), snapshot(BASE + DAY, 1100, false)],
      transactionEvents: [], cashflows: []
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);
    expect(report.status).toBe('unavailable');
    expect(report.reason).toContain('cashflow-history baseline');
  });

  it('refuses ambiguous adjustments and mixed-currency external flows', () => {
    const baseState = {
      performanceValuations: [snapshot(BASE, 1000), snapshot(BASE + DAY, 1100)],
      transactionEvents: [],
      cashflows: []
    };
    const ambiguous = buildPortfolioPerformanceReport({
      ...baseState,
      transactionEvents: [{
        id: 'unknown-adjustment', schemaVersion: 1, type: 'cash.adjustment',
        actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow',
        effectiveAt: BASE + DAY / 2, recordedAt: BASE + DAY / 2,
        currency: 'USD', externalCashFlowAmount: -50, grossAmount: 50
      }]
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);
    expect(ambiguous.status).toBe('unavailable');
    expect(ambiguous.reason).toContain('cannot yet be classified');
    const mixed = buildPortfolioPerformanceReport({
      ...baseState,
      transactionEvents: [{
        id: 'amd-deposit', schemaVersion: 1, type: 'cash.deposit',
        actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow',
        effectiveAt: BASE + DAY / 2, recordedAt: BASE + DAY / 2,
        currency: 'AMD', externalCashFlowAmount: 50
      }]
    } as unknown as Pick<PortfolioState, 'performanceValuations' | 'transactionEvents' | 'cashflows'>);
    expect(mixed.status).toBe('unavailable');
    expect(mixed.reason).toContain('different or unknown currency');
  });
});
