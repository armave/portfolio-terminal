/**
 * Shared cache and in-flight request coordination for Yahoo's full stock payload.
 *
 * Kept separate from API transport so cache lifetime, de-duplication, and
 * forced-refresh ordering can be verified without browser networking.
 */
export interface YahooDeepDataCacheOptions {
  fetchData: (symbol: string, force: boolean) => Promise<unknown>;
  recordMetric: (metric: string, details: Record<string, unknown>) => void;
  now?: () => number;
  cacheTtlMs?: number;
  maxEntries?: number;
}

export interface YahooDeepDataCacheClient {
  remember(value: unknown): void;
  fetch(ticker: string, force?: boolean): Promise<unknown | null>;
  clear(): void;
}

interface CachedYahooDeepData {
  expiresAt: number;
  data: Record<string, unknown>;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

function normalizeSymbol(symbol: unknown): string {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  cache.set(key, value);
  if (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

export function createYahooDeepDataCache(options: YahooDeepDataCacheOptions): YahooDeepDataCacheClient {
  const cache = new Map<string, CachedYahooDeepData>();
  const requests = new Map<string, Promise<unknown>>();
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  function remember(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(remember);
      return;
    }

    if (!isRecord(value)) return;
    const symbol = normalizeSymbol(value.symbol);
    if (!symbol || value.error) return;

    setBoundedCache(cache, symbol, {
      expiresAt: now() + cacheTtlMs,
      data: value
    }, maxEntries);
  }

  async function fetch(ticker: string, force = false): Promise<unknown | null> {
    const symbol = normalizeSymbol(ticker);
    if (!symbol) return null;

    if (!force) {
      const cached = cache.get(symbol);
      if (cached && cached.expiresAt > now()) return cached.data;
      if (cached) cache.delete(symbol);
    }

    const existing = requests.get(symbol);
    if (!force && existing) return existing;

    const startedAt = now();
    const request = options.fetchData(symbol, force)
      .then((data) => {
        const durationMs = now() - startedAt;
        const providerError = isRecord(data) && Boolean(data.error);
        if (providerError) {
          options.recordMetric('provider_failure', {
            provider: 'yahoo',
            operation: 'deep_data',
            durationMs
          });
        } else {
          options.recordMetric('provider_request', {
            provider: 'yahoo',
            operation: 'deep_data',
            durationMs,
            success: true
          });
        }

        if (
          requests.get(symbol) === request
          && data !== null
          && typeof data === 'object'
          && !providerError
        ) {
          // A superseded request must not overwrite a newer forced refresh in cache.
          remember(data);
        }
        return data;
      }, (error: unknown) => {
        options.recordMetric('provider_failure', {
          provider: 'yahoo',
          operation: 'deep_data',
          durationMs: now() - startedAt
        });
        throw error;
      })
      .finally(() => {
        if (requests.get(symbol) === request) requests.delete(symbol);
      });

    requests.set(symbol, request);
    return request;
  }

  function clear(): void {
    cache.clear();
    requests.clear();
  }

  return { remember, fetch, clear };
}
