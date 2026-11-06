import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFallbackQuote, fetchYahooQuoteData } from './api';
import { fetchLivePriceFromProviders } from './quoteProvider';
import { fetchFreedomQuote, fetchFreedomQuoteWebSocket } from './freedomMarketData';

vi.mock('./api', () => ({
  fetchYahooQuoteData: vi.fn(),
  fetchFallbackQuote: vi.fn()
}));

vi.mock('./freedomMarketData', () => ({
  fetchFreedomQuote: vi.fn(),
  fetchFreedomQuoteWebSocket: vi.fn()
}));

describe('fetchLivePriceFromProviders', () => {
  beforeEach(() => {
    vi.mocked(fetchFreedomQuoteWebSocket).mockRejectedValue(new Error('Freedom WebSocket unavailable'));
    vi.mocked(fetchFreedomQuote).mockRejectedValue(new Error('Freedom REST unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('uses a valid authenticated q quote without launching Yahoo or Freedom REST quote requests', async () => {
    vi.mocked(fetchFreedomQuoteWebSocket).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: Date.now(),
      raw: {}
    });

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(fetchFreedomQuoteWebSocket).toHaveBeenCalledWith('AAPL');
    expect(fetchFreedomQuote).not.toHaveBeenCalled();
    expect(fetchYahooQuoteData).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      price: 210,
      sourceName: 'Freedom TradeNet',
      quoteDetails: {
        transport: 'websocket',
        provider: 'FREEDOM TRADENET',
        instrumentId: 'UNKNOWN:US:AAPL',
        exchange: 'US',
        assetType: 'UNKNOWN',
        delayClass: 'live',
        dataQuality: 'partial',
        freshness: 'fresh'
      }
    });
  });

  it('uses the valid q snapshot as the primary quote even when its source timestamp is older', async () => {
    const oldTimestamp = Date.now() - 60 * 60 * 1000;
    vi.mocked(fetchFreedomQuoteWebSocket).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: oldTimestamp,
      raw: {}
    });
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 211,
        previousClose: 200,
        regularMarketTime: Math.floor(Date.now() / 1000),
        marketState: 'REGULAR'
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.price).toBe(210);
    expect(result.sourceName).toBe('Freedom TradeNet');
    expect(result.quoteDetails).toMatchObject({
      transport: 'websocket',
      freshness: 'stale',
      sourceTimestamp: oldTimestamp
    });
    expect(fetchYahooQuoteData).not.toHaveBeenCalled();
  });

  it('uses Freedom REST only after q fails, and does not launch Yahoo when that fallback succeeds', async () => {
    vi.mocked(fetchFreedomQuote).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: null,
      marketState: 'CLOSED',
      raw: {}
    });

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(fetchFreedomQuoteWebSocket).toHaveBeenCalledWith('AAPL');
    expect(fetchFreedomQuote).toHaveBeenCalledWith('AAPL', true);
    expect(fetchYahooQuoteData).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      price: 210,
      sourceName: 'Freedom TradeNet',
      quoteDetails: {
        transport: 'rest',
        marketState: 'CLOSED',
        freshness: 'unknown'
      }
    });
  });

  it('uses Yahoo market-session quote data only after both Freedom quote paths fail', async () => {
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        marketState: 'REGULAR',
        change: 5,
        currency: 'USD',
        exchange: 'NMS',
        quoteType: 'EQUITY'
      }
    } as never);

    const result = await fetchLivePriceFromProviders('aapl');

    expect(fetchFreedomQuoteWebSocket).toHaveBeenCalledWith('AAPL');
    expect(fetchFreedomQuote).toHaveBeenCalledWith('AAPL', true);
    expect(fetchYahooQuoteData).toHaveBeenCalledWith('AAPL');
    expect(result.price).toBe(100);
    expect(result.sourceName).toBe('Yahoo');
    expect(result.quoteDetails).toMatchObject({
      marketState: 'REGULAR',
      freshness: 'unknown',
      receivedAt: expect.any(Number),
      provider: 'YAHOO',
      instrumentId: 'EQUITY:NMS:AAPL',
      currency: 'USD',
      exchange: 'NMS',
      assetType: 'EQUITY',
      dataQuality: 'partial',
      delayClass: 'unknown',
      price: 100,
      change: 5,
      changePercent: expect.any(Number)
    });
    expect(fetchFallbackQuote).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
  });

  it('retains normalized provider, instrument, exchange, currency, and freshness metadata on the quote', async () => {
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        regularMarketTime: Math.floor(Date.now() / 1000),
        marketState: 'REGULAR',
        currency: 'USD',
        exchange: 'NMS',
        quoteType: 'EQUITY'
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.quoteDetails).toMatchObject({
      provider: 'YAHOO',
      instrumentId: 'EQUITY:NMS:AAPL',
      currency: 'USD',
      exchange: 'NMS',
      assetType: 'EQUITY',
      marketSession: 'REGULAR',
      delayClass: 'live',
      dataQuality: 'complete',
      freshness: 'fresh'
    });
  });

  it('retains the provider cache status in portfolio quote provenance', async () => {
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      cacheStatus: 'stale-fallback',
      price: {
        current: 100,
        previousClose: 95,
        regularMarketTime: Math.floor(Date.now() / 1000),
        marketState: 'REGULAR',
        currency: 'USD',
        exchange: 'NMS',
        quoteType: 'EQUITY'
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.quoteDetails).toMatchObject({
      cacheStatus: 'stale-fallback',
      provider: 'YAHOO',
      currency: 'USD',
      exchange: 'NMS'
    });
  });

  it('keeps the daily move against previous close when the market is closed', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        change: 5,
        changePercent: 5.263157894736842,
        regularMarketTime: nowSeconds,
        marketState: 'CLOSED'
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.price).toBe(100);
    expect(result.quoteDetails).toMatchObject({
      marketState: 'CLOSED',
      change: 5,
      changePercent: 5.263157894736842
    });
  });

  it('preserves Yahoo change percentage when the previous close is unavailable', async () => {
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      price: {
        current: 100,
        changePercent: 5.26,
        marketState: 'CLOSED'
      }
    } as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.quoteDetails).toMatchObject({ changePercent: 5.26 });
    expect(result.quoteDetails).not.toHaveProperty('change');
  });

  it('falls back to the existing Freedom REST quote when the q WebSocket request fails', async () => {
    vi.mocked(fetchFreedomQuote).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceTimestamp: null,
      marketState: 'CLOSED',
      raw: {}
    });
    vi.mocked(fetchYahooQuoteData).mockResolvedValue(null as never);

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(fetchFreedomQuoteWebSocket).toHaveBeenCalledWith('AAPL');
    expect(fetchFreedomQuote).toHaveBeenCalledWith('AAPL', true);
    expect(fetchYahooQuoteData).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      price: 210,
      sourceName: 'Freedom TradeNet',
      quoteDetails: {
        transport: 'rest',
        marketState: 'CLOSED',
        freshness: 'unknown'
      }
    });
  });

  it('does not turn missing Freedom daily-change data into zero', async () => {
    vi.mocked(fetchFreedomQuoteWebSocket).mockResolvedValue({
      symbol: 'AAPL',
      price: 210,
      previousClose: null,
      change: null,
      changePercent: null,
      sourceTimestamp: Date.now(),
      raw: {}
    });

    const result = await fetchLivePriceFromProviders('AAPL');

    expect(result.sourceName).toBe('Freedom TradeNet');
    expect(result.quoteDetails).not.toHaveProperty('change');
    expect(result.quoteDetails).not.toHaveProperty('changePercent');
  });

  it('does not turn missing fallback daily-change data into zero', async () => {
    vi.mocked(fetchYahooQuoteData).mockRejectedValue(new Error('Yahoo unavailable'));
    vi.mocked(fetchFallbackQuote).mockResolvedValue({
      price: 42,
      sourceName: 'Finnhub',
      previousClose: null,
      change: null,
      changePercent: null
    } as never);

    const result = await fetchLivePriceFromProviders('MSFT');

    expect(result.sourceName).toBe('Finnhub');
    expect(result.quoteDetails).not.toHaveProperty('change');
    expect(result.quoteDetails).not.toHaveProperty('changePercent');
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

  it('forces the Freedom and Yahoo fallback chain and preserves the batch request timestamp', async () => {
    const requestStartedAt = Date.now() - 1_000;
    vi.mocked(fetchYahooQuoteData).mockResolvedValue({
      symbol: 'AAPL',
      price: {
        current: 215,
        previousClose: 200,
        regularMarketTime: Math.floor(Date.now() / 1000),
        marketState: 'REGULAR',
        change: 15
      }
    } as never);

    const result = await fetchLivePriceFromProviders('aapl', requestStartedAt, true);

    expect(fetchFreedomQuoteWebSocket).toHaveBeenCalledWith('AAPL');
    expect(fetchFreedomQuote).toHaveBeenCalledWith('AAPL', true);
    expect(fetchYahooQuoteData).toHaveBeenCalledWith('AAPL', true);
    expect(result).toMatchObject({
      price: 215,
      requestStartedAt,
      quoteDetails: { requestStartedAt }
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
