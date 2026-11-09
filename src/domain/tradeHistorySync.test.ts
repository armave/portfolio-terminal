import { describe, expect, it } from 'vitest';
import { getLatestClosedTradeCheckpoint, getLatestClosedTradeDate } from './tradeHistorySync';

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

  it('changes the checkpoint when another execution appears on the same latest trade date', () => {
    const initial = getLatestClosedTradeCheckpoint([
      { id: 'sell-1', side: 'SELL', executedAt: '2026-10-29T14:30:00Z' }
    ]);
    const updated = getLatestClosedTradeCheckpoint([
      { id: 'sell-1', side: 'SELL', executedAt: '2026-10-29T14:30:00Z' },
      { id: 'sell-2', side: 'SELL', executedAt: '2026-10-29T15:00:00Z' }
    ]);
    expect(initial).not.toBe(updated);
  });

  it('does not change the checkpoint when the latest closed-trade snapshot is unchanged', () => {
    const trades = [
      { id: 'sell-1', side: 'SELL', executedAt: '2026-10-29T14:30:00Z' },
      { id: 'buy-1', side: 'BUY', executedAt: '2026-10-30T10:00:00Z' }
    ];
    expect(getLatestClosedTradeCheckpoint(trades)).toBe(getLatestClosedTradeCheckpoint([...trades]));
  });

  it('returns no checkpoint when there are no dated closed trades', () => {
    expect(getLatestClosedTradeCheckpoint()).toBeUndefined();
  });
});
