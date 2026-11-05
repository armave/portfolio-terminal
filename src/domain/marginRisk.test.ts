import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS } from './brokerAssumptions';
import { calculateMarginRiskMetrics, type AvailableMarginRiskMetrics, type MarginRiskResult } from './marginRisk';
import type { BrokerAssumptions } from '../types/portfolio';

function available(result: MarginRiskResult): AvailableMarginRiskMetrics {
  if (result.status !== 'available') {
    throw new Error(`Expected available margin-risk metrics, received ${result.reason}`);
  }
  return result;
}

function assumptions(overrides: Partial<BrokerAssumptions> = {}): BrokerAssumptions {
  return { ...DEFAULT_BROKER_ASSUMPTIONS, ...overrides };
}

describe('calculateMarginRiskMetrics', () => {
  it('calculates equity ratio and configured maintenance/stop-out buffers', () => {
    const metrics = available(calculateMarginRiskMetrics(500, 1000, 100, DEFAULT_BROKER_ASSUMPTIONS));

    expect(metrics.assets).toBe(1100);
    expect(metrics.equity).toBe(600);
    expect(metrics.equityRatio).toBeCloseTo(600 / 1100);
    expect(metrics.marginCallAssetsRequired).toBeCloseTo(500 / 0.9);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(true);
    expect(metrics.showRiskTriggers).toBe(true);
  });

  it('preserves the no-debt result for a normally valued portfolio', () => {
    const metrics = available(calculateMarginRiskMetrics(0, 1000, 100, DEFAULT_BROKER_ASSUMPTIONS));

    expect(metrics.equityRatio).toBe(1);
    expect(metrics.marginCallBufferPct).toBe(100);
    expect(metrics.stopOutBufferPct).toBe(100);
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
    expect(metrics.showRiskTriggers).toBe(false);
  });

  it('keeps zero assets and zero debt available while representing undefined ratios explicitly', () => {
    const metrics = available(calculateMarginRiskMetrics(0, 0, 0, DEFAULT_BROKER_ASSUMPTIONS));

    expect(metrics.assets).toBe(0);
    expect(metrics.equity).toBe(0);
    expect(metrics.equityRatio).toBeNull();
    expect(metrics.marginCallBufferPct).toBeNull();
    expect(metrics.stopOutBufferPct).toBeNull();
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
    expect(metrics.showRiskTriggers).toBe(false);
  });

  it('does not turn zero assets with outstanding debt into an infinite ratio or hidden trigger', () => {
    const metrics = available(calculateMarginRiskMetrics(50, 0, 0, DEFAULT_BROKER_ASSUMPTIONS));

    expect(metrics.equity).toBe(-50);
    expect(metrics.equityRatio).toBeNull();
    expect(metrics.marginCallBufferPct).toBeNull();
    expect(metrics.stopOutBufferPct).toBeNull();
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(true);
    expect(metrics.showRiskTriggers).toBe(true);
  });

  it('keeps negative equity finite and classifies it below configured thresholds', () => {
    const metrics = available(calculateMarginRiskMetrics(200, 100, 0, DEFAULT_BROKER_ASSUMPTIONS));

    expect(metrics.equity).toBe(-100);
    expect(metrics.equityRatio).toBe(-1);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(true);
    expect(metrics.showRiskTriggers).toBe(true);
    expect(Object.values(metrics).filter((value): value is number => typeof value === 'number')
      .every(Number.isFinite)).toBe(true);
  });

  it('handles exact maintenance-threshold equality without rounding or non-finite output', () => {
    const metrics = available(calculateMarginRiskMetrics(
      90,
      100,
      0,
      assumptions({ maintenanceEquityRatio: 0.1, stopOutRatio: 0 })
    ));

    expect(metrics.equityRatio).toBeCloseTo(0.1);
    expect(metrics.marginCallAssetsRequired).toBe(100);
    expect(metrics.marginCallBufferPct).toBe(0);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showRiskTriggers).toBe(true);
    expect(Object.values(metrics).filter((value): value is number => typeof value === 'number')
      .every(Number.isFinite)).toBe(true);
  });

  it('accepts the zero maintenance and stop-out boundary', () => {
    const metrics = available(calculateMarginRiskMetrics(
      25,
      75,
      25,
      assumptions({ maintenanceEquityRatio: 0, stopOutRatio: 0 })
    ));

    expect(metrics.marginCallAssetsRequired).toBe(25);
    expect(metrics.stopOutAssetsRequired).toBe(25);
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
  });

  it.each([
    ['negative debt', -1, 100, 10],
    ['negative position value', 1, -100, 10],
    ['negative collateral', 1, 100, -10],
    ['NaN debt', Number.NaN, 100, 10],
    ['infinite position value', 1, Number.POSITIVE_INFINITY, 10],
    ['infinite collateral', 1, 100, Number.POSITIVE_INFINITY],
    ['negative infinite debt', Number.NEGATIVE_INFINITY, 100, 10]
  ])('rejects %s', (_label, debt, positionValue, collateral) => {
    expect(calculateMarginRiskMetrics(debt, positionValue, collateral, DEFAULT_BROKER_ASSUMPTIONS))
      .toEqual({ status: 'unavailable', reason: 'invalid-financial-inputs' });
  });

  it.each([
    ['negative maintenance ratio', { maintenanceEquityRatio: -0.01 }],
    ['maintenance ratio at one', { maintenanceEquityRatio: 1 }],
    ['non-finite maintenance ratio', { maintenanceEquityRatio: Number.NaN }],
    ['infinite maintenance ratio', { maintenanceEquityRatio: Number.POSITIVE_INFINITY }],
    ['negative stop-out ratio', { stopOutRatio: -0.01 }],
    ['stop-out above maintenance', { stopOutRatio: 0.11 }],
    ['non-finite stop-out ratio', { stopOutRatio: Number.NaN }],
    ['infinite stop-out ratio', { stopOutRatio: Number.POSITIVE_INFINITY }]
  ])('rejects %s', (_label, override) => {
    expect(calculateMarginRiskMetrics(50, 100, 10, assumptions(override)))
      .toEqual({ status: 'unavailable', reason: 'invalid-broker-assumptions' });
  });

  it('rejects missing broker assumptions instead of throwing or returning misleading metrics', () => {
    expect(calculateMarginRiskMetrics(
      50,
      100,
      10,
      undefined as unknown as BrokerAssumptions
    )).toEqual({ status: 'unavailable', reason: 'invalid-broker-assumptions' });
  });

  it('reports calculation overflow as unavailable', () => {
    expect(calculateMarginRiskMetrics(
      Number.MAX_VALUE,
      Number.MAX_VALUE,
      0,
      DEFAULT_BROKER_ASSUMPTIONS
    )).toEqual({ status: 'unavailable', reason: 'calculation-overflow' });

    expect(calculateMarginRiskMetrics(
      Number.MAX_VALUE,
      0,
      0,
      assumptions({ maintenanceEquityRatio: 1 - Number.EPSILON })
    )).toEqual({ status: 'unavailable', reason: 'calculation-overflow' });
  });
});
