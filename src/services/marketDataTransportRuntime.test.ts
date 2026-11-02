import { describe, expect, it, vi } from 'vitest';
import { createMarketDataTransportRuntime } from './marketDataTransportRuntime';

function createRuntime(proxyFetch: (...args: any[]) => Promise<any>, now: () => number = Date.now) {
  const recordMetric = vi.fn();
  const runtime = createMarketDataTransportRuntime({ proxyFetch, recordMetric, now });
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
    expect(proxyFetch).toHaveBeenCalledWith('quote', { symbol: 'AAPL,MSFT' });
  });

  it('caches successful quotes for eight seconds and refreshes after expiry', async () => {
    let now = 100;
    let version = 0;
    const proxyFetch = vi.fn(async () => [{ symbol: 'AAPL', price: { current: ++version } }]);
    const { runtime } = createRuntime(proxyFetch, () => now);
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({ price: { current: 1 } });
    await expect(runtime.fetchYahooQuoteData('AAPL')).resolves.toMatchObject({ price: { current: 1 } });
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
    expect(proxyFetch).toHaveBeenNthCalledWith(2, 'quote', { symbol: 'AAPL' }, { cache: 'no-store' });
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
    expect(proxyFetch).toHaveBeenCalledWith('provider-quote', { symbol: 'AAPL', provider: 'finnhub' });
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
