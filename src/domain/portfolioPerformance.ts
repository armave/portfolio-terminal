/**
 * Deterministic portfolio performance calculations.
 *
 * All timestamps are UTC epoch milliseconds. Money values must already be in one
 * currency for a calculation. Returns are decimal fractions (0.1 = 10%).
 * No rounding is performed here; formatting/rounding belongs at presentation.
 */

export type PerformanceDataQuality = 'current' | 'provisional' | 'incomplete';
export type ExternalCashFlowType = 'contribution' | 'withdrawal';
export type PerformanceFrequency = 'daily' | 'monthly' | 'yearly';

export interface PerformanceValuationPoint {
  timestamp: number;
  equity: number;
  currency: string;
  quality: PerformanceDataQuality;
}

/** Amount is a positive magnitude; type determines its portfolio sign. */
export interface PerformanceExternalCashFlow {
  timestamp: number;
  amount: number;
  type: ExternalCashFlowType;
  currency: string;
  quality: PerformanceDataQuality;
}

export interface PerformanceInput {
  valuations: readonly PerformanceValuationPoint[];
  externalCashFlows?: readonly PerformanceExternalCashFlow[];
}

export type PerformanceCalculation<T> =
  | {
      status: 'available' | 'provisional';
      quality: 'current' | 'provisional';
      value: T;
      warnings: string[];
    }
  | {
      status: 'unavailable';
      reason: string;
      warnings: string[];
    };

export interface ModifiedDietzPeriod {
  startAt: number;
  endAt: number;
  startValue: number;
  endValue: number;
  externalFlow: number;
  weightedExternalFlow: number;
  capitalBase: number;
  profit: number;
  returnRate: number;
}

export interface TimeWeightedPerformance {
  method: 'linked-modified-dietz';
  currency: string;
  totalReturn: number;
  periods: ModifiedDietzPeriod[];
}

export interface PerformanceSeriesPoint {
  period: string;
  startAt: number;
  endAt: number;
  periodReturn: number;
  cumulativeReturn: number;
  quality: 'current' | 'provisional';
}

export interface PerformanceSeries {
  frequency: PerformanceFrequency;
  currency: string;
  sinceInceptionReturn: number;
  points: PerformanceSeriesPoint[];
}

export interface MoneyWeightedPerformance {
  method: 'xirr-act-365';
  currency: string;
  annualizedReturn: number;
  startAt: number;
  endAt: number;
}

export interface PerformanceAttributionFlow {
  timestamp: number;
  /** Signed capital movement from the portfolio's perspective. */
  amount: number;
  currency: string;
  quality: PerformanceDataQuality;
}

export interface PerformanceAttributionItem {
  key: string;
  currency: string;
  startValue: number;
  endValue: number;
  quality: PerformanceDataQuality;
  /** Includes internal transfers between items; their sum must equal external flows. */
  flows: readonly PerformanceAttributionFlow[];
}

export interface PeriodAttributionInput {
  startAt: number;
  endAt: number;
  currency: string;
  startPortfolioValue: number;
  endPortfolioValue: number;
  quality: PerformanceDataQuality;
  externalCashFlows?: readonly PerformanceExternalCashFlow[];
  items: readonly PerformanceAttributionItem[];
  /** Absolute currency-unit tolerance for snapshot/flow reconciliation. Defaults to 0.01. */
  tolerance?: number;
}

export interface PerformanceAttributionItemResult {
  key: string;
  profit: number;
  contribution: number;
}

export interface PeriodAttribution {
  currency: string;
  periodReturn: number;
  capitalBase: number;
  profit: number;
  items: PerformanceAttributionItemResult[];
}

export type PerformanceAdjustmentType = 'dividend' | 'fee' | 'commission' | 'interest';

export interface PerformanceAdjustment {
  timestamp: number;
  type: PerformanceAdjustmentType;
  /** Positive magnitude; fees/commissions/interest are costs, dividends are income. */
  amount: number;
  currency: string;
  quality: PerformanceDataQuality;
}

