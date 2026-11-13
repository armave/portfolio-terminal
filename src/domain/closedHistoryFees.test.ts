import { describe, expect, it } from 'vitest';
import {
  aggregateOpenBrokerMarginFeeAllocationsByTicker,
  applyCashflowAllocationsToBrokerExecutions,
  applyCashflowAllocationsToMarginPositions,
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

  it('stores the open-share fee remainder separately on its buy execution and clears it later', () => {
    const buy = { id: 'buy-1', side: 'buy', openMarginFeeAllocations: { old: 5 }, openMarginFee: 5 };
    const updated = applyCashflowAllocationsToBrokerExecutions(
      [buy],
      new Map(),
      new Map([[0, { 'fee-2026-11-02': 0.6 }]])
    )[0];
    expect(updated).toMatchObject({
      openMarginFeeAllocations: { 'fee-2026-11-02': 0.6 },
      openMarginFee: 0.6
    });

    const cleared = applyCashflowAllocationsToBrokerExecutions([updated], new Map(), new Map())[0];
    expect(cleared).toMatchObject({ openMarginFeeAllocations: {}, openMarginFee: 0 });
  });

  it('does not count non-USD commissions in the USD closed-trade fee total', () => {
    const sell = {
      id: 'sell-usd',
      side: 'sell',
      currency: 'USD',
      commissionCurrency: 'EUR',
      commission: 2,
      profit: 100
    };
    expect(applyCashflowAllocationsToBrokerExecutions(
      [sell],
      new Map([[0, { 'fee-usd': 1 }]])
    )[0]).toMatchObject({
      feesAndCommissions: 1,
      marginFee: 1,
      netProfit: 99
    });
  });

  it('aggregates open broker lot fees to the active position by ticker', () => {
    const allocations = aggregateOpenBrokerMarginFeeAllocationsByTicker([
      { side: 'buy', ticker: 'AAPL.US' },
      { side: 'buy', ticker: 'AAPL' },
      { side: 'sell', ticker: 'AAPL' }
    ], new Map<number, Record<string, number>>([
      [0, { 'fee-1': 0.2 }],
      [1, { 'fee-1': 0.3, 'fee-2': 0.1 }],
      [2, { 'fee-3': 5 }]
    ]));

    expect(allocations.get('AAPL')).toEqual({ 'fee-1': 0.5, 'fee-2': 0.1 });
  });

  it('keeps broker cashflow fees separate from modeled position margin charges', () => {
    const position = {
      ticker: 'AAPL',
      shares: 6,
      marginCharged: 3.25,
      tranches: [{ qty: 6, price: 100 }]
    };
    const updated = applyCashflowAllocationsToMarginPositions(
      { AAPL: position },
      new Map([['AAPL', { 'fee-open': 0.6 }]])
    ).AAPL;

    expect(updated).toMatchObject({
      marginCharged: 3.25,
      brokerMarginFeeAllocations: { 'fee-open': 0.6 },
      brokerMarginFee: 0.6
    });
    const cleared = applyCashflowAllocationsToMarginPositions(
      { AAPL: updated },
      new Map()
    ).AAPL;
    expect(cleared).toMatchObject({ marginCharged: 3.25, brokerMarginFeeAllocations: {}, brokerMarginFee: 0 });
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

  it('restores persisted open-buy fee allocations when a fresh broker row omits them', () => {
    const freshBuyRow = { id: 'buy-91', side: 'buy' };
    const persistedBuyRow = {
      id: 'buy-91',
      side: 'buy',
      openMarginFeeAllocations: { 'fee-2026-01-01': 2.5 },
      openMarginFee: 2.5
    };
    expect(preservePersistedBrokerFeeAllocations([freshBuyRow], [persistedBuyRow])[0]).toMatchObject({
      openMarginFeeAllocations: { 'fee-2026-01-01': 2.5 },
      openMarginFee: 2.5
    });
  });

  it('does not resurrect stale open fees after the open bucket was explicitly cleared', () => {
    const clearedBuyRow = {
      id: 'buy-92',
      side: 'buy',
      openMarginFeeAllocations: {},
      openMarginFee: 0
    };
    const staleBuyRow = {
      id: 'buy-92',
      side: 'buy',
      openMarginFeeAllocations: { 'old-fee': 1.5 },
      openMarginFee: 1.5
    };
    expect(preservePersistedBrokerFeeAllocations([clearedBuyRow], [staleBuyRow])[0]).toBe(clearedBuyRow);
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

  it('preserves sale linkage and fee metadata identity across app fee recalculation', () => {
    const trade = {
      id: 'closed-sale-1',
      transactionEventId: 'sale-event-1',
      ticker: 'AAPL',
      shares: 2,
      feesAndCommissions: 8,
      totalCommissions: 8,
      marginInterest: 5,
      marginFee: 5,
      netProfit: 92,
      netRealizedGain: 92,
      brokerNote: 'retained metadata'
    };

    const recalculated = applyCashflowAllocationsToClosedTrades([trade], new Map([[0, 2]]))[0];
    expect(recalculated).toMatchObject({
      id: 'closed-sale-1',
      transactionEventId: 'sale-event-1',
      ticker: 'AAPL',
      feesAndCommissions: 5,
      totalCommissions: 5,
      marginInterest: 2,
      marginFee: 2,
      netProfit: 95,
      netRealizedGain: 95,
      brokerNote: 'retained metadata'
    });
    expect(applyCashflowAllocationsToClosedTrades([recalculated], new Map([[0, 2]]))[0]).toBe(recalculated);
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

  it('uses the larger legacy margin alias when both stored fields disagree', () => {
    expect(resolveClosedTradeFeeBreakdown({
      feesAndCommissions: 7,
      totalCommissions: 7,
      marginInterest: 2,
      marginFee: 5
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
  it('retains the complete displayed cache when an incremental response contains one recent sale', () => {
    const cached = Array.from({ length: 77 }, (_, index) => ({
      id: 'cached-' + index,
      ticker: index === 76 ? 'META' : 'OLD' + index,
      side: 'sell',
      executedAt: '2026-10-' + String(Math.max(1, 28 - Math.floor(index / 3))).padStart(2, '0') + 'T10:00:00Z'
    }));
    const incrementalPage = [{
      id: 'cached-76',
      ticker: 'META',
      side: 'sell',
      executedAt: '2026-10-29T10:00:00Z',
      profit: 12
    }];
    const merged = mergeBrokerExecutionHistory(cached, incrementalPage);
    expect(merged).toHaveLength(77);
    expect(merged.find((trade) => trade.id === 'cached-0')).toBeDefined();
    expect(merged.find((trade) => trade.id === 'cached-76')).toMatchObject({ profit: 12 });
  });

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

it('falls through empty preferred fields to the next valid commission and net P/L aliases', () => {
  const breakdown = resolveClosedTradeFeeBreakdown({
    commissions: '',
    commission: 1.25,
    marginFee: 2
  });
  expect(breakdown).toEqual({ fees: 2, commissions: 1.25, feesTotal: 3.25, commissionsKnown: true });
  expect(resolveClosedTradeNetProfit(
    { netProfit: '', netRealizedGain: 8 },
    breakdown
  )).toBe(8);
});
