import { describe, expect, it } from 'vitest';
import {
  buildPerformanceEnvironmentMetadata,
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


describe('buildPerformanceEnvironmentMetadata', () => {
  it('records host, browser, runner, and viewport details for reproducibility', () => {
    expect(buildPerformanceEnvironmentMetadata({
      platform: 'linux',
      osRelease: '6.8.0',
      architecture: 'x64',
      nodeVersion: 'v22.12.0',
      cpuModel: 'Example CPU',
      logicalCpuCount: 4,
      runnerImageOS: 'ubuntu24',
      runnerImageVersion: '20261101.1',
      browserName: 'Chromium',
      browserVersion: '140.0',
      headless: true,
      viewports: [{ name: 'desktop', width: 1440, height: 900 }]
    })).toEqual({
      platform: 'linux',
      osRelease: '6.8.0',
      architecture: 'x64',
      nodeVersion: 'v22.12.0',
      cpuModel: 'Example CPU',
      logicalCpuCount: 4,
      runnerImageOS: 'ubuntu24',
      runnerImageVersion: '20261101.1',
      browserName: 'Chromium',
      browserVersion: '140.0',
      headless: true,
      viewports: [{ name: 'desktop', width: 1440, height: 900 }]
    });
  });

  it('retains unavailable environment facts as null rather than inventing defaults', () => {
    expect(buildPerformanceEnvironmentMetadata({
      logicalCpuCount: 0,
      viewports: [{ name: 'mobile', width: 390, height: undefined }]
    })).toEqual({
      platform: null,
      osRelease: null,
      architecture: null,
      nodeVersion: null,
      cpuModel: null,
      logicalCpuCount: null,
      runnerImageOS: null,
      runnerImageVersion: null,
      browserName: null,
      browserVersion: null,
      headless: false,
      viewports: [{ name: 'mobile', width: 390, height: null }]
    });
  });
});
