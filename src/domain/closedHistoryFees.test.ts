import { describe, expect, it } from 'vitest';
import {
  applyCashflowAllocationsToBrokerExecutions,
  mergeBrokerExecutionHistory,
  applyCashflowAllocationsToClosedTrades,
  deduplicateClosedHistoryRows,
  preservePersistedBrokerFeeAllocations,
  resolveClosedTradeFeeBreakdown,
  resolveClosedTradeNetProfit
} from './closedHistoryFees';

describe('closed-history cashflow fee recalculation', () => {
  it('replaces old broker fee allocations with the current broker cashflows', () => {
    const executions = [{
      id: 'sell-1',
      side: 'sell',
      commission: 1.25,
      profit: 100,
      marginFeeAllocations: { old_cashflow: 4.5 },
      marginFee: 4.5,
      feesAndCommissions: 5.75,
      netProfit: 95.5
    }];

    expect(applyCashflowAllocationsToBrokerExecutions(executions, new Map([[0, { new_cashflow: 2.25 }]]))[0]).toMatchObject({
      marginFeeAllocations: { new_cashflow: 2.25 },
      marginFee: 2.25,
      feesAndCommissions: 3.5,
      netProfit: 96.5
    });
  });

  it('clears stale broker fees when current cashflows no longer match a closed trade', () => {
    const executions = [{
      side: 'sell',
      commission: 1.25,
      profit: 100,
      marginFeeAllocations: { old_cashflow: 4.5 },
      marginFee: 4.5,
      feesAndCommissions: 5.75,
      netProfit: 95.5
    }];

    expect(applyCashflowAllocationsToBrokerExecutions(executions, new Map())[0]).toMatchObject({
      marginFeeAllocations: {},
      marginFee: 0,
      feesAndCommissions: 1.25,
      netProfit: 98.75
    });
  });

  it('recalculates app closed-trade fees from the new allocation and removes stale allocation', () => {
    const trades = [{
      feesAndCommissions: 8,
      totalCommissions: 8,
      marginInterest: 5,
      marginFee: 5,
      netProfit: 92,
      netRealizedGain: 92
    }];

    expect(applyCashflowAllocationsToClosedTrades(trades, new Map([[0, 2]]))[0]).toMatchObject({
      feesAndCommissions: 5,
      totalCommissions: 5,
      marginInterest: 2,
      marginFee: 2,
      netProfit: 95,
      netRealizedGain: 95
    });
    expect(applyCashflowAllocationsToClosedTrades(trades, new Map())[0]).toMatchObject({
      feesAndCommissions: 3,
      totalCommissions: 3,
      marginInterest: 0,
      marginFee: 0,
      netProfit: 97,
      netRealizedGain: 97
    });
  });
});


  it('restores persisted cashflow fee allocations when fresh broker rows omit them', () => {
    const freshBrokerRow = {
      id: 'sell-42',
      side: 'sell',
      commission: 1.25,
      profit: 100,
      marginFeeAllocations: {},
      marginFee: 0,
      feesAndCommissions: 1.25,
      netProfit: 98.75
    };
    const persistedRow = {
      id: 'sell-42',
      side: 'sell',
      commission: 1.25,
      profit: 100,
      marginFeeAllocations: { 'fee-2026-01-01': 2.5, 'fee-2026-01-02': 1.5 },
      marginFee: 4,
      feesAndCommissions: 5.25,
      netProfit: 94.75
    };

    expect(preservePersistedBrokerFeeAllocations([freshBrokerRow], [persistedRow])[0]).toMatchObject({
      id: 'sell-42',
      marginFeeAllocations: { 'fee-2026-01-01': 2.5, 'fee-2026-01-02': 1.5 },
      marginFee: 4,
      feesAndCommissions: 5.25,
      netProfit: 94.75
    });
  });

  it('does not replace freshly calculated allocations with saved metadata', () => {
    const fresh = {
      id: 'sell-42',
      marginFeeAllocations: { 'new-fee': 1 },
      marginFee: 1,
      feesAndCommissions: 2,
      netProfit: 98
    };
    const stale = {
      id: 'sell-42',
      marginFeeAllocations: { 'old-fee': 5 },
      marginFee: 5,
      feesAndCommissions: 6,
      netProfit: 94
    };
    expect(preservePersistedBrokerFeeAllocations([fresh], [stale])[0]).toBe(fresh);
  });

