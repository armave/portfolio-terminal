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
  const parsed = explicitExchange
    ? {
        symbol: rawSymbol.endsWith('.' + explicitExchange)
          ? rawSymbol.slice(0, -(explicitExchange.length + 1))
          : rawSymbol,
        exchange: explicitExchange
      }
    : splitKnownExchangeSuffix(rawSymbol);
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
  else if (delayClass === 'live' && observedAt !== null) {
    const ageMs = now - observedAt;
    freshness = ageMs < 0 || ageMs > maxAgeMs ? 'stale' : 'fresh';
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
  price: number;
  volume?: number;
}

export interface MarketHistoryResult {
  points: MarketPricePoint[];
  quality: 'complete' | 'partial' | 'unavailable';
  issues: string[];
}

/** Normalizes, validates, sorts, and de-duplicates untrusted historical prices. */
export function normalizeMarketHistoryPoints(
  input: unknown,
  options: { maxPoints?: number } = {}
): MarketHistoryResult {
  if (!Array.isArray(input)) {
    return { points: [], quality: 'unavailable', issues: ['Historical price response is not an array.'] };
  }
  const maxPoints = Math.max(1, Math.min(20_000, Math.floor(options.maxPoints ?? 20_000)));
  const issues: string[] = [];
  const byTimestamp = new Map<number, MarketPricePoint>();
  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      issues.push('Historical row ' + (index + 1) + ' is malformed.');
      continue;
    }
    const row = item as Record<string, unknown>;
    const timestamp = normalizeTimestamp(row.timestamp ?? row.time ?? row.date);
    const priceValue = row.price ?? row.close ?? row.value;
    const price = typeof priceValue === 'number'
      ? priceValue
      : typeof priceValue === 'string' && priceValue.trim()
        ? Number(priceValue)
        : Number.NaN;
    if (timestamp === null || !Number.isFinite(price) || price <= 0) {
      issues.push('Historical row ' + (index + 1) + ' has an invalid timestamp or price.');
      continue;
    }
    const volumeValue = row.volume;
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
  quality: MarketDataQuality;
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
  if (rate.quality !== 'complete' || rate.observedAt === null || rate.receivedAt < rate.observedAt) return false;
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
