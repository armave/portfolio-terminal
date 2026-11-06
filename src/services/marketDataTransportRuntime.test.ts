import { describe, expect, it, vi } from 'vitest';
import { createMarketDataTransportRuntime } from './marketDataTransportRuntime';

function createRuntime(
  proxyFetch: (...args: any[]) => Promise<any>,
  now: () => number = Date.now,
  sleep?: (delayMs: number) => Promise<void>,
  requestTimeoutMs?: number
) {
  const recordMetric = vi.fn();
  const runtime = createMarketDataTransportRuntime({
    proxyFetch, recordMetric, now,
    ...(sleep ? { sleep } : {}),
    ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {})
  });
  return { runtime, recordMetric };
}

describe('market data transport runtime', () => {
  it('batches quote requests queued in the same turn and resolves each requested symbol', async () => {
    const proxyFetch = vi.fn(async (_action: string, params: { symbol: string }) =>
      params.symbol.split(',').map((symbol) => ({ symbol, price: { current: 100 } }))
    );
    const { runtime } = createRuntime(proxyFetch);
    const first = runtime.fetchYahooQuoteData('aapl');
    const second = runtime.fetchYahooQuoteData('msft');
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { symbol: 'AAPL', price: { current: 100 } },
      { symbol: 'MSFT', price: { current: 100 } }
    ]);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith('quote', { symbol: 'AAPL,MSFT' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('retries a transient Yahoo batch transport failure before returning normalized data', async () => {
    const proxyFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce([{ symbol: 'AAPL', price: { current: 100 } }]);
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const { runtime } = createRuntime(proxyFetch, Date.now, sleep);

    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({
      symbol: 'AAPL', price: { current: 100 }, cacheStatus: 'network'
    });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('serves a bounded last-known-good quote when a refresh fails', async () => {
    let now = 100;
    const proxyFetch = vi.fn()
      .mockResolvedValueOnce([{ symbol: 'AAPL', price: { current: 100 } }])
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const { runtime, recordMetric } = createRuntime(proxyFetch, () => now, sleep);

    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({
      price: { current: 100 }
    });
    now += 8_001;
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({
      symbol: 'AAPL', price: { current: 100 }
    });
    expect(proxyFetch).toHaveBeenCalledTimes(3);
    expect(recordMetric).toHaveBeenCalledWith('stale_fallback', {
      provider: 'yahoo', operation: 'quote_batch', symbol: 'AAPL'
    });
  });

  it('does not reuse a last-known-good quote beyond its stale retention window', async () => {
    let now = 100;
    const proxyFetch = vi.fn()
      .mockResolvedValueOnce([{ symbol: 'AAPL', price: { current: 100 } }])
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const { runtime } = createRuntime(proxyFetch, () => now, sleep);

    await runtime.fetchYahooQuoteData('AAPL');
    now += 15 * 60 * 1000 + 1;
    await expect(runtime.fetchYahooQuoteData('AAPL')).rejects.toThrow('Failed to fetch');
    expect(proxyFetch).toHaveBeenCalledTimes(3);
  });

  it('aborts a provider request after the configured timeout and reports a retryable timeout', async () => {
    const proxyFetch = vi.fn((_action: string, _params: unknown, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          reject(new DOMException('The request was aborted.', 'AbortError'));
        }, { once: true });
      })
    );
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const { runtime } = createRuntime(proxyFetch, Date.now, sleep, 5);

    await expect(runtime.fetchYahooQuoteData('AAPL')).rejects.toThrow('Market data provider request timed out.');
    expect(proxyFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
    expect((proxyFetch.mock.calls[0][2] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it('caches successful quotes for eight seconds and refreshes after expiry', async () => {
    let now = 100;
    let version = 0;
    const proxyFetch = vi.fn(async () => [{ symbol: 'AAPL', price: { current: ++version } }]);
    const { runtime } = createRuntime(proxyFetch, () => now);
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({
      price: { current: 1 }, cacheStatus: 'network'
    });
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({
      price: { current: 1 }, cacheStatus: 'fresh-cache'
    });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    now += 8_001;
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({ price: { current: 2 } });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

  it('lets an explicit quote refresh bypass cached values', async () => {
    let version = 0;
    const proxyFetch = vi.fn(async () => [{ symbol: 'AAPL', price: { current: ++version } }]);
    const { runtime } = createRuntime(proxyFetch);
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({ price: { current: 1 } });
    await expect(runtime.fetchYahooQuoteData('AAPL', true)).resolves.toMatchObject({ price: { current: 2 } });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
    expect(proxyFetch).toHaveBeenNthCalledWith(2, 'quote', { symbol: 'AAPL' }, expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  });

  it('returns an explicit symbol error for partial batch responses', async () => {
    const proxyFetch = vi.fn(async () => [{ symbol: 'AAPL', price: { current: 100 } }]);
    const { runtime } = createRuntime(proxyFetch);
    const [aapl, msft] = await Promise.all([
      runtime.fetchYahooQuoteData('AAPL'),
      runtime.fetchYahooQuoteData('MSFT')
    ]);
    expect(aapl).toMatchObject({ symbol: 'AAPL', price: { current: 100 } });
    expect(msft).toEqual({ symbol: 'MSFT', error: 'Yahoo batch response omitted this symbol.' });
  });

  it('normalizes Finnhub fallback quote values and derives missing change fields', async () => {
    const proxyFetch = vi.fn().mockResolvedValue({ c: '101.5', pc: '100', d: null, dp: null });
    const { runtime } = createRuntime(proxyFetch);
    await expect(runtime.fetchFallbackQuote(' aapl ', 'finnhub')).resolves.toEqual({
      symbol: 'AAPL', price: 101.5, previousClose: 100,
      change: 1.5, changePercent: 1.5, sourceName: 'Finnhub'
    });
    expect(proxyFetch).toHaveBeenCalledWith('provider-quote', { symbol: 'AAPL', provider: 'finnhub' }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('retries transient fallback-provider transport errors but not invalid quote data', async () => {
    const proxyFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ c: '101.5', pc: '100' });
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const { runtime } = createRuntime(proxyFetch, Date.now, sleep);

    await expect(runtime.fetchFallbackQuote('AAPL', 'finnhub')).resolves.toMatchObject({
      price: 101.5, previousClose: 100
    });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('rejects invalid fallback quote prices and empty symbols', async () => {
    const proxyFetch = vi.fn().mockResolvedValue({ c: 'not-a-price' });
    const { runtime } = createRuntime(proxyFetch);
    await expect(runtime.fetchFallbackQuote('AAPL', 'finnhub')).rejects.toThrow('no valid quote');
    await expect(runtime.fetchFallbackQuote('', 'finnhub')).rejects.toThrow('ticker symbol is required');
  });

  it('clears provider caches so a subsequent quote is fetched again', async () => {
    const proxyFetch = vi.fn(async () => [{ symbol: 'AAPL', price: { current: 100 } }]);
    const { runtime } = createRuntime(proxyFetch);
    await runtime.fetchYahooQuoteData('AAPL');
    runtime.clearYahooDeepStockDataCache();
    await runtime.fetchYahooQuoteData('AAPL');
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });
});