export interface PerformanceIncomeCostSummary {
  currency: string;
  dividends: number;
  fees: number;
  commissions: number;
  interest: number;
  netIncomeAndCosts: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * DAY_MS;
const DEFAULT_TOLERANCE = 0.01;
const RETURN_EPSILON = 1e-12;

function unavailable<T>(reason: string, warnings: string[] = []): PerformanceCalculation<T> {
  return { status: 'unavailable', reason, warnings };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= 8.64e15;
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function validQuality(value: unknown): value is PerformanceDataQuality {
  return value === 'current' || value === 'provisional' || value === 'incomplete';
}

function mergeQuality(...qualities: PerformanceDataQuality[]): 'current' | 'provisional' | 'incomplete' {
  if (qualities.includes('incomplete')) return 'incomplete';
  return qualities.includes('provisional') ? 'provisional' : 'current';
}

function resultWithQuality<T>(
  value: T,
  quality: 'current' | 'provisional',
  warnings: string[]
): PerformanceCalculation<T> {
  return {
    status: quality === 'current' ? 'available' : 'provisional',
    quality,
    value,
    warnings
  };
}

function closeEnough(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= Math.max(tolerance, Math.abs(expected) * 1e-10);
}

function normalizeValuations(
  values: readonly PerformanceValuationPoint[]
): PerformanceCalculation<{
  points: PerformanceValuationPoint[];
  currency: string;
  quality: 'current' | 'provisional';
}> {
  if (!Array.isArray(values) || values.length < 2) {
    return unavailable('At least two valuation observations are required.');
  }

  const points: PerformanceValuationPoint[] = [];
  let currency: string | null = null;
  const warnings: string[] = [];
  const qualities: PerformanceDataQuality[] = [];

  for (const point of values) {
    if (!point || !validTimestamp(point.timestamp)) {
      return unavailable('A valuation timestamp is missing or invalid.');
    }
    if (!finite(point.equity) || point.equity < 0) {
      return unavailable('A valuation must contain a finite, non-negative equity value.');
    }
    const pointCurrency = currencyCode(point.currency);
    if (!pointCurrency) return unavailable('A valuation currency must be a three-letter currency code.');
    if (!validQuality(point.quality)) return unavailable('A valuation data-quality state is missing or invalid.');
    if (currency !== null && pointCurrency !== currency) {
      return unavailable('Mixed currencies cannot be combined without a validated historical FX conversion.');
    }
    currency = pointCurrency;
    qualities.push(point.quality);
    points.push({ ...point, currency: pointCurrency });
  }

  points.sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].timestamp === points[index - 1].timestamp) {
      return unavailable('Valuation timestamps must be unique; duplicate observations cannot define a return period.');
    }
  }

  const quality = mergeQuality(...qualities);
  if (quality === 'incomplete') return unavailable('One or more valuation observations are incomplete.');
  if (quality === 'provisional') warnings.push('One or more valuation observations are provisional.');
  return resultWithQuality({ points, currency: currency as string, quality }, quality, warnings);
}

