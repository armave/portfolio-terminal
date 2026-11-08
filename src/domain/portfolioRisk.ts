import type { BrokerAssumptions } from '../types/portfolio';
import {
  calculateMarginRiskSnapshot,
  type MarginRiskSnapshot,
  type BrokerReportedMarginRequirements,
  type MarginRiskDataQuality,
  type MarginRiskQuoteFreshness,
  type EligibleCollateralSource
} from './marginRisk';

type RiskDataQuality = 'current' | 'provisional' | 'incomplete';
type RiskQuoteFreshness = 'fresh' | 'stale' | 'delayed' | 'indicative' | 'unknown';
export type RiskCalculation<T> =
  | { status: 'available' | 'provisional'; quality: 'current' | 'provisional'; value: T; warnings: string[] }
  | { status: 'unavailable'; reason: string; warnings: string[] };

export interface RiskPositionInput {
  id: string;
  ticker: string;
  /** Positive for long exposure; negative for short exposure. */
  quantity: number;
  price: number;
  currency: string;
  quality: RiskDataQuality;
  freshness: RiskQuoteFreshness;
  /** Provider observation time, never replaced by client receipt time. */
  observedAt: number | null;
  sector?: string | null;
  assetType?: string | null;
  brokerId?: string | null;
  accountId?: string | null;
}
export interface RiskCapitalInput {
  currency: string;
  /** Positive cash and debt magnitudes; signed balance normalization occurs before this boundary. */
  cash: number;
  debt: number;
  /** Eligible collateral after haircut; null/omitted is unknown, not zero. */
  eligibleCollateral?: number | null;
  eligibleCollateralSource?: EligibleCollateralSource;
  collateralBeforeHaircut?: number | null;
  collateralHaircutPct?: number | null;
  quality: RiskDataQuality;
  freshness: RiskQuoteFreshness;
  observedAt: number | null;
  brokerId?: string | null;
  accountId?: string | null;
}
interface RiskHistoryPoint { timestamp: number; close: number; }
export interface RiskHistoricalSeriesInput {
  ticker: string;
  currency: string;
  points: readonly RiskHistoryPoint[];
  quality: 'complete' | 'partial' | 'unavailable';
  freshness: RiskQuoteFreshness;
  observedAt: number | null;
}
interface RiskBrokerAssumptions { brokerId: string; assumptions: BrokerAssumptions; }
export interface RiskBrokerMarginRequirements extends BrokerReportedMarginRequirements {
  brokerId: string;
  accountId?: string | null;
}
export interface PortfolioRiskSnapshot {
  calculatedAt: number;
  positions: readonly RiskPositionInput[];
  capital: readonly RiskCapitalInput[];
  histories?: readonly RiskHistoricalSeriesInput[];
  brokerAssumptions?: readonly RiskBrokerAssumptions[];
  brokerRequirements?: readonly RiskBrokerMarginRequirements[];
}
interface CurrencyExposure {
  currency: string; longExposure: number; shortExposure: number; grossExposure: number; netExposure: number;
  cash: number; debt: number; eligibleCollateral: number | null; equity: number;
}
interface RiskConcentrationGroup { key: string; exposure: number; percentage: number; positions: number; positionIds: string[]; }
interface RiskConcentrationBreakdown {
  byTicker: RiskConcentrationGroup[];
  bySector: RiskConcentrationGroup[];
  byAssetType: RiskConcentrationGroup[];
  byBroker: RiskConcentrationGroup[];
  byAccount: RiskConcentrationGroup[];
  grossExposure: number;
}
export interface BrokerMarginRisk extends MarginRiskSnapshot {
  brokerId: string;
  accountId: string;
  broker: string;
  /** Backward-compatible aliases for consumers of the earlier estimate contract. */
  estimatedAssets: number;
  estimatedEquity: number;
  maintenanceEquityRatio: number;
  stopOutRatio: number;
}
interface RiskPortfolioMetrics {
  currency: string; calculatedAt: number; longExposure: number; shortExposure: number;
  grossExposure: number; netExposure: number; cash: number; debt: number; eligibleCollateral: number | null;
  equity: number; grossLeverage: number | null; netLeverage: number | null; marginUtilization: number | null;
  cashCoverage: number | null; equityRatio: number | null; margin: RiskCalculation<BrokerMarginRisk[]>;
  inputPositionIds: string[]; sourceObservationTimes: number[];
}
export interface PortfolioRiskReport {
  calculatedAt: number; quality: 'current' | 'provisional'; currencyExposure: CurrencyExposure[];
  /** A consolidated value is unavailable until a single-currency or explicit FX contract exists. */
  portfolio: RiskCalculation<RiskPortfolioMetrics>;
  concentrationByCurrency: Array<{ currency: string; value: RiskConcentrationBreakdown }>;
  /** Margin estimates remain separated by broker account and currency. */
  marginByAccount: RiskCalculation<BrokerMarginRisk[]>;
  historyByTicker: Record<string, RiskCalculation<HistoricalRiskMetrics>>;
  warnings: string[];
}
export interface HistoricalRiskMetrics {
  ticker: string; currency: string; observations: number; returnObservations: number;
  annualizedVolatility: number; maximumDrawdown: number; historicalDownsideLoss95: number;
  lookbackStart: number; lookbackEnd: number; observedAt: number | null;
  method: 'sample-standard-deviation-sqrt-252'; downsideMethod: 'historical-5th-percentile';
}
export interface HistoricalCorrelation {
  firstTicker: string; secondTicker: string; currency: string; pairedReturns: number;
  correlation: number; lookbackStart: number; lookbackEnd: number;
}
export interface StressShockInput { ticker: string; /** Decimal return: -0.25 = -25%. */ priceShock: number; }
interface StressShockDriver { ticker: string; currentExposure: number; grossExposure: number; priceShock: number; pnlImpact: number; }
export interface RiskFxStressRateInput {
  currency: string;
  /** Reporting-currency units for one unit of the foreign currency. */
  rateToReportingCurrency: number;
  quality: RiskDataQuality;
  freshness: RiskQuoteFreshness;
  observedAt: number | null;
}
export interface RiskFxStressShockInput { currency: string; /** Decimal FX move, e.g. -0.1 = 10% depreciation. */ fxShock: number; }
export interface RiskFxStressInput {
  reportingCurrency: string;
  rates: readonly RiskFxStressRateInput[];
  shocks: readonly RiskFxStressShockInput[];
  priceShocks?: readonly StressShockInput[];
}
interface StressFxShockDriver {
  currency: string; rateToReportingCurrency: number; fxShock: number;
  currentEquityExposure: number; pnlImpact: number;
}
export interface StressScenarioResult {
  currency: string; calculatedAt: number; totalPnlImpact: number; currentEquity: number; stressedEquity: number;
  drivers: StressShockDriver[]; fxDrivers: StressFxShockDriver[];
  assumptions: string[]; disclaimer: string;
}

