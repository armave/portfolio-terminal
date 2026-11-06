/**
 * Provider-neutral market-data contracts.
 *
 * These functions validate untrusted provider values without guessing missing
 * currencies, observation timestamps, exchanges, or asset classifications.
 * Receipt time is intentionally independent from observation time.
 */

export type MarketDelayClass = 'live' | 'delayed' | 'indicative' | 'unknown';
export type MarketFreshness = 'fresh' | 'stale' | 'delayed' | 'indicative' | 'unknown';
export type MarketDataQuality = 'complete' | 'partial' | 'unknown';
export type MarketSession = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | 'UNKNOWN';
export type MarketAssetType = 'EQUITY' | 'ETF' | 'FUND' | 'INDEX' | 'FX' | 'CRYPTO' | 'OPTION' | 'FUTURE' | 'BOND' | 'UNKNOWN';

export interface InstrumentIdentityInput {
  symbol: unknown;
  exchange?: unknown;
  assetType?: unknown;
  quoteCurrency?: unknown;
  aliases?: readonly unknown[];
  providerSymbols?: Readonly<Record<string, unknown>>;
}

export interface InstrumentIdentity {
  id: string;
  symbol: string;
  exchange: string | null;
  assetType: MarketAssetType;
  quoteCurrency: string | null;
  aliases: string[];
  providerSymbols: Record<string, string>;
}

export interface InstrumentIdentityResult {
  instrument: InstrumentIdentity | null;
  issues: string[];
}

const KNOWN_EXCHANGE_SUFFIXES = new Set([
  'US', 'NASDAQ', 'NYSE', 'AMEX', 'LSE', 'TSE', 'TSX', 'V',
  'HK', 'HKG', 'AS', 'PA', 'DE', 'XETRA', 'SW'
]);

const ASSET_TYPES = new Set<MarketAssetType>([
  'EQUITY', 'ETF', 'FUND', 'INDEX', 'FX', 'CRYPTO', 'OPTION', 'FUTURE', 'BOND', 'UNKNOWN'
]);

function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