function normalizeExternalFlows(
  flows: readonly PerformanceExternalCashFlow[] | undefined,
  startAt: number,
  endAt: number,
  currency: string
): PerformanceCalculation<{
  flows: PerformanceExternalCashFlow[];
  quality: 'current' | 'provisional';
}> {
  const relevant: PerformanceExternalCashFlow[] = [];
  const warnings: string[] = [];
  const qualities: PerformanceDataQuality[] = [];

  for (const flow of flows ?? []) {
    if (!flow || !validTimestamp(flow.timestamp)) {
      return unavailable('An external cash-flow timestamp is missing or invalid.');
    }
    // The opening valuation already includes flows at/before its timestamp; flows after
    // the closing valuation belong to a later measurement window.
    if (flow.timestamp <= startAt || flow.timestamp > endAt) continue;
    if (!finite(flow.amount) || flow.amount <= 0) {
      return unavailable('External cash-flow amounts must be finite positive magnitudes.');
    }
    if (flow.type !== 'contribution' && flow.type !== 'withdrawal') {
      return unavailable('An external cash flow has an unsupported type.');
    }
    if (currencyCode(flow.currency) !== currency) {
      return unavailable('An external cash flow uses a different or invalid currency.');
    }
    if (!validQuality(flow.quality)) return unavailable('An external cash flow has missing or invalid data quality.');
    if (flow.quality === 'incomplete') return unavailable('An external cash flow is incomplete.');
    relevant.push({ ...flow, currency });
    qualities.push(flow.quality);
  }

  relevant.sort((a, b) => a.timestamp - b.timestamp);
  const quality = mergeQuality(...qualities);
  if (quality === 'incomplete') return unavailable('One or more external cash flows are incomplete.');
  if (quality === 'provisional') warnings.push('One or more external cash flows are provisional.');
  return resultWithQuality({ flows: relevant, quality }, quality, warnings);
}

function signedExternalFlow(flow: PerformanceExternalCashFlow): number {
  return flow.type === 'contribution' ? flow.amount : -flow.amount;
}

function calculateDietzPeriod(
  start: PerformanceValuationPoint,
  end: PerformanceValuationPoint,
  flows: readonly PerformanceExternalCashFlow[]
): PerformanceCalculation<ModifiedDietzPeriod> {
  const duration = end.timestamp - start.timestamp;
  if (duration <= 0) return unavailable('A return period must have positive duration.');
  if (start.equity <= 0) return unavailable('A return period requires positive opening equity.');

  let externalFlow = 0;
  let weightedExternalFlow = 0;
  const qualities: PerformanceDataQuality[] = [start.quality, end.quality];

  for (const flow of flows) {
    const signedAmount = signedExternalFlow(flow);
    const weight = (end.timestamp - flow.timestamp) / duration;
    externalFlow += signedAmount;
    weightedExternalFlow += signedAmount * weight;
    qualities.push(flow.quality);
  }

  const capitalBase = start.equity + weightedExternalFlow;
  if (!finite(capitalBase) || capitalBase <= 0) {
    return unavailable('The Modified Dietz capital base must be finite and positive.');
  }

  const profit = end.equity - start.equity - externalFlow;
  const returnRate = profit / capitalBase;
  if (!finite(returnRate) || returnRate < -1 - RETURN_EPSILON) {
    return unavailable('The period return is outside the supported range; verify valuation timing and cash-flow allocation.');
  }

  const quality = mergeQuality(...qualities);
  if (quality === 'incomplete') return unavailable('A return-period input is incomplete.');
  return resultWithQuality({
    startAt: start.timestamp,
    endAt: end.timestamp,
    startValue: start.equity,
    endValue: end.equity,
    externalFlow,
    weightedExternalFlow,
    capitalBase,
    profit,
    returnRate: Math.max(-1, returnRate)
  }, quality, quality === 'provisional' ? ['The return period includes provisional source data.'] : []);
}

/**
 * Calculate linked Modified Dietz returns between supplied valuation observations.
 * This is a flow-weighted approximation of TWR when pre/post-flow valuations are not
 * available; it is not represented as an exact subperiod valuation method.
 */
