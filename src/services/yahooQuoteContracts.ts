/**
 * Typed boundary for untrusted Yahoo quote-provider payloads.
 *
 * Provider values intentionally remain unknown until the market-domain
 * normalizers validate numbers and timestamps. This keeps network JSON from
 * leaking an `any` type into portfolio calculations.
 */
export interface YahooQuotePricePayload {
  current?: unknown;
  regularMarketPrice?: unknown;
  previousClose?: unknown;
  regularMarketPreviousClose?: unknown;
  preMarketPrice?: unknown;
  postMarketPrice?: unknown;
  marketState?: string;
  regularMarketTime?: unknown;
  preMarketTime?: unknown;
  postMarketTime?: unknown;
  change?: unknown;
  regularMarketChange?: unknown;
}

export interface YahooBatchQuoteResult {
  symbol: string;
  price?: YahooQuotePricePayload | null;
  regularMarketPrice?: unknown;
  regularMarketPreviousClose?: unknown;
  regularMarketChange?: unknown;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeYahooBatchItem(value: unknown): YahooBatchQuoteResult | null {
  if (!isRecord(value) || typeof value.symbol !== 'string') return null;
  const symbol = value.symbol.trim().toUpperCase();
  if (!symbol) return null;

  const result: YahooBatchQuoteResult = { symbol };
  if (isRecord(value.price)) {
    // Copy only fields consumed by the market-domain layer. Numeric and time
    // values stay unknown until their domain-specific validation boundary.
    const price: YahooQuotePricePayload = {};
    for (const key of [
      'current',
      'regularMarketPrice',
      'previousClose',
      'regularMarketPreviousClose',
      'preMarketPrice',
      'postMarketPrice',
      'regularMarketTime',
      'preMarketTime',
      'postMarketTime',
      'change',
      'regularMarketChange'
    ] as const) {
      if (key in value.price) price[key] = value.price[key];
    }
    if (typeof value.price.marketState === 'string') {
      price.marketState = value.price.marketState;
    }
    result.price = price;
  } else if (value.price === null) {
    result.price = null;
  } else if (value.price !== undefined) {
    result.error = 'Yahoo returned a malformed quote payload.';
  }

  for (const key of ['regularMarketPrice', 'regularMarketPreviousClose', 'regularMarketChange'] as const) {
    if (key in value) result[key] = value[key];
  }

  const providerError = typeof value.error === 'string' && value.error.trim()
    ? value.error.trim()
    : typeof value.errMsg === 'string' && value.errMsg.trim()
      ? value.errMsg.trim()
      : null;
  if (providerError) result.error = providerError;
  if (!result.price && !result.error) result.error = 'Yahoo returned no usable quote payload.';
  return result;
}

/**
 * Normalizes an unknown Yahoo batch response into safe, symbol-addressable
 * records. Missing requested symbols receive explicit errors so callers can
 * attempt their normal per-symbol fallback instead of silently skipping them.
 *
 * Unexpected provider symbols are retained for diagnostics; callers must still
 * verify that a returned symbol was actually requested before applying it.
 */
export function normalizeYahooBatchResults(
  responseData: unknown,
  tickers: readonly string[]
): YahooBatchQuoteResult[] {
  const requested = [...new Set(tickers
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean))];
  const candidates = Array.isArray(responseData)
    ? responseData
    : isRecord(responseData)
      ? [responseData]
      : [];

  if (candidates.length === 0) {
    return requested.map(symbol => ({ symbol, error: 'Yahoo batch request failed' }));
  }

  const results: YahooBatchQuoteResult[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeYahooBatchItem(candidate);
    if (!normalized || seen.has(normalized.symbol)) continue;
    seen.add(normalized.symbol);
    results.push(normalized);
  }

  for (const symbol of requested) {
    if (!seen.has(symbol)) {
      results.push({ symbol, error: 'Yahoo batch response omitted this symbol.' });
    }
  }
  return results;
}