export function normalizeCurrencyCode(value: unknown): string | null {
  const currency = normalizeToken(value);
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAssetType(value: unknown): MarketAssetType {
  const token = normalizeToken(value);
  return token && ASSET_TYPES.has(token as MarketAssetType)
    ? token as MarketAssetType
    : 'UNKNOWN';
}

function splitKnownExchangeSuffix(symbol: string): { symbol: string; exchange: string | null } {
  const dot = symbol.lastIndexOf('.');
  if (dot <= 0 || dot === symbol.length - 1) return { symbol, exchange: null };
  const suffix = symbol.slice(dot + 1);
  if (!KNOWN_EXCHANGE_SUFFIXES.has(suffix)) return { symbol, exchange: null };
  return { symbol: symbol.slice(0, dot), exchange: suffix };
}

/**
 * Creates a stable, explicit instrument identity.
 *
 * Only a known exchange suffix is separated. Share-class symbols such as
 * BRK.B remain intact. No currency or asset type is inferred from a ticker.
 */
export function normalizeInstrumentIdentity(input: InstrumentIdentityInput): InstrumentIdentityResult {
  const issues: string[] = [];
  const rawSymbol = normalizeToken(input.symbol);
  if (!rawSymbol) return { instrument: null, issues: ['Instrument symbol is missing.'] };
  if (!/^[A-Z0-9^][A-Z0-9.^=_-]{0,31}$/.test(rawSymbol)) {
    return { instrument: null, issues: ['Instrument symbol contains unsupported characters.'] };
  }

  const explicitExchange = normalizeToken(input.exchange);
  if (explicitExchange && !/^[A-Z0-9-]{1,16}$/.test(explicitExchange)) {
    return { instrument: null, issues: ['Exchange contains unsupported characters.'] };
  }
  const suffixParsed = splitKnownExchangeSuffix(rawSymbol);
  const parsed = explicitExchange
    ? {
        symbol: suffixParsed.exchange ? suffixParsed.symbol : rawSymbol,
        exchange: explicitExchange
      }
    : suffixParsed;
  const exchange = parsed.exchange || explicitExchange;
  const symbol = parsed.symbol;
  if (!symbol) return { instrument: null, issues: ['Instrument symbol is empty after exchange normalization.'] };

  const assetToken = normalizeToken(input.assetType);
  const assetType = normalizeAssetType(input.assetType);
  if (assetToken && assetType === 'UNKNOWN') issues.push('Asset type is unsupported; classification remains unknown.');

  const quoteCurrency = input.quoteCurrency === undefined || input.quoteCurrency === null || input.quoteCurrency === ''
    ? null
    : normalizeCurrencyCode(input.quoteCurrency);
  if (input.quoteCurrency !== undefined && input.quoteCurrency !== null && input.quoteCurrency !== '' && !quoteCurrency) {
    issues.push('Quote currency is invalid; currency remains unknown.');
  }

  const aliases = [...new Set((input.aliases || [])
    .map(normalizeToken)
    .filter((alias): alias is string => Boolean(alias) && alias !== symbol))];

  const providerSymbols: Record<string, string> = {};
  for (const [provider, rawProviderSymbol] of Object.entries(input.providerSymbols || {})) {
    const providerKey = normalizeToken(provider);
    const providerSymbol = normalizeToken(rawProviderSymbol);
    if (providerKey && providerSymbol) providerSymbols[providerKey] = providerSymbol;
    else issues.push('An invalid provider symbol mapping was ignored.');
  }

  const id = assetType + ':' + (exchange || 'UNSPECIFIED') + ':' + symbol;
  return {
    instrument: { id, symbol, exchange, assetType, quoteCurrency, aliases, providerSymbols },
    issues
  };
}

export interface MarketQuoteObservationInput {
  symbol: unknown;
  price: unknown;
  provider: unknown;
  receivedAt: unknown;
  observedAt?: unknown;
  currency?: unknown;
  exchange?: unknown;
  assetType?: unknown;
  session?: unknown;
  delayClass?: unknown;
  requestSequence?: unknown;
}

export interface MarketQuoteObservation {
  instrument: InstrumentIdentity;
  price: number;
  provider: string;
  observedAt: number | null;
  receivedAt: number;
  session: MarketSession;
  delayClass: MarketDelayClass;
  freshness: MarketFreshness;
  quality: MarketDataQuality;
  requestSequence: number | null;
}

export interface MarketQuoteObservationResult {
  observation: MarketQuoteObservation | null;
  issues: string[];
}

function normalizeMarketSession(value: unknown): MarketSession {
  const token = normalizeToken(value);
  if (!token) return 'UNKNOWN';
  if (['PRE', 'PREMARKET', 'PRE-MARKET'].includes(token)) return 'PRE';
  if (['REGULAR', 'MARKET', 'OPEN'].includes(token)) return 'REGULAR';
  if (['POST', 'POSTMARKET', 'POST-MARKET'].includes(token)) return 'POST';
  if (['CLOSED', 'CLOSE'].includes(token)) return 'CLOSED';
  return 'UNKNOWN';
}

function normalizeDelayClass(value: unknown): MarketDelayClass {
  const token = normalizeToken(value);
  return token === 'LIVE' || token === 'REALTIME' ? 'live'
    : token === 'DELAYED' ? 'delayed'
      : token === 'INDICATIVE' ? 'indicative'
        : 'unknown';
}

function normalizeRequestSequence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * Validates a quote without upgrading it to live merely because the response
 * was received recently. A source observation timestamp is required for a
 * fresh classification.
 */
export function normalizeMarketQuoteObservation(
  input: MarketQuoteObservationInput,
  options: { now?: number; maxAgeMs?: number; maxFutureSkewMs?: number } = {}
): MarketQuoteObservationResult {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
  const maxFutureSkewMs = options.maxFutureSkewMs ?? 60 * 1000;
  const issues: string[] = [];
  const price = typeof input.price === 'number'
    ? input.price
    : typeof input.price === 'string' && input.price.trim()
      ? Number(input.price)
      : Number.NaN;
  const provider = normalizeToken(input.provider);
  const receivedAt = normalizeTimestamp(input.receivedAt);

  if (!Number.isFinite(price) || price <= 0) issues.push('Quote price must be a finite positive number.');
  if (!provider) issues.push('Quote provider is missing.');
  if (receivedAt === null) issues.push('Quote receipt timestamp is missing or invalid.');

  const identity = normalizeInstrumentIdentity({
    symbol: input.symbol,
    exchange: input.exchange,
    assetType: input.assetType,
    quoteCurrency: input.currency
  });
  issues.push(...identity.issues);

  if (!Number.isFinite(price) || price <= 0 || !provider || receivedAt === null || !identity.instrument) {
    return { observation: null, issues };
  }

  let observedAt = normalizeTimestamp(input.observedAt);
  if (input.observedAt !== undefined && input.observedAt !== null && observedAt === null) {
    issues.push('Provider observation timestamp is invalid; freshness remains unknown.');
  }
  if (observedAt !== null && observedAt > receivedAt + maxFutureSkewMs) {
    observedAt = null;
    issues.push('Provider observation timestamp is later than receipt time; freshness remains unknown.');
  }

  const delayClass = normalizeDelayClass(input.delayClass);
  let freshness: MarketFreshness = 'unknown';
  if (delayClass === 'delayed') freshness = 'delayed';
  else if (delayClass === 'indicative') freshness = 'indicative';
  else if (observedAt !== null) {
    const ageMs = now - observedAt;
    // Age is objective even when the provider's delay classification is not.
    // A recent observation is called fresh only when the provider confirms live data.
    if (ageMs < 0 || ageMs > maxAgeMs) freshness = 'stale';
    else if (delayClass === 'live') freshness = 'fresh';
  }

  const hasCurrency = identity.instrument.quoteCurrency !== null;
  const quality: MarketDataQuality = observedAt !== null && hasCurrency
    ? 'complete'
    : 'partial';
  if (!hasCurrency) issues.push('Quote currency is unknown; currency conversion is unavailable.');
  if (observedAt === null) issues.push('Quote observation time is unknown; live freshness cannot be verified.');

  return {
    observation: {
      instrument: identity.instrument,
      price,
      provider,
      observedAt,
      receivedAt,
      session: normalizeMarketSession(input.session),
      delayClass,
      freshness,
      quality,
      requestSequence: normalizeRequestSequence(input.requestSequence)
    },
    issues
  };
}

export interface MarketPricePoint {
  timestamp: number;
  /** Close/last price retained as the common scalar consumed by existing analytics. */
  price: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

export interface MarketHistoryResult {
  points: MarketPricePoint[];
  quality: 'complete' | 'partial' | 'unavailable';
  issues: string[];
  instrument?: InstrumentIdentity;
  provider?: string;
  receivedAt?: number;
  interval?: string;
}

export interface MarketQuoteRequest {
  instrument: InstrumentIdentity;
  force?: boolean;
  signal?: AbortSignal;
}

export interface MarketHistoryRequest {
  instrument: InstrumentIdentity;
  startAt: number;
  endAt: number;
  interval: string;
  signal?: AbortSignal;
}

/** Provider adapters return normalized contracts, never provider JSON or untyped values. */
export interface MarketDataProviderAdapter {
  readonly providerId: string;
  fetchQuote(request: MarketQuoteRequest): Promise<MarketQuoteObservationResult>;
  fetchHistory(request: MarketHistoryRequest): Promise<MarketHistoryResult>;
}

/** Normalizes, validates, sorts, and de-duplicates untrusted historical prices. */
export function normalizeMarketHistoryPoints(
  input: unknown,
  options: { maxPoints?: number } = {}
): MarketHistoryResult {
  if (!Array.isArray(input)) {
    return { points: [], quality: 'unavailable', issues: ['Historical price response is not an array.'] };
  }
  const requestedMaxPoints = options.maxPoints ?? 20_000;
  const maxPoints = Number.isFinite(requestedMaxPoints)
    ? Math.max(1, Math.min(20_000, Math.floor(requestedMaxPoints)))
    : 20_000;
  const issues: string[] = [];
  const byTimestamp = new Map<number, MarketPricePoint>();
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push('Historical row ' + (index + 1) + ' is malformed.');
      continue;
    }
    const row = item as Record<string, unknown>;
    const timestamp = normalizeTimestamp(row.timestamp ?? row.time ?? row.date ?? row.t);
    const priceValue = row.price ?? row.close ?? row.value ?? row.c;
    const price = typeof priceValue === 'number'
      ? priceValue
      : typeof priceValue === 'string' && priceValue.trim()
        ? Number(priceValue)
        : Number.NaN;
    if (timestamp === null || !Number.isFinite(price) || price <= 0) {
      issues.push('Historical row ' + (index + 1) + ' has an invalid timestamp or close price.');
      continue;
    }
    const readOptionalPrice = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const parsed = typeof value === 'number' ? value
        : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
    };
    const open = readOptionalPrice(row.open ?? row.o);
    const high = readOptionalPrice(row.high ?? row.h);
    const low = readOptionalPrice(row.low ?? row.l);
    if ((row.open ?? row.o) != null && open === undefined) issues.push('Historical row ' + (index + 1) + ' has invalid open; open was omitted.');
    if ((row.high ?? row.h) != null && high === undefined) issues.push('Historical row ' + (index + 1) + ' has invalid high; high was omitted.');
    if ((row.low ?? row.l) != null && low === undefined) issues.push('Historical row ' + (index + 1) + ' has invalid low; low was omitted.');
    if (high !== undefined && low !== undefined && high < low) {
      issues.push('Historical row ' + (index + 1) + ' has high below low; high and low were omitted.');
    }
    const validHighLow = high !== undefined && low !== undefined && high >= low;
    const volumeValue = row.volume ?? row.v;
    const volume = volumeValue === undefined || volumeValue === null
      ? undefined
      : typeof volumeValue === 'number' ? volumeValue
        : typeof volumeValue === 'string' && volumeValue.trim() ? Number(volumeValue) : Number.NaN;
    if (volume !== undefined && (!Number.isFinite(volume) || volume < 0)) {
      issues.push('Historical row ' + (index + 1) + ' has invalid volume; volume was omitted.');
    }
    byTimestamp.set(timestamp, {
      timestamp,
      price,
      ...(open !== undefined ? { open } : {}),
      ...(validHighLow ? { high, low } : {}),
      ...(volume !== undefined && Number.isFinite(volume) && volume >= 0 ? { volume } : {})
    });
  }
  const points = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (points.length > maxPoints) {
    points.splice(0, points.length - maxPoints);
    issues.push('Historical points were bounded to the most recent ' + maxPoints + ' observations.');
  }
  const quality = points.length === 0 ? 'unavailable' : issues.length > 0 ? 'partial' : 'complete';
  return { points, quality, issues };
}