export function calculateTimeWeightedReturn(
  input: PerformanceInput
): PerformanceCalculation<TimeWeightedPerformance> {
  const normalized = normalizeValuations(input.valuations);
  if (normalized.status === 'unavailable') return normalized;
  const { points, currency, quality: valuationQuality } = normalized.value;
  const normalizedFlows = normalizeExternalFlows(
    input.externalCashFlows,
    points[0].timestamp,
    points[points.length - 1].timestamp,
    currency
  );
  if (normalizedFlows.status === 'unavailable') return normalizedFlows;

  const periods: ModifiedDietzPeriod[] = [];
  const warnings = [...normalized.warnings, ...normalizedFlows.warnings];
  let linkedGrowth = 1;
  let overallQuality = mergeQuality(valuationQuality, normalizedFlows.value.quality);

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const periodFlows = normalizedFlows.value.flows.filter(
      (flow) => flow.timestamp > start.timestamp && flow.timestamp <= end.timestamp
    );
    const result = calculateDietzPeriod(start, end, periodFlows);
    if (result.status === 'unavailable') return result;
    periods.push(result.value);
    linkedGrowth *= 1 + result.value.returnRate;
    overallQuality = mergeQuality(overallQuality, result.quality);
  }

  const totalReturn = linkedGrowth - 1;
  if (!finite(totalReturn)) return unavailable('The linked return is not finite.', warnings);
  if (overallQuality === 'incomplete') return unavailable('The linked return contains incomplete inputs.', warnings);
  if (overallQuality === 'provisional' && warnings.length === 0) {
    warnings.push('The result includes provisional inputs.');
  }
  return resultWithQuality(
    { method: 'linked-modified-dietz', currency, totalReturn, periods },
    overallQuality,
    warnings
  );
}

function periodKey(timestamp: number, frequency: PerformanceFrequency): string {
  const iso = new Date(timestamp).toISOString();
  if (frequency === 'daily') return iso.slice(0, 10);
  if (frequency === 'monthly') return iso.slice(0, 7);
  return iso.slice(0, 4);
}

/** Build daily/monthly/yearly linked return buckets from the supplied valuation cadence. */
export function buildPerformanceSeries(
  input: PerformanceInput,
  frequency: PerformanceFrequency
): PerformanceCalculation<PerformanceSeries> {
  if (frequency !== 'daily' && frequency !== 'monthly' && frequency !== 'yearly') {
    return unavailable('An unsupported performance-series frequency was requested.');
  }
  const calculation = calculateTimeWeightedReturn(input);
  if (calculation.status === 'unavailable') return calculation;

  const groups = new Map<string, { startAt: number; endAt: number; growth: number }>();
  for (const period of calculation.value.periods) {
    const key = periodKey(period.endAt, frequency);
    const existing = groups.get(key);
    if (existing) {
      existing.endAt = period.endAt;
      existing.growth *= 1 + period.returnRate;
    } else {
      groups.set(key, {
        startAt: period.startAt,
        endAt: period.endAt,
        growth: 1 + period.returnRate
      });
    }
  }

  let cumulativeGrowth = 1;
  const points: PerformanceSeriesPoint[] = [];
  for (const [period, group] of groups) {
    const periodReturn = group.growth - 1;
    cumulativeGrowth *= group.growth;
    points.push({
      period,
      startAt: group.startAt,
      endAt: group.endAt,
      periodReturn,
      cumulativeReturn: cumulativeGrowth - 1,
      quality: calculation.quality
    });
  }

  return resultWithQuality({
    frequency,
    currency: calculation.value.currency,
    sinceInceptionReturn: calculation.value.totalReturn,
    points
  }, calculation.quality, calculation.warnings);
}

function normalizedXnpvSign(
  cashFlows: readonly { timestamp: number; amount: number }[],
  rate: number,
  origin: number
): number {
  const logFactor = Math.log1p(rate);
  const terms = cashFlows.map((flow) => ({
    sign: Math.sign(flow.amount),
    logMagnitude: Math.log(Math.abs(flow.amount)) -
      ((flow.timestamp - origin) / YEAR_MS) * logFactor
  }));
  const maxLog = Math.max(...terms.map((term) => term.logMagnitude));
  let normalizedNpv = 0;
  for (const term of terms) {
    normalizedNpv += term.sign * Math.exp(term.logMagnitude - maxLog);
  }
  return normalizedNpv;
}

/**
 * Calculate XIRR using ACT/365 year fractions and a bracketed bisection solver.
 * Contributions are investor cash outflows; withdrawals and ending equity are inflows.
 * Ambiguous multiple-sign-change cash-flow series are reported as unavailable.
 */
