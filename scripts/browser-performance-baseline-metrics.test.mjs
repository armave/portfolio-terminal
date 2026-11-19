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
      p25: 10,
      median: 20,
      p75: 30,
      p95: 30,
      max: 30,
      mean: 20,
      variance: expect.closeTo(66.6666666667),
      standardDeviation: expect.closeTo(Math.sqrt(66.6666666667)),
      interquartileRange: 20,
      outlierRunNumbers: []
    });
  });

  it('uses the midpoint average for an even-sized sample', () => {
    expect(summarizePerformanceSamples([{ fcp: 10 }, { fcp: 20 }, { fcp: 30 }, { fcp: 40 }], 'fcp').median).toBe(25);
  });

  it('returns null statistics when a metric has no valid samples', () => {
    expect(summarizePerformanceSamples([{ fcp: null }, { fcp: 'missing' }], 'fcp')).toEqual({
      sampleCount: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      p95: null,
      max: null,
      mean: null,
      variance: null,
      standardDeviation: null,
      interquartileRange: null,
      outlierRunNumbers: []
    });
  });

  it('summarizes all viewport metrics without inventing missing values', () => {
    const summary = summarizePerformanceViewport([
      { authShellReadyMs: 100, firstContentfulPaintMs: null, totalResourceTransferBytes: 1_000 },
      { authShellReadyMs: 120, firstContentfulPaintMs: 80, totalResourceTransferBytes: 1_200 }
    ]);
    expect(summary.authShellReadyMs.median).toBe(110);
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


describe('authenticated performance stage summaries', () => {
  it('summarizes stage, resource, DOM and optional heap measurements', () => {
    const summary = summarizePerformanceViewport([
      {
        run: 1, authShellReadyMs: 100, authenticationMs: 200,
        fixtureHydrationMs: 300, brokerRefreshAndParityMs: 400,
        portfolioRenderReadyMs: 500, tradesDeskReadyMs: 600,
        elapsedToPortfolioReadyMs: 1500, elapsedToTradesDeskReadyMs: 2100,
        firstContentfulPaintMs: null, totalResourceTransferBytes: 1000,
        heapUsedBytes: null, domNodeCount: 250
      },
      {
        run: 2, authShellReadyMs: 120, authenticationMs: 180,
        fixtureHydrationMs: 320, brokerRefreshAndParityMs: 380,
        portfolioRenderReadyMs: 480, tradesDeskReadyMs: 620,
        elapsedToPortfolioReadyMs: 1500, elapsedToTradesDeskReadyMs: 2120,
        firstContentfulPaintMs: 80, totalResourceTransferBytes: 1200,
        heapUsedBytes: 8000000, domNodeCount: 270
      }
    ]);

    expect(summary.authShellReadyMs.median).toBe(110);
    expect(summary.authenticationMs.median).toBe(190);
    expect(summary.fixtureHydrationMs.median).toBe(310);
    expect(summary.brokerRefreshAndParityMs.median).toBe(390);
    expect(summary.portfolioRenderReadyMs.median).toBe(490);
    expect(summary.tradesDeskReadyMs.median).toBe(610);
    expect(summary.elapsedToPortfolioReadyMs.median).toBe(1500);
    expect(summary.elapsedToTradesDeskReadyMs.median).toBe(2110);
    expect(summary.firstContentfulPaintMs.sampleCount).toBe(1);
    expect(summary.heapUsedBytes.sampleCount).toBe(1);
    expect(summary.totalResourceTransferBytes.median).toBe(1100);
    expect(summary.domNodeCount.median).toBe(260);
  });

  it('reports Tukey outlier sample numbers without losing their original run IDs', () => {
    const summary = summarizePerformanceSamples([
      { run: 1, metric: 1 }, { run: 2, metric: 2 },
      { run: 3, metric: 3 }, { run: 4, metric: 4 },
      { run: 5, metric: 5 }, { run: 6, metric: 100 }
    ], 'metric');
    expect(summary).toMatchObject({
      p25: 2, p75: 5, interquartileRange: 3, outlierRunNumbers: [6]
    });
  });
});


describe('extended baseline sample contract', () => {
  it('accepts ten desktop/mobile samples without coercing unsupported browser metrics', () => {
    const samples = Array.from({ length: 10 }, (_, run) => ({
      run: run + 1,
      authShellReadyMs: 100 + run,
      firstContentfulPaintMs: run === 9 ? null : 80 + run,
      totalResourceTransferBytes: 296_000,
      largestContentfulPaintMs: null,
      cumulativeLayoutShift: null
    }));
    const summary = summarizePerformanceSamples(samples, 'authShellReadyMs');
    expect(summary.sampleCount).toBe(10);
    expect(summary.median).toBe(104.5);
    expect(summary.p95).toBe(109);
    expect(summarizePerformanceSamples(samples, 'largestContentfulPaintMs').sampleCount).toBe(0);
    expect(summarizePerformanceSamples(samples, 'cumulativeLayoutShift').median).toBeNull();
  });
});