const MIN_RETURN_OBSERVATIONS = 20;
const TRADING_DAYS_PER_YEAR = 252;
function unavailable<T>(reason: string, warnings: string[] = []): RiskCalculation<T> {
  return { status: 'unavailable', reason, warnings };
}
function available<T>(value: T, quality: 'current' | 'provisional', warnings: string[] = []): RiskCalculation<T> {
  return { status: quality === 'current' ? 'available' : 'provisional', quality, value, warnings };
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function validBrokerAssumptions(value: BrokerAssumptions): boolean {
  return Boolean(value) &&
    typeof value.broker === 'string' && value.broker.trim().length > 0 &&
    finite(value.annualBorrowRate) && value.annualBorrowRate >= 0 && value.annualBorrowRate <= 1 &&
    (value.dayCountBasis === 360 || value.dayCountBasis === 365) &&
    finite(value.maintenanceEquityRatio) && value.maintenanceEquityRatio > 0 && value.maintenanceEquityRatio < 1 &&
    finite(value.stopOutRatio) && value.stopOutRatio >= 0 && value.stopOutRatio <= value.maintenanceEquityRatio;
}
function normalizeTicker(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/.test(ticker) ? ticker : null;
}
function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}
function normalizedLabel(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'Unclassified';
}
function mergeQuality(...values: Array<'current' | 'provisional'>): 'current' | 'provisional' {
  return values.includes('provisional') ? 'provisional' : 'current';
}
interface NormalizedSnapshot {
  positions: RiskPositionInput[]; capital: RiskCapitalInput[]; quality: 'current' | 'provisional';
  warnings: string[]; calculatedAt: number;
}
function eligibleCollateralFor(item: RiskCapitalInput): number | null {
  if (item.eligibleCollateral !== null && item.eligibleCollateral !== undefined) return item.eligibleCollateral;
  if (item.collateralBeforeHaircut !== null && item.collateralBeforeHaircut !== undefined &&
      item.collateralHaircutPct !== null && item.collateralHaircutPct !== undefined) {
    return item.collateralBeforeHaircut * (1 - item.collateralHaircutPct);
  }
  return null;
}
function normalizeSnapshot(input: PortfolioRiskSnapshot): RiskCalculation<NormalizedSnapshot> {
  if (!input || !validTimestamp(input.calculatedAt)) return unavailable('A valid calculation timestamp is required.');
  if (!Array.isArray(input.positions) || !Array.isArray(input.capital)) return unavailable('Position and capital snapshots must be arrays.');
  if (input.positions.length === 0 && input.capital.length === 0) return unavailable('At least one position or capital observation is required.');
  const warnings: string[] = [];
  const ids = new Set<string>();
  const positions: RiskPositionInput[] = [];
  const capital: RiskCapitalInput[] = [];
  const qualities: Array<'current' | 'provisional'> = [];
  for (const position of input.positions) {
    const positionId = typeof position?.id === 'string' ? position.id.trim() : '';
    if (!positionId || ids.has(positionId)) {
      return unavailable('Every position must have a unique, non-empty id.');
    }
    ids.add(positionId);
    const ticker = normalizeTicker(position.ticker);
    const currency = normalizeCurrency(position.currency);
    if (!ticker || !currency) return unavailable('A position has an invalid ticker or currency.');
    if (!finite(position.quantity) || !finite(position.price) || position.price <= 0) {
      return unavailable('A position needs a finite quantity and positive finite price; missing prices cannot be replaced with zero.');
    }
    if (!['current', 'provisional', 'incomplete'].includes(position.quality) ||
        !['fresh', 'stale', 'delayed', 'indicative', 'unknown'].includes(position.freshness)) {
      return unavailable('A position has an unknown data-quality or quote-freshness state.');
    }
    if (position.quality === 'incomplete') return unavailable('A position snapshot is incomplete.');
    if (position.observedAt !== null && (!validTimestamp(position.observedAt) || position.observedAt > input.calculatedAt)) {
      return unavailable('A position has an invalid or future market-observation timestamp.');
    }
    const quality = position.quality === 'provisional' || position.freshness !== 'fresh' || position.observedAt === null
      ? 'provisional' : 'current';
    if (quality === 'provisional') warnings.push(position.observedAt === null
      ? ticker + ': market observation time is unknown.' : ticker + ': quote is not confirmed fresh.');
    qualities.push(quality);
    positions.push({
      ...position, id: positionId, ticker, currency,
      sector: normalizedLabel(position.sector), assetType: normalizedLabel(position.assetType),
      brokerId: normalizedLabel(position.brokerId), accountId: normalizedLabel(position.accountId)
    });
  }
  for (const item of input.capital) {
    if (!item) return unavailable('A capital observation is malformed.');
    const currency = normalizeCurrency(item.currency);
    if (!currency) return unavailable('A capital observation has an invalid currency.');
    if (!finite(item.cash) || !finite(item.debt) || item.cash < 0 || item.debt < 0) {
      return unavailable('Capital cash and debt must be finite non-negative magnitudes.');
    }
    const collateralBeforeHaircut = item.collateralBeforeHaircut === undefined ? null : item.collateralBeforeHaircut;
    const collateralHaircutPct = item.collateralHaircutPct === undefined ? null : item.collateralHaircutPct;
    if ((collateralBeforeHaircut === null) !== (collateralHaircutPct === null) ||
        (collateralBeforeHaircut !== null && (!finite(collateralBeforeHaircut) || collateralBeforeHaircut < 0)) ||
        (collateralHaircutPct !== null && (!finite(collateralHaircutPct) || collateralHaircutPct < 0 || collateralHaircutPct > 1))) {
      return unavailable('Capital gross collateral and haircut must be supplied together as finite non-negative values.');
    }
    const suppliedEligibleCollateral = item.eligibleCollateral === undefined ? null : item.eligibleCollateral;
    if (suppliedEligibleCollateral !== null && (!finite(suppliedEligibleCollateral) || suppliedEligibleCollateral < 0)) {
      return unavailable('Eligible collateral must be a finite non-negative amount or explicitly unknown.');
    }
    const derivedEligibleCollateral = collateralBeforeHaircut !== null && collateralHaircutPct !== null
      ? collateralBeforeHaircut * (1 - collateralHaircutPct) : null;
    if (suppliedEligibleCollateral !== null && derivedEligibleCollateral !== null &&
        Math.abs(suppliedEligibleCollateral - derivedEligibleCollateral) >
        Math.max(0.01, Math.abs(derivedEligibleCollateral) * 1e-6)) {
      return unavailable('Capital eligible collateral does not reconcile to gross collateral after the supplied haircut.');
    }
    const eligibleCollateral = suppliedEligibleCollateral ?? derivedEligibleCollateral;
    if (item.eligibleCollateralSource !== undefined &&
        !['broker', 'configured-assumption', 'unknown'].includes(item.eligibleCollateralSource)) {
      return unavailable('Capital eligible-collateral provenance is invalid.');
    }
    if (!['current', 'provisional', 'incomplete'].includes(item.quality) ||
        !['fresh', 'stale', 'delayed', 'indicative', 'unknown'].includes(item.freshness)) {
      return unavailable('A capital observation has an unknown data-quality or freshness state.');
    }
    if (item.quality === 'incomplete') return unavailable('A capital observation is incomplete.');
    if (item.observedAt !== null && (!validTimestamp(item.observedAt) || item.observedAt > input.calculatedAt)) {
      return unavailable('A capital observation has an invalid or future timestamp.');
    }
    const quality = item.quality === 'provisional' || item.freshness !== 'fresh' || item.observedAt === null
      ? 'provisional' : 'current';
    if (quality === 'provisional') warnings.push('Capital observation is stale, delayed, or has unknown source time.');
    qualities.push(quality);
    if (eligibleCollateral === null && (item.debt > 0 || collateralBeforeHaircut !== null)) warnings.push('Eligible collateral is unknown for a margin debit.');
    capital.push({
      ...item, currency, eligibleCollateral, collateralBeforeHaircut, collateralHaircutPct,
      eligibleCollateralSource: item.eligibleCollateralSource ?? (eligibleCollateral === null ? 'unknown' : 'configured-assumption'),
      brokerId: normalizedLabel(item.brokerId), accountId: normalizedLabel(item.accountId)
    });
  }
  const quality = mergeQuality(...qualities);
  return available({ positions, capital, quality, warnings: [...new Set(warnings)], calculatedAt: input.calculatedAt },
    quality, [...new Set(warnings)]);
}
function buildCurrencyExposure(currency: string, positions: readonly RiskPositionInput[], capital: readonly RiskCapitalInput[]): CurrencyExposure {
  const longExposure = positions.reduce((sum, position) => sum + Math.max(0, position.quantity * position.price), 0);
  const shortExposure = positions.reduce((sum, position) => sum + Math.max(0, -position.quantity * position.price), 0);
  const grossExposure = longExposure + shortExposure;
  const netExposure = longExposure - shortExposure;
  const cash = capital.reduce((sum, item) => sum + item.cash, 0);
  const debt = capital.reduce((sum, item) => sum + item.debt, 0);
  const eligibleValues = capital.map(eligibleCollateralFor);
  const eligibleCollateral = capital.length > 0 && eligibleValues.every(value => value !== null)
    ? eligibleValues.reduce<number>((sum, value) => sum + Number(value), 0)
    : null;
  return {
    currency, longExposure, shortExposure, grossExposure, netExposure, cash, debt, eligibleCollateral,
    equity: cash + longExposure - shortExposure - debt
  };
}
function groupConcentration(positions: readonly RiskPositionInput[], keyFor: (position: RiskPositionInput) => string): RiskConcentrationGroup[] {
  const values = new Map<string, { exposure: number; positions: number; positionIds: string[] }>();
  let grossExposure = 0;
  for (const position of positions) {
    const exposure = Math.abs(position.quantity * position.price);
    if (exposure === 0) continue;
    grossExposure += exposure;
    const key = keyFor(position);
    const group = values.get(key) ?? { exposure: 0, positions: 0, positionIds: [] };
    group.exposure += exposure;
    group.positions += 1;
    group.positionIds.push(position.id);
    values.set(key, group);
  }
  return [...values.entries()]
    .map(([key, value]) => ({
      key, exposure: value.exposure, percentage: grossExposure > 0 ? value.exposure / grossExposure * 100 : 0,
      positions: value.positions, positionIds: value.positionIds.sort()
    }))
    .sort((a, b) => b.exposure - a.exposure || a.key.localeCompare(b.key));
}
function buildConcentration(positions: readonly RiskPositionInput[]): RiskConcentrationBreakdown {
  const grossExposure = positions.reduce((sum, position) => sum + Math.abs(position.quantity * position.price), 0);
  return {
    byTicker: groupConcentration(positions, position => position.ticker),
    bySector: groupConcentration(positions, position => normalizedLabel(position.sector)),
    byAssetType: groupConcentration(positions, position => normalizedLabel(position.assetType)),
    byBroker: groupConcentration(positions, position => normalizedLabel(position.brokerId)),
    byAccount: groupConcentration(positions, position => normalizedLabel(position.accountId)),
    grossExposure
  };
}
function accountRiskKey(brokerId: string, accountId: string, currency: string): string {
  return JSON.stringify([brokerId, accountId, currency]);
}
function mergeRiskFreshness(values: readonly RiskQuoteFreshness[]): MarginRiskQuoteFreshness {
  if (values.includes('stale')) return 'stale';
  if (values.includes('delayed')) return 'delayed';
  if (values.includes('indicative')) return 'indicative';
  if (values.includes('unknown')) return 'unknown';
  return 'fresh';
}
function mergeRiskQuality(values: readonly RiskDataQuality[]): MarginRiskDataQuality {
  return values.includes('incomplete') ? 'incomplete' :
    values.includes('provisional') ? 'provisional' : 'current';
}
function earliestObservedAt(values: readonly (number | null)[]): number | null {
  return values.length > 0 && values.every(value => value !== null)
    ? Math.min(...values as number[])
    : null;
}
function buildMarginRisk(
  positions: readonly RiskPositionInput[],
  capital: readonly RiskCapitalInput[],
  assumptions: readonly RiskBrokerAssumptions[],
  requirements: readonly RiskBrokerMarginRequirements[],
  calculatedAt: number
): RiskCalculation<BrokerMarginRisk[]> {
  const capitalGroups = new Map<string, { brokerId: string; accountId: string; currency: string; rows: RiskCapitalInput[] }>();
  for (const item of capital) {
    const brokerId = item.brokerId ?? 'Unclassified';
    const accountId = item.accountId ?? 'Unclassified';
    const key = accountRiskKey(brokerId, accountId, item.currency);
    const group = capitalGroups.get(key) ?? { brokerId, accountId, currency: item.currency, rows: [] };
    group.rows.push(item);
    capitalGroups.set(key, group);
  }
  for (const [key, group] of capitalGroups) {
    const hasShortExposure = positions.some(position =>
      (position.brokerId ?? 'Unclassified') === group.brokerId &&
      (position.accountId ?? 'Unclassified') === group.accountId &&
      position.currency === group.currency &&
      position.quantity < 0
    );
    if (group.rows.reduce((sum, item) => sum + item.debt, 0) <= 0 && !hasShortExposure) {
      capitalGroups.delete(key);
    }
  }
  for (const position of positions) {
    if (position.quantity >= 0) continue;
    const key = accountRiskKey(
      position.brokerId ?? 'Unclassified',
      position.accountId ?? 'Unclassified',
      position.currency
    );
    if (!capitalGroups.has(key)) {
      return unavailable('Short position ' + position.ticker + ' has no matching broker/account/currency capital snapshot; eligible collateral cannot be verified.');
    }
  }
  if (capitalGroups.size === 0) return available([], 'current');

  const assumptionMap = new Map<string, BrokerAssumptions>();
  for (const item of assumptions) {
    if (assumptionMap.has(item.brokerId)) return unavailable('Duplicate broker margin assumptions were supplied for ' + item.brokerId + '.');
    assumptionMap.set(item.brokerId, item.assumptions);
  }
  const requirementMap = new Map<string, RiskBrokerMarginRequirements>();
  for (const item of requirements) {
    const currency = normalizeCurrency(item?.currency);
    const brokerId = typeof item?.brokerId === 'string' ? item.brokerId.trim() : '';
    if (!currency || !brokerId) return unavailable('Broker margin requirements need a valid broker id and currency.');
    const key = accountRiskKey(brokerId, item.accountId?.trim() || 'Unclassified', currency);
    if (requirementMap.has(key)) return unavailable('Duplicate broker margin requirements were supplied for one account/currency.');
    requirementMap.set(key, item);
  }

  const marginAccountsByBroker = new Map<string, Set<string>>();
  for (const group of capitalGroups.values()) {
    const accounts = marginAccountsByBroker.get(group.brokerId) ?? new Set<string>();
    accounts.add(group.accountId);
    marginAccountsByBroker.set(group.brokerId, accounts);
  }
  for (const position of positions) {
    const brokerId = position.brokerId ?? 'Unclassified';
    const accountId = position.accountId ?? 'Unclassified';
    if (brokerId === 'Unclassified' || accountId === 'Unclassified') {
      return unavailable('A position is missing broker or account identity and cannot be assigned safely to a margin account.');
    }
    const accounts = marginAccountsByBroker.get(brokerId);
    if (accounts && !accounts.has(accountId) && accounts.size > 0) {
      // The position belongs to another account at this broker. It is intentionally
      // excluded from this account's risk calculation rather than rolled into it.
      continue;
    }
  }

  const results: BrokerMarginRisk[] = [];
  const allWarnings: string[] = [];
  let resultQuality: 'current' | 'provisional' = 'current';
  for (const [key, group] of capitalGroups) {
    const rules = assumptionMap.get(group.brokerId);
    if (!rules) return unavailable('Configured broker assumptions are missing for broker ' + group.brokerId + '.');
    const accountPositions = positions.filter(position =>
      (position.brokerId ?? 'Unclassified') === group.brokerId &&
      (position.accountId ?? 'Unclassified') === group.accountId &&
      position.currency === group.currency
    );
    const cash = group.rows.reduce((sum, item) => sum + item.cash, 0);
    const debt = group.rows.reduce((sum, item) => sum + item.debt, 0);
    const eligibleRows = group.rows.map(eligibleCollateralFor);
    const collateralKnown = eligibleRows.every(value => value !== null);
    const eligibleCollateral = collateralKnown
      ? eligibleRows.reduce<number>((sum, value) => sum + Number(value), 0)
      : null;
    const completeHaircutRows = group.rows.every(item =>
      item.collateralBeforeHaircut !== null && item.collateralBeforeHaircut !== undefined &&
      item.collateralHaircutPct !== null && item.collateralHaircutPct !== undefined
    );
    const collateralBeforeHaircut = completeHaircutRows
      ? group.rows.reduce((sum, item) => sum + Number(item.collateralBeforeHaircut), 0)
      : null;
    const collateralHaircutPct = completeHaircutRows && collateralBeforeHaircut !== null && collateralBeforeHaircut > 0 && eligibleCollateral !== null
      ? (collateralBeforeHaircut - eligibleCollateral) / collateralBeforeHaircut
      : completeHaircutRows ? 0 : null;
    const collateralSources = group.rows.map(item => item.eligibleCollateralSource ?? (item.eligibleCollateral === null ? 'unknown' : 'configured-assumption'));
    const eligibleCollateralSource: EligibleCollateralSource = collateralSources.every(value => value === 'broker')
      ? 'broker'
      : collateralSources.some(value => value === 'unknown') ? 'unknown' : 'configured-assumption';
    const longExposure = accountPositions.reduce((sum, item) => sum + Math.max(0, item.quantity * item.price), 0);
    const shortExposure = accountPositions.reduce((sum, item) => sum + Math.max(0, -item.quantity * item.price), 0);
    const quality = mergeRiskQuality([...group.rows.map(item => item.quality), ...accountPositions.map(item => item.quality)]);
    const freshness = mergeRiskFreshness([...group.rows.map(item => item.freshness), ...accountPositions.map(item => item.freshness)]);
    const observedAt = earliestObservedAt([...group.rows.map(item => item.observedAt), ...accountPositions.map(item => item.observedAt)]);
    const brokerRequirements = requirementMap.get(key);
    const calculation = calculateMarginRiskSnapshot({
      currency: group.currency, longExposure, shortExposure, cashBalance: cash, marginDebt: debt,
      eligibleCollateral, eligibleCollateralSource,
      ...(collateralBeforeHaircut !== null && collateralHaircutPct !== null
        ? { collateralBeforeHaircut, collateralHaircutPct } : {}),
      assumptions: rules, quality, freshness, observedAt, calculatedAt,
      brokerRequirements: brokerRequirements ? {
        currency: brokerRequirements.currency,
        initialMarginRequired: brokerRequirements.initialMarginRequired,
        maintenanceMarginRequired: brokerRequirements.maintenanceMarginRequired,
        concentrationAddOn: brokerRequirements.concentrationAddOn,
        concentrationAddOnSource: brokerRequirements.concentrationAddOnSource,
        observedAt: brokerRequirements.observedAt
      } : null
    });
    if (calculation.status === 'unavailable') {
      return unavailable('Margin risk for ' + group.brokerId + '/' + group.accountId + '/' + group.currency + ': ' + calculation.reason,
        [...allWarnings, ...calculation.warnings]);
    }
    if (calculation.status === 'provisional') resultQuality = 'provisional';
    allWarnings.push(...calculation.warnings);
    results.push({
      ...calculation.value,
      brokerId: group.brokerId,
      accountId: group.accountId,
      broker: rules.broker,
      estimatedAssets: calculation.value.assets,
      estimatedEquity: calculation.value.equity,
      maintenanceEquityRatio: rules.maintenanceEquityRatio,
      stopOutRatio: rules.stopOutRatio
    });
  }
  return available(results, resultQuality, [...new Set(allWarnings)]);
}

