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
    expect(appendDailyPerformanceValuation(withFirst, snapshot(BASE + 30 * 60 * 1000, 310))).toEqual(withFirst);
    const withUpgrade = appendDailyPerformanceValuation(withFirst, upgradedSameDay);
    expect(withUpgrade).toHaveLength(1);
    expect(withUpgrade[0]).toMatchObject({ cashflowHistoryComplete: true, equity: 305 });
    expect(appendDailyPerformanceValuation(withUpgrade, nextDay)).toHaveLength(2);
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
