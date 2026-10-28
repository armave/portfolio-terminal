import { describe, expect, it } from 'vitest';
import {
  applyCashflowAllocationsToBrokerExecutions,
  applyCashflowAllocationsToClosedTrades
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
      netProfit: 97.75
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
      netProfit: 100
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