/** Calculates exposure and concentrations without combining unlike currencies. */
export function calculatePortfolioRiskSnapshot(input: PortfolioRiskSnapshot): RiskCalculation<PortfolioRiskReport> {
  const normalized = normalizeSnapshot(input);
  if (normalized.status === 'unavailable') return normalized;
  const { positions, capital, quality, warnings, calculatedAt } = normalized.value;
  const currencies = [...new Set([...positions.map(item => item.currency), ...capital.map(item => item.currency)])].sort();
  const currencyExposure = currencies.map(currency => buildCurrencyExposure(
    currency, positions.filter(item => item.currency === currency), capital.filter(item => item.currency === currency)
  ));
  if (currencyExposure.some(item => ![
    item.longExposure, item.shortExposure, item.grossExposure, item.netExposure, item.cash, item.debt, item.equity
  ].every(finite))) {
    return unavailable('Aggregated risk exposure exceeds the finite calculation range.');
  }
  const concentrationByCurrency = currencies.map(currency => ({
    currency, value: buildConcentration(positions.filter(item => item.currency === currency))
  }));
  const marginByAccount = buildMarginRisk(
    positions, capital, input.brokerAssumptions ?? [], input.brokerRequirements ?? [], calculatedAt
  );
  const portfolioQuality = marginByAccount.status === 'available' ? quality : 'provisional';
  if (marginByAccount.status === 'unavailable') warnings.push('Margin risk unavailable: ' + marginByAccount.reason);
  else warnings.push(...marginByAccount.warnings);

  let portfolio: RiskCalculation<RiskPortfolioMetrics>;
  if (currencies.length !== 1) {
    portfolio = unavailable('A consolidated portfolio risk value requires one currency or an explicit, timestamped FX conversion contract.');
  } else {
    const exposure = currencyExposure[0];
    const assets = exposure.longExposure + exposure.cash;
    portfolio = available({
      currency: currencies[0], calculatedAt,
      longExposure: exposure.longExposure, shortExposure: exposure.shortExposure,
      grossExposure: exposure.grossExposure, netExposure: exposure.netExposure,
      cash: exposure.cash, debt: exposure.debt, eligibleCollateral: exposure.eligibleCollateral,
      equity: exposure.equity,
      grossLeverage: exposure.equity > 0 ? exposure.grossExposure / exposure.equity : null,
      netLeverage: exposure.equity !== 0 ? exposure.netExposure / exposure.equity : null,
      marginUtilization: exposure.grossExposure > 0 ? exposure.debt / exposure.grossExposure : null,
      cashCoverage: exposure.grossExposure > 0 ? exposure.cash / exposure.grossExposure : null,
      equityRatio: assets > 0 ? exposure.equity / assets : null,
      margin: marginByAccount,
      inputPositionIds: positions.filter(item => item.currency === currencies[0]).map(item => item.id).sort(),
      sourceObservationTimes: [...new Set([
        ...positions.filter(item => item.currency === currencies[0]).map(item => item.observedAt),
        ...capital.filter(item => item.currency === currencies[0]).map(item => item.observedAt)
      ].filter((value): value is number => value !== null))].sort((a, b) => a - b)
    }, portfolioQuality, marginByAccount.status === 'unavailable' ? [...warnings] : [...warnings]);
  }
  const historyByTicker: Record<string, RiskCalculation<HistoricalRiskMetrics>> = {};
  for (const history of input.histories ?? []) {
    const ticker = normalizeTicker(history.ticker);
    if (!ticker) continue;
    if (historyByTicker[ticker]) {
      historyByTicker[ticker] = unavailable('Duplicate historical series were supplied for ' + ticker + '.');
      continue;
    }
    historyByTicker[ticker] = calculateHistoricalRisk(history);
  }
  return available({
    calculatedAt, quality: portfolioQuality, currencyExposure, portfolio, concentrationByCurrency,
    marginByAccount, historyByTicker, warnings
  }, portfolioQuality, warnings);
}

