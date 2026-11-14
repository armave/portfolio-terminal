import { describe, expect, it } from 'vitest';
import { calculateFreedomMarginFeeAllocations } from './freedomMarginFees';
import { mergeFreedomCashflowRows } from './freedomCashflows';
import { applyCashflowAllocationsToBrokerExecutions } from './closedHistoryFees';

const fee = (id: string, date: string, amount: number, currency = 'USD') => ({
  id: `freedom-${id}`,
  date,
  type: 'Margin Fee',
  amount,
  currency,
  raw: { comment: 'Negative cash balance fee' }
});

describe('Freedom margin fee allocation', () => {
  it('allocates a daily fee across open FIFO-matched sale exposure and preserves every cent', () => {
    const executions = [
      { id: 'buy-a', ticker: 'AAPL.US', side: 'buy', quantity: 10, price: 100, executedAt: '2026-01-01T10:00:00Z' },
      { id: 'buy-b', ticker: 'MSFT', side: 'buy', quantity: 10, price: 200, executedAt: '2026-01-01T10:01:00Z' },
      { id: 'sell-a', ticker: 'AAPL', side: 'sell', quantity: 10, price: 120, executedAt: '2026-01-03T10:00:00Z' },
      { id: 'sell-b', ticker: 'MSFT.US', side: 'sell', quantity: 10, price: 220, executedAt: '2026-01-04T10:00:00Z' }
    ];
    const result = calculateFreedomMarginFeeAllocations([fee('daily', '2026-01-02', -0.05)], executions);
    expect(result.brokerAllocations.get(2)).toEqual({ 'freedom-daily': 0.02 });
    expect(result.brokerAllocations.get(3)).toEqual({ 'freedom-daily': 0.03 });
    expect(result.allocatedAmount).toBe(0.05);
    expect(result.matchedFeeRows).toBe(1);
  });

  it('splits a daily margin fee between a partial close and the still-open buy lot', () => {
    const executions = [
      { id: 'margin-buy', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, executedAt: '2026-11-01T10:00:00Z' },
      { id: 'partial-sale', ticker: 'AAPL', side: 'sell', quantity: 4, price: 110, executedAt: '2026-11-04T10:00:00Z' }
    ];
    const trancheId = `AAPL:${Date.parse('2026-11-01T10:00:00Z')}:margin-buy`;
    const result = calculateFreedomMarginFeeAllocations(
      [fee('stage-split', '2026-11-02', -1)],
      executions,
      [],
      { trancheTypes: { [trancheId]: 'margin' } }
    );

    expect(result.brokerAllocations.get(1)).toEqual({ 'freedom-stage-split': 0.4 });
    expect(result.brokerOpenAllocations.get(0)).toEqual({ 'freedom-stage-split': 0.6 });
    expect(result.closedAllocatedAmount).toBe(0.4);
    expect(result.openAllocatedAmount).toBe(0.6);
    expect(result.allocatedAmount).toBe(1);
    expect(result.closedAllocatedAmount + result.openAllocatedAmount).toBe(result.allocatedAmount);

    // Recalculate after the remaining six shares close. The previously open
    // sixty cents must move to the second sale rather than remain on the buy lot.
    const fullyClosed = calculateFreedomMarginFeeAllocations(
      [fee('stage-split', '2026-11-02', -1)],
      [
        ...executions,
        { id: 'final-sale', ticker: 'AAPL', side: 'sell', quantity: 6, price: 115, executedAt: '2026-11-06T10:00:00Z' }
      ],
      [],
      { trancheTypes: { [trancheId]: 'margin' } }
    );
    expect(fullyClosed.brokerAllocations.get(1)).toEqual({ 'freedom-stage-split': 0.4 });
    expect(fullyClosed.brokerAllocations.get(2)).toEqual({ 'freedom-stage-split': 0.6 });
    expect(fullyClosed.brokerOpenAllocations.size).toBe(0);
    expect(fullyClosed.closedAllocatedAmount).toBe(1);
    expect(fullyClosed.openAllocatedAmount).toBe(0);
  });

  it('allocates only the margin-funded portion of a mixed tranche', () => {
    const executedAt = '2026-11-01T10:00:00Z';
    const trancheId = `AAPL:${Date.parse(executedAt)}:mixed-buy`;
    const executions = [
      { id: 'mixed-buy', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, executedAt },
      { id: 'mixed-sale', ticker: 'AAPL', side: 'sell', quantity: 4, price: 110, executedAt: '2026-11-04T10:00:00Z' }
    ];
    const result = calculateFreedomMarginFeeAllocations(
      [fee('mixed-stage', '2026-11-02', -1)],
      executions,
      [],
      {
        trancheTypes: { [trancheId]: 'mix' },
        trancheMixes: { [trancheId]: { cash: 6, margin: 4 } }
      }
    );

    expect(result.brokerAllocations.get(1)).toEqual({ 'freedom-mixed-stage': 0.4 });
    expect(result.brokerOpenAllocations.get(0)).toEqual({ 'freedom-mixed-stage': 0.6 });
    expect(result.allocatedAmount).toBe(1);
  });

  it('does not attach financing cashflows to explicitly cash-funded sales or open lots', () => {
    const executedAt = '2026-11-01T10:00:00Z';
    const trancheId = `AAPL:${Date.parse(executedAt)}:cash-buy`;
    const executions = [
      { id: 'cash-buy', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, executedAt },
      { id: 'cash-sale', ticker: 'AAPL', side: 'sell', quantity: 10, price: 110, executedAt: '2026-11-04T10:00:00Z' }
    ];
    const result = calculateFreedomMarginFeeAllocations(
      [fee('cash-only', '2026-11-02', -1)],
      executions,
      [],
      { trancheTypes: { [trancheId]: 'cash' } }
    );

    expect(result.brokerAllocations.size).toBe(0);
    expect(result.brokerOpenAllocations.size).toBe(0);
    expect(result.allocatedAmount).toBe(0);
    expect(result.matchedFeeRows).toBe(0);
  });

  it('splits app-only fallback fees between a closed trade and an active margin position', () => {
    const result = calculateFreedomMarginFeeAllocations(
      [fee('app-open', '2026-11-02', -1)],
      [],
      [{
        buyDate: '2026-11-01',
        sellDate: '2026-11-04',
        shares: 4,
        entryPrice: 100
      }],
      {
        openAppPositions: {
          AAPL: {
            ticker: 'AAPL',
            shares: 6,
            tranches: [{ qty: 6, price: 100, date: '2026-11-01' }]
          }
        }
      }
    );

    expect(result.appAllocations.get(0)).toBe(0.4);
    expect(result.appOpenAllocations.get('AAPL')).toEqual({ 'freedom-app-open': 0.6 });
    expect(result.closedAllocatedAmount).toBe(0.4);
    expect(result.openAllocatedAmount).toBe(0.6);
    expect(result.allocatedAmount).toBe(1);
  });

  it('uses FIFO partial-close segments and stable original execution indices', () => {
    const executions = [
      { id: 'buy-1', ticker: 'AAPL', side: 'buy', quantity: 10, price: 100, executedAt: '2026-02-01T10:00:00Z' },
      { id: 'buy-2', ticker: 'AAPL', side: 'buy', quantity: 10, price: 200, executedAt: '2026-02-02T10:00:00Z' },
      { id: 'sell-1', ticker: 'AAPL', side: 'sell', quantity: 15, price: 180, executedAt: '2026-02-03T10:00:00Z' },
      { id: 'sell-2', ticker: 'AAPL', side: 'sell', quantity: 5, price: 190, executedAt: '2026-02-04T10:00:00Z' }
    ];
    const result = calculateFreedomMarginFeeAllocations([fee('fifo', '2026-02-02', -10.01)], executions);
    expect(result.brokerAllocations.get(2)).toEqual({ 'freedom-fifo': 6.67 });
    expect(result.brokerAllocations.get(3)).toEqual({ 'freedom-fifo': 3.34 });
    expect(result.allocatedAmount).toBe(10.01);
  });

  it('conserves a one-cent USD fee in the normalized execution contract', () => {
    const executions = [
      { id: 'buy-cent', ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, executedAt: '2026-10-01T10:00:00Z' },
      { id: 'sell-cent', ticker: 'AAPL', side: 'sell', quantity: 1, price: 110, executedAt: '2026-10-03T10:00:00Z' }
    ];
    const result = calculateFreedomMarginFeeAllocations([fee('one-cent', '2026-10-02', -0.01)], executions);
    expect(result.brokerAllocations.get(1)).toEqual({ 'freedom-one-cent': 0.01 });
    expect(result.allocatedAmount).toBe(0.01);
    expect(result.matchedFeeRows).toBe(1);
  });

  it('does not allocate known non-USD cashflows or trade commissions to USD trade P/L', () => {
    const executions = [
      { ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, executedAt: '2026-03-01T10:00:00Z' },
      { ticker: 'AAPL', side: 'sell', quantity: 1, price: 110, executedAt: '2026-03-03T10:00:00Z' }
    ];
    const rows = [
      fee('amd', '2026-03-02', -100, 'AMD'),
      { ...fee('commission', '2026-03-02', -1), type: 'Trading Fee' }
    ];
    const result = calculateFreedomMarginFeeAllocations(rows, executions);
    expect(result.brokerAllocations.size).toBe(0);
    expect(result.allocatedAmount).toBe(0);
  });

  it('falls back to closed app trades only when broker executions are absent', () => {
    const trades = [
      { buyDate: '2026-04-01', sellDate: '2026-04-04', shares: 1, entryPrice: 100 },
      { buyDate: '2026-04-01', sellDate: '2026-04-04', shares: 2, entryPrice: 100 }
    ];
    const result = calculateFreedomMarginFeeAllocations([fee('app', '2026-04-02', -0.05)], [], trades);
    expect(result.appAllocations.get(0)).toBe(0.02);
    expect(result.appAllocations.get(1)).toBe(0.03);
  });

  it('ignores legacy imported rows and fees that have no matching open exposure', () => {
    const executions = [
      { ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, executedAt: '2026-05-01T10:00:00Z' },
      { ticker: 'AAPL', side: 'sell', quantity: 1, price: 110, executedAt: '2026-05-02T10:00:00Z' }
    ];
    const legacy = { ...fee('legacy', '2026-05-01', -5), id: 'cashflow-legacy' };
    const future = fee('future', '2026-05-03', -5);
    const result = calculateFreedomMarginFeeAllocations([legacy, future], executions);
    expect(result.brokerAllocations.size).toBe(0);
    expect(result.matchedFeeRows).toBe(0);
  });
});

