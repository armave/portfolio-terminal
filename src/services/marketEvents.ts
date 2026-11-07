import { normalizeCurrencyCode } from './marketDataContracts';

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
  earningsAvailable: boolean;
  dividendsAvailable: boolean;
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
    const quarter = finiteNumber(raw.quarter);
    const year = finiteNumber(raw.year);
    events.push({
      id: [rowSymbol, eventDate, year ?? '', quarter ?? ''].join(':'),
      symbol: rowSymbol,
      eventDate,
      timing: normalizeTiming(raw.hour),
      epsActual: finiteNumber(raw.epsActual),
      epsEstimate: finiteNumber(raw.epsEstimate),
      revenueActual: finiteNumber(raw.revenueActual),
      revenueEstimate: finiteNumber(raw.revenueEstimate),
      fiscalQuarter: quarter !== null && Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? quarter : null,
      fiscalYear: year !== null && Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null,
      currency: normalizeCurrencyCode(raw.currency),
      provenance: provenance(provider, receivedAt, 'complete', [])
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
    const amount = finiteNumber(raw.amount);
    const payDate = dateOnly(raw.payDate);
    const recordDate = dateOnly(raw.recordDate);
    const declarationDate = dateOnly(raw.declarationDate);
    if (raw.payDate !== null && raw.payDate !== undefined && !payDate) issues.push('Dividend row ' + (index + 1) + ' has an invalid pay date.');
    if (raw.recordDate !== null && raw.recordDate !== undefined && !recordDate) issues.push('Dividend row ' + (index + 1) + ' has an invalid record date.');
    if (raw.declarationDate !== null && raw.declarationDate !== undefined && !declarationDate) issues.push('Dividend row ' + (index + 1) + ' has an invalid declaration date.');
    events.push({
      id: [rowSymbol, exDate, amount ?? '', normalizeCurrencyCode(raw.currency) ?? ''].join(':'),
      symbol: rowSymbol,
      exDate,
      amount,
      adjustedAmount: finiteNumber(raw.adjustedAmount),
      payDate,
      recordDate,
      declarationDate,
      currency: normalizeCurrencyCode(raw.currency),
      frequency: finiteNumber(raw.freq),
      provenance: provenance(provider, receivedAt, 'complete', [])
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
      earningsAvailable: false,
      dividendsAvailable: false,
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
  const issues = [...earningsResult.issues, ...dividendsResult.issues];
  const hasAvailableFeed = earningsResult.quality !== 'unavailable' || dividendsResult.quality !== 'unavailable';
  const quality: MarketEventQuality = !hasAvailableFeed ? 'unavailable'
    : earningsResult.quality === 'partial' || dividendsResult.quality === 'partial' ||
      earningsResult.quality === 'unavailable' || dividendsResult.quality === 'unavailable' ? 'partial' : 'complete';
  return {
    symbol,
    earnings: earningsResult.events,
    dividends: dividendsResult.events,
    earningsAvailable: input.earningsAvailable === true,
    dividendsAvailable: input.dividendsAvailable === true,
    quality,
    provider,
    receivedAt,
    observedAt: null,
    issues
  };
}