export interface FxRateInput {
  baseCurrency: unknown;
  quoteCurrency: unknown;
  rate: unknown;
  provider: unknown;
  observedAt?: unknown;
  receivedAt: unknown;
  /** Optional provider-specific FX trading session; never inferred. */
  session?: unknown;
}

export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  /** Quote-currency units for one unit of base currency. Never reverse implicitly. */
  direction: 'BASE_TO_QUOTE';
  rate: number;
  provider: string;
  observedAt: number | null;
  receivedAt: number;
  session: string | null;
  quality: MarketDataQuality;
}

export interface FxRateProviderAdapter {
  readonly providerId: string;
  fetchRate(
    baseCurrency: string,
    quoteCurrency: string,
    signal?: AbortSignal
  ): Promise<{ rate: FxRate | null; issues: string[] }>;
}

export interface MarketHistoryResponseInput {
  symbol: unknown;
  provider: unknown;
  receivedAt: unknown;
  interval: unknown;
  points: unknown;
  exchange?: unknown;
  assetType?: unknown;
  currency?: unknown;
}

/**
 * Normalizes a historical-price response and attaches source/instrument
 * provenance. Invalid provenance downgrades the result rather than fabricating
 * an exchange, currency, provider, or observation timestamp.
 */
export function normalizeMarketHistoryResponse(
  input: MarketHistoryResponseInput,
  options: { maxPoints?: number } = {}
): MarketHistoryResult {
  const history = normalizeMarketHistoryPoints(input.points, options);
  const identity = normalizeInstrumentIdentity({
    symbol: input.symbol,
    exchange: input.exchange,
    assetType: input.assetType,
    quoteCurrency: input.currency
  });
  const provider = normalizeToken(input.provider);
  const receivedAt = normalizeTimestamp(input.receivedAt);
  const interval = normalizeToken(input.interval);
  const issues = [...history.issues, ...identity.issues];

  if (!provider) issues.push('Historical data provider is missing.');
  if (receivedAt === null) issues.push('Historical data receipt timestamp is missing or invalid.');
  if (!interval) issues.push('Historical data interval is missing.');
  if (identity.instrument && !identity.instrument.quoteCurrency) {
    issues.push('Historical quote currency is unknown; currency conversion is unavailable.');
  }

  const quality = history.quality === 'unavailable' || history.points.length === 0
    ? 'unavailable'
    : history.quality === 'partial' || !identity.instrument || !identity.instrument.quoteCurrency ||
        !provider || receivedAt === null || !interval
      ? 'partial'
      : 'complete';

  return {
    points: history.points,
    quality,
    issues,
    ...(identity.instrument ? { instrument: identity.instrument } : {}),
    ...(provider ? { provider } : {}),
    ...(receivedAt !== null ? { receivedAt } : {}),
    ...(interval ? { interval } : {})
  };
}

