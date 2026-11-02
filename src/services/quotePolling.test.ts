import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLivePriceFromProviders } from './quoteProvider';
import { refreshTrackedQuotes } from './quotePolling';

vi.mock('./quoteProvider', () => ({
  fetchLivePriceFromProviders: vi.fn()
}));

function quoteResult(price: number, requestStartedAt: number, ticker: string) {
  return {
    price,
    sourceName: 'Yahoo',
    updatedAt: requestStartedAt + 10,
    requestStartedAt,
    requestSequence: 1000 + ticker.charCodeAt(0),
    quoteDetails: {
      marketState: 'REGULAR',
      freshness: 'fresh',
      receivedAt: requestStartedAt + 10,
      requestSequence: 1000 + ticker.charCodeAt(0),
      requestStartedAt,
      sourceTimestamp: requestStartedAt,
      price,
      change: 1,
      changePercent: 1
    }
  };
}

describe('refreshTrackedQuotes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => vi.resetAllMocks());

  it('uses the same provider-comparison policy for every normalized unique ticker', async () => {
    vi.mocked(fetchLivePriceFromProviders)
      .mockImplementation(async (ticker, requestStartedAt = 0) =>
        quoteResult(ticker === 'AAPL' ? 100 : 200, requestStartedAt, ticker) as never
      );
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes([' aapl ', 'AAPL', ' msft ', ''], 123, record)).resolves.toBe(2);

    expect(fetchLivePriceFromProviders).toHaveBeenCalledTimes(2);
    expect(fetchLivePriceFromProviders).toHaveBeenNthCalledWith(1, 'AAPL', 123);
    expect(fetchLivePriceFromProviders).toHaveBeenNthCalledWith(2, 'MSFT', 123);
    expect(record).toHaveBeenNthCalledWith(
      1, 'AAPL', 100, 'Yahoo', 133, expect.objectContaining({ sourceTimestamp: 123 }), 123
    );
    expect(record).toHaveBeenNthCalledWith(
      2, 'MSFT', 200, 'Yahoo', 133, expect.objectContaining({ sourceTimestamp: 123 }), 123
    );
  });

  it('bounds provider concurrency and applies results in the requested ticker order', async () => {
    const tickers = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META'];
    const releases = new Map<string, (result: ReturnType<typeof quoteResult>) => void>();
    vi.mocked(fetchLivePriceFromProviders).mockImplementation((ticker, requestStartedAt = 0) =>
      new Promise((resolve) => {
        releases.set(ticker, (result) => resolve(result as never));
      }) as never
    );
    const record = vi.fn().mockReturnValue(true);

    const pending = refreshTrackedQuotes(tickers, 765, record);
    await Promise.resolve();
    expect(fetchLivePriceFromProviders).toHaveBeenCalledTimes(4);

    releases.get('AAPL')!(quoteResult(100, 765, 'AAPL'));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchLivePriceFromProviders).toHaveBeenCalledTimes(5);

    for (const [index, ticker] of tickers.entries()) {
      if (ticker !== 'AAPL') releases.get(ticker)!(quoteResult(100 + index, 765, ticker));
    }

    await expect(pending).resolves.toBe(5);
    expect(record.mock.calls.map(([ticker]) => ticker)).toEqual(tickers);
  });

  it('passes force through to every provider comparison for an explicit refresh', async () => {
    vi.mocked(fetchLivePriceFromProviders).mockImplementation(async (ticker, requestStartedAt = 0, force = false) =>
      quoteResult(150, requestStartedAt, ticker) as never
    );
    const record = vi.fn().mockReturnValue(true);

    await expect(refreshTrackedQuotes(['AAPL', 'MSFT'], 321, record, true)).resolves.toBe(2);

    expect(fetchLivePriceFromProviders).toHaveBeenNthCalledWith(1, 'AAPL', 321, true);
    expect(fetchLivePriceFromProviders).toHaveBeenNthCalledWith(2, 'MSFT', 321, true);
  });

  it('counts only quotes accepted by the portfolio store', async () => {
    vi.mocked(fetchLivePriceFromProviders).mockImplementation(async (ticker, requestStartedAt = 0) =>
      quoteResult(100, requestStartedAt, ticker) as never
    );
    const record = vi.fn((ticker: string) => ticker === 'AAPL');

    await expect(refreshTrackedQuotes(['AAPL', 'MSFT'], 654, record)).resolves.toBe(1);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it('skips unavailable provider results and returns zero for an empty ticker list', async () => {
    const record = vi.fn().mockReturnValue(true);
    await expect(refreshTrackedQuotes([], 789, record)).resolves.toBe(0);
    expect(fetchLivePriceFromProviders).not.toHaveBeenCalled();

    vi.mocked(fetchLivePriceFromProviders).mockResolvedValue({
      price: null,
      sourceName: '',
      updatedAt: null,
      requestStartedAt: 790,
      requestSequence: 1,
      quoteDetails: null,
      error: 'Quote unavailable'
    } as never);
    await expect(refreshTrackedQuotes(['TSLA'], 790, record)).resolves.toBe(0);
    expect(record).not.toHaveBeenCalled();
  });

  it('propagates an unexpected provider error to the caller', async () => {
    vi.mocked(fetchLivePriceFromProviders).mockRejectedValue(new Error('Network unavailable'));
    await expect(refreshTrackedQuotes(['TSLA'], 100, vi.fn())).rejects.toThrow('Network unavailable');
  });
});
