import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS } from './brokerAssumptions';
import { calculateMarginRiskMetrics } from './marginRisk';
import type { BrokerAssumptions } from '../types/portfolio';

function assumptions(overrides: Partial<BrokerAssumptions> = {}): BrokerAssumptions {
  return { ...DEFAULT_BROKER_ASSUMPTIONS, ...overrides };
}

describe('calculateMarginRiskMetrics', () => {
  it('calculates equity ratio and thresholds from total portfolio assets', () => {
    const metrics = calculateMarginRiskMetrics(500, 1000, 100, DEFAULT_BROKER_ASSUMPTIONS);

    expect(metrics.assets).toBe(1100);
    expect(metrics.equity).toBe(600);
    expect(metrics.equityRatio).toBeCloseTo(600 / 1100);
    expect(metrics.marginCallAssetsRequired).toBeCloseTo(500 / 0.9);
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
    expect(metrics.showRiskTriggers).toBe(false);
  });

  it('reports a maintenance call while remaining above the stop-out threshold', () => {
    const rules = assumptions({ maintenanceEquityRatio: 0.2, stopOutRatio: 0.05 });
    const metrics = calculateMarginRiskMetrics(900, 900, 100, rules);

    expect(metrics.assets).toBe(1000);
    expect(metrics.equityRatio).toBeCloseTo(0.1);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(false);
    expect(metrics.showRiskTriggers).toBe(true);
  });

  it('shows a maintenance trigger at exact threshold equality', () => {
    const rules = assumptions({ maintenanceEquityRatio: 0.1, stopOutRatio: 0 });
    const metrics = calculateMarginRiskMetrics(90, 95, 5, rules);

    expect(metrics.assets).toBe(100);
    expect(metrics.marginCallAssetsRequired).toBe(100);
    expect(metrics.marginCallBufferPct).toBe(0);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(false);
  });

  it('reports stop-out when total assets reach or fall below the stop-out requirement', () => {
    const metrics = calculateMarginRiskMetrics(1000, 800, 100, DEFAULT_BROKER_ASSUMPTIONS);

    expect(metrics.assets).toBe(900);
    expect(metrics.equity).toBe(-100);
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