/** Normalizes an explicit BASE_TO_QUOTE FX observation; no pair inversion is attempted. */
export function normalizeFxRate(
  input: FxRateInput,
  options: { maxFutureSkewMs?: number } = {}
): { rate: FxRate | null; issues: string[] } {
  const issues: string[] = [];
  const baseCurrency = normalizeCurrencyCode(input.baseCurrency);
  const quoteCurrency = normalizeCurrencyCode(input.quoteCurrency);
  const provider = normalizeToken(input.provider);
  const rawRate = typeof input.rate === 'number'
    ? input.rate
    : typeof input.rate === 'string' && input.rate.trim() ? Number(input.rate) : Number.NaN;
  const receivedAt = normalizeTimestamp(input.receivedAt);
  let observedAt = normalizeTimestamp(input.observedAt);

  if (!baseCurrency || !quoteCurrency) issues.push('FX currency pair must contain two ISO-style three-letter codes.');
  if (baseCurrency && quoteCurrency && baseCurrency === quoteCurrency) issues.push('FX base and quote currencies must differ.');
  if (!Number.isFinite(rawRate) || rawRate <= 0) issues.push('FX rate must be a finite positive number.');
  if (!provider) issues.push('FX provider is missing.');
  if (receivedAt === null) issues.push('FX receipt timestamp is missing or invalid.');
  if (input.observedAt !== undefined && input.observedAt !== null && observedAt === null) {
    issues.push('FX observation timestamp is invalid.');
  }
  if (observedAt !== null && receivedAt !== null && observedAt > receivedAt + (options.maxFutureSkewMs ?? 60 * 1000)) {
    observedAt = null;
    issues.push('FX observation timestamp is later than receipt time.');
  }
  if (!baseCurrency || !quoteCurrency || baseCurrency === quoteCurrency ||
      !Number.isFinite(rawRate) || rawRate <= 0 || !provider || receivedAt === null) {
    return { rate: null, issues };
  }
  const quality: MarketDataQuality = observedAt === null ? 'partial' : 'complete';
  if (quality === 'partial') issues.push('FX rate has no verifiable observation timestamp and must not be applied.');
  return {
    rate: {
      baseCurrency,
      quoteCurrency,
      direction: 'BASE_TO_QUOTE',
      rate: rawRate,
      provider,
      observedAt,
      receivedAt,
      session: normalizeToken(input.session),
      quality
    },
    issues
  };
}

