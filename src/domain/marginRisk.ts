import type { BrokerAssumptions } from '../types/portfolio';

/** The gauge uses 40% as its visual healthy-reference threshold. */
export const ACCOUNT_EQUITY_HEALTH_REFERENCE = 0.4;

export type MarginRiskLevel = 'Healthy' | 'Elevated' | 'Margin-call level' | 'Stop-out level';

export type MarginRiskDataQuality = 'current' | 'provisional' | 'incomplete';
export type MarginRiskQuoteFreshness = 'fresh' | 'stale' | 'delayed' | 'indicative' | 'unknown';
export type EligibleCollateralSource = 'broker' | 'configured-assumption' | 'unknown';

export interface BrokerReportedMarginRequirements {
  currency: string;
  /** null means the broker did not report this requirement; it is not zero. */
  initialMarginRequired: number | null;
  /** Base maintenance amount, separate from concentration add-ons. */
  maintenanceMarginRequired: number | null;
  /** null means the broker did not report an add-on; it is not zero. */
  concentrationAddOn: number | null;
  /** Explicitly distinguishes a broker-reported add-on from a local assumption. */
  concentrationAddOnSource?: 'broker' | 'configured-assumption';
  observedAt: number | null;
}

export interface MarginRiskInput {
  currency: string;
  /** Positive market value of long positions. */
  longExposure: number;
  /** Positive market value of short liabilities, not an asset. */
  shortExposure: number;
  /** Positive available account cash; negative balances belong in marginDebt. */
  cashBalance: number;
  /** Positive magnitude of margin debit. */
  marginDebt: number;
  /** Broker-confirmed or explicitly assumed eligible collateral. Never inferred from total assets. */
  eligibleCollateral: number | null;
  eligibleCollateralSource: EligibleCollateralSource;
  assumptions: BrokerAssumptions;
  quality: MarginRiskDataQuality;
  freshness: MarginRiskQuoteFreshness;
  /** Provider observation time. Do not substitute client receipt time. */
  observedAt: number | null;
  calculatedAt: number;
  brokerRequirements?: BrokerReportedMarginRequirements | null;
}

interface MarginRequirementValue {
  amount: number | null;
  source: 'broker' | 'configured-assumption' | 'unavailable';
}

export interface MarginRiskSnapshot {
  currency: string;
  calculatedAt: number;
  longExposure: number;
  shortExposure: number;
  grossExposure: number;
  netExposure: number;
  cashBalance: number;
  marginDebt: number;
  /** Positive assets are cash plus long holdings; short liabilities are not counted as assets. */
  assets: number;
  equity: number;
  equityRatio: number | null;
  eligibleCollateral: number | null;
  eligibleCollateralSource: EligibleCollateralSource;
  collateralCoverageRatio: number | null;
  initialMarginRequirement: MarginRequirementValue;
  maintenanceMarginRequirement: MarginRequirementValue;
  concentrationAddOn: MarginRequirementValue;
  totalMaintenanceRequirement: number | null;
  /** Estimate before any broker concentration add-on that was not supplied. */
  baseMaintenanceBuffer: number | null;
  /** null when an unreported concentration add-on prevents a complete buffer calculation. */
  maintenanceBuffer: number | null;
  maintenanceBufferPct: number | null;
  stopOutBuffer: number | null;
  stopOutBufferPct: number | null;
  marginCallValue: number | null;
  stopOutValue: number | null;
  marginCallBufferPct: number | null;
  stopOutBufferPctOfLongExposure: number | null;
  showMarginCall: boolean;
  showStopOut: boolean;
  maintenanceState: 'above-maintenance' | 'maintenance-breach' | 'unknown';
  stopOutState: 'above-stop-out' | 'stop-out-breach' | 'unknown';
  /** Financing cost on margin debit only; does not include unreported short-borrow fees. */
  annualInterestCost: number;
  dailyInterestCost: number;
  riskLevel: MarginRiskLevel;
  quality: 'current' | 'provisional';
  warnings: string[];
  disclaimer: string;
}

