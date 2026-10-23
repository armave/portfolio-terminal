import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFallbackQuote, fetchYahooStockData } from './api';
import { fetchLivePriceFromProviders } from './quoteProvider';

vi.mock('./api', () => ({
  fetchYahooStockData: vi.fn(),
  fetchFallbackQuote: vi.fn()
}));

describe('fetchLivePriceFromProviders', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('uses Yahoo market-session price data when available', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({
      price: {
        current: 100,
        previousClose: 95,
        marketState: 'REGULAR',
        change: 5
      }
    } as never);

    const result = await fetchLivePriceFromProviders('aapl');

    expect(fetchYahooStockData).toHaveBeenCalledWith('AAPL');
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
    vi.mocked(fetchYahooStockData).mockResolvedValue(null as never);
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
    vi.mocked(fetchYahooStockData).mockResolvedValue({
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
    vi.mocked(fetchYahooStockData).mockResolvedValue({
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
    vi.mocked(fetchYahooStockData).mockRejectedValue(new Error('Yahoo unavailable'));
    vi.mocked(fetchFallbackQuote).mockRejectedValue(new Error('Fallback unavailable'));

    const result = await fetchLivePriceFromProviders('TSLA');

    expect(result.price).toBeNull();
    expect(result.updatedAt).toBeNull();
    expect(result.error).toContain('Quote unavailable');
  });
});