/** Calculates a broker-specific estimate from the supplied broker assumptions. */
export function calculateBrokerMarginRisk(input: {
  brokerId: string; debt: number; positions: readonly RiskPositionInput[]; capital: readonly RiskCapitalInput[];
  assumptions: BrokerAssumptions; accountId?: string; requirements?: RiskBrokerMarginRequirements | null;
  calculatedAt?: number;
}): RiskCalculation<BrokerMarginRisk> {
  if (!input || typeof input.brokerId !== 'string' || !input.brokerId.trim()) return unavailable('A broker id is required.');
  if (!finite(input.debt) || input.debt < 0) return unavailable('Debt must be a finite non-negative amount.');
  if (!validBrokerAssumptions(input.assumptions)) return unavailable('Broker margin assumptions are invalid.');
  const brokerPositions = input.positions.filter(item => (item.brokerId ?? 'Unclassified') === input.brokerId);
  const brokerCapital = input.capital.filter(item => (item.brokerId ?? 'Unclassified') === input.brokerId);
  const accountIds = new Set([
    ...brokerPositions.map(item => item.accountId ?? 'Unclassified'),
    ...brokerCapital.map(item => item.accountId ?? 'Unclassified')
  ]);
  const accountId = input.accountId ?? [...accountIds][0];
  if (!accountId || (!input.accountId && accountIds.size > 1)) {
    return unavailable('A single account id is required; broker accounts cannot be combined into one margin estimate.');
  }
  const positions = brokerPositions.filter(item => (item.accountId ?? 'Unclassified') === accountId);
  const capital = brokerCapital.filter(item => (item.accountId ?? 'Unclassified') === accountId);
  const currencies = new Set<string | null>([
    ...positions.map(item => normalizeCurrency(item.currency)), ...capital.map(item => normalizeCurrency(item.currency))
  ]);
  if (currencies.size !== 1 || currencies.has(null)) {
    return unavailable('Broker margin inputs must use exactly one valid currency.');
  }
  const currency = [...currencies][0] as string;
  const capitalDebt = capital.reduce((sum, item) => sum + item.debt, 0);
  if (Math.abs(capitalDebt - input.debt) > 0.01) {
    return unavailable('The supplied debt does not match the selected account capital snapshot.');
  }
  if (capital.length === 0) return unavailable('A capital observation is required for broker margin risk.');
  const standaloneEligibleRows = capital.map(eligibleCollateralFor);
  const collateralKnown = standaloneEligibleRows.every(value => value !== null);
  const eligibleCollateral = collateralKnown
    ? standaloneEligibleRows.reduce<number>((sum, value) => sum + Number(value), 0)
    : null;
  const completeStandaloneHaircut = capital.every(item =>
    item.collateralBeforeHaircut !== null && item.collateralBeforeHaircut !== undefined &&
    item.collateralHaircutPct !== null && item.collateralHaircutPct !== undefined
  );
  const standaloneGrossCollateral = completeStandaloneHaircut
    ? capital.reduce((sum, item) => sum + Number(item.collateralBeforeHaircut), 0)
    : null;
  const standaloneHaircut = completeStandaloneHaircut && standaloneGrossCollateral !== null && standaloneGrossCollateral > 0 && eligibleCollateral !== null
    ? (standaloneGrossCollateral - eligibleCollateral) / standaloneGrossCollateral
    : completeStandaloneHaircut ? 0 : null;
  const eligibleCollateralSource: EligibleCollateralSource = capital.every(item => item.eligibleCollateralSource === 'broker')
    ? 'broker'
    : capital.some(item => item.eligibleCollateralSource === 'unknown') ? 'unknown' : 'configured-assumption';
  const longExposure = positions.reduce((sum, item) => sum + Math.max(0, item.quantity * item.price), 0);
  const shortExposure = positions.reduce((sum, item) => sum + Math.max(0, -item.quantity * item.price), 0);
  const quality = mergeRiskQuality([...positions.map(item => item.quality), ...capital.map(item => item.quality)]);
  const freshness = mergeRiskFreshness([...positions.map(item => item.freshness), ...capital.map(item => item.freshness)]);
  const observedAt = earliestObservedAt([...positions.map(item => item.observedAt), ...capital.map(item => item.observedAt)]);
  if (input.requirements && (
    input.requirements.brokerId !== input.brokerId ||
    (input.requirements.accountId?.trim() || 'Unclassified') !== accountId ||
    normalizeCurrency(input.requirements.currency) !== currency
  )) {
    return unavailable('Broker margin requirements do not match the selected broker account and currency.');
  }
  const calculation = calculateMarginRiskSnapshot({
    currency, longExposure, shortExposure,
    cashBalance: capital.reduce((sum, item) => sum + item.cash, 0),
    marginDebt: capitalDebt, eligibleCollateral, eligibleCollateralSource,
    assumptions: input.assumptions, quality, freshness, observedAt,
    ...(standaloneGrossCollateral !== null && standaloneHaircut !== null
      ? { collateralBeforeHaircut: standaloneGrossCollateral, collateralHaircutPct: standaloneHaircut } : {}),
    calculatedAt: input.calculatedAt ?? Date.now(),
    brokerRequirements: input.requirements ? {
      currency: input.requirements.currency,
      initialMarginRequired: input.requirements.initialMarginRequired,
      maintenanceMarginRequired: input.requirements.maintenanceMarginRequired,
      concentrationAddOn: input.requirements.concentrationAddOn,
      concentrationAddOnSource: input.requirements.concentrationAddOnSource,
      observedAt: input.requirements.observedAt
    } : null
  });
  if (calculation.status === 'unavailable') return calculation;
  const value: BrokerMarginRisk = {
    ...calculation.value,
    brokerId: input.brokerId,
    accountId,
    broker: input.assumptions.broker,
    estimatedAssets: calculation.value.assets,
    estimatedEquity: calculation.value.equity,
    maintenanceEquityRatio: input.assumptions.maintenanceEquityRatio,
    stopOutRatio: input.assumptions.stopOutRatio
  };
  return available(value, calculation.quality, calculation.warnings);
}

