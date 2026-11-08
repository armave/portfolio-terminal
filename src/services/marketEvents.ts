import { normalizeCurrencyCode } from './marketDataContracts';
import { normalizeFinnhubStockSplits, type CorporateActionEvent } from './corporateActions';

export type MarketEventQuality = 'complete' | 'partial' | 'unavailable';
type EarningsTiming = 'before_market' | 'after_market' | 'during_market' | 'unknown';

interface MarketEventProvenance {
  provider: string | null;
  receivedAt: number | null;
  observedAt: number | null;
  publishedAt: number | null;
  quality: MarketEventQuality;
  issues: string[];
}

export interface EarningsEvent {
  id: string;
  symbol: string;
  eventDate: string;
  timing: EarningsTiming;
  epsActual: number | null;
  epsEstimate: number | null;
  revenueActual: number | null;
  revenueEstimate: number | null;
  fiscalQuarter: number | null;
  fiscalYear: number | null;
  currency: string | null;
  provenance: MarketEventProvenance;
}

export interface DividendEvent {
  id: string;
  symbol: string;
  exDate: string;
  amount: number | null;
  adjustedAmount: number | null;
  payDate: string | null;
  recordDate: string | null;
  declarationDate: string | null;
  currency: string | null;
  frequency: number | null;
  provenance: MarketEventProvenance;
}

export interface MarketEventsResult {
  symbol: string;
  earnings: EarningsEvent[];
  dividends: DividendEvent[];
  corporateActions: CorporateActionEvent[];
  earningsAvailable: boolean;
  dividendsAvailable: boolean;
  corporateActionsAvailable: boolean;
  quality: MarketEventQuality;
  provider: string | null;
  receivedAt: number | null;
  observedAt: null;
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function safeText(value: unknown, maxLength = 64): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function timestamp(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number !== null && number > 0) return number < 1e12 ? number * 1000 : number;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeTiming(value: unknown): EarningsTiming {
  const token = safeText(value)?.toLowerCase();
  if (token === 'bmo' || token === 'before market open' || token === 'before-market') return 'before_market';
  if (token === 'amc' || token === 'after market close' || token === 'after-market') return 'after_market';
  if (token === 'dmh' || token === 'during market hours' || token === 'during-market') return 'during_market';
  return 'unknown';
}

function provenance(
  provider: string | null,
  receivedAt: number | null,
  quality: MarketEventQuality,
  issues: string[]
): MarketEventProvenance {
  // Finnhub's current calendar/dividend payloads do not establish an exchange
  // observation or publication timestamp. Do not substitute client receipt time.
  return { provider, receivedAt, observedAt: null, publishedAt: null, quality, issues };
}

export function normalizeEarningsEvents(
  input: unknown,
  options: { symbol: string; provider?: unknown; receivedAt?: unknown; available?: boolean }
): { events: EarningsEvent[]; quality: MarketEventQuality; issues: string[] } {
  const issues: string[] = [];
  const provider = safeText(options.provider)?.toUpperCase() ?? null;
  const receivedAt = timestamp(options.receivedAt);
  if (options.available === false) return { events: [], quality: 'unavailable', issues: ['Earnings feed is unavailable.'] };
  if (!Array.isArray(input)) return { events: [], quality: 'unavailable', issues: ['Earnings feed is not an array.'] };
  const symbol = options.symbol.trim().toUpperCase();
  const events: EarningsEvent[] = [];
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) { issues.push('Earnings row ' + (index + 1) + ' is malformed.'); continue; }
    const eventDate = dateOnly(raw.date);
    if (!eventDate) { issues.push('Earnings row ' + (index + 1) + ' has an invalid event date.'); continue; }
    const rowSymbol = safeText(raw.symbol, 32)?.toUpperCase() ?? symbol;
    if (rowSymbol !== symbol) {
      issues.push('Earnings row ' + (index + 1) + ' belongs to a different symbol and was ignored.');
      continue;
    }
    const quarter = finiteNumber(raw.quarter);
    const year = finiteNumber(raw.year);
    const timing = normalizeTiming(raw.hour);
    if (timing === 'unknown') issues.push('Earnings row ' + (index + 1) + ' has no verified session timing.');
    const rowIssues = timing === 'unknown' ? ['Earnings session timing is unknown.'] : [];
    events.push({
      id: [rowSymbol, eventDate, year ?? '', quarter ?? ''].join(':'),
      symbol: rowSymbol,
      eventDate,
      timing,
      epsActual: finiteNumber(raw.epsActual),
      epsEstimate: finiteNumber(raw.epsEstimate),
      revenueActual: finiteNumber(raw.revenueActual),
      revenueEstimate: finiteNumber(raw.revenueEstimate),
      fiscalQuarter: quarter !== null && Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? quarter : null,
      fiscalYear: year !== null && Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null,
      currency: normalizeCurrencyCode(raw.currency),
      provenance(provider, receivedAt, rowIssues.length ? 'partial' : 'complete', rowIssues)
    });
  }
  const quality: MarketEventQuality = events.length === 0 ? 'unavailable' : issues.length ? 'partial' : 'complete';
  return { events, quality, issues };
}

