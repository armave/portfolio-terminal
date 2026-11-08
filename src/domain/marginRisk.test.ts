import { describe, expect, it } from 'vitest';
import { DEFAULT_BROKER_ASSUMPTIONS } from './brokerAssumptions';
import {
  ACCOUNT_EQUITY_HEALTH_REFERENCE,
  calculateMarginRiskMetrics,
  calculateMarginRiskSnapshot,
  getMarginRiskLevel
} from './marginRisk';
import type { BrokerAssumptions } from '../types/portfolio';

function assumptions(overrides: Partial<BrokerAssumptions> = {}): BrokerAssumptions {
  return { ...DEFAULT_BROKER_ASSUMPTIONS, ...overrides };
}
function riskInput(overrides: Partial<Parameters<typeof calculateMarginRiskSnapshot>[0]> = {}) {
  return {
    currency: 'USD',
    longExposure: 1_000,
    shortExposure: 0,
    cashBalance: 100,
    marginDebt: 500,
    eligibleCollateral: 100,
    eligibleCollateralSource: 'broker' as const,
    assumptions: DEFAULT_BROKER_ASSUMPTIONS,
    quality: 'current' as const,
    freshness: 'fresh' as const,
    observedAt: Date.UTC(2026, 10, 8, 7, 0),
    calculatedAt: Date.UTC(2026, 10, 8, 7, 1),
    brokerRequirements: {
      currency: 'USD',
      initialMarginRequired: 450,
      maintenanceMarginRequired: 120,
      concentrationAddOn: 10,
      observedAt: Date.UTC(2026, 10, 8, 7, 0)
    },
    ...overrides
  };
}

describe('calculateMarginRiskSnapshot', () => {
  it('keeps long assets, short liabilities, cash and margin debt separate', () => {
    const result = calculateMarginRiskSnapshot(riskInput({
      longExposure: 1_000, shortExposure: 300, cashBalance: 400, marginDebt: 200,
      eligibleCollateral: 250
    }));
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.assets).toBe(1_400);
    expect(result.value.grossExposure).toBe(1_300);
    expect(result.value.netExposure).toBe(700);
    expect(result.value.equity).toBe(900);
    expect(result.value.eligibleCollateral).toBe(250);
    expect(result.value.collateralCoverageRatio).toBe(1.25);
  });

  it('does not count short liabilities as positive assets in the equity-ratio denominator', () => {
    const result = calculateMarginRiskSnapshot(riskInput({
      longExposure: 100, shortExposure: 100, cashBalance: 100, marginDebt: 0,
      eligibleCollateral: 100
    }));
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.assets).toBe(200);
    expect(result.value.equity).toBe(100);
    expect(result.value.equityRatio).toBe(0.5);
    expect(result.value.grossExposure).toBe(200);
  });

  it('uses broker-reported maintenance and initial requirements separately from concentration add-ons', () => {
    const result = calculateMarginRiskSnapshot(riskInput());
    expect(result.status).toBe('available');
    if (result.status === 'unavailable') return;
    expect(result.value.initialMarginRequirement).toEqual({ amount: 450, source: 'broker' });
    expect(result.value.maintenanceMarginRequirement).toEqual({ amount: 120, source: 'broker' });
    expect(result.value.concentrationAddOn).toEqual({ amount: 10, source: 'broker' });
    expect(result.value.totalMaintenanceRequirement).toBe(130);
    expect(result.value.maintenanceBuffer).toBe(470);
  });

  it('does not turn missing initial margin or concentration add-ons into zero', () => {
    const result = calculateMarginRiskSnapshot(riskInput({ brokerRequirements: null }));
    expect(result.status).toBe('provisional');
    if (result.status === 'unavailable') return;
    expect(result.value.initialMarginRequirement).toEqual({ amount: null, source: 'unavailable' });
    expect(result.value.concentrationAddOn).toEqual({ amount: null, source: 'unavailable' });
    expect(result.value.totalMaintenanceRequirement).toBeNull();
    expect(result.value.maintenanceBuffer).toBeNull();
    expect(result.value.maintenanceState).toBe('unknown');
    expect(result.value.showMarginCall).toBe(false);
    expect(result.value.marginCallValue).toBeNull();
    expect(Number.isFinite(result.value.baseMaintenanceBuffer)).toBe(true);
    expect(result.warnings.some(item => item.includes('Initial margin requirement is unavailable'))).toBe(true);
    expect(result.warnings.some(item => item.includes('Concentration add-on is unavailable'))).toBe(true);
  });

  it('deducts margin debt exactly once from equity', () => {
    const lowerDebt = calculateMarginRiskSnapshot(riskInput({ marginDebt: 200 }));
    const higherDebt = calculateMarginRiskSnapshot(riskInput({ marginDebt: 300 }));
    expect(lowerDebt.status).not.toBe('unavailable');
    expect(higherDebt.status).not.toBe('unavailable');
    if (lowerDebt.status === 'unavailable' || higherDebt.status === 'unavailable') return;
    expect(lowerDebt.value.equity - higherDebt.value.equity).toBe(100);
    expect(lowerDebt.value.assets).toBe(higherDebt.value.assets);
  });

  it('reports a definite maintenance breach even when the concentration add-on is unknown', () => {
    const result = calculateMarginRiskSnapshot(riskInput({
      longExposure: 100,
      cashBalance: 0,
      marginDebt: 100,
      eligibleCollateral: 0,
      brokerRequirements: null
    }));
    expect(result.status).toBe('provisional');
    if (result.status === 'unavailable') return;
    expect(result.value.baseMaintenanceBuffer).toBeLessThan(0);
    expect(result.value.maintenanceBuffer).toBeNull();
    expect(result.value.maintenanceState).toBe('maintenance-breach');
    expect(result.value.showMarginCall).toBe(true);
  });

  it('marks configured collateral and stale market inputs provisional', () => {
    const result = calculateMarginRiskSnapshot(riskInput({
      eligibleCollateralSource: 'configured-assumption',
      freshness: 'stale',
      observedAt: null
    }));
    expect(result.status).toBe('provisional');
    if (result.status === 'unavailable') return;
    expect(result.value.quality).toBe('provisional');
    expect(result.warnings.some(item => item.includes('configured assumption'))).toBe(true);
    expect(result.warnings.some(item => item.includes('freshness cannot be confirmed'))).toBe(true);
  });

  it('fails closed when collateral is unknown while margin debt exists', () => {
    const result = calculateMarginRiskSnapshot(riskInput({ eligibleCollateral: null }));
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toContain('eligible collateral is unknown');
  });

  it('rejects currency mismatches and invalid financial inputs', () => {
    expect(calculateMarginRiskSnapshot(riskInput({
      brokerRequirements: { ...riskInput().brokerRequirements!, currency: 'AMD' }
    })).status).toBe('unavailable');
    expect(calculateMarginRiskSnapshot(riskInput({ shortExposure: -1 })).status).toBe('unavailable');
    expect(calculateMarginRiskSnapshot(riskInput({ marginDebt: Number.NaN })).status).toBe('unavailable');
    expect(calculateMarginRiskSnapshot(riskInput({ assumptions: assumptions({ maintenanceEquityRatio: 1 }) })).status).toBe('unavailable');
    expect(calculateMarginRiskSnapshot(riskInput({ observedAt: Date.UTC(2026, 10, 9) })).status).toBe('unavailable');
  });

  it('estimates a long-only price trigger only when configured maintenance assumptions and add-ons are explicit', () => {
    const configuredRequirements = {
      currency: 'USD',
      initialMarginRequired: 450,
      maintenanceMarginRequired: null,
      concentrationAddOn: 0,
      concentrationAddOnSource: 'configured-assumption' as const,
      observedAt: Date.UTC(2026, 10, 8, 7, 0)
    };
    const longOnly = calculateMarginRiskSnapshot(riskInput({
      shortExposure: 0, brokerRequirements: configuredRequirements
    }));
    const mixed = calculateMarginRiskSnapshot(riskInput({
      shortExposure: 200, brokerRequirements: configuredRequirements
    }));
    expect(longOnly.status).toBe('provisional');
    expect(mixed.status).toBe('provisional');
    if (longOnly.status === 'unavailable' || mixed.status === 'unavailable') return;
    expect(longOnly.value.marginCallValue).not.toBeNull();
    expect(longOnly.value.concentrationAddOn.source).toBe('configured-assumption');
    expect(mixed.value.marginCallValue).toBeNull();
    expect(mixed.value.marginCallBufferPct).toBeNull();
  });
});