/** Applies explicit price shocks and timestamped FX shocks into one reporting currency. */
export function calculateRiskFxStressScenario(
  snapshot: PortfolioRiskSnapshot, input: RiskFxStressInput
): RiskCalculation<StressScenarioResult> {
  const normalized = normalizeSnapshot(snapshot);
  if (normalized.status === 'unavailable') return normalized;
  const reportingCurrency = normalizeCurrency(input?.reportingCurrency);
  if (!reportingCurrency) return unavailable('FX stress needs a valid reporting currency.');
  if (!Array.isArray(input.rates) || !Array.isArray(input.shocks) || !Array.isArray(input.priceShocks ?? [])) {
    return unavailable('FX rates, FX shocks and price shocks must be arrays.');
  }
  const currencies = [...new Set([
    ...normalized.value.positions.map(item => item.currency),
    ...normalized.value.capital.map(item => item.currency)
  ])].sort();
  const foreignCurrencies = currencies.filter(currency => currency !== reportingCurrency);
  if (foreignCurrencies.length === 0) return unavailable('FX stress requires at least one exposure outside the reporting currency.');
  const rateMap = new Map<string, RiskFxStressRateInput>();
  for (const rate of input.rates) {
    const currency = normalizeCurrency(rate?.currency);
    if (!currency || currency === reportingCurrency || rateMap.has(currency) ||
        !finite(rate.rateToReportingCurrency) || rate.rateToReportingCurrency <= 0 ||
        !['current', 'provisional', 'incomplete'].includes(rate.quality) ||
        !['fresh', 'stale', 'delayed', 'indicative', 'unknown'].includes(rate.freshness) ||
        !validTimestamp(rate.observedAt) || rate.observedAt > normalized.value.calculatedAt ||
        rate.quality === 'incomplete') {
      return unavailable('FX rates must be unique, positive, timestamped and have complete quality metadata.');
    }
    rateMap.set(currency, { ...rate, currency });
  }
  if (rateMap.size !== foreignCurrencies.length || foreignCurrencies.some(currency => !rateMap.has(currency))) {
    return unavailable('Every foreign exposure currency needs an explicit rate into the reporting currency.');
  }
  const fxShockMap = new Map<string, number>();
  for (const shock of input.shocks) {
    const currency = normalizeCurrency(shock?.currency);
    if (!currency || currency === reportingCurrency || !foreignCurrencies.includes(currency) ||
        fxShockMap.has(currency) || !finite(shock.fxShock) || shock.fxShock < -1 || shock.fxShock > 10) {
      return unavailable('Each FX shock must identify one foreign exposure currency and a decimal move between -100% and +1,000%.');
    }
    fxShockMap.set(currency, shock.fxShock);
  }
  if (fxShockMap.size !== foreignCurrencies.length) {
    return unavailable('Every foreign exposure currency needs one explicit FX shock.');
  }
  const priceShockMap = new Map<string, number>();
  for (const shock of input.priceShocks ?? []) {
    const ticker = normalizeTicker(shock?.ticker);
    if (!ticker || !finite(shock.priceShock) || shock.priceShock < -1 || shock.priceShock > 10 ||
        priceShockMap.has(ticker) || !normalized.value.positions.some(position => position.ticker === ticker)) {
      return unavailable('Each price shock must identify a unique held ticker and a decimal move between -100% and +1,000%.');
    }
    priceShockMap.set(ticker, shock.priceShock);
  }

  const allCurrencies = [...new Set([...currencies, reportingCurrency])].sort();
  const drivers: StressShockDriver[] = [];
  const fxDrivers: StressFxShockDriver[] = [];
  let currentEquity = 0;
  let stressedEquity = 0;
  let provisional = normalized.value.quality === 'provisional';
  const warnings = [...normalized.value.warnings];
  for (const currency of allCurrencies) {
    const positions = normalized.value.positions.filter(item => item.currency === currency);
    const capital = normalized.value.capital.filter(item => item.currency === currency);
    const cash = capital.reduce((sum, item) => sum + item.cash, 0);
    const debt = capital.reduce((sum, item) => sum + item.debt, 0);
    const positionValue = positions.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const priceImpactLocal = positions.reduce((sum, item) =>
      sum + item.quantity * item.price * (priceShockMap.get(item.ticker) ?? 0), 0);
    const localEquity = cash - debt + positionValue;
    const localEquityAfterPrice = localEquity + priceImpactLocal;
    const rate = currency === reportingCurrency ? 1 : rateMap.get(currency)!.rateToReportingCurrency;
    const fxShock = currency === reportingCurrency ? 0 : fxShockMap.get(currency)!;
    currentEquity += localEquity * rate;
    stressedEquity += localEquityAfterPrice * rate * (1 + fxShock);
    for (const position of positions) {
      const priceShock = priceShockMap.get(position.ticker) ?? 0;
      if (priceShock === 0) continue;
      const pnlImpact = position.quantity * position.price * priceShock * rate * (1 + fxShock);
      drivers.push({
        ticker: position.ticker, currentExposure: position.quantity * position.price * rate,
        grossExposure: Math.abs(position.quantity * position.price * rate),
        priceShock, pnlImpact
      });
    }
    if (currency !== reportingCurrency) {
      const rateInput = rateMap.get(currency)!;
      if (rateInput.quality === 'provisional' || rateInput.freshness !== 'fresh') {
        provisional = true;
        warnings.push('FX rate for ' + currency + ' is stale, delayed or provisional.');
      }
      fxDrivers.push({
        currency, rateToReportingCurrency: rate, fxShock,
        currentEquityExposure: localEquity * rate,
        pnlImpact: localEquity * rate * fxShock
      });
    }
  }
  const totalPnlImpact = stressedEquity - currentEquity;
  if (![currentEquity, stressedEquity, totalPnlImpact].every(finite)) {
    return unavailable('FX stress totals exceed the finite calculation range.');
  }
  return available({
    currency: reportingCurrency, calculatedAt: normalized.value.calculatedAt,
    totalPnlImpact, currentEquity, stressedEquity,
    drivers: drivers.sort((a, b) => Math.abs(b.pnlImpact) - Math.abs(a.pnlImpact) || a.ticker.localeCompare(b.ticker)),
    fxDrivers,
    assumptions: [
      'FX rates are reporting-currency units per one unit of foreign currency and must be timestamped.',
      'FX shocks revalue cash, debt and signed positions; price shocks affect positions only.',
      'The combined scenario includes the interaction between price and FX moves; unshocked exposures remain unchanged.',
      'Trading costs, taxes, liquidity slippage, collateral changes and forced liquidation are not modeled.'
    ],
    disclaimer: 'Arithmetic price and FX stress scenario only. It is not a probability estimate, forecast, broker liquidation price, or portfolio-state mutation.'
  }, provisional ? 'provisional' : 'current', [...new Set(warnings)]);
}

