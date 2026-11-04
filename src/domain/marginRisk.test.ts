import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS } from './brokerAssumptions';
import { calculateMarginRiskMetrics } from './marginRisk';

describe('calculateMarginRiskMetrics', () => {
  it('calculates equity ratio and configured maintenance/stop-out buffers', () => {
    const metrics = calculateMarginRiskMetrics(500, 1000, 100, DEFAULT_BROKER_ASSUMPTIONS);

    expect(metrics.assets).toBe(1100);
    expect(metrics.equity).toBe(600);
    expect(metrics.equityRatio).toBeCloseTo(600 / 1100);
    expect(metrics.marginCallAssetsRequired).toBeCloseTo(500 / 0.9);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(true);
    expect(metrics.showRiskTriggers).toBe(true);
  });

  it('does not claim a margin trigger when debt is absent', () => {
    const metrics = calculateMarginRiskMetrics(0, 1000, 100, DEFAULT_BROKER_ASSUMPTIONS);

    expect(metrics.equityRatio).toBe(1);
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
    expect(metrics.showRiskTriggers).toBe(false);
  });
});
