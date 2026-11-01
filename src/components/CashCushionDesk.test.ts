import { describe, expect, it } from 'vitest';
import { formatDailyQuoteRange } from './CashCushionDesk';
import { mergeBrokerExecutionHistory } from '../domain/closedHistoryFees';

describe('cash holdings daily quote range', () => {
  it('formats the actual high and low prices instead of placeholder text', () => {
    expect(formatDailyQuoteRange({ high: 123.45, low: 120 })).toBe('H 123.45 / L 120.00');
  });
});

describe('Balance cache-first history retention', () => {
  it('keeps all cached executions when a refresh returns only one newer row', () => {
    const cached = Array.from({ length: 77 }, (_, index) => ({
      id: 'balance-trade-' + index,
      ticker: 'T' + index,
      side: 'buy',
      executedAt: '2026-10-01T10:00:00Z'
    }));
    const refreshed = [{
      id: 'balance-trade-76',
      ticker: 'T76',
      side: 'buy',
      executedAt: '2026-10-29T10:00:00Z',
      price: 125
    }];

    const merged = mergeBrokerExecutionHistory(cached, refreshed);

    expect(merged).toHaveLength(77);
    expect(merged.find((trade) => trade.id === 'balance-trade-0')).toBeDefined();
    expect(merged.find((trade) => trade.id === 'balance-trade-76')).toMatchObject({ price: 125 });
  });
});