/** Historical single-instrument risk; requires 20 valid returns and never invents missing prices. */
export function calculateHistoricalRisk(input: RiskHistoricalSeriesInput): RiskCalculation<HistoricalRiskMetrics> {
  if (!input) return unavailable('A historical price series is required.');
  const ticker = normalizeTicker(input.ticker);
  const currency = normalizeCurrency(input.currency);
  if (!ticker || !currency) return unavailable('Historical risk requires a valid ticker and currency.');
  if (!['complete', 'partial', 'unavailable'].includes(input.quality)) return unavailable('Historical data quality is missing or invalid.');
  if (input.quality === 'unavailable') return unavailable('Historical price data is unavailable.');
  if (!['fresh', 'stale', 'delayed', 'indicative', 'unknown'].includes(input.freshness)) return unavailable('Historical freshness state is invalid.');
  if (!Array.isArray(input.points)) return unavailable('Historical price points must be an array.');
  const points = [...input.points];
  if (points.some(item => !item || !validTimestamp(item.timestamp) || !finite(item.close) || item.close <= 0)) {
    return unavailable('Historical points must contain unique timestamps and positive finite closing prices.');
  }
  points.sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].timestamp === points[index - 1].timestamp) return unavailable('Historical timestamps must be unique.');
  }
  const returns = points.slice(1).map((point, index) => ({ timestamp: point.timestamp, value: point.close / points[index].close - 1 }));
  if (returns.length < MIN_RETURN_OBSERVATIONS) return unavailable('At least 20 valid historical returns are required; received ' + returns.length + '.');
  if (returns.some(item => !finite(item.value))) return unavailable('Historical returns contain a non-finite value.');
  const mean = returns.reduce((sum, item) => sum + item.value, 0) / returns.length;
  const variance = returns.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) / (returns.length - 1);
  const annualizedVolatility = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
  let peak = points[0].close, maximumDrawdown = 0;
  for (const point of points) {
    peak = Math.max(peak, point.close);
    maximumDrawdown = Math.max(maximumDrawdown, (peak - point.close) / peak);
  }
  const sortedReturns = returns.map(item => item.value).sort((a, b) => a - b);
  const percentileIndex = Math.max(0, Math.ceil(sortedReturns.length * 0.05) - 1);
  const historicalDownsideLoss95 = Math.max(0, -sortedReturns[percentileIndex]);
  if (input.observedAt !== null && (!validTimestamp(input.observedAt) || input.observedAt > points[points.length - 1].timestamp)) {
    return unavailable('Historical source observation time is invalid or later than the final price point.');
  }
  const quality: 'current' | 'provisional' = input.quality === 'partial' || input.freshness !== 'fresh' || input.observedAt === null
    ? 'provisional' : 'current';
  const warnings = quality === 'provisional' ? ['Historical risk uses partial history or data whose freshness cannot be confirmed.'] : [];
  return available({
    ticker, currency, observations: points.length, returnObservations: returns.length,
    annualizedVolatility, maximumDrawdown, historicalDownsideLoss95,
    lookbackStart: points[0].timestamp, lookbackEnd: points[points.length - 1].timestamp,
    observedAt: input.observedAt, method: 'sample-standard-deviation-sqrt-252', downsideMethod: 'historical-5th-percentile'
  }, quality, warnings);
}

