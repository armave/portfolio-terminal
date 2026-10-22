import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFallbackPrice } from './quoteProvider';
import { fetchYahooStockData, normalizeYahooBatchResults } from './api';
import { refreshTrackedQuotes } from './quotePolling';

vi.mock('./quoteProvider', () => ({ fetchFallbackPrice: vi.fn() }));
vi.mock('./api', () => ({ fetchYahooStockData: vi.fn(), normalizeYahooBatchResults: vi.fn() }));

describe('refreshTrackedQuotes', () => {
  afterEach(() => vi.resetAllMocks());

  it('resolves a batch market price and applies it through the current-state callback', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'AAPL', price: { current: 100, previousClose: 95, marketState: 'REGULAR', change: 5 }
    }] as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['AAPL'], 123, record)).resolves.toBe(1);
    expect(fetchYahooStockData).toHaveBeenCalledWith('AAPL');
    expect(record).toHaveBeenCalledWith('AAPL', 100, 'Yahoo', expect.any(Number), expect.objectContaining({
      marketState: 'REGULAR', price: 100, change: 5, changePercent: expect.any(Number)
    }), 123);
  });

  it('uses fallback quotes when batch data has no usable price', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{ symbol: 'MSFT', error: 'No batch quote' }] as never);
    vi.mocked(fetchFallbackPrice).mockResolvedValue({
      price: 42, sourceName: 'Twelve Data',
      quoteDetails: { marketState: 'REGULAR', price: 42, change: 2, changePercent: 5 }
    } as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['MSFT'], 456, record)).resolves.toBe(1);
    expect(fetchFallbackPrice).toHaveBeenCalledWith('MSFT');
    expect(record).toHaveBeenCalledWith('MSFT', 42, 'Twelve Data', expect.any(Number), expect.objectContaining({ price: 42 }), 456);
  });

  it('returns zero for no tickers or when returned symbols are not tracked', async () => {
    const record = vi.fn().mockReturnValue(false);
    await expect(refreshTrackedQuotes([], 789, record)).resolves.toBe(0);
    expect(fetchYahooStockData).not.toHaveBeenCalled();

    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'NVDA', price: { current: 50, previousClose: 50, marketState: 'REGULAR', change: 0 }
    }] as never);
    await expect(refreshTrackedQuotes(['NVDA'], 789, record)).resolves.toBe(0);
  });

  it('ignores unexpected symbols returned by the batch provider', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([
      { symbol: 'AAPL', price: { current: 100, previousClose: 95, marketState: 'REGULAR', change: 5 } },
      { symbol: 'UNREQUESTED', error: 'Unexpected symbol' }
    ] as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes([' aapl '], 321, record)).resolves.toBe(1);

    expect(fetchYahooStockData).toHaveBeenCalledWith('AAPL');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith('AAPL', 100, 'Yahoo', expect.any(Number), expect.any(Object), 321);
    expect(fetchFallbackPrice).not.toHaveBeenCalled();
  });

  it('keeps quote change percentages finite when previous close is invalid', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'AAPL',
      price: { current: 100, previousClose: '0', marketState: 'REGULAR', change: 5 }
    }] as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['AAPL'], 654, record)).resolves.toBe(1);

    expect(record).toHaveBeenCalledWith('AAPL', 100, 'Yahoo', expect.any(Number), expect.objectContaining({
      changePercent: 0
    }), 654);
  });

  it('normalizes and deduplicates requested symbols before querying the provider', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([
      { symbol: 'AAPL', price: { current: 100, previousClose: 95, marketState: 'REGULAR', change: 5 } },
      { symbol: 'MSFT', price: { current: 200, previousClose: 190, marketState: 'REGULAR', change: 10 } }
    ] as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes([' aapl ', 'AAPL', ' msft ', ''], 654, record)).resolves.toBe(2);

    expect(fetchYahooStockData).toHaveBeenCalledTimes(1);
    expect(fetchYahooStockData).toHaveBeenCalledWith('AAPL, MSFT');
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls.map(([ticker]) => ticker)).toEqual(['AAPL', 'MSFT']);
  });

  it('does not apply or erase a quote when both batch and fallback providers fail', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([
      { symbol: 'AAPL', error: 'Batch unavailable' }
    ] as never);
    vi.mocked(fetchFallbackPrice).mockResolvedValue(null as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['AAPL'], 987, record)).resolves.toBe(0);

    expect(fetchFallbackPrice).toHaveBeenCalledWith('AAPL');
    expect(record).not.toHaveBeenCalled();
  });

  it('propagates batch provider failures to the caller', async () => {
    vi.mocked(fetchYahooStockData).mockRejectedValue(new Error('Network unavailable'));
    await expect(refreshTrackedQuotes(['TSLA'], 100, vi.fn())).rejects.toThrow('Network unavailable');
  });
});
