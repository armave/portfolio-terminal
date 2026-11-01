import { describe, expect, it } from 'vitest';
import { calculateTargetUpsidePercent, sentimentLabel } from './sentiment';

describe('market sentiment helpers', () => {
  it('labels each sentiment direction', () => {
    expect(sentimentLabel('bullish')).toBe('Bullish');
    expect(sentimentLabel('bearish')).toBe('Bearish');
    expect(sentimentLabel('neutral')).toBe('Neutral');
    expect(sentimentLabel('unknown')).toBe('No signal');
  });

  it('calculates analyst target upside and downside percentages', () => {
    expect(calculateTargetUpsidePercent(120, 100)).toBe(20);
    expect(calculateTargetUpsidePercent(80, 100)).toBe(-20);
    expect(calculateTargetUpsidePercent(100, 100)).toBe(0);
  });

  it('returns no percentage for invalid inputs or non-finite results', () => {
    expect(calculateTargetUpsidePercent(100, 0)).toBeUndefined();
    expect(calculateTargetUpsidePercent(100, -1)).toBeUndefined();
    expect(calculateTargetUpsidePercent(0, 100)).toBeUndefined();
    expect(calculateTargetUpsidePercent(Number.NaN, 100)).toBeUndefined();
    expect(calculateTargetUpsidePercent(Number.POSITIVE_INFINITY, 100)).toBeUndefined();
    expect(calculateTargetUpsidePercent(Number.MAX_VALUE, Number.MIN_VALUE)).toBeUndefined();
  });
});
