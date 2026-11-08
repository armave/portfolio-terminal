import { describe, expect, it } from 'vitest';
import {
  createMarketHistoryCorrectionEvent,
  isMarketHistoryCorrectionEvent,
  mergeMarketHistoryCorrectionEvents,
  replayMarketHistoryCorrections
} from './marketHistoryCorrections';

const timestamp = 1_793_966_400_000;
const original = { timestamp, price: 100, open: 99, high: 101, low: 98, volume: 1_000 };
const corrected = { timestamp, price: 101, open: 99, high: 102, low: 98, volume: 1_100 };

function correction(previous: typeof original | null, next: typeof original | null, recordedAt = timestamp + 100) {
  return createMarketHistoryCorrectionEvent({
    symbol: 'AAPL',
    interval: '1D',
    timestamp,
    provider: 'Finnhub',
    receivedAt: timestamp + 10,
    recordedAt,
    previous,
    corrected: next,
    reason: 'Verified provider correction.'
  });
}

describe('market history correction journal', () => {
  it('records immutable before/after values and replays the correction deterministically', () => {
    const event = correction(original, corrected);
    expect(isMarketHistoryCorrectionEvent(event)).toBe(true);
    expect(event).toMatchObject({
      schemaVersion: 1,
      symbol: 'AAPL',
      interval: '1D',
      previous: original,
      corrected
    });
    const replayed = replayMarketHistoryCorrections([original], [event]);
    expect(replayed).toMatchObject({
      status: 'complete',
      appliedCount: 1,
      points: [corrected]
    });
    expect(replayMarketHistoryCorrections(replayed.points, [event])).toMatchObject({
      status: 'complete',
      appliedCount: 0,
      points: [corrected]
    });
  });

  it('replays sequential corrections in recorded order and retains both revisions', () => {
    const first = correction(original, corrected, timestamp + 100);
    const second = correction(corrected, { ...corrected, price: 102 }, timestamp + 200);
    const journal = mergeMarketHistoryCorrectionEvents([], [second, first]);
    expect(journal.map(item => item.recordedAt)).toEqual([first.recordedAt, second.recordedAt]);
    expect(replayMarketHistoryCorrections([original], journal)).toMatchObject({
      status: 'complete',
      appliedCount: 2,
      points: [{ timestamp, price: 102 }]
    });
  });

  it('stops for review when the current candle no longer matches the before-value', () => {
    const event = correction(original, corrected);
    const result = replayMarketHistoryCorrections([{ timestamp, price: 95 }], [event]);
    expect(result.status).toBe('review_required');
    expect(result.points).toEqual([{ timestamp, price: 95 }]);
    expect(result.issues[0]).toContain('before-value');
  });

  it('supports an explicit candle removal and rejects reused source IDs with different evidence', () => {
    const removal = correction(original, null);
    expect(replayMarketHistoryCorrections([original], [removal])).toMatchObject({
      status: 'complete', points: []
    });
    const first = correction(original, corrected);
    const reused = { ...first, corrected: { ...corrected, price: 103 } };
    expect(() => mergeMarketHistoryCorrectionEvents([first], [reused])).toThrow('reused for different evidence');
  });
});