export function isFxRateUsableForConversion(
  rate: FxRate,
  now = Date.now(),
  maxAgeMs = 24 * 60 * 60 * 1000
): boolean {
  if (
    !rate ||
    rate.quality !== 'complete' ||
    rate.direction !== 'BASE_TO_QUOTE' ||
    !normalizeCurrencyCode(rate.baseCurrency) ||
    !normalizeCurrencyCode(rate.quoteCurrency) ||
    rate.baseCurrency === rate.quoteCurrency ||
    !Number.isFinite(rate.rate) || rate.rate <= 0 ||
    !Number.isFinite(rate.receivedAt) ||
    rate.observedAt === null || !Number.isFinite(rate.observedAt) ||
    rate.receivedAt < rate.observedAt ||
    !Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
  ) return false;
  const ageMs = now - rate.observedAt;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

/**
 * Prevents an older provider response from replacing a newer observation.
 * If timestamps are unavailable, a lower request sequence (or older receipt)
 * cannot replace the current accepted observation.
 */
export function shouldAcceptMarketObservation(
  current: MarketQuoteObservation | null | undefined,
  candidate: MarketQuoteObservation
): boolean {
  if (!current) return true;
  if (candidate.instrument.id !== current.instrument.id) return false;
  if (current.observedAt !== null && candidate.observedAt === null) return false;
  if (current.observedAt !== null && candidate.observedAt !== null) {
    if (candidate.observedAt < current.observedAt) return false;
    if (candidate.observedAt > current.observedAt) return true;
  } else if (current.observedAt === null && candidate.observedAt !== null) {
    return true;
  }

  if (current.requestSequence !== null && candidate.requestSequence !== null &&
      candidate.requestSequence !== current.requestSequence) {
    return candidate.requestSequence > current.requestSequence;
  }
  return candidate.receivedAt >= current.receivedAt;
}
