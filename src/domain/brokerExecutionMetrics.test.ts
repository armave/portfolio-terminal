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

  it('accepts allowlisted legacy aliases and numeric strings at the broker boundary', () => {
    const buy = {
      ticker: 'AAPL.US',
      side: '1',
      shares: '2',
      commission: '0.50',
      currency: 'USD',
      date: '2026-02-01T00:00:00Z'
    };
    const sell = {
      ticker: 'AAPL',
      side: '2',
      quantity: '2',
      commission: '0.25',
      commissionCurrency: 'USD',
      executedAt: '2026-02-03T00:00:00Z'
    };

    expect(calculateBrokerExecutionMetrics([buy, sell]).get(sell)).toEqual({
      holdingDays: 2,
      buyCommission: 0.5
    });
  });

  it('ignores malformed quantities and dates rather than inventing FIFO metrics', () => {
    const malformedBuy = {
      ticker: 'AAPL',
      side: 'buy',
      quantity: 'not-a-number',
      commission: '1.00',
      executedAt: '2026-02-01T00:00:00Z'
    };
    const sell = {
      ticker: 'AAPL',
      side: 'sell',
      quantity: 2,
      commission: 0.25,
      executedAt: '2026-02-03T00:00:00Z'
    };
    const invalidDateBuy = {
      ticker: 'MSFT',
      side: 'buy',
      quantity: 2,
      commission: 1,
      date: 'not-a-date'
    };
    const msftSell = {
      ticker: 'MSFT',
      side: 'sell',
      quantity: 2,
      commission: 0.25,
      executedAt: '2026-02-03T00:00:00Z'
    };

    const metrics = calculateBrokerExecutionMetrics([malformedBuy, sell, invalidDateBuy, msftSell]);
    expect(metrics.get(sell)).toEqual({ holdingDays: null, buyCommission: null });
    expect(metrics.get(msftSell)).toEqual({ holdingDays: null, buyCommission: null });
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

it('preserves every cent of a small buy commission across multiple partial sells', () => {
  const buy = { ticker: 'AAPL', side: 'buy', quantity: 3, commission: 0.01, executedAt: '2026-09-01T00:00:00Z' };
  const firstSell = { ticker: 'AAPL', side: 'sell', quantity: 1, commission: 0, executedAt: '2026-09-02T00:00:00Z' };
  const secondSell = { ticker: 'AAPL', side: 'sell', quantity: 1, commission: 0, executedAt: '2026-09-03T00:00:00Z' };
  const finalSell = { ticker: 'AAPL', side: 'sell', quantity: 1, commission: 0, executedAt: '2026-09-04T00:00:00Z' };
  const metrics = calculateBrokerExecutionMetrics([buy, firstSell, secondSell, finalSell]);
  const allocated = [
    metrics.get(firstSell)?.buyCommission ?? 0,
    metrics.get(secondSell)?.buyCommission ?? 0,
    metrics.get(finalSell)?.buyCommission ?? 0
  ];
  expect(allocated.reduce((sum, amount) => sum + amount, 0)).toBe(0.01);
  expect(allocated).toEqual([0, 0, 0.01]);
});