describe('closed-history idempotency and source deduplication', () => {
  it('preserves object identity when broker allocations have not changed', () => {
    const sell = {
      id: 'sell-1',
      side: 'sell',
      commission: 1.25,
      profit: 100,
      marginFeeAllocations: { fee1: 2 },
      marginFee: 2,
      feesAndCommissions: 3.25,
      netProfit: 96.75
    };
    const result = applyCashflowAllocationsToBrokerExecutions([sell], new Map([[0, { fee1: 2 }]]));
    expect(result[0]).toBe(sell);
  });

  it('does not fabricate net P/L when an app trade has no known realized profit', () => {
    const trade = { feesAndCommissions: 4, marginFee: 2, netProfit: null, netRealizedGain: null };
    const result = applyCashflowAllocationsToClosedTrades([trade], new Map([[0, 3]]))[0];
    expect(result).toMatchObject({ feesAndCommissions: 5, totalCommissions: 5, marginFee: 3, marginInterest: 3 });
    expect(result.netProfit).toBeNull();
    expect(result.netRealizedGain).toBeNull();
  });

  it('uses the non-zero margin fee when legacy margin fields disagree', () => {
    const trade = { feesAndCommissions: 7, totalCommissions: 7, marginInterest: 0, marginFee: 5, netProfit: 93, netRealizedGain: 93 };
    const result = applyCashflowAllocationsToClosedTrades([trade], new Map([[0, 2]]))[0];
    expect(result).toMatchObject({ feesAndCommissions: 4, totalCommissions: 4, marginFee: 2, marginInterest: 2, netProfit: 96 });
  });

  it('preserves object identity when app trade allocation is already applied', () => {
    const trade = {
      feesAndCommissions: 5,
      totalCommissions: 5,
      marginInterest: 2,
      marginFee: 2,
      netProfit: 95,
      netRealizedGain: 95
    };
    const result = applyCashflowAllocationsToClosedTrades([trade], new Map([[0, 2]]));
    expect(result[0]).toBe(trade);
  });

  it('uses broker rows for overlapping app trades without removing distinct app trades', () => {
    const duplicate = { trade: { ticker: 'AAPL.US', exitDate: '2026-01-10T10:00:00Z', shares: 5 }, source: 'app' };
    const distinct = { trade: { ticker: 'MSFT', exitDate: '2026-01-10T10:00:00Z', shares: 3 }, source: 'app' };
    const broker = { trade: { ticker: 'AAPL', exitDate: '2026-01-10T12:00:00Z', shares: 5 }, source: 'tradenet' };
    expect(deduplicateClosedHistoryRows([duplicate, distinct], [broker])).toEqual([distinct]);
  });

  it('deduplicates one-to-one so repeated partial closes are not all discarded', () => {
    const make = (id: string, source: string) => ({
      trade: { id, ticker: 'AAPL', exitDate: '2026-01-10T10:00:00Z', shares: 5 },
      source
    });
    expect(deduplicateClosedHistoryRows([make('app-1', 'app'), make('app-2', 'app')], [make('broker-1', 'tradenet')]))
      .toEqual([make('app-2', 'app')]);
  });
});


