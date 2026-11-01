import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFallbackPrice, nextQuoteRequestSequence } from './quoteProvider';
import { fetchYahooStockData } from './api';
import { normalizeYahooBatchResults } from './yahooQuoteContracts';
import { refreshTrackedQuotes } from './quotePolling';

vi.mock('./quoteProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./quoteProvider')>();
  return { ...actual, fetchFallbackPrice: vi.fn(), nextQuoteRequestSequence: vi.fn() };
});
vi.mock('./api', () => ({ fetchYahooStockData: vi.fn() }));
vi.mock('./yahooQuoteContracts', () => ({ normalizeYahooBatchResults: vi.fn() }));

describe('refreshTrackedQuotes', () => {
  beforeEach(() => {
    vi.mocked(nextQuoteRequestSequence).mockReturnValue(1234);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

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
      marketState: 'REGULAR', requestSequence: 1234, requestStartedAt: 123, price: 100, change: 5, changePercent: expect.any(Number)
    }), 123);
  });

  it('resolves fallback quotes with a bounded pool and preserves batch update order', async () => {
    type FallbackQuote = NonNullable<Awaited<ReturnType<typeof fetchFallbackPrice>>>;
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => { resolve = res; });
      return { promise, resolve };
    }

    const tickers = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'];
    const responses = new Map(tickers.map((ticker) => [ticker, deferred<FallbackQuote>()]));
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue(
      tickers.map((symbol) => ({ symbol, error: 'Missing batch quote' })) as never
    );
    const started: string[] = [];
    vi.mocked(fetchFallbackPrice).mockImplementation((ticker) => {
      started.push(ticker);
      return responses.get(ticker)!.promise;
    });
    const record = vi.fn().mockReturnValue(true);

    const pending = refreshTrackedQuotes(tickers, 765, record);
    await Promise.resolve();

    // Four workers start immediately, but a fifth request waits for a slot.
    expect(started).toEqual(tickers.slice(0, 4));
    for (let index = 0; index < 4; index++) {
      responses.get(tickers[index])!.resolve({
        price: 100 + index,
        sourceName: 'Twelve Data',
        previousClose: 100,
        change: index,
        changePercent: index,
      });
      await Promise.resolve();
    }

    expect(started).toEqual(tickers);
    responses.get('META')!.resolve({
      price: 104,
      sourceName: 'Twelve Data',
      previousClose: 100,
      change: 4,
      changePercent: 4,
    });

    await expect(pending).resolves.toBe(5);
    expect(record.mock.calls.map(([ticker]) => ticker)).toEqual(tickers);
  });

  it('uses fallback quotes when batch data has no usable price', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{ symbol: 'MSFT', error: 'No batch quote' }] as never);
    vi.mocked(fetchFallbackPrice).mockResolvedValue({
      price: 42, sourceName: 'Twelve Data',
      quoteDetails: { marketState: 'UNKNOWN', freshness: 'unknown', receivedAt: 456, price: 42, change: 2, changePercent: 5 }
    } as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['MSFT'], 456, record)).resolves.toBe(1);
    expect(fetchFallbackPrice).toHaveBeenCalledWith('MSFT');
    expect(record).toHaveBeenCalledWith('MSFT', 42, 'Twelve Data', expect.any(Number), expect.objectContaining({ price: 42, requestSequence: 1234, requestStartedAt: 456 }), 456);
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
      requestSequence: 1234, requestStartedAt: 654, changePercent: 0
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

  it('preserves a fresh Yahoo observation timestamp in tracked batch quotes', async () => {
    const sourceTime = Math.floor(Date.now() / 1000);
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'AAPL',
      price: {
        current: 100,
        previousClose: 99,
        regularMarketTime: sourceTime,
        marketState: 'REGULAR'
      }
    }] as never);
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['AAPL'], 100, record)).resolves.toBe(1);

    expect(record).toHaveBeenCalledWith('AAPL', 100, 'Yahoo', expect.any(Number), expect.objectContaining({
      freshness: 'fresh',
      sourceTimestamp: sourceTime * 1000,
      receivedAt: expect.any(Number)
    }), 100);
  });

  it('marks an old regular-session Yahoo observation stale despite recent receipt', async () => {
    const sourceTime = Math.floor(Date.now() / 1000) - 60 * 60;
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'MSFT',
      price: {
        current: 200,
        previousClose: 198,
        regularMarketTime: sourceTime,
        marketState: 'REGULAR'
      }
    }] as never);
    const record = vi.fn().mockReturnValue(true);

    await refreshTrackedQuotes(['MSFT'], 200, record);

    expect(record).toHaveBeenCalledWith('MSFT', 200, 'Yahoo', expect.any(Number), expect.objectContaining({
      freshness: 'stale',
      sourceTimestamp: sourceTime * 1000,
      receivedAt: expect.any(Number)
    }), 200);
  });

  it('marks an old closed-session observation delayed rather than live or stale', async () => {
    const sourceTime = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'NVDA',
      price: {
        current: 150,
        previousClose: 149,
        regularMarketTime: sourceTime,
        marketState: 'CLOSED'
      }
    }] as never);
    const record = vi.fn().mockReturnValue(true);

    await refreshTrackedQuotes(['NVDA'], 300, record);

    expect(record).toHaveBeenCalledWith('NVDA', 150, 'Yahoo', expect.any(Number), expect.objectContaining({
      freshness: 'delayed',
      sourceTimestamp: sourceTime * 1000
    }), 300);
  });

  it('keeps batch quote freshness unknown when Yahoo omits observation timestamps', async () => {
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([{
      symbol: 'TSLA',
      price: { current: 250, previousClose: 248, marketState: 'REGULAR' }
    }] as never);
    const record = vi.fn().mockReturnValue(true);

    await refreshTrackedQuotes(['TSLA'], 400, record);

    expect(record).toHaveBeenCalledWith('TSLA', 250, 'Yahoo', expect.any(Number), expect.objectContaining({
      freshness: 'unknown',
      receivedAt: expect.any(Number)
    }), 400);
    expect(record.mock.calls[0][4]?.sourceTimestamp).toBeUndefined();
  });

  it('uses the matching pre-market or post-market observation timestamp', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.mocked(fetchYahooStockData).mockResolvedValue({} as never);
    vi.mocked(normalizeYahooBatchResults).mockReturnValue([
      {
        symbol: 'AAPL',
        price: {
          current: 100,
          previousClose: 99,
          regularMarketTime: now - 60 * 60,
          preMarketTime: now - 30,
          marketState: 'PRE'
        }
      },
      {
        symbol: 'MSFT',
        price: {
          current: 200,
          previousClose: 198,
          regularMarketTime: now - 60 * 60,
          postMarketTime: now - 30,
          marketState: 'POST'
        }
      }
    ] as never);
    const record = vi.fn().mockReturnValue(true);

    await refreshTrackedQuotes(['AAPL', 'MSFT'], 500, record);

    expect(record).toHaveBeenNthCalledWith(1, 'AAPL', 100, 'Yahoo', expect.any(Number), expect.objectContaining({
      freshness: 'fresh',
      sourceTimestamp: (now - 30) * 1000
    }), 500);
    expect(record).toHaveBeenNthCalledWith(2, 'MSFT', 200, 'Yahoo', expect.any(Number), expect.objectContaining({
      freshness: 'fresh',
      sourceTimestamp: (now - 30) * 1000
    }), 500);
  });

  it('propagates batch provider failures to the caller', async () => {
    vi.mocked(fetchYahooStockData).mockRejectedValue(new Error('Network unavailable'));
    await expect(refreshTrackedQuotes(['TSLA'], 100, vi.fn())).rejects.toThrow('Network unavailable');
  });
});