/** Pearson correlation over exact overlapping return timestamps and a common currency. */
export function calculateHistoricalCorrelation(
  first: RiskHistoricalSeriesInput, second: RiskHistoricalSeriesInput
): RiskCalculation<HistoricalCorrelation> {
  const firstRisk = calculateHistoricalRisk(first), secondRisk = calculateHistoricalRisk(second);
  if (firstRisk.status === 'unavailable') return unavailable('First series: ' + firstRisk.reason);
  if (secondRisk.status === 'unavailable') return unavailable('Second series: ' + secondRisk.reason);
  if (firstRisk.value.currency !== secondRisk.value.currency) return unavailable('Correlation series must use the same currency.');
  const toReturns = (series: RiskHistoricalSeriesInput): Map<number, number> => {
    const points = [...series.points].sort((a, b) => a.timestamp - b.timestamp);
    return new Map<number, number>(points.slice(1).map((point, index) =>
      [point.timestamp, point.close / points[index].close - 1]
    ));
  };
  const a = toReturns(first), b = toReturns(second);
  const pairs = [...a.entries()].filter(([timestamp]) => b.has(timestamp))
    .map(([timestamp, value]) => ({ timestamp, first: value, second: b.get(timestamp)! }))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (pairs.length < MIN_RETURN_OBSERVATIONS) return unavailable('At least 20 exactly aligned return observations are required; received ' + pairs.length + '.');
  const meanA = pairs.reduce((sum, item) => sum + item.first, 0) / pairs.length;
  const meanB = pairs.reduce((sum, item) => sum + item.second, 0) / pairs.length;
  const varianceA = pairs.reduce((sum, item) => sum + (item.first - meanA) ** 2, 0);
  const varianceB = pairs.reduce((sum, item) => sum + (item.second - meanB) ** 2, 0);
  if (varianceA === 0 || varianceB === 0) return unavailable('Correlation is undefined for a constant-return series.');
  const covariance = pairs.reduce((sum, item) => sum + (item.first - meanA) * (item.second - meanB), 0);
  const correlation = covariance / Math.sqrt(varianceA * varianceB);
  if (!finite(correlation)) return unavailable('Correlation could not be calculated from these observations.');
  return available({
    firstTicker: firstRisk.value.ticker, secondTicker: secondRisk.value.ticker, currency: firstRisk.value.currency,
    pairedReturns: pairs.length, correlation: Math.max(-1, Math.min(1, correlation)),
    lookbackStart: pairs[0].timestamp, lookbackEnd: pairs[pairs.length - 1].timestamp
  }, mergeQuality(firstRisk.quality, secondRisk.quality), [...firstRisk.warnings, ...secondRisk.warnings]);
}

