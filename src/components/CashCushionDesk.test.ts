import { describe, expect, it } from 'vitest';
import { formatDailyQuoteRange } from './CashCushionDesk';

describe('cash holdings daily quote range', () => {
  it('formats the actual high and low prices instead of placeholder text', () => {
    expect(formatDailyQuoteRange({ high: 123.45, low: 120 })).toBe('H 123.45 / L 120.00');
  });
});