export type MarginRiskCalculation =
  | { status: 'available' | 'provisional'; quality: 'current' | 'provisional'; value: MarginRiskSnapshot; warnings: string[] }
  | { status: 'unavailable'; reason: string; warnings: string[] };

/** Classify equity against the same 40% visual reference shown on the account-health meter. */
export function getMarginRiskLevel(equityRatio: number, rules: BrokerAssumptions): MarginRiskLevel {
  if (equityRatio <= rules.stopOutRatio) return 'Stop-out level';
  if (equityRatio <= rules.maintenanceEquityRatio) return 'Margin-call level';
  if (equityRatio < ACCOUNT_EQUITY_HEALTH_REFERENCE) return 'Elevated';
  return 'Healthy';
}

function unavailable(reason: string, warnings: string[] = []): MarginRiskCalculation {
  return { status: 'unavailable', reason, warnings };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validAssumptions(value: BrokerAssumptions): boolean {
  return !!value &&
    isFiniteNumber(value.annualBorrowRate) && value.annualBorrowRate >= 0 && value.annualBorrowRate <= 1 &&
    (value.dayCountBasis === 360 || value.dayCountBasis === 365) &&
    isFiniteNumber(value.maintenanceEquityRatio) && value.maintenanceEquityRatio > 0 && value.maintenanceEquityRatio < 1 &&
    isFiniteNumber(value.stopOutRatio) && value.stopOutRatio >= 0 && value.stopOutRatio <= value.maintenanceEquityRatio &&
    typeof value.broker === 'string' && value.broker.trim().length > 0;
}

/**
 * Canonical margin-risk calculation used by portfolio summaries, AI context,
 * account-level risk analytics and stress tooling. All monetary inputs are in
 * the same currency. Missing broker requirements remain unknown.
 */
export function calculateMarginRiskSnapshot(input: MarginRiskInput): MarginRiskCalculation {
  if (!input || typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase())) {
    return unavailable('A valid three-letter account currency is required.');
  }
  if (![
    input.longExposure, input.shortExposure, input.cashBalance, input.marginDebt
  ].every(isFiniteNumber) || input.longExposure < 0 || input.shortExposure < 0 ||
      input.cashBalance < 0 || input.marginDebt < 0) {
    return unavailable('Long exposure, short exposure, cash and margin debt must be finite non-negative amounts.');
  }
  if (input.eligibleCollateral !== null &&
      (!isFiniteNumber(input.eligibleCollateral) || input.eligibleCollateral < 0)) {
    return unavailable('Eligible collateral must be a finite non-negative amount or explicitly unknown.');
  }
  if (!['broker', 'configured-assumption', 'unknown'].includes(input.eligibleCollateralSource)) {
    return unavailable('Eligible-collateral provenance is missing or invalid.');
  }
  if ((input.marginDebt > 0 || input.shortExposure > 0) && input.eligibleCollateral === null) {
    return unavailable('Margin risk is unavailable because eligible collateral is unknown.');
  }
  if (!validAssumptions(input.assumptions)) return unavailable('Broker margin assumptions are invalid.');
  if (!['current', 'provisional', 'incomplete'].includes(input.quality) ||
      !['fresh', 'stale', 'delayed', 'indicative', 'unknown'].includes(input.freshness)) {
    return unavailable('Margin-risk data quality or quote freshness is invalid.');
  }
  if (input.quality === 'incomplete') return unavailable('Margin-risk inputs are incomplete.');
  if (!validTimestamp(input.calculatedAt)) return unavailable('A valid calculation timestamp is required.');
  if (input.observedAt !== null &&
      (!validTimestamp(input.observedAt) || input.observedAt > input.calculatedAt)) {
    return unavailable('The market/account observation timestamp is invalid or later than the calculation.');
  }

  const currency = input.currency.trim().toUpperCase();
  const requirements = input.brokerRequirements ?? null;
  if (requirements) {
    if (typeof requirements.currency !== 'string' || requirements.currency.trim().toUpperCase() !== currency) {
      return unavailable('Broker margin requirements use a different currency from the account inputs.');
    }
    for (const amount of [
      requirements.initialMarginRequired,
      requirements.maintenanceMarginRequired,
      requirements.concentrationAddOn
    ]) {
      if (amount !== null && (!isFiniteNumber(amount) || amount < 0)) {
        return unavailable('Broker-reported margin requirements must be finite non-negative amounts or explicitly unknown.');
      }
    }
    if (requirements.concentrationAddOnSource !== undefined &&
        !['broker', 'configured-assumption'].includes(requirements.concentrationAddOnSource)) {
      return unavailable('Broker concentration add-on provenance is invalid.');
    }
    if (requirements.observedAt !== null &&
        (!validTimestamp(requirements.observedAt) || requirements.observedAt > input.calculatedAt)) {
      return unavailable('The broker margin-requirement timestamp is invalid or later than the calculation.');
    }
  }

  const assets = input.cashBalance + input.longExposure;
  const equity = assets - input.shortExposure - input.marginDebt;
  const grossExposure = input.longExposure + input.shortExposure;
  const netExposure = input.longExposure - input.shortExposure;
  const equityRatio = assets > 0 ? equity / assets : null;
  const hasBrokerMaintenanceRequirement = requirements?.maintenanceMarginRequired !== null &&
    requirements?.maintenanceMarginRequired !== undefined;
  const canUseLongOnlyMaintenanceAssumption = input.shortExposure === 0;
  const baseMaintenanceAmount = hasBrokerMaintenanceRequirement
    ? requirements!.maintenanceMarginRequired!
    : canUseLongOnlyMaintenanceAssumption ? assets * input.assumptions.maintenanceEquityRatio : null;
  const maintenanceSource = hasBrokerMaintenanceRequirement
    ? 'broker'
    : canUseLongOnlyMaintenanceAssumption ? 'configured-assumption' : 'unavailable';
  const concentrationAmount = requirements?.concentrationAddOn ?? null;
  const totalMaintenanceRequirement = concentrationAmount === null || baseMaintenanceAmount === null
    ? null : baseMaintenanceAmount + concentrationAmount;
  const baseMaintenanceBuffer = baseMaintenanceAmount === null ? null : equity - baseMaintenanceAmount;
  const maintenanceBuffer = totalMaintenanceRequirement === null ? null : equity - totalMaintenanceRequirement;
  // The configured stop-out ratio belongs to the existing long-only model.
  // Without an explicit broker short-account rule, do not invent a short stop-out buffer.
  const stopOutRequirement = input.shortExposure === 0
    ? assets * input.assumptions.stopOutRatio
    : null;
  const stopOutBuffer = stopOutRequirement === null ? null : equity - stopOutRequirement;
  const annualInterestCost = input.marginDebt * input.assumptions.annualBorrowRate;
  const dailyInterestCost = annualInterestCost / input.assumptions.dayCountBasis;

  const isLongOnly = input.shortExposure === 0;
  const canEstimatePriceTriggers = isLongOnly && maintenanceSource === 'configured-assumption';
  const marginCallValue = canEstimatePriceTriggers && concentrationAmount !== null
    ? Math.max(0, (input.marginDebt - (1 - input.assumptions.maintenanceEquityRatio) * input.cashBalance +
      concentrationAmount) / (1 - input.assumptions.maintenanceEquityRatio))
    : null;
  const stopOutValue = isLongOnly
    ? Math.max(0, (input.marginDebt - (1 - input.assumptions.stopOutRatio) * input.cashBalance) /
      (1 - input.assumptions.stopOutRatio))
    : null;
  const marginCallBufferPct = isLongOnly && input.longExposure > 0 && marginCallValue !== null
    ? ((input.longExposure - marginCallValue) / input.longExposure) * 100
    : null;
  const stopOutBufferPctOfLongExposure = isLongOnly && input.longExposure > 0 && stopOutValue !== null
    ? ((input.longExposure - stopOutValue) / input.longExposure) * 100
    : null;
  const maintenanceBufferPct = maintenanceBuffer !== null && assets > 0
    ? maintenanceBuffer / assets * 100
    : null;
  const stopOutBufferPct = stopOutBuffer !== null && assets > 0 ? stopOutBuffer / assets * 100 : null;

  const warnings: string[] = [];
  let quality: 'current' | 'provisional' = input.quality;
  if (input.freshness !== 'fresh' || input.observedAt === null) {
    quality = 'provisional';
    warnings.push('Quote or account observation freshness cannot be confirmed.');
  }
  if (input.shortExposure > 0) {
    quality = 'provisional';
    warnings.push('A broker-specific short-position stop-out rule is unavailable; short stop-out buffers are not estimated.');
    warnings.push('Short borrow fees and availability costs are unavailable; they are not included in margin-debit interest estimates.');
  }
  const hasMarginActivity = input.marginDebt > 0 || input.shortExposure > 0;
  if (hasMarginActivity && input.eligibleCollateralSource !== 'broker') {
    quality = 'provisional';
    warnings.push('Eligible collateral is a configured assumption, not a broker-confirmed amount.');
  }
  if (hasMarginActivity && !requirements?.initialMarginRequired && requirements?.initialMarginRequired !== 0) {
    quality = 'provisional';
    warnings.push('Initial margin requirement is unavailable; buying power is not estimated.');
  }
  if (hasMarginActivity && maintenanceSource === 'configured-assumption') {
    quality = 'provisional';
    warnings.push('Maintenance requirement uses the configured equity ratio, not a broker-reported requirement.');
  } else if (hasMarginActivity && maintenanceSource === 'unavailable') {
    quality = 'provisional';
    warnings.push('A short-position maintenance requirement was not reported; long-only maintenance assumptions are not applied to short exposure.');
  }
  if (hasMarginActivity && concentrationAmount === null) {
    quality = 'provisional';
    warnings.push('Concentration add-on is unavailable; the complete maintenance buffer cannot be calculated.');
  } else if (hasMarginActivity && requirements?.concentrationAddOnSource === 'configured-assumption') {
    quality = 'provisional';
    warnings.push('Concentration add-on uses a configured assumption, not a broker-reported amount.');
  }
  if (requirements?.observedAt === null && requirements !== null) {
    quality = 'provisional';
    warnings.push('Broker margin-requirement observation time is unavailable.');
  }

  const ratioForClassification = equityRatio ?? Number.NEGATIVE_INFINITY;
  let riskLevel = input.marginDebt <= 0 ? 'Healthy' : getMarginRiskLevel(ratioForClassification, input.assumptions);
  if (input.shortExposure > 0) {
    if (equity <= 0) riskLevel = 'Stop-out level';
    else if (maintenanceBuffer !== null && maintenanceBuffer <= 0) riskLevel = 'Margin-call level';
    else riskLevel = 'Elevated';
  } else if (quality === 'provisional' && riskLevel === 'Healthy' && input.marginDebt > 0) {
    riskLevel = 'Elevated';
  }

  const maintenanceState: MarginRiskSnapshot['maintenanceState'] = input.marginDebt <= 0 && input.shortExposure === 0
    ? 'above-maintenance'
    : maintenanceBuffer === null
      ? (baseMaintenanceBuffer !== null && baseMaintenanceBuffer <= 0 ? 'maintenance-breach' : 'unknown')
      : maintenanceBuffer <= 0 ? 'maintenance-breach' : 'above-maintenance';
  const stopOutState: MarginRiskSnapshot['stopOutState'] = stopOutBuffer === null
    ? 'unknown'
    : stopOutBuffer <= 0 ? 'stop-out-breach' : 'above-stop-out';
  const value: MarginRiskSnapshot = {
    currency, calculatedAt: input.calculatedAt,
    longExposure: input.longExposure, shortExposure: input.shortExposure, grossExposure, netExposure,
    cashBalance: input.cashBalance, marginDebt: input.marginDebt, assets, equity, equityRatio,
    eligibleCollateral: input.eligibleCollateral, eligibleCollateralSource: input.eligibleCollateralSource,
    collateralCoverageRatio: input.marginDebt > 0 && input.eligibleCollateral !== null
      ? input.eligibleCollateral / input.marginDebt : null,
    initialMarginRequirement: {
      amount: requirements?.initialMarginRequired ?? null,
      source: requirements?.initialMarginRequired === null || requirements?.initialMarginRequired === undefined ? 'unavailable' : 'broker'
    },
    maintenanceMarginRequirement: { amount: baseMaintenanceAmount, source: maintenanceSource },
    concentrationAddOn: {
      amount: concentrationAmount,
      source: concentrationAmount === null ? 'unavailable' : (requirements?.concentrationAddOnSource ?? 'broker')
    },
    totalMaintenanceRequirement, baseMaintenanceBuffer, maintenanceBuffer, maintenanceBufferPct,
    stopOutBuffer, stopOutBufferPct, marginCallValue, stopOutValue,
    marginCallBufferPct, stopOutBufferPctOfLongExposure,
    showMarginCall: maintenanceState === 'maintenance-breach',
    showStopOut: stopOutBuffer !== null && stopOutBuffer <= 0,
    maintenanceState, stopOutState,
    annualInterestCost, dailyInterestCost, riskLevel, quality, warnings,
    disclaimer: 'This is an estimate from the supplied snapshot and configured assumptions, not a broker maintenance calculation, buying-power result, liquidation quote, or forecast.'
  };
  if (![assets, equity, grossExposure, netExposure, baseMaintenanceAmount, baseMaintenanceBuffer,
    totalMaintenanceRequirement, maintenanceBuffer, stopOutRequirement, stopOutBuffer,
    annualInterestCost, dailyInterestCost, input.eligibleCollateral].every(value => value === null || isFiniteNumber(value))) {
    return unavailable('Margin-risk totals exceed the finite calculation range.');
  }
  return { status: quality === 'current' ? 'available' : 'provisional', quality, value, warnings };
}

