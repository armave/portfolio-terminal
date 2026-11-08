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
  /** Explicit eligible-collateral amount; null/omitted is unknown, not zero. */
  eligibleCollateral?: number | null;
  eligibleCollateralSource?: EligibleCollateralSource;
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
export interface StressScenarioResult {
  currency: string; calculatedAt: number; totalPnlImpact: number; currentEquity: number; stressedEquity: number;
  drivers: StressShockDriver[]; assumptions: string[]; disclaimer: string;
}

const MIN_RETURN_OBSERVATIONS = 20;
const TRADING_DAYS_PER_YEAR = 252;
const RISK_DISCLAIMER = 'This is a deterministic estimate from the supplied snapshot and configured assumptions, not a broker maintenance calculation, liquidation quote, or forecast.';

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
    const eligibleCollateral = item.eligibleCollateral === undefined ? null : item.eligibleCollateral;
    if (eligibleCollateral !== null && (!finite(eligibleCollateral) || eligibleCollateral < 0)) {
      return unavailable('Eligible collateral must be a finite non-negative amount or explicitly unknown.');
    }
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
    if (eligibleCollateral === null && item.debt > 0) warnings.push('Eligible collateral is unknown for a margin debit.');
    capital.push({
      ...item, currency, eligibleCollateral,
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
  const eligibleCollateral = capital.length > 0 && capital.every(item => item.eligibleCollateral !== null && item.eligibleCollateral !== undefined)
    ? capital.reduce((sum, item) => sum + Number(item.eligibleCollateral), 0)
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
  return [brokerId, accountId, currency].join('|');
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
    if (item.debt <= 0) continue;
    const brokerId = item.brokerId ?? 'Unclassified';
    const accountId = item.accountId ?? 'Unclassified';
    const key = accountRiskKey(brokerId, accountId, item.currency);
    const group = capitalGroups.get(key) ?? { brokerId, accountId, currency: item.currency, rows: [] };
    group.rows.push(item);
    capitalGroups.set(key, group);
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
    const collateralKnown = group.rows.every(item => item.eligibleCollateral !== null && item.eligibleCollateral !== undefined);
    const eligibleCollateral = collateralKnown
      ? group.rows.reduce((sum, item) => sum + Number(item.eligibleCollateral), 0)
      : null;
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
      eligibleCollateral, eligibleCollateralSource, assumptions: rules, quality, freshness, observedAt, calculatedAt,
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
      broker: rules.broker
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
  const portfolioQuality = marginByAccount.status === 'provisional' ? 'provisional' : quality;
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
  const collateralKnown = capital.every(item => item.eligibleCollateral !== null && item.eligibleCollateral !== undefined);
  const eligibleCollateral = collateralKnown
    ? capital.reduce((sum, item) => sum + Number(item.eligibleCollateral), 0)
    : null;
  const eligibleCollateralSource: EligibleCollateralSource = capital.every(item => item.eligibleCollateralSource === 'broker')
    ? 'broker'
    : capital.some(item => item.eligibleCollateralSource === 'unknown') ? 'unknown' : 'configured-assumption';
  const longExposure = positions.reduce((sum, item) => sum + Math.max(0, item.quantity * item.price), 0);
  const shortExposure = positions.reduce((sum, item) => sum + Math.max(0, -item.quantity * item.price), 0);
  const quality = mergeRiskQuality([...positions.map(item => item.quality), ...capital.map(item => item.quality)]);
  const freshness = mergeRiskFreshness([...positions.map(item => item.freshness), ...capital.map(item => item.freshness)]);
  const observedAt = earliestObservedAt([...positions.map(item => item.observedAt), ...capital.map(item => item.observedAt)]);
  const calculation = calculateMarginRiskSnapshot({
    currency, longExposure, shortExposure,
    cashBalance: capital.reduce((sum, item) => sum + item.cash, 0),
    marginDebt: capitalDebt, eligibleCollateral, eligibleCollateralSource,
    assumptions: input.assumptions, quality, freshness, observedAt,
    calculatedAt: input.calculatedAt ?? Date.now(),
    brokerRequirements: input.requirements ? {
      currency: input.requirements.currency,
      initialMarginRequired: input.requirements.initialMarginRequired,
      maintenanceMarginRequired: input.requirements.maintenanceMarginRequired,
      concentrationAddOn: input.requirements.concentrationAddOn,
      observedAt: input.requirements.observedAt
    } : null
  });
  if (calculation.status === 'unavailable') return calculation;
  const value: BrokerMarginRisk = {
    ...calculation.value, brokerId: input.brokerId, accountId, broker: input.assumptions.broker
  };
  return available(value, calculation.quality, calculation.warnings);
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
    stressedEquity, drivers,
    assumptions: [
      'Only explicitly supplied ticker shocks are applied; unshocked positions are held constant.',
      'Cash and debt are held constant; trading costs, taxes, liquidity slippage and forced liquidation are not modeled.'
    ],
    disclaimer: 'Arithmetic stress scenario only. It is not a probability estimate, forecast, broker liquidation price, or portfolio-state mutation.'
  }, normalized.value.quality, normalized.value.warnings);
}