export function calculateMoneyWeightedReturn(
  input: PerformanceInput
): PerformanceCalculation<MoneyWeightedPerformance> {
  const normalized = normalizeValuations(input.valuations);
  if (normalized.status === 'unavailable') return normalized;
  const { points, currency, quality: valuationQuality } = normalized.value;
  const first = points[0];
  const last = points[points.length - 1];
  if (first.equity <= 0) return unavailable('Money-weighted return requires positive opening equity.');
  const normalizedFlows = normalizeExternalFlows(
    input.externalCashFlows,
    first.timestamp,
    last.timestamp,
    currency
  );
  if (normalizedFlows.status === 'unavailable') return normalizedFlows;

  const events: { timestamp: number; amount: number }[] = [
    { timestamp: first.timestamp, amount: -first.equity }
  ];
  for (const flow of normalizedFlows.value.flows) {
    events.push({
      timestamp: flow.timestamp,
      amount: flow.type === 'contribution' ? -flow.amount : flow.amount
    });
  }
  events.push({ timestamp: last.timestamp, amount: last.equity });

  const byTimestamp = new Map<number, number>();
  for (const event of events) {
    byTimestamp.set(event.timestamp, (byTimestamp.get(event.timestamp) ?? 0) + event.amount);
  }
  const cashFlows = [...byTimestamp.entries()]
    .map(([timestamp, amount]) => ({ timestamp, amount }))
    .filter((event) => event.amount !== 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  if (cashFlows.length < 2) {
    return unavailable('At least one investment outflow and one terminal/investment inflow are required.');
  }

  let signChanges = 0;
  for (let index = 1; index < cashFlows.length; index += 1) {
    if (Math.sign(cashFlows[index].amount) !== Math.sign(cashFlows[index - 1].amount)) signChanges += 1;
  }
  if (signChanges !== 1) {
    return unavailable('Money-weighted return is ambiguous because the investor cash-flow series has multiple or no sign changes.');
  }
  if (cashFlows[0].amount >= 0 || cashFlows[cashFlows.length - 1].amount <= 0) {
    return unavailable('The investor cash-flow series must begin with an investment outflow and end with an inflow.');
  }

  let low = -0.999999;
  let high = 1;
  let lowValue = normalizedXnpvSign(cashFlows, low, first.timestamp);
  let highValue = normalizedXnpvSign(cashFlows, high, first.timestamp);
  while (Math.sign(lowValue) === Math.sign(highValue) && high < 1_000_000) {
    high = high * 2 + 1;
    highValue = normalizedXnpvSign(cashFlows, high, first.timestamp);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || Math.sign(lowValue) === Math.sign(highValue)) {
    return unavailable('No money-weighted return root was found within the supported rate range.');
  }

  for (let iteration = 0; iteration < 180; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = normalizedXnpvSign(cashFlows, middle, first.timestamp);
    if (!Number.isFinite(middleValue)) {
      return unavailable('The money-weighted return solver became numerically unstable.');
    }
    if (Math.abs(middleValue) <= 1e-14 || high - low <= 1e-12) {
      const quality = mergeQuality(valuationQuality, normalizedFlows.value.quality);
      if (quality === 'incomplete') return unavailable('The money-weighted return contains incomplete inputs.');
      return resultWithQuality({
        method: 'xirr-act-365',
        currency,
        annualizedReturn: middle,
        startAt: first.timestamp,
        endAt: last.timestamp
      }, quality, [...normalized.warnings, ...normalizedFlows.warnings]);
    }
    if (Math.sign(middleValue) === Math.sign(lowValue)) {
      low = middle;
      lowValue = middleValue;
    } else {
      high = middle;
      highValue = middleValue;
    }
  }

  const annualizedReturn = (low + high) / 2;
  const quality = mergeQuality(valuationQuality, normalizedFlows.value.quality);
  if (quality === 'incomplete') return unavailable('The money-weighted return contains incomplete inputs.');
  return resultWithQuality({
    method: 'xirr-act-365',
    currency,
    annualizedReturn,
    startAt: first.timestamp,
    endAt: last.timestamp
  }, quality, [...normalized.warnings, ...normalizedFlows.warnings]);
}

/**
 * Attribute one Modified Dietz period across position/account/cash/debt buckets.
 * Item values must sum to portfolio equity at both ends. Item capital movements may
 * include internal transfers, but all item flows together must equal external flows.
 */
export function calculatePeriodAttribution(
  input: PeriodAttributionInput
): PerformanceCalculation<PeriodAttribution> {
  if (!validTimestamp(input.startAt) || !validTimestamp(input.endAt) || input.endAt <= input.startAt) {
    return unavailable('Attribution requires a valid positive-duration period.');
  }
  const currency = currencyCode(input.currency);
  if (!currency) return unavailable('Attribution requires a three-letter currency code.');
  if (!finite(input.startPortfolioValue) || input.startPortfolioValue <= 0 ||
      !finite(input.endPortfolioValue) || input.endPortfolioValue < 0) {
    return unavailable('Attribution requires positive opening equity and non-negative closing equity.');
  }
  if (!validQuality(input.quality) || input.quality === 'incomplete') {
    return unavailable('Attribution input quality is incomplete or invalid.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return unavailable('At least one attribution item is required.');
  }
  const tolerance = finite(input.tolerance) && input.tolerance >= 0
    ? input.tolerance
    : DEFAULT_TOLERANCE;

  const flowResult = normalizeExternalFlows(input.externalCashFlows, input.startAt, input.endAt, currency);
  if (flowResult.status === 'unavailable') return flowResult;
  const netExternalFlow = flowResult.value.flows.reduce(
    (sum, flow) => sum + signedExternalFlow(flow),
    0
  );
  const duration = input.endAt - input.startAt;
  let weightedExternalFlow = 0;
  for (const flow of flowResult.value.flows) {
    weightedExternalFlow += signedExternalFlow(flow) * ((input.endAt - flow.timestamp) / duration);
  }
  const capitalBase = input.startPortfolioValue + weightedExternalFlow;
  if (!finite(capitalBase) || capitalBase <= 0) {
    return unavailable('Attribution capital base must be finite and positive.');
  }

  const keys = new Set<string>();
  let startSum = 0;
  let endSum = 0;
  let itemFlowSum = 0;
  const qualities: PerformanceDataQuality[] = [input.quality, flowResult.value.quality];
  const results: PerformanceAttributionItemResult[] = [];

  for (const item of input.items) {
    if (!item || typeof item.key !== 'string' || item.key.trim() === '' || keys.has(item.key)) {
      return unavailable('Attribution item keys must be non-empty and unique.');
    }
    keys.add(item.key);
    if (currencyCode(item.currency) !== currency) {
      return unavailable('Attribution items must use the portfolio currency.');
    }
    if (!finite(item.startValue) || !finite(item.endValue) || !validQuality(item.quality)) {
      return unavailable('An attribution item has missing or invalid values/quality.');
    }
    if (item.quality === 'incomplete') return unavailable('An attribution item is incomplete.');
    qualities.push(item.quality);
    startSum += item.startValue;
    endSum += item.endValue;

    let itemFlows = 0;
    for (const flow of item.flows ?? []) {
      if (!flow || !validTimestamp(flow.timestamp)) {
        return unavailable('An attribution flow timestamp is missing or invalid.');
      }
      if (flow.timestamp <= input.startAt || flow.timestamp > input.endAt) continue;
      if (!finite(flow.amount) || currencyCode(flow.currency) !== currency || !validQuality(flow.quality)) {
        return unavailable('An attribution flow has invalid amount, currency, or quality.');
      }
      if (flow.quality === 'incomplete') return unavailable('An attribution flow is incomplete.');
      qualities.push(flow.quality);
      itemFlows += flow.amount;
    }
    itemFlowSum += itemFlows;
    const profit = item.endValue - item.startValue - itemFlows;
    results.push({ key: item.key, profit, contribution: profit / capitalBase });
  }

  if (!closeEnough(startSum, input.startPortfolioValue, tolerance)) {
    return unavailable('Opening attribution items do not reconcile to opening portfolio equity.');
  }
  if (!closeEnough(endSum, input.endPortfolioValue, tolerance)) {
    return unavailable('Closing attribution items do not reconcile to closing portfolio equity.');
  }
  if (!closeEnough(itemFlowSum, netExternalFlow, tolerance)) {
    return unavailable('Attribution item capital movements do not reconcile to external portfolio flows.');
  }

  const portfolioProfit = input.endPortfolioValue - input.startPortfolioValue - netExternalFlow;
  const attributedProfit = results.reduce((sum, item) => sum + item.profit, 0);
  if (!closeEnough(attributedProfit, portfolioProfit, tolerance)) {
    return unavailable('Attribution profit does not reconcile to portfolio profit.');
  }
  const periodReturn = portfolioProfit / capitalBase;
  const quality = mergeQuality(...qualities);
  if (quality === 'incomplete') return unavailable('Attribution contains incomplete source data.');
  return resultWithQuality({
    currency,
    periodReturn,
    capitalBase,
    profit: portfolioProfit,
    items: results
  }, quality, quality === 'provisional' ? ['Attribution includes provisional source data.'] : []);
}

/**
 * Summarize dividends and costs separately from return cash flows.
 * These entries must already be reflected in the valuation series; this helper is
 * explanatory only and must not be added again to TWR/MWR, which would double count.
 */
export function summarizePerformanceIncomeAndCosts(
  adjustments: readonly PerformanceAdjustment[],
  currencyInput: string
): PerformanceCalculation<PerformanceIncomeCostSummary> {
  const currency = currencyCode(currencyInput);
  if (!currency) return unavailable('A three-letter summary currency is required.');
  let dividends = 0;
  let fees = 0;
  let commissions = 0;
  let interest = 0;
  const qualities: PerformanceDataQuality[] = [];

  for (const adjustment of adjustments) {
    if (!adjustment || !validTimestamp(adjustment.timestamp)) {
      return unavailable('An income/cost adjustment timestamp is missing or invalid.');
    }
    if (!finite(adjustment.amount) || adjustment.amount < 0) {
      return unavailable('Income/cost adjustment amounts must be finite non-negative magnitudes.');
    }
    if (currencyCode(adjustment.currency) !== currency) {
      return unavailable('Income/cost adjustments must use the summary currency.');
    }
    if (!validQuality(adjustment.quality)) {
      return unavailable('An income/cost adjustment has missing or invalid data quality.');
    }
    if (adjustment.quality === 'incomplete') {
      return unavailable('An income/cost adjustment is incomplete.');
    }
    qualities.push(adjustment.quality);
    switch (adjustment.type) {
      case 'dividend': dividends += adjustment.amount; break;
      case 'fee': fees += adjustment.amount; break;
      case 'commission': commissions += adjustment.amount; break;
      case 'interest': interest += adjustment.amount; break;
      default: return unavailable('An unsupported income/cost adjustment type was supplied.');
    }
  }

  const netIncomeAndCosts = dividends - fees - commissions - interest;
  if (![dividends, fees, commissions, interest, netIncomeAndCosts].every(Number.isFinite)) {
    return unavailable('The income/cost summary exceeds the supported numeric range.');
  }
  const quality = mergeQuality(...qualities);
  if (quality === 'incomplete') return unavailable('The income/cost summary contains incomplete source data.');
  return resultWithQuality({
    currency,
    dividends,
    fees,
    commissions,
    interest,
    netIncomeAndCosts
  }, quality, quality === 'provisional' ? ['The income/cost summary includes provisional source data.'] : []);
}
