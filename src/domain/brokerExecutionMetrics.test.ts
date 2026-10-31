import { describe, expect, it } from 'vitest';
import { calculateBrokerExecutionMetrics, normalizeExecutionTicker } from './brokerExecutionMetrics';

describe('broker execution FIFO metrics', () => {
  it('normalizes broker symbol suffixes before matching buy and sell lots', () => {
    expect(normalizeExecutionTicker('aapl.us')).toBe('AAPL');
    const buy = { ticker: 'AAPL.US', side: 'buy', quantity: 10, commission: 1, executedAt: '2026-01-01T10:00:00Z' };
    const sell = { ticker: 'AAPL', side: 'sell', quantity: 10, commission: 2, executedAt: '2026-01-03T10:00:00Z' };
    expect(calculateBrokerExecutionMetrics([buy, sell]).get(sell)).toEqual({ holdingDays: 2, buyCommission: 1 });
  });

  it('allocates buy commission proportionally across partial FIFO sells', () => {
    const buy = { ticker: 'MSFT', side: 'buy', quantity: 10, commission: 2, executedAt: '2026-02-01T00:00:00Z' };
    const firstSell = { ticker: 'MSFT.US', side: 'sell', quantity: 4, commission: 0.5, executedAt: '2026-02-02T00:00:00Z' };
    const secondSell = { ticker: 'MSFT', side: 'sell', quantity: 6, commission: 0.75, executedAt: '2026-02-03T00:00:00Z' };
    const metrics = calculateBrokerExecutionMetrics([buy, firstSell, secondSell]);
    expect(metrics.get(firstSell)?.buyCommission).toBe(0.8);
    expect(metrics.get(secondSell)?.buyCommission).toBe(1.2);
    expect(metrics.get(firstSell)?.holdingDays).toBe(1);
    expect(metrics.get(secondSell)?.holdingDays).toBe(2);
  });

  it('does not invent complete duration or buy commission when the buy history is incomplete', () => {
    const partialSell = { ticker: 'AAPL', side: 'sell', quantity: 5, commission: 1, executedAt: '2026-03-03T00:00:00Z' };
    expect(calculateBrokerExecutionMetrics([partialSell]).get(partialSell))
      .toEqual({ holdingDays: null, buyCommission: null });
  });

  it('keeps duration but marks commission incomplete when the buy commission is missing', () => {
    const buy = { ticker: 'AAPL', side: 'buy', quantity: 5, executedAt: '2026-03-01T00:00:00Z' };
    const sell = { ticker: 'AAPL', side: 'sell', quantity: 5, commission: 1, executedAt: '2026-03-03T00:00:00Z' };
    expect(calculateBrokerExecutionMetrics([buy, sell]).get(sell))
      .toEqual({ holdingDays: 2, buyCommission: null });
  });
});

it('marks foreign-currency buy commissions incomplete instead of adding them to USD P/L', () => {
  const buy = { ticker: 'AAPL', side: 'buy', quantity: 1, commission: 2, commissionCurrency: 'EUR', executedAt: '2026-08-01T00:00:00Z' };
  const sell = { ticker: 'AAPL', side: 'sell', quantity: 1, commission: 1, commissionCurrency: 'USD', executedAt: '2026-08-02T00:00:00Z' };
  expect(calculateBrokerExecutionMetrics([buy, sell]).get(sell))
    .toEqual({ holdingDays: 1, buyCommission: null });
});
