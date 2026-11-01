/**
 * Shared cache and in-flight request coordination for Yahoo's full stock payload.
 *
 * Cache policy and transport cancellation are kept separate from browser
 * networking so deduplication, TTL, and subscriber races can be tested alone.
 */
export interface YahooDeepDataCacheOptions {
  fetchData: (symbol: string, force: boolean, signal: AbortSignal) => Promise<unknown>;
  recordMetric: (metric: string, details: Record<string, unknown>) => void;
  now?: () => number;
  cacheTtlMs?: number;
  maxEntries?: number;
}

export interface YahooDeepDataCacheClient {
  remember(value: unknown): void;
  fetch(ticker: string, force?: boolean, signal?: AbortSignal): Promise<unknown | null>;
  clear(): void;
}

interface CachedYahooDeepData {
  expiresAt: number;
  data: Record<string, unknown>;
}

interface InFlightYahooDeepData {
  controller: AbortController;
  promise: Promise<unknown>;
  subscribers: number;
  settled: boolean;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

function normalizeSymbol(symbol: unknown): string {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function createAbortError(): Error {
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T, maxEntries: number): void {
  cache.set(key, value);
  if (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

function subscribeToRequest(
  entry: InFlightYahooDeepData,
  signal: AbortSignal | undefined,
  onLastSubscriberAbort: () => void
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(createAbortError());

  entry.subscribers += 1;
  return new Promise<unknown>((resolve, reject) => {
    let active = true;

    const release = (): boolean => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener('abort', onAbort);
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      return true;
    };

    const onAbort = (): void => {
      if (!release()) return;
      if (!entry.settled && entry.subscribers === 0) {
        onLastSubscriberAbort();
        entry.controller.abort();
      }
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    entry.promise.then(
      value => {
        if (release()) resolve(value);
      },
      error => {
        if (release()) reject(error);
      }
    );
  });
}

export function createYahooDeepDataCache(options: YahooDeepDataCacheOptions): YahooDeepDataCacheClient {
  const cache = new Map<string, CachedYahooDeepData>();
  const requests = new Map<string, InFlightYahooDeepData>();
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

  function startRequest(symbol: string, force: boolean): InFlightYahooDeepData {
    const controller = new AbortController();
    let entry!: InFlightYahooDeepData;
    const startedAt = now();

    const promise = Promise.resolve()
      .then(() => options.fetchData(symbol, force, controller.signal))
      .then((data) => {
        if (!controller.signal.aborted) {
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
            requests.get(symbol) === entry
            && data !== null
            && typeof data === 'object'
            && !providerError
          ) {
            // A superseded request must not overwrite a newer forced refresh.
            remember(data);
          }
        }
        return data;
      }, (error: unknown) => {
        if (!isAbortError(error)) {
          options.recordMetric('provider_failure', {
            provider: 'yahoo',
            operation: 'deep_data',
            durationMs: now() - startedAt
          });
        }
        throw error;
      })
      .finally(() => {
        entry.settled = true;
        if (requests.get(symbol) === entry) requests.delete(symbol);
      });

    entry = { controller, promise, subscribers: 0, settled: false };
    requests.set(symbol, entry);
    return entry;
  }

  function fetch(ticker: string, force = false, signal?: AbortSignal): Promise<unknown | null> {
    const symbol = normalizeSymbol(ticker);
    if (!symbol) return Promise.resolve(null);
    if (signal?.aborted) return Promise.reject(createAbortError());

    if (!force) {
      const cached = cache.get(symbol);
      if (cached && cached.expiresAt > now()) return Promise.resolve(cached.data);
      if (cached) cache.delete(symbol);
    }

    const existing = force ? undefined : requests.get(symbol);
    const entry = existing ?? startRequest(symbol, force);
    return subscribeToRequest(entry, signal, () => {
      // Remove the completed/cancelled generation immediately so a fresh
      // consumer can retry even if the underlying transport takes time to stop.
      if (requests.get(symbol) === entry) requests.delete(symbol);
    });
  }

  function clear(): void {
    cache.clear();
    requests.clear();
  }

  return { remember, fetch, clear };
}
