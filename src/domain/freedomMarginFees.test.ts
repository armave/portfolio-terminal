import { describe, expect, it } from 'vitest';
import { calculateFreedomMarginFeeAllocations } from './freedomMarginFees';

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
