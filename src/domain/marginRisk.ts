import type { BrokerAssumptions } from '../types/portfolio';

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
  showRiskTriggers: boolean;
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
  const showMarginCall = debt > 0 && collateral < marginCallAssetsRequired;
  const showStopOut = debt > 0 && collateral < stopOutAssetsRequired;

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
    showStopOut,
    showRiskTriggers: showMarginCall && marginCallBufferPct < 60
  };
}
