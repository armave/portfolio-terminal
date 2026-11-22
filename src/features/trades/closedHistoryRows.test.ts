import { describe, expect, it } from 'vitest';
import type { BrokerExecutionMetrics } from '../../domain/brokerExecutionMetrics';
import type { ClosedTradeAttribution } from '../../domain/closedTradeAttribution';
import type { FreedomExecutedTrade } from '../../types/freedomTrade';
import { buildClosedHistoryRows, sortClosedHistoryRows, summarizeClosedHistoryRows } from './closedHistoryRows';

function createSell(overrides: Partial<FreedomExecutedTrade> = {}): FreedomExecutedTrade {
  return {
    id: 'sell-1',
    ticker: 'AAPL',
    side: 'SELL',
    quantity: 5,
    price: 120,
    currency: 'USD',
    executedAt: '2026-11-13T10:00:00.000Z',
    tradeValue: 600,
    profit: null,
    marginFee: 2,
    commission: 1,
    commissionCurrency: 'USD',
    raw: {},
    ...overrides
  };
}

function createAttribution(overrides: Partial<ClosedTradeAttribution> = {}): ClosedTradeAttribution {
  return {
    fundingType: 'margin',
    cashQuantity: 0,
    marginQuantity: 5,
    guestAllocations: [],
    guestMetrics: {},
    averagePrice: 100,
    purchasedAt: Date.parse('2026-09-24T10:00:00.000Z'),
    unmatchedQuantity: 0,
    ...overrides
  };
}

function buildRows(
  sell: FreedomExecutedTrade,
  attribution: ClosedTradeAttribution,
  metrics: BrokerExecutionMetrics = { holdingDays: 49.7, buyCommission: 0.5 }
) {
  return buildClosedHistoryRows({
    brokerTrades: [sell],
    brokerTradeMetrics: new Map([[sell, metrics]]),
    trancheAttributions: new Map([[sell, attribution]]),
    appTrades: []
  });
}

