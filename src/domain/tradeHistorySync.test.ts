import { describe, expect, it } from 'vitest';
import { getLatestClosedTradeDate } from './tradeHistorySync';

describe('latest closed trade date for incremental TradeNet synchronization', () => {
  it('uses the newest broker sell and ignores a newer opening buy', () => {
    expect(getLatestClosedTradeDate([
      { side: 'SELL', executedAt: '2026-10-29T14:30:00' },
      { side: 'BUY', executedAt: '2026-10-31T10:00:00' },
      { side: 'sell', executedAt: '2026-10-30T09:00:00' }
    ])).toBe('2026-10-30');
  });

  it('includes the newest app-owned closed trade in the combined table', () => {
    expect(getLatestClosedTradeDate(
      [{ side: 'SELL', executedAt: '2026-10-29T14:30:00Z' }],
      [{ ticker: 'MSFT', exitDate: '2026-10-31T11:00:00Z' }]
    )).toBe('2026-10-31');
  });

  it('handles Excel serial dates and returns no cursor for an empty trade cache', () => {
    expect(getLatestClosedTradeDate([], [{ date: 46300 }])).toBe('2026-10-05');
    expect(getLatestClosedTradeDate()).toBeUndefined();
  });
});
