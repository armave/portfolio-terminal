import type { BrokerAssumptions } from '../types/portfolio';

export type MarginRiskUnavailableReason =
  | 'invalid-financial-inputs'
  | 'invalid-broker-assumptions'
  | 'calculation-overflow';

export interface AvailableMarginRiskMetrics {
  status: 'available';
  assets: number;
  equity: number;
  /** Null only when assets are zero, so an equity ratio is mathematically undefined. */
  equityRatio: number | null;
  marginCallAssetsRequired: number;
  stopOutAssetsRequired: number;
  marginCallValue: number;
  stopOutValue: number;
  /** Null when the position value is zero, so a position buffer is undefined. */
  marginCallBufferPct: number | null;
  stopOutBufferPct: number | null;
  showMarginCall: boolean;
  showStopOut: boolean;
  showRiskTriggers: boolean;
}

export interface UnavailableMarginRiskMetrics {
  status: 'unavailable';
  reason: MarginRiskUnavailableReason;
}

export type MarginRiskResult = AvailableMarginRiskMetrics | UnavailableMarginRiskMetrics;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Calculate estimates using configured broker thresholds, not live broker rules. */
export function calculateMarginRiskMetrics(
  debt: number,
  positionValue: number,
  collateral: number,
  rules: BrokerAssumptions
): MarginRiskResult {
  if (
    !isFiniteNonNegative(debt) ||
    !isFiniteNonNegative(positionValue) ||
    !isFiniteNonNegative(collateral)
  ) {
    return { status: 'unavailable', reason: 'invalid-financial-inputs' };
  }

  const maintenanceEquityRatio = rules?.maintenanceEquityRatio;
  const stopOutRatio = rules?.stopOutRatio;
  if (
    typeof maintenanceEquityRatio !== 'number' ||
    !Number.isFinite(maintenanceEquityRatio) ||
    maintenanceEquityRatio < 0 ||
    maintenanceEquityRatio >= 1 ||
    typeof stopOutRatio !== 'number' ||
    !Number.isFinite(stopOutRatio) ||
    stopOutRatio < 0 ||
    stopOutRatio > maintenanceEquityRatio
  ) {
    return { status: 'unavailable', reason: 'invalid-broker-assumptions' };
  }

  const assets = positionValue + collateral;
  const equity = assets - debt;
  const equityRatio = assets > 0 ? equity / assets : null;
  const marginCallAssetsRequired = debt > 0 ? debt / (1 - maintenanceEquityRatio) : 0;
  const stopOutAssetsRequired = debt > 0 ? debt / (1 - stopOutRatio) : 0;
  const marginCallValue = Math.max(0, marginCallAssetsRequired - collateral);
  const stopOutValue = Math.max(0, stopOutAssetsRequired - collateral);
  const marginCallBufferPct = positionValue > 0
    ? ((positionValue - marginCallValue) / positionValue) * 100
    : null;
  const stopOutBufferPct = positionValue > 0
    ? ((positionValue - stopOutValue) / positionValue) * 100
    : null;

  const finiteResults = [
    assets,
    equity,
    marginCallAssetsRequired,
    stopOutAssetsRequired,
    marginCallValue,
    stopOutValue
  ].every(Number.isFinite);
  if (
    !finiteResults ||
    (equityRatio !== null && !Number.isFinite(equityRatio)) ||
    (marginCallBufferPct !== null && !Number.isFinite(marginCallBufferPct)) ||
    (stopOutBufferPct !== null && !Number.isFinite(stopOutBufferPct))
  ) {
    return { status: 'unavailable', reason: 'calculation-overflow' };
  }

  const showMarginCall = debt > 0 && collateral < marginCallAssetsRequired;
  const showStopOut = debt > 0 && collateral < stopOutAssetsRequired;

  return {
    status: 'available',
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
    showStopOut,
    // A missing position buffer must not hide an otherwise active risk trigger.
    showRiskTriggers: showMarginCall && (marginCallBufferPct === null || marginCallBufferPct < 60)
  };
}
