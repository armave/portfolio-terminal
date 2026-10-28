import { describe, expect, it } from 'vitest';
import {
  applyCashflowAllocationsToBrokerExecutions,
  applyCashflowAllocationsToClosedTrades,
  deduplicateClosedHistoryRows,
  preservePersistedBrokerFeeAllocations
} from './closedHistoryFees';

describe('closed-history cashflow fee recalculation', () => {
  it('replaces old broker fee allocations with the currently imported cashflows', () => {
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
