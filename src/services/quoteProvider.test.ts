import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFallbackQuote, fetchYahooQuoteData } from './api';
import { fetchLivePriceFromProviders } from './quoteProvider';
import { fetchFreedomQuote } from './freedomMarketData';

vi.mock('./api', () => ({
  fetchYahooQuoteData: vi.fn(),
  fetchFallbackQuote: vi.fn()
}));

vi.mock('./freedomMarketData', () => ({ fetchFreedomQuote: vi.fn() }));

describe('fetchLivePriceFromProviders', () => {
  beforeEach(() => {
    vi.mocked(fetchFreedomQuote).mockRejectedValue(new Error('Freedom unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('starts Freedom and Yahoo requests concurrently', async () => {
    let resolveFreedom!: (value: any) => void;
    let resolveYahoo!: (value: any) => void;
    vi.mocked(fetchFreedomQuote).mockImplementation(() => new Promise<any>(resolve => { resolveFreedom = resolve; }));
    vi.mocked(fetchYahooQuoteData).mockImplementation(() => new Promise<any>(resolve => { resolveYahoo = resolve; }));

    const pending = fetchLivePriceFromProviders('AAPL');
    await Promise.resolve();
    expect(fetchFreedomQuote).toHaveBeenCalledWith('AAPL');
    expect(fetchYahooQuoteData).toHaveBeenCalledWith('AAPL');
    resolveFreedom({
      symbol: 'AAPL', price: 210, previousClose: 200, change: 10,
      changePercent: 5, sourceTimestamp: (Math.floor(Date.now() / 1000) - 60) * 1000, raw: {}
    });
    resolveYahoo({ symbol: 'AAPL', price: { current: 211, previousClose: 200, regularMarketTime: Math.floor(Date.now() / 1000), marketState: 'REGULAR', change: 11 } });
    const result = await pending;
    expect(result.price).toBe(211);
    expect(result.sourceName).toBe('Yahoo');
  });

  it('uses a valid fresh Freedom quote when Yahoo has no source timestamp', async () => {
    vi.mocked(fetchFreedomQuote).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: Date.now(),
      raw: {}
    });

    const result = await fetchLivePriceFromProviders('aapl');

    expect(fetchFreedomQuote).toHaveBeenCalledWith('AAPL');
    expect(result.price).toBe(210);
    expect(result.sourceName).toBe('Freedom TradeNet');
    expect(result.quoteDetails).toMatchObject({ freshness: 'fresh', price: 210, change: 10, changePercent: 5 });
    expect(fetchYahooQuoteData).toHaveBeenCalledWith('AAPL');
  });

  it('prefers Yahoo when its source timestamp is newer than Freedom', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    vi.mocked(fetchFreedomQuote).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: (nowSeconds - 60) * 1000,
      raw: {}
    });
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 211,
        previousClose: 200,
        regularMarketTime: nowSeconds,
        marketState: 'REGULAR',
        change: 11
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.price).toBe(211);
    expect(result.sourceName).toBe('Yahoo');
    expect(result.quoteDetails).toMatchObject({ freshness: 'fresh', sourceTimestamp: nowSeconds * 1000 });
  });


  it('always chooses Yahoo when its observation timestamp is newer than Freedom', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const freedomTimestamp = (nowSeconds - 120) * 1000;
    const yahooTimestamp = (nowSeconds - 60) * 1000;
    vi.mocked(fetchFreedomQuote).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: freedomTimestamp,
      raw: {}
    });
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 211,
        previousClose: 200,
        regularMarketTime: yahooTimestamp / 1000,
        marketState: 'REGULAR',
        change: 11
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.price).toBe(211);
    expect(result.sourceName).toBe('Yahoo');
    expect(result.quoteDetails).toMatchObject({
      sourceTimestamp: yahooTimestamp,
      price: 211
    });
  });

  it('keeps Freedom when its observation timestamp is newer than Yahoo', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const freedomTimestamp = (nowSeconds - 30) * 1000;
    const yahooTimestamp = (nowSeconds - 60) * 1000;
    vi.mocked(fetchFreedomQuote).mockResolvedValue({
      symbol: 'AAPL',
      price: 212,
      previousClose: 200,
      change: 12,
      changePercent: 6,
      sourceTimestamp: freedomTimestamp,
      raw: {}
    });
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 211,
        previousClose: 200,
        regularMarketTime: yahooTimestamp / 1000,
        marketState: 'REGULAR',
        change: 11
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.price).toBe(212);
    expect(result.sourceName).toBe('Freedom TradeNet');
    expect(result.quoteDetails).toMatchObject({
      sourceTimestamp: freedomTimestamp,
      price: 212
    });
  });

  it('uses Yahoo market-session price data when available', async () => {
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        marketState: 'REGULAR',
        change: 5
      }
    } as never);

    const result = await fetchLivePriceFromProviders('aapl');

    expect(fetchYahooQuoteData).toHaveBeenCalledWith('AAPL');
    expect(result.price).toBe(100);
    expect(result.sourceName).toBe('Yahoo');
    expect(result.quoteDetails).toMatchObject({
      marketState: 'REGULAR',
      freshness: 'unknown',
      receivedAt: expect.any(Number),
      price: 100,
      change: 5,
      changePercent: expect.any(Number)
    });
    expect(fetchFallbackQuote).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
  });

  it('falls back through supported providers when Yahoo has no usable quote', async () => {
    vi.mocked(fetchYahooQuoteData).mockResolvedValue(null as never);
    vi.mocked(fetchFallbackQuote)
      .mockRejectedValueOnce(new Error('Finnhub unavailable'))
      .mockResolvedValueOnce({
        price: 42,
        sourceName: 'Twelve Data',
        change: 2,
        changePercent: 5
      } as never);

    const result = await fetchLivePriceFromProviders('msft');

    expect(fetchFallbackQuote).toHaveBeenNthCalledWith(1, 'MSFT', 'finnhub');
    expect(fetchFallbackQuote).toHaveBeenNthCalledWith(2, 'MSFT', 'twelvedata');
    expect(result).toMatchObject({
      price: 42,
      sourceName: 'Twelve Data',
      quoteDetails: {
        marketState: 'UNKNOWN',
        freshness: 'unknown',
        receivedAt: expect.any(Number),
        price: 42,
        change: 2,
        changePercent: 5
      },
      error: null
    });
  });

  it('marks old provider observations stale even when the response was just received', async () => {
    const sourceTime = Math.floor(Date.now() / 1000) - 60 * 60;
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        regularMarketTime: sourceTime,
        marketState: 'REGULAR',
        change: 5
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.price).toBe(100);
    expect(result.quoteDetails).toMatchObject({
      sourceTimestamp: sourceTime * 1000,
      freshness: 'stale',
      receivedAt: expect.any(Number)
    });
  });

  it('labels an old closed-market observation delayed rather than live', async () => {
    const sourceTime = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        regularMarketTime: sourceTime,
        marketState: 'CLOSED',
        change: 5
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.quoteDetails).toMatchObject({
      sourceTimestamp: sourceTime * 1000,
      freshness: 'delayed'
    });
  });

  it('returns a clear error when every quote provider fails', async () => {
    vi.mocked(fetchYahooQuoteData).mockRejectedValue(new Error('Yahoo unavailable'));
    vi.mocked(fetchFallbackQuote).mockRejectedValue(new Error('Fallback unavailable'));

    const result = await fetchLivePriceFromProviders('TSLA');

    expect(result.price).toBeNull();
    expect(result.updatedAt).toBeNull();
    expect(result.error).toContain('Quote unavailable');
  });
});