describe('empty cashflow snapshots', () => {
  it('produces empty allocations so stale saved fees can be cleared', () => {
    const result = calculateFreedomMarginFeeAllocations([], [
      { side: 'sell', commission: 1, profit: 10, marginFeeAllocations: { old: 5 } }
    ]);
    expect(result.brokerAllocations.size).toBe(0);
    expect(result.appAllocations.size).toBe(0);
  });
});

it('does not mix known foreign-currency executions into USD financing-fee weights', () => {
  const executions = [
    { ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, currency: 'USD', executedAt: '2026-07-01T10:00:00Z' },
    { ticker: 'BMW', side: 'buy', quantity: 1, price: 100, currency: 'EUR', executedAt: '2026-07-01T10:00:00Z' },
    { ticker: 'AAPL', side: 'sell', quantity: 1, price: 110, currency: 'USD', executedAt: '2026-07-03T10:00:00Z' },
    { ticker: 'BMW', side: 'sell', quantity: 1, price: 110, currency: 'EUR', executedAt: '2026-07-03T10:00:00Z' }
  ];
  const result = calculateFreedomMarginFeeAllocations([fee('usd-only', '2026-07-02', -1)], executions);
  expect(result.brokerAllocations.get(2)).toEqual({ 'freedom-usd-only': 1 });
  expect(result.brokerAllocations.has(3)).toBe(false);
});