/** Compatibility result for older summary callers; new code should use calculateMarginRiskSnapshot. */
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

/** Legacy long-only adapter retained for compatibility with existing callers/tests. */
export function calculateMarginRiskMetrics(
  debt: number,
  positionValue: number,
  collateral: number,
  rules: BrokerAssumptions
): MarginRiskMetrics {
  const result = calculateMarginRiskSnapshot({
    currency: 'USD', longExposure: positionValue, shortExposure: 0,
    cashBalance: collateral, marginDebt: debt,
    eligibleCollateral: collateral, eligibleCollateralSource: 'configured-assumption',
    assumptions: rules, quality: 'provisional', freshness: 'unknown', observedAt: null,
    calculatedAt: Date.now(),
    brokerRequirements: {
      currency: 'USD',
      initialMarginRequired: null,
      maintenanceMarginRequired: null,
      // The legacy API had no concentration field; retain its zero-add-on
      // behavior as a disclosed local assumption, never as a broker fact.
      concentrationAddOn: 0,
      concentrationAddOnSource: 'configured-assumption',
      observedAt: null
    }
  });
  if (result.status === 'unavailable') {
    return {
      assets: Number.NaN, equity: Number.NaN, equityRatio: Number.NaN,
      marginCallAssetsRequired: Number.NaN, stopOutAssetsRequired: Number.NaN,
      marginCallValue: Number.NaN, stopOutValue: Number.NaN,
      marginCallBufferPct: Number.NaN, stopOutBufferPct: Number.NaN,
      showMarginCall: false, showStopOut: false
    };
  }
  const metrics = result.value;
  const marginCallAssetsRequired = debt > 0 ? debt / (1 - rules.maintenanceEquityRatio) : 0;
  const stopOutAssetsRequired = debt > 0 ? debt / (1 - rules.stopOutRatio) : 0;
  return {
    assets: metrics.assets,
    equity: metrics.equity,
    equityRatio: metrics.equityRatio ?? Number.NEGATIVE_INFINITY,
    marginCallAssetsRequired,
    stopOutAssetsRequired,
    marginCallValue: metrics.marginCallValue ?? Number.NaN,
    stopOutValue: metrics.stopOutValue ?? Number.NaN,
    marginCallBufferPct: metrics.marginCallBufferPct ?? Number.NaN,
    stopOutBufferPct: metrics.stopOutBufferPctOfLongExposure ?? Number.NaN,
    showMarginCall: metrics.showMarginCall,
    showStopOut: metrics.showStopOut
  };
}