/** Applies deterministic ticker price shocks without mutating the supplied snapshot. */
export function calculateRiskStressScenario(
  snapshot: PortfolioRiskSnapshot, shocks: readonly StressShockInput[]
): RiskCalculation<StressScenarioResult> {
  const normalized = normalizeSnapshot(snapshot);
  if (normalized.status === 'unavailable') return normalized;
  if (!Array.isArray(shocks) || shocks.length === 0) return unavailable('At least one price shock is required.');
  const currencies = new Set([
    ...normalized.value.positions.map(item => item.currency), ...normalized.value.capital.map(item => item.currency)
  ]);
  if (currencies.size !== 1) return unavailable('A stress scenario requires one currency; cross-currency shocks need an explicit FX contract.');
  const byTicker = new Map<string, { currentExposure: number; grossExposure: number }>();
  for (const position of normalized.value.positions) {
    const existing = byTicker.get(position.ticker) ?? { currentExposure: 0, grossExposure: 0 };
    const exposure = position.quantity * position.price;
    existing.currentExposure += exposure;
    existing.grossExposure += Math.abs(exposure);
    byTicker.set(position.ticker, existing);
  }
  const seen = new Set<string>();
  const drivers: StressShockDriver[] = [];
  for (const shock of shocks) {
    const ticker = normalizeTicker(shock?.ticker);
    if (!ticker || !finite(shock.priceShock) || shock.priceShock < -1 || shock.priceShock > 10) {
      return unavailable('Each stress shock needs a valid ticker and decimal price shock between -100% and +1,000%.');
    }
    if (seen.has(ticker)) return unavailable('A ticker may be shocked only once per scenario.');
    seen.add(ticker);
    const exposure = byTicker.get(ticker);
    if (!exposure) return unavailable('No supplied position matches stress ticker ' + ticker + '.');
    const pnlImpact = exposure.currentExposure * shock.priceShock;
    if (!finite(pnlImpact)) return unavailable('Stress impact exceeds the finite calculation range for ' + ticker + '.');
    drivers.push({
      ticker, currentExposure: exposure.currentExposure, grossExposure: exposure.grossExposure,
      priceShock: shock.priceShock, pnlImpact
    });
  }
  drivers.sort((a, b) => Math.abs(b.pnlImpact) - Math.abs(a.pnlImpact) || a.ticker.localeCompare(b.ticker));
  const totalPnlImpact = drivers.reduce((sum, item) => sum + item.pnlImpact, 0);
  const cash = normalized.value.capital.reduce((sum, item) => sum + item.cash, 0);
  const debt = normalized.value.capital.reduce((sum, item) => sum + item.debt, 0);
  const currentExposure = normalized.value.positions.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const currentEquity = cash + currentExposure - debt;
  const stressedEquity = currentEquity + totalPnlImpact;
  if (![totalPnlImpact, currentEquity, stressedEquity].every(finite)) {
    return unavailable('Stress scenario totals exceed the finite calculation range.');
  }
  return available({
    currency: [...currencies][0], calculatedAt: normalized.value.calculatedAt, totalPnlImpact, currentEquity,
    stressedEquity, drivers, fxDrivers: [],
    assumptions: [
      'Only explicitly supplied ticker shocks are applied; unshocked positions are held constant.',
      'Cash and debt are held constant; trading costs, taxes, liquidity slippage and forced liquidation are not modeled.'
    ],
    disclaimer: 'Arithmetic stress scenario only. It is not a probability estimate, forecast, broker liquidation price, or portfolio-state mutation.'
  }, normalized.value.quality, normalized.value.warnings);
}