describe('Freedom cashflow correction propagation', () => {
  it('replaces a corrected operation amount in Closed History without accumulating the prior fee', () => {
    const executions = [
      { id: 'margin-buy', ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, currency: 'USD', executedAt: '2026-11-01T10:00:00Z' },
      { id: 'margin-sell', ticker: 'AAPL', side: 'sell', quantity: 1, price: 110, currency: 'USD', commission: 1.25, profit: 10, executedAt: '2026-11-04T10:00:00Z' }
    ];
    const trancheId = `AAPL:${Date.parse('2026-11-01T10:00:00Z')}:margin-buy`;
    const fundingOptions = { trancheTypes: { [trancheId]: 'margin' as const } };
    const original = fee('corrected-operation', '2026-11-02', -1);
    const initialHistory = mergeFreedomCashflowRows([], [original]);
    const initialAllocations = calculateFreedomMarginFeeAllocations(initialHistory, executions, [], fundingOptions);
    const initialExecution = applyCashflowAllocationsToBrokerExecutions(
      executions,
      initialAllocations.brokerAllocations,
      initialAllocations.brokerOpenAllocations
    );

    expect(initialExecution[1]).toMatchObject({
      marginFeeAllocations: { 'freedom-corrected-operation': 1 },
      marginFee: 1,
      feesAndCommissions: 2.25,
      netProfit: 7.75
    });

    const corrected = { ...original, amount: -1.75, raw: { ...original.raw, corrected: 'true' } };
    const correctedHistory = mergeFreedomCashflowRows(initialHistory, [corrected]);
    const correctedAllocations = calculateFreedomMarginFeeAllocations(
      correctedHistory,
      executions,
      [],
      fundingOptions
    );
    const correctedExecution = applyCashflowAllocationsToBrokerExecutions(
      initialExecution,
      correctedAllocations.brokerAllocations,
      correctedAllocations.brokerOpenAllocations
    );

    expect(correctedHistory).toHaveLength(1);
    expect(correctedAllocations.allocatedAmount).toBe(1.75);
    expect(correctedExecution[1]).toMatchObject({
      marginFeeAllocations: { 'freedom-corrected-operation': 1.75 },
      marginFee: 1.75,
      feesAndCommissions: 3,
      netProfit: 7
    });
  });
});