describe('broker closed-history source reconciliation', () => {
  it('does not double-count an app sale that matches one fill inside a grouped broker sale', () => {
    const firstSell = createSell({
      id: 'broker-sell-2',
      quantity: 2,
      price: 120,
      tradeValue: 240,
      executedAt: '2026-11-13T10:00:00.000Z',
      profit: 20,
      marginFee: 0.4,
      commission: 0.5
    });
    const secondSell = createSell({
      id: 'broker-sell-3',
      quantity: 3,
      price: 121,
      tradeValue: 363,
      executedAt: '2026-11-13T10:20:00.000Z',
      profit: 30,
      marginFee: 0.6,
      commission: 0.75
    });
    const appDuplicate = {
      trade: {
        id: 'app-duplicate',
        ticker: 'AAPL',
        shares: 2,
        exitDate: firstSell.executedAt,
        sellPrice: 120
      },
      index: 0,
      source: 'app',
      profit: 20,
      fees: 0.4,
      commissions: 0.5,
      feesTotal: 0.9,
      commissionsComplete: true
    };
    const rows = buildClosedHistoryRows({
      brokerTrades: [firstSell, secondSell],
      brokerTradeMetrics: new Map([
        [firstSell, { holdingDays: 49, buyCommission: 0.2 }],
        [secondSell, { holdingDays: 50, buyCommission: 0.3 }]
      ]),
      trancheAttributions: new Map([
        [firstSell, createAttribution({ marginQuantity: 2, averagePrice: 110 })],
        [secondSell, createAttribution({ marginQuantity: 3, averagePrice: 111 })]
      ]),
      appTrades: [appDuplicate]
    });

    // The two broker fills remain one displayed 5-share row; the duplicated
    // 2-share app record must not add a second sale to the totals.
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('tradenet');
    expect(rows[0].trade.shares).toBe(5);
    expect(rows[0].profit).toBe(47.25);
    expect(rows[0].feesTotal).toBe(2.75);
    expect(rows[0].trade.netProfit).toBe(47.25);
    expect(rows[0].trade.feesAndCommissions).toBe(2.75);
  });

  it('still deduplicates an app record that matches the grouped broker total', () => {
    const firstSell = createSell({
      id: 'broker-sell-a',
      quantity: 2,
      executedAt: '2026-11-13T10:00:00.000Z',
      profit: 20
    });
    const secondSell = createSell({
      id: 'broker-sell-b',
      quantity: 3,
      executedAt: '2026-11-13T10:20:00.000Z',
      profit: 30
    });
    const appDuplicate = {
      trade: {
        id: 'app-group-duplicate',
        ticker: 'AAPL',
        shares: 5,
        exitDate: '2026-11-13T10:20:00.000Z',
        sellPrice: 120
      },
      index: 0,
      source: 'app',
      profit: 50
    };

    const rows = buildClosedHistoryRows({
      brokerTrades: [firstSell, secondSell],
      brokerTradeMetrics: new Map([
        [firstSell, { holdingDays: 49, buyCommission: 0.2 }],
        [secondSell, { holdingDays: 50, buyCommission: 0.3 }]
      ]),
      trancheAttributions: new Map([
        [firstSell, createAttribution({ marginQuantity: 2, averagePrice: 110 })],
        [secondSell, createAttribution({ marginQuantity: 3, averagePrice: 111 })]
      ]),
      appTrades: [appDuplicate]
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('tradenet');
    expect(rows[0].trade.shares).toBe(5);
  });
});

describe('broker closed-history net profit fallback', () => {
  it('derives net P&L from a complete FIFO cost basis when TradeNet omits profit', () => {
    const sell = createSell({ price: null, tradeValue: 600 });
    const [row] = buildRows(sell, createAttribution());

    // Gross P&L: (120 sell - 100 FIFO cost) × 5 = 100.
    // Net P&L: 100 - 2 financing fee - 1 sell commission - 0.50 buy commission.
    expect(row).toMatchObject({
      profit: 96.5,
      fees: 2,
      commissions: 1.5,
      feesTotal: 3.5,
      commissionsComplete: true
    });
    expect(row.trade).toMatchObject({ netProfit: 96.5, shares: 5 });
  });

  it('keeps net P&L unavailable when any sold quantity lacks a FIFO cost match', () => {
    const [row] = buildRows(
      createSell(),
      createAttribution({ unmatchedQuantity: 1 })
    );

    expect(row.profit).toBeNull();
    expect(row.trade.netProfit).toBeNull();
  });

  it('keeps net P&L unavailable when FIFO cost evidence is incomplete', () => {
    const missingCost = buildRows(
      createSell(),
      createAttribution({ averagePrice: null })
    )[0];

    expect(missingCost.profit).toBeNull();
    expect(missingCost.profitIsUpperBound).toBeFalsy();
  });

  it('shows a net P&L upper bound when buy-side commission is missing', () => {
    const [row] = buildRows(
      createSell(),
      createAttribution(),
      { holdingDays: 49.7, buyCommission: null }
    );

    // Gross P&L is 100. Known costs are 2 financing + 1 sell commission.
    // The missing buy commission can only reduce actual net P&L from this bound.
    expect(row).toMatchObject({
      profit: 97,
      profitIsUpperBound: true,
      commissionsComplete: false,
      feesTotal: 3
    });
  });

  it('shows a net P&L upper bound when sell-side commission is missing', () => {
    const [row] = buildRows(
      createSell({ commission: null }),
      createAttribution(),
      { holdingDays: 49.7, buyCommission: 0.5 }
    );

    expect(row).toMatchObject({
      profit: 97.5,
      profitIsUpperBound: true,
      commissionsComplete: false,
      feesTotal: 2.5
    });
  });

  it('keeps upper-bound rows out of exact Known Net P&L and win-rate totals', () => {
    expect(summarizeClosedHistoryRows([
      { profit: 10, profitIsUpperBound: false, feesTotal: 2, commissionsComplete: true, trade: { holdingDays: 2 } },
      { profit: 97, profitIsUpperBound: true, feesTotal: 3, commissionsComplete: false, trade: { holdingDays: 49.7 } },
      { profit: -5, profitIsUpperBound: false, feesTotal: 4, commissionsComplete: true, trade: { holdingDays: 4 } }
    ])).toMatchObject({
      realizedNet: 5,
      hasIncompleteCommissions: true,
      hasUnknownProfit: true,
      knownProfitCount: 2,
      winningTrades: 1,
      winRate: 50
    });
  });

  it('continues to prefer a finite broker-reported profit over a derived FIFO result', () => {
    const [row] = buildRows(
      createSell({ profit: 20 }),
      createAttribution()
    );

    expect(row.profit).toBe(16.5);
  });
});


describe('closed history sorting', () => {
  const rows = [
    { trade: { id: 'older', ticker: 'AAA', exitDate: '2026-11-10T10:00:00.000Z', shares: 2 }, profit: 25, profitIsUpperBound: false },
    { trade: { id: 'newer', ticker: 'BBB', exitDate: '2026-11-20T10:00:00.000Z', shares: 8 }, profit: -10, profitIsUpperBound: false },
    { trade: { id: 'unknown', ticker: 'CCC', exitDate: '2026-11-18T10:00:00.000Z', shares: 50 }, profit: null },
    { trade: { id: 'bounded', ticker: 'DDD', exitDate: '2026-11-19T10:00:00.000Z', shares: 4 }, profit: 100, profitIsUpperBound: true },
    { trade: { id: 'no-date', ticker: 'EEE', shares: 1 }, profit: 5, profitIsUpperBound: false }
  ];
  it('sorts newest and oldest dates while keeping unknown dates last', () => {
    expect(sortClosedHistoryRows(rows, 'newest').map((row) => row.trade.id)).toEqual(['newer', 'bounded', 'unknown', 'older', 'no-date']);
    expect(sortClosedHistoryRows(rows, 'oldest').map((row) => row.trade.id)).toEqual(['older', 'unknown', 'bounded', 'newer', 'no-date']);
  });
  it('ranks only exact net P&L values and keeps missing or upper-bound results last', () => {
    expect(sortClosedHistoryRows(rows, 'profit-high').map((row) => row.trade.id)).toEqual(['older', 'no-date', 'newer', 'unknown', 'bounded']);
    expect(sortClosedHistoryRows(rows, 'profit-low').map((row) => row.trade.id)).toEqual(['newer', 'no-date', 'older', 'unknown', 'bounded']);
  });
  it('sorts largest positions first without converting missing shares to zero', () => {
    expect(sortClosedHistoryRows(rows, 'largest').map((row) => row.trade.id)).toEqual(['unknown', 'newer', 'bounded', 'older', 'no-date']);
  });
  it('does not mutate the original rows', () => {
    const original = [...rows];
    sortClosedHistoryRows(rows, 'profit-high');
    expect(rows).toEqual(original);
  });
});