export function normalizeDividendEvents(
  input: unknown,
  options: { symbol: string; provider?: unknown; receivedAt?: unknown; available?: boolean }
): { events: DividendEvent[]; quality: MarketEventQuality; issues: string[] } {
  const issues: string[] = [];
  const provider = safeText(options.provider)?.toUpperCase() ?? null;
  const receivedAt = timestamp(options.receivedAt);
  if (options.available === false) return { events: [], quality: 'unavailable', issues: ['Dividend feed is unavailable.'] };
  if (!Array.isArray(input)) return { events: [], quality: 'unavailable', issues: ['Dividend feed is not an array.'] };
  const symbol = options.symbol.trim().toUpperCase();
  const events: DividendEvent[] = [];
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) { issues.push('Dividend row ' + (index + 1) + ' is malformed.'); continue; }
    const exDate = dateOnly(raw.date);
    if (!exDate) { issues.push('Dividend row ' + (index + 1) + ' has an invalid ex-date.'); continue; }
    const rowSymbol = safeText(raw.symbol, 32)?.toUpperCase() ?? symbol;
    if (rowSymbol !== symbol) {
      issues.push('Dividend row ' + (index + 1) + ' belongs to a different symbol and was ignored.');
      continue;
    }
    const amount = finiteNumber(raw.amount);
    const payDate = dateOnly(raw.payDate);
    const recordDate = dateOnly(raw.recordDate);
    const declarationDate = dateOnly(raw.declarationDate);
    if (raw.payDate !== null && raw.payDate !== undefined && !payDate) issues.push('Dividend row ' + (index + 1) + ' has an invalid pay date.');
    if (raw.recordDate !== null && raw.recordDate !== undefined && !recordDate) issues.push('Dividend row ' + (index + 1) + ' has an invalid record date.');
    if (raw.declarationDate !== null && raw.declarationDate !== undefined && !declarationDate) issues.push('Dividend row ' + (index + 1) + ' has an invalid declaration date.');
    const currency = normalizeCurrencyCode(raw.currency);
    const rowIssues = [
      ...(amount === null ? ['Dividend amount is unavailable.'] : []),
      ...(!currency ? ['Dividend currency is unknown; no conversion was applied.'] : [])
    ];
    const stableSourceId = safeText(raw.id ?? raw.sourceId, 128);
    const id = stableSourceId
      ? provider + ':' + stableSourceId
      : [rowSymbol, exDate, declarationDate ?? '', recordDate ?? '', payDate ?? '', finiteNumber(raw.freq) ?? ''].join(':');
    events.push({
      id,
      symbol: rowSymbol,
      exDate,
      amount,
      adjustedAmount: finiteNumber(raw.adjustedAmount),
      payDate,
      recordDate,
      declarationDate,
      currency,
      frequency: finiteNumber(raw.freq),
      provenance: provenance(provider, receivedAt, rowIssues.length ? 'partial' : 'complete', rowIssues)
    });
  }
  const quality: MarketEventQuality = events.length === 0 ? 'unavailable' : issues.length ? 'partial' : 'complete';
  return { events, quality, issues };
}