describe('legacy margin metrics adapter', () => {
  it('preserves the long-only calculation contract for existing consumers', () => {
    const metrics = calculateMarginRiskMetrics(500, 1_000, 100, DEFAULT_BROKER_ASSUMPTIONS);
    expect(metrics.assets).toBe(1_100);
    expect(metrics.equity).toBe(600);
    expect(metrics.equityRatio).toBeCloseTo(600 / 1_100);
    expect(metrics.marginCallAssetsRequired).toBeCloseTo(500 / 0.9);
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
  });

  it('reports a maintenance call at exact threshold equality', () => {
    const rules = assumptions({ maintenanceEquityRatio: 0.1, stopOutRatio: 0 });
    const metrics = calculateMarginRiskMetrics(90, 95, 5, rules);
    expect(metrics.assets).toBe(100);
    expect(metrics.marginCallAssetsRequired).toBe(100);
    expect(metrics.marginCallBufferPct).toBe(0);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(false);
  });

  it('reports stop-out when total assets reach or fall below the stop-out requirement', () => {
    const metrics = calculateMarginRiskMetrics(1_000, 800, 100, DEFAULT_BROKER_ASSUMPTIONS);
    expect(metrics.assets).toBe(900);
    expect(metrics.equity).toBe(-100);
    expect(metrics.showMarginCall).toBe(true);
    expect(metrics.showStopOut).toBe(true);
  });

  it('does not claim a margin trigger when debt is absent', () => {
    const metrics = calculateMarginRiskMetrics(0, 1_000, 100, DEFAULT_BROKER_ASSUMPTIONS);
    expect(metrics.equityRatio).toBe(1);
    expect(metrics.showMarginCall).toBe(false);
    expect(metrics.showStopOut).toBe(false);
  });
});

describe('account equity health status', () => {
  it('matches the 40% reference shown on the account-health meter', () => {
    expect(ACCOUNT_EQUITY_HEALTH_REFERENCE).toBe(0.4);
    expect(getMarginRiskLevel(0.2618, DEFAULT_BROKER_ASSUMPTIONS)).toBe('Elevated');
    expect(getMarginRiskLevel(0.3999, DEFAULT_BROKER_ASSUMPTIONS)).toBe('Elevated');
    expect(getMarginRiskLevel(0.4, DEFAULT_BROKER_ASSUMPTIONS)).toBe('Healthy');
  });

  it('keeps maintenance-call and stop-out states more severe than elevated', () => {
    expect(getMarginRiskLevel(0.1, DEFAULT_BROKER_ASSUMPTIONS)).toBe('Margin-call level');
    expect(getMarginRiskLevel(0, DEFAULT_BROKER_ASSUMPTIONS)).toBe('Stop-out level');
    expect(getMarginRiskLevel(-0.05, DEFAULT_BROKER_ASSUMPTIONS)).toBe('Stop-out level');
  });
});
