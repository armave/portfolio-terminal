import { describe, expect, it } from 'vitest';
import type { MarginRiskSnapshot } from '../domain/marginRisk';
import { getCapitalAdequacyMetrics, getMinimumMarginBufferMetrics } from './MarginRiskDetailsModal';

function snapshot(overrides: Partial<MarginRiskSnapshot> = {}): MarginRiskSnapshot {
  return {
    currency: 'USD',
    calculatedAt: 1_800_000_000_000,
    longExposure: 30_257.7,
    shortExposure: 0,
    grossExposure: 30_257.7,
    netExposure: 30_257.7,
    cashBalance: 0,
    marginDebt: 22_345.27,
    assets: 30_257.7,
    equity: 7_912.43,
    equityRatio: 7_912.43 / 30_257.7,
    eligibleCollateral: 0,
    eligibleCollateralSource: 'configured-assumption',
    collateralBeforeHaircut: null,
    collateralHaircutPct: null,
    collateralHaircutAmount: null,
    collateralCoverageRatio: 0,
    initialMarginRequirement: { amount: null, source: 'unavailable' },
    maintenanceMarginRequirement: { amount: 3_025.77, source: 'configured-assumption' },
    concentrationAddOn: { amount: null, source: 'unavailable' },
    totalMaintenanceRequirement: null,
    baseMaintenanceBuffer: 4_886.66,
    baseMaintenanceBufferPct: 16.15,
    maintenanceBuffer: null,
    maintenanceBufferPct: null,
    stopOutBuffer: 7_912.43,
    stopOutBufferPct: 26.15,
    marginCallValue: null,
    stopOutValue: 0,
    marginCallBufferPct: null,
    stopOutBufferPctOfLongExposure: null,
    showMarginCall: false,
    showStopOut: false,
    maintenanceState: 'unknown',
    stopOutState: 'above-stop-out',
    annualInterestCost: 3_351.79,
    dailyInterestCost: 9.18,
    riskLevel: 'Elevated',
    quality: 'provisional',
    warnings: [],
    disclaimer: 'Estimate from app inputs.',
    ...overrides
  };
}

describe('capital adequacy display', () => {
  it('does not invent capital adequacy when the broker initial margin is not supplied', () => {
    expect(getCapitalAdequacyMetrics(snapshot())).toBeNull();
  });

  it('calculates capital adequacy only from a broker-reported initial margin requirement', () => {
    const result = getCapitalAdequacyMetrics(snapshot({
      initialMarginRequirement: { amount: 7_564.42, source: 'broker' }
    }));
    expect(result?.percentage).toBeCloseTo(104.6, 1);
    expect(result?.surplus).toBeCloseTo(348.01, 2);
  });

  it('does not treat configured assumptions as broker capital adequacy', () => {
    expect(getCapitalAdequacyMetrics(snapshot({
      initialMarginRequirement: { amount: 7_564.42, source: 'configured-assumption' }
    }))).toBeNull();
  });
});

describe('minimum margin buffer display', () => {
  it('uses a clearly provisional base buffer when concentration add-on is missing', () => {
    expect(getMinimumMarginBufferMetrics(snapshot())).toMatchObject({
      amount: 4_886.66,
      percentage: 16.15,
      source: 'configured-assumption',
      complete: false
    });
  });

  it('uses the complete broker maintenance buffer only when both requirement and add-on are broker reported', () => {
    expect(getMinimumMarginBufferMetrics(snapshot({
      maintenanceMarginRequirement: { amount: 3_782.21, source: 'broker' },
      concentrationAddOn: { amount: 0, source: 'broker' },
      totalMaintenanceRequirement: 3_782.21,
      maintenanceBuffer: 4_130.22,
      maintenanceBufferPct: 13.65
    }))).toMatchObject({
      amount: 4_130.22,
      percentage: 13.65,
      source: 'broker',
      complete: true
    });
  });

  it('marks broker base requirements without a reported concentration add-on as incomplete', () => {
    expect(getMinimumMarginBufferMetrics(snapshot({
      maintenanceMarginRequirement: { amount: 3_782.21, source: 'broker' },
      baseMaintenanceBuffer: 4_130.22,
      baseMaintenanceBufferPct: 13.65
    }))).toMatchObject({
      amount: 4_130.22,
      source: 'broker-base',
      complete: false
    });
  });
});
