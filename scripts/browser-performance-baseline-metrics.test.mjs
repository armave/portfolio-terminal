import { describe, expect, it } from 'vitest';
import {
  parsePerformanceSampleCount,
  summarizePerformanceSamples,
  summarizePerformanceViewport
} from './browser-performance-baseline-metrics.mjs';

describe('parsePerformanceSampleCount', () => {
  it('uses the fallback for an omitted value', () => {
    expect(parsePerformanceSampleCount(undefined, 3)).toBe(3);
  });

  it('accepts integer sample counts from one through twenty', () => {
    expect(parsePerformanceSampleCount('10')).toBe(10);
    expect(parsePerformanceSampleCount(20)).toBe(20);
  });

  it('rejects invalid or unbounded sample counts', () => {
    for (const value of ['0', '-1', '1.5', 'abc', '21']) {
      expect(() => parsePerformanceSampleCount(value)).toThrow(RangeError);
    }
  });
});

describe('summarizePerformanceSamples', () => {
  it('reports distributions without converting missing measurements to zero', () => {
    expect(summarizePerformanceSamples([
      { fcp: 10 },
      { fcp: null },
      { fcp: 20 },
      { fcp: Number.NaN },
      { fcp: 30 }
    ], 'fcp')).toEqual({
      sampleCount: 3,
      min: 10,
      median: 20,
      p95: 30,
      max: 30,
      mean: 20,
      variance: expect.closeTo(66.6666666667),
      standardDeviation: expect.closeTo(Math.sqrt(66.6666666667))
    });
  });

  it('uses the midpoint average for an even-sized sample', () => {
    expect(summarizePerformanceSamples([{ fcp: 10 }, { fcp: 20 }, { fcp: 30 }, { fcp: 40 }], 'fcp').median).toBe(25);
  });

  it('returns null statistics when a metric has no valid samples', () => {
    expect(summarizePerformanceSamples([{ fcp: null }, { fcp: 'missing' }], 'fcp')).toEqual({
      sampleCount: 0,
      min: null,
      median: null,
      p95: null,
      max: null,
      mean: null,
      variance: null,
      standardDeviation: null
    });
  });

  it('summarizes all viewport metrics without inventing missing values', () => {
    const summary = summarizePerformanceViewport([
      { elapsedToAuthReadyMs: 100, firstContentfulPaintMs: null, totalResourceTransferBytes: 1_000 },
      { elapsedToAuthReadyMs: 120, firstContentfulPaintMs: 80, totalResourceTransferBytes: 1_200 }
    ]);
    expect(summary.elapsedToAuthReadyMs.median).toBe(110);
    expect(summary.firstContentfulPaintMs.sampleCount).toBe(1);
    expect(summary.largestContentfulPaintMs.sampleCount).toBe(0);
    expect(summary.totalResourceTransferBytes.median).toBe(1_100);
  });
});
