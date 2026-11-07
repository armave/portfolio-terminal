import type { BrokerAssumptions } from '../types/portfolio';

/** The gauge uses 40% as its visual healthy-reference threshold. */
export const ACCOUNT_EQUITY_HEALTH_REFERENCE = 0.4;

export type MarginRiskLevel = 'Healthy' | 'Elevated' | 'Margin-call level' | 'Stop-out level';

/** Classify equity against the same 40% reference shown on the account-health meter. */
export function getMarginRiskLevel(equityRatio: number, rules: BrokerAssumptions): MarginRiskLevel {
  if (equityRatio <= rules.stopOutRatio) return 'Stop-out level';
  if (equityRatio <= rules.maintenanceEquityRatio) return 'Margin-call level';
  if (equityRatio < ACCOUNT_EQUITY_HEALTH_REFERENCE) return 'Elevated';
  return 'Healthy';
}

export interface MarginRiskMetrics {
  assets: number;
  equity: number;
  equityRatio: number;
  marginCallAssetsRequired: number;
  stopOutAssetsRequired: number;
  marginCallValue: number;
  stopOutValue: number;
  marginCallBufferPct: number;
  stopOutBufferPct: number;
  showMarginCall: boolean;
  showStopOut: boolean;
}

/** Calculate estimates using configured broker thresholds, not live broker rules. */
export function calculateMarginRiskMetrics(
  debt: number,
  positionValue: number,
  collateral: number,
  rules: BrokerAssumptions
): MarginRiskMetrics {
  const assets = positionValue + collateral;
  const equity = assets - debt;
  const equityRatio = assets > 0 ? equity / assets : Number.NEGATIVE_INFINITY;
  const marginCallAssetsRequired = debt > 0 ? debt / (1 - rules.maintenanceEquityRatio) : 0;
  const stopOutAssetsRequired = debt > 0 ? debt / (1 - rules.stopOutRatio) : 0;
  const marginCallValue = Math.max(0, marginCallAssetsRequired - collateral);
  const stopOutValue = Math.max(0, stopOutAssetsRequired - collateral);
  const marginCallBufferPct = positionValue > 0
    ? ((positionValue - marginCallValue) / positionValue) * 100
    : Number.NEGATIVE_INFINITY;
  const stopOutBufferPct = positionValue > 0
    ? ((positionValue - stopOutValue) / positionValue) * 100
    : Number.NEGATIVE_INFINITY;

  // The threshold is defined against total assets (position value + eligible
  // collateral), not collateral in isolation. Equality is already at the
  // configured threshold and must remain visible as a risk trigger.
  const showMarginCall = debt > 0 && assets <= marginCallAssetsRequired;
  const showStopOut = debt > 0 && assets <= stopOutAssetsRequired;

  return {
    assets,
    equity,
    equityRatio,
    marginCallAssetsRequired,
    stopOutAssetsRequired,
    marginCallValue,
    stopOutValue,
    marginCallBufferPct,
    stopOutBufferPct,
    showMarginCall,
    showStopOut
  };
}