export function normalizeMarketEventsResponse(input: unknown): MarketEventsResult {
  if (!isRecord(input) || input.ok !== true) {
    return {
      symbol: '',
      earnings: [],
      dividends: [],
      corporateActions: [],
      earningsAvailable: false,
      dividendsAvailable: false,
      corporateActionsAvailable: false,
      quality: 'unavailable',
      provider: null,
      receivedAt: null,
      observedAt: null,
      issues: ['Market events response is unavailable or malformed.']
    };
  }
  const symbol = safeText(input.symbol, 32)?.toUpperCase() ?? '';
  const provider = safeText(input.provider);
  const receivedAt = timestamp(input.receivedAt);
  const earningsResult = normalizeEarningsEvents(input.earnings, {
    symbol, provider, receivedAt, available: input.earningsAvailable === true
  });
  const dividendsResult = normalizeDividendEvents(input.dividends, {
    symbol, provider, receivedAt, available: input.dividendsAvailable === true
  });
  const corporateActionsResult = normalizeFinnhubStockSplits(input.corporateActions, {
    symbol, provider, receivedAt
  });
  const corporateActionsAvailable = input.corporateActionsAvailable === true;
  if (!corporateActionsAvailable) {
    corporateActionsResult.quality = 'unavailable';
    corporateActionsResult.issues.push('Corporate-action split feed is unavailable.');
  }
  const issues = [...earningsResult.issues, ...dividendsResult.issues, ...corporateActionsResult.issues];
  const hasAvailableFeed = earningsResult.quality !== 'unavailable' || dividendsResult.quality !== 'unavailable';
  const quality: MarketEventQuality = !hasAvailableFeed ? 'unavailable'
    : earningsResult.quality === 'partial' || dividendsResult.quality === 'partial' ||
      earningsResult.quality === 'unavailable' || dividendsResult.quality === 'unavailable' ||
      corporateActionsResult.quality === 'partial' || corporateActionsResult.quality === 'unavailable' ? 'partial' : 'complete';
  return {
    symbol,
    earnings: earningsResult.events,
    dividends: dividendsResult.events,
    corporateActions: corporateActionsResult.events,
    earningsAvailable: input.earningsAvailable === true,
    dividendsAvailable: input.dividendsAvailable === true,
    corporateActionsAvailable,
    quality,
    provider,
    receivedAt,
    observedAt: null,
    issues
  };
}

export interface MarketEventDateRange {
  from: string;
  to: string;
}

/** Keep event requests inside the Worker/provider one-year range contract. */
export function createMarketEventDateRange(now = new Date()): MarketEventDateRange {
  const center = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  return {
    from: new Date(center - 180 * dayMs).toISOString().slice(0, 10),
    to: new Date(center + 180 * dayMs).toISOString().slice(0, 10)
  };
}

/** Return the nearest non-past earnings date; never label a stale date as upcoming. */
export function getNextUpcomingEarningsDate(
  events: readonly { eventDate: string }[],
  now = Date.now()
): string | null {
  const date = new Date(now);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return events
    .map((event) => event.eventDate)
    .filter((value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = Date.parse(value + 'T00:00:00.000Z');
      return Number.isFinite(parsed) && parsed >= today &&
        new Date(parsed).toISOString().slice(0, 10) === value;
    })
    .sort((a, b) => a.localeCompare(b))[0] ?? null;
}
