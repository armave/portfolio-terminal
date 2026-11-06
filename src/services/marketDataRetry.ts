export interface MarketDataRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (delayMs: number) => Promise<void>;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  const value = record.status ?? record.statusCode ?? record.code;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/** Retry network/transient HTTP failures only; never retry validation or auth errors. */
export function isRetryableMarketDataError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  if (record.name === 'AbortError' || record.name === 'ValidationError') return false;

  const status = errorStatus(error);
  if (status !== null) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  if (error instanceof TypeError) return true;
  const message = typeof record.message === 'string' ? record.message : '';
  return /failed to fetch|network error|network request failed|econnreset|socket hang up|timed out|timeout/i.test(message);
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

/**
 * Executes a bounded retry policy with exponential backoff. The request is
 * retried only for transient network/HTTP failures; callers can inject a
 * stricter provider-specific classifier and deterministic sleep in tests.
 */
export async function retryMarketDataRequest<T>(
  request: () => Promise<T>,
  options: MarketDataRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, Math.min(4, Math.floor(options.attempts ?? 2)));
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 2_000);
  const shouldRetry = options.shouldRetry ?? isRetryableMarketDataError;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await sleep(delayMs);
    }
  }
  throw new Error('Market data retry exhausted without a result.');
}
