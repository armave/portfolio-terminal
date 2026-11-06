import type { BrokerAssumptions } from '../types/portfolio';

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
export interface PortfolioRiskSnapshot {
  calculatedAt: number;
  positions: readonly RiskPositionInput[];
  capital: readonly RiskCapitalInput[];
  histories?: readonly RiskHistoricalSeriesInput[];
  brokerAssumptions?: readonly RiskBrokerAssumptions[];
}
interface CurrencyExposure {
  currency: string; grossExposure: number; netExposure: number; cash: number; debt: number; equity: number;
}
interface RiskConcentrationGroup { key: string; exposure: number; percentage: number; positions: number; }
interface RiskConcentrationBreakdown {
  byTicker: RiskConcentrationGroup[];
  bySector: RiskConcentrationGroup[];
  byAssetType: RiskConcentrationGroup[];
  byBroker: RiskConcentrationGroup[];
  byAccount: RiskConcentrationGroup[];
  grossExposure: number;
}
export interface BrokerMarginRisk {
  brokerId: string; broker: string; debt: number; annualBorrowRate: number; dayCountBasis: 360 | 365;
  annualInterestCost: number; dailyInterestCost: number; maintenanceEquityRatio: number; stopOutRatio: number;
  estimatedAssets: number; estimatedEquity: number; maintenanceBuffer: number; maintenanceBufferPct: number | null;
  stopOutBuffer: number; stopOutBufferPct: number | null;
  maintenanceState: 'above-maintenance' | 'maintenance-breach';
  stopOutState: 'above-stop-out' | 'stop-out-breach';
  disclaimer: string;
}
interface RiskPortfolioMetrics {
  currency: string; calculatedAt: number; grossExposure: number; netExposure: number; cash: number; debt: number;
  equity: number; grossLeverage: number | null; netLeverage: number | null; marginUtilization: number | null;
  cashCoverage: number | null; equityRatio: number | null; margin: RiskCalculation<BrokerMarginRisk[]>;
}
export interface PortfolioRiskReport {
  calculatedAt: number; quality: 'current' | 'provisional'; currencyExposure: CurrencyExposure[];
  /** A consolidated value is unavailable until a single-currency or explicit FX contract exists. */
  portfolio: RiskCalculation<RiskPortfolioMetrics>;
  concentrationByCurrency: Array<{ currency: string; value: RiskConcentrationBreakdown }>;
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
interface StressShockDriver { ticker: string; currentExposure: number; priceShock: number; pnlImpact: number; }
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
    if (!position || typeof position.id !== 'string' || !position.id.trim() || ids.has(position.id)) {
      return unavailable('Every position must have a unique, non-empty id.');
    }
    ids.add(position.id);
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
      ...position, id: position.id.trim(), ticker, currency,
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
    capital.push({ ...item, currency, brokerId: normalizedLabel(item.brokerId), accountId: normalizedLabel(item.accountId) });
  }
  const quality = mergeQuality(...qualities);
  return available({ positions, capital, quality, warnings: [...new Set(warnings)], calculatedAt: input.calculatedAt },
    quality, [...new Set(warnings)]);
}
function buildCurrencyExposure(currency: string, positions: readonly RiskPositionInput[], capital: readonly RiskCapitalInput[]): CurrencyExposure {
  const netExposure = positions.reduce((sum, position) => sum + position.quantity * position.price, 0);
  const grossExposure = positions.reduce((sum, position) => sum + Math.abs(position.quantity * position.price), 0);
  const cash = capital.reduce((sum, item) => sum + item.cash, 0);
  const debt = capital.reduce((sum, item) => sum + item.debt, 0);
  return { currency, grossExposure, netExposure, cash, debt, equity: cash + netExposure - debt };
}
function groupConcentration(positions: readonly RiskPositionInput[], keyFor: (position: RiskPositionInput) => string): RiskConcentrationGroup[] {
  const values = new Map<string, { exposure: number; positions: number }>();
  let grossExposure = 0;
  for (const position of positions) {
    const exposure = Math.abs(position.quantity * position.price);
    if (exposure === 0) continue;
    grossExposure += exposure;
    const key = keyFor(position);
    const group = values.get(key) ?? { exposure: 0, positions: 0 };
    group.exposure += exposure;
    group.positions += 1;
    values.set(key, group);
  }
  return [...values.entries()]
    .map(([key, value]) => ({ key, exposure: value.exposure, percentage: grossExposure > 0 ? value.exposure / grossExposure * 100 : 0, positions: value.positions }))
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
function validBrokerAssumptions(value: BrokerAssumptions): boolean {
  return !!value && finite(value.annualBorrowRate) && value.annualBorrowRate >= 0 && value.annualBorrowRate <= 1 &&
    (value.dayCountBasis === 360 || value.dayCountBasis === 365) &&
    finite(value.maintenanceEquityRatio) && value.maintenanceEquityRatio > 0 && value.maintenanceEquityRatio < 1 &&
    finite(value.stopOutRatio) && value.stopOutRatio >= 0 && value.stopOutRatio <= value.maintenanceEquityRatio &&
    typeof value.broker === 'string' && value.broker.trim().length > 0;
}
function buildBrokerMarginRisk(
  brokerId: string, debt: number, grossExposure: number, netExposure: number, cash: number, rules: BrokerAssumptions
): BrokerMarginRisk {
  const assets = grossExposure + cash;
  const equity = cash + netExposure - debt;
  const maintenanceBuffer = equity - assets * rules.maintenanceEquityRatio;
  const stopOutBuffer = equity - assets * rules.stopOutRatio;
  return {
    brokerId, broker: rules.broker, debt, annualBorrowRate: rules.annualBorrowRate, dayCountBasis: rules.dayCountBasis,
    annualInterestCost: debt * rules.annualBorrowRate,
    dailyInterestCost: debt * rules.annualBorrowRate / rules.dayCountBasis,
    maintenanceEquityRatio: rules.maintenanceEquityRatio, stopOutRatio: rules.stopOutRatio,
    estimatedAssets: assets, estimatedEquity: equity, maintenanceBuffer,
    maintenanceBufferPct: assets > 0 ? maintenanceBuffer / assets * 100 : null,
    stopOutBuffer, stopOutBufferPct: assets > 0 ? stopOutBuffer / assets * 100 : null,
    maintenanceState: maintenanceBuffer >= 0 ? 'above-maintenance' : 'maintenance-breach',
    stopOutState: stopOutBuffer >= 0 ? 'above-stop-out' : 'stop-out-breach',
    disclaimer: RISK_DISCLAIMER
  };
}
function buildMarginRisk(
  positions: readonly RiskPositionInput[], capital: readonly RiskCapitalInput[], assumptions: readonly RiskBrokerAssumptions[]
): RiskCalculation<BrokerMarginRisk[]> {
  const debts = new Map<string, number>();
  for (const item of capital) {
    const brokerId = item.brokerId ?? 'Unclassified';
    debts.set(brokerId, (debts.get(brokerId) ?? 0) + item.debt);
  }
  const brokersWithDebt = [...debts.entries()].filter(([, debt]) => debt > 0);
  if (brokersWithDebt.length === 0) return available([], 'current');
  const assumptionMap = new Map<string, BrokerAssumptions>(assumptions.map(item => [item.brokerId, item.assumptions]));
  const missing = brokersWithDebt.find(([brokerId]) => !assumptionMap.has(brokerId));
  if (missing) return unavailable('Configured broker assumptions are missing for broker ' + missing[0] + '.');
  const results: BrokerMarginRisk[] = [];
  for (const [brokerId, debt] of brokersWithDebt) {
    const brokerPositions = positions.filter(position => (position.brokerId ?? 'Unclassified') === brokerId);
    const brokerCapital = capital.filter(item => (item.brokerId ?? 'Unclassified') === brokerId);
    const gross = brokerPositions.reduce((sum, item) => sum + Math.abs(item.quantity * item.price), 0);
    const net = brokerPositions.reduce((sum, item) => sum + item.quantity * item.price, 0);
    const cash = brokerCapital.reduce((sum, item) => sum + item.cash, 0);
    const rules = assumptionMap.get(brokerId)!;
    if (!validBrokerAssumptions(rules)) return unavailable('Broker assumptions for ' + brokerId + ' are invalid.');
    results.push(buildBrokerMarginRisk(brokerId, debt, gross, net, cash, rules));
  }
  return available(results, 'current');
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
  const concentrationByCurrency = currencies.map(currency => ({
    currency, value: buildConcentration(positions.filter(item => item.currency === currency))
  }));
  let portfolio: RiskCalculation<RiskPortfolioMetrics>;
  if (currencies.length !== 1) {
    portfolio = unavailable('A consolidated portfolio risk value requires one currency or an explicit, timestamped FX conversion contract.');
  } else {
    const exposure = currencyExposure[0];
    const assets = exposure.grossExposure + exposure.cash;
    const margin = buildMarginRisk(positions, capital, input.brokerAssumptions ?? []);
    portfolio = available({
      currency: currencies[0], calculatedAt, grossExposure: exposure.grossExposure, netExposure: exposure.netExposure,
      cash: exposure.cash, debt: exposure.debt, equity: exposure.equity,
      grossLeverage: exposure.equity > 0 ? exposure.grossExposure / exposure.equity : null,
      netLeverage: exposure.equity !== 0 ? exposure.netExposure / exposure.equity : null,
      marginUtilization: exposure.grossExposure > 0 ? exposure.debt / exposure.grossExposure : null,
      cashCoverage: exposure.grossExposure > 0 ? exposure.cash / exposure.grossExposure : null,
      equityRatio: assets > 0 ? exposure.equity / assets : null,
      margin
    }, quality, warnings);
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
    calculatedAt, quality, currencyExposure, portfolio, concentrationByCurrency, historyByTicker, warnings
  }, quality, warnings);
}

