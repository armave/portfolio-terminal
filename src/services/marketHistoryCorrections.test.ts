import { describe, expect, it } from 'vitest';
import {
  applyMarketHistoryCorrectionsToResult,
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
    expect(result.issues[0]).toContain('before/after value');
  });

  it('treats provider values at an intermediate or final revision as idempotently replayed', () => {
    const first = correction(original, corrected, timestamp + 100);
    const finalPoint = { ...corrected, price: 102 };
    const second = correction(corrected, finalPoint, timestamp + 200);
    const journal = mergeMarketHistoryCorrectionEvents([], [first, second]);

    expect(replayMarketHistoryCorrections([corrected], journal)).toMatchObject({
      status: 'complete', appliedCount: 1, points: [finalPoint]
    });
    expect(replayMarketHistoryCorrections([finalPoint], journal)).toMatchObject({
      status: 'complete', appliedCount: 0, points: [finalPoint]
    });
  });

  it('does not partially apply a multi-candle correction journal when one candle conflicts', () => {
    const timestampTwo = timestamp + 86_400_000;
    const secondOriginal = { timestamp: timestampTwo, price: 80 };
    const firstCorrection = correction(original, corrected, timestamp + 100);
    const conflictingCorrection = createMarketHistoryCorrectionEvent({
      symbol: 'AAPL',
      interval: '1D',
      timestamp: timestampTwo,
      provider: 'USER',
      receivedAt: timestamp + 10,
      recordedAt: timestamp + 200,
      previous: { timestamp: timestampTwo, price: 90 },
      corrected: { timestamp: timestampTwo, price: 91 },
      reason: 'Conflicting correction baseline.'
    });
    const source = [original, secondOriginal];
    const result = replayMarketHistoryCorrections(source, [firstCorrection, conflictingCorrection]);
    expect(result).toMatchObject({ status: 'review_required', appliedCount: 0, points: source });
  });

  it('applies matching correction chains to history results and withholds conflicting corrections', () => {
    const first = correction(original, corrected, timestamp + 100);
    const finalPoint = { ...corrected, price: 102 };
    const second = correction(corrected, finalPoint, timestamp + 200);
    const source = {
      points: [original],
      observedAt: timestamp,
      freshness: 'fresh' as const,
      session: 'REGULAR' as const,
      delayClass: 'unknown' as const,
      quality: 'complete' as const,
      issues: [],
      provider: 'FINNHUB',
      receivedAt: timestamp + 20,
      interval: 'D'
    };
    const applied = applyMarketHistoryCorrectionsToResult(source, 'AAPL', '1D', [first, second]);
    expect(applied).toMatchObject({
      status: 'applied',
      correctionCount: 2,
      appliedCount: 2,
      result: {
        points: [finalPoint],
        quality: 'partial',
        correctionStatus: 'applied'
      }
    });

    const conflict = applyMarketHistoryCorrectionsToResult({
      ...source, points: [{ timestamp, price: 95 }]
    }, 'AAPL', '1D', [first]);
    expect(conflict).toMatchObject({
      status: 'review_required',
      appliedCount: 0,
      result: { points: [{ timestamp, price: 95 }], correctionStatus: 'review_required', quality: 'partial' }
    });
  });

  it('rejects unsafe or unbounded candle timestamps in correction evidence', () => {
    expect(() => createMarketHistoryCorrectionEvent({
      symbol: 'AAPL', interval: '1D', timestamp: Number.MAX_SAFE_INTEGER + 1,
      provider: 'USER', receivedAt: timestamp + 1, recordedAt: timestamp + 2,
      previous: null,
      corrected: { timestamp: Number.MAX_SAFE_INTEGER + 1, price: 100 },
      reason: 'Invalid timestamp.'
    })).toThrow('valid instrument, interval, timestamps');
    expect(replayMarketHistoryCorrections([{ timestamp: Number.POSITIVE_INFINITY, price: 100 }], []))
      .toMatchObject({ status: 'review_required', appliedCount: 0 });
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