describe('closed-trade fee display breakdown', () => {
  it('does not count an aggregate margin-inclusive fee total as commission again', () => {
    expect(resolveClosedTradeFeeBreakdown({
      feesAndCommissions: 7,
      totalCommissions: 7,
      marginFee: 5,
      marginInterest: 5
    })).toEqual({ fees: 5, commissions: 2, feesTotal: 7, commissionsKnown: true });
  });

  it('prefers explicit commission fields and uses non-zero legacy margin fallback', () => {
    expect(resolveClosedTradeFeeBreakdown({
      commissions: 1.25,
      feesAndCommissions: 6.25,
      marginFee: 5,
      marginInterest: 0
    })).toEqual({ fees: 5, commissions: 1.25, feesTotal: 6.25, commissionsKnown: true });
  });

  it('treats legacy totalCommissions as commission when no aggregate field exists', () => {
    expect(resolveClosedTradeFeeBreakdown({
      totalCommissions: 1.5,
      marginInterest: 2
    })).toEqual({ fees: 2, commissions: 1.5, feesTotal: 3.5, commissionsKnown: true });
  });
});

it('marks commission totals unknown when no commission source field exists', () => {
  expect(resolveClosedTradeFeeBreakdown({ marginFee: 2 }))
    .toEqual({ fees: 2, commissions: 0, feesTotal: 2, commissionsKnown: false });
});

describe('closed-trade net profit resolution', () => {
  it('uses explicit net P/L when available', () => {
    expect(resolveClosedTradeNetProfit(
      { netProfit: 8, grossProfit: 20 },
      { fees: 5, commissions: 2, feesTotal: 7, commissionsKnown: true }
    )).toBe(8);
  });

  it('subtracts all known commissions and margin fees from gross P/L', () => {
    expect(resolveClosedTradeNetProfit(
      { grossProfit: 20 },
      { fees: 5, commissions: 2, feesTotal: 7, commissionsKnown: true }
    )).toBe(13);
  });

  it('does not report gross P/L as net when commission data is unavailable', () => {
    expect(resolveClosedTradeNetProfit(
      { grossProfit: 20 },
      { fees: 5, commissions: 0, feesTotal: 5, commissionsKnown: false }
    )).toBeNull();
  });

  it('preserves unknown profit when no net or gross source value exists', () => {
    expect(resolveClosedTradeNetProfit(
      {},
      { fees: 0, commissions: 0, feesTotal: 0, commissionsKnown: false }
    )).toBeNull();
  });
});


it('treats legacy totalCommissions as commission-only when no aggregate fee field exists', () => {
  const trade = {
    totalCommissions: 4,
    marginInterest: 2,
    marginFee: 2,
    netProfit: 94,
    netRealizedGain: 94
  };
  const result = applyCashflowAllocationsToClosedTrades([trade], new Map([[0, 3]]))[0];
  expect(result).toMatchObject({
    feesAndCommissions: 7,
    totalCommissions: 7,
    marginInterest: 3,
    marginFee: 3,
    netProfit: 93
  });
});

describe('bounded broker execution history merge', () => {
  it('retains older executions and replaces refreshed rows by stable trade ID', () => {
    const older = { id: 'old-1', ticker: 'AAPL', side: 'buy', quantity: 5, executedAt: '2025-01-01T10:00:00Z' };
    const refreshed = { id: 'recent-1', ticker: 'AAPL', side: 'sell', quantity: 5, executedAt: '2026-01-01T10:00:00Z' };
    const corrected = { ...refreshed, profit: 12 };
    const merged = mergeBrokerExecutionHistory([older, refreshed], [corrected]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(older);
    expect(merged[1]).toMatchObject({ id: 'recent-1', profit: 12 });
  });

  it('deduplicates repeated persisted pages while retaining distinct operation IDs', () => {
    const a = { id: 'trade-a', ticker: 'AAPL', quantity: 1 };
    const b = { id: 'trade-b', ticker: 'AAPL', quantity: 1 };
    expect(mergeBrokerExecutionHistory([a, b, a], [a, b])).toEqual([a, b]);
  });
});