/** Calculates a broker-specific estimate from the supplied broker assumptions. */
export function calculateBrokerMarginRisk(input: {
  brokerId: string; debt: number; positions: readonly RiskPositionInput[]; capital: readonly RiskCapitalInput[];
  assumptions: BrokerAssumptions;
}): RiskCalculation<BrokerMarginRisk> {
  if (!input || typeof input.brokerId !== 'string' || !input.brokerId.trim()) return unavailable('A broker id is required.');
  if (!finite(input.debt) || input.debt < 0) return unavailable('Debt must be a finite non-negative amount.');
  if (!validBrokerAssumptions(input.assumptions)) return unavailable('Broker margin assumptions are invalid.');
  const positions = input.positions.filter(item => item.brokerId === input.brokerId);
  const capital = input.capital.filter(item => item.brokerId === input.brokerId);
  const currencies = new Set<string | null>([
    ...positions.map(item => normalizeCurrency(item.currency)), ...capital.map(item => normalizeCurrency(item.currency))
  ]);
  if (currencies.size > 1 || currencies.has(null)) return unavailable('Broker margin inputs must use one valid currency.');
  const gross = positions.reduce((sum, item) => sum + Math.abs(item.quantity * item.price), 0);
  const net = positions.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const cash = capital.reduce((sum, item) => sum + item.cash, 0);
  if (input.debt > 0 && currencies.size === 0) return unavailable('A currency is required for non-zero broker debt.');
  return available(buildBrokerMarginRisk(input.brokerId, input.debt, gross, net, cash, input.assumptions), 'current');
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
  const byTicker = new Map<string, RiskPositionInput>(normalized.value.positions.map(item => [item.ticker, item]));
  const seen = new Set<string>();
  const drivers: StressShockDriver[] = [];
  for (const shock of shocks) {
    const ticker = normalizeTicker(shock?.ticker);
    if (!ticker || !finite(shock.priceShock) || shock.priceShock < -1 || shock.priceShock > 10) {
      return unavailable('Each stress shock needs a valid ticker and decimal price shock between -100% and +1,000%.');
    }
    if (seen.has(ticker)) return unavailable('A ticker may be shocked only once per scenario.');
    seen.add(ticker);
    const position = byTicker.get(ticker);
    if (!position) return unavailable('No supplied position matches stress ticker ' + ticker + '.');
    const currentExposure = position.quantity * position.price;
    drivers.push({ ticker, currentExposure, priceShock: shock.priceShock, pnlImpact: currentExposure * shock.priceShock });
  }
  drivers.sort((a, b) => Math.abs(b.pnlImpact) - Math.abs(a.pnlImpact) || a.ticker.localeCompare(b.ticker));
  const totalPnlImpact = drivers.reduce((sum, item) => sum + item.pnlImpact, 0);
  const cash = normalized.value.capital.reduce((sum, item) => sum + item.cash, 0);
  const debt = normalized.value.capital.reduce((sum, item) => sum + item.debt, 0);
  const currentExposure = normalized.value.positions.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const currentEquity = cash + currentExposure - debt;
  return available({
    currency: [...currencies][0], calculatedAt: normalized.value.calculatedAt, totalPnlImpact, currentEquity,
    stressedEquity: currentEquity + totalPnlImpact, drivers,
    assumptions: [
      'Only explicitly supplied ticker shocks are applied; unshocked positions are held constant.',
      'Cash and debt are held constant; trading costs, taxes, liquidity slippage and forced liquidation are not modeled.'
    ],
    disclaimer: 'Arithmetic stress scenario only. It is not a probability estimate, forecast, broker liquidation price, or portfolio-state mutation.'
  }, normalized.value.quality, normalized.value.warnings);
}
