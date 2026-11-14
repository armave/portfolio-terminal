import { describe, expect, it } from 'vitest';
import type { BrokerExecutionMetrics } from '../../domain/brokerExecutionMetrics';
import type { ClosedTradeAttribution } from '../../domain/closedTradeAttribution';
import type { FreedomExecutedTrade } from '../../types/freedomTrade';
import { buildClosedHistoryRows, summarizeClosedHistoryRows } from './closedHistoryRows';

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
