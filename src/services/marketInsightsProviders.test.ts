import { describe, expect, it, vi } from 'vitest';
import { createMarketInsightsProviderClient } from './marketInsightsProviders';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

describe('market insights provider client', () => {
  it('normalizes ticker keys and caches news for its configured TTL', async () => {
    let now = 10_000;
    const fetchNews = vi.fn().mockResolvedValue([{ headline: 'First' }, null, 'invalid']);
    const client = createMarketInsightsProviderClient({
      fetchNews,
      fetchStocktwits: vi.fn().mockResolvedValue({ messages: [] }),
      now: () => now
    });

    await expect(client.fetchMarketNews(' aapl ')).resolves.toEqual([{ headline: 'First' }]);
    await expect(client.fetchMarketNews('AAPL')).resolves.toEqual([{ headline: 'First' }]);
    expect(fetchNews).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000;
    await expect(client.fetchMarketNews('AAPL')).resolves.toEqual([{ headline: 'First' }]);
    expect(fetchNews).toHaveBeenCalledTimes(2);
  });

  it('normalizes Stocktwits messages and supplies a safe fallback stream URL', async () => {
    const client = createMarketInsightsProviderClient({
      fetchNews: vi.fn().mockResolvedValue([]),
      fetchStocktwits: vi.fn().mockResolvedValue({
        messages: [
          {
            id: 1,
            body: 'Bullish',
            created_at: '2026-10-31T10:00:00Z',
            sentiment: { basic: 'Bullish' },
            likes: { total: 4 },
            user: { username: 'trader' },
            conversation: { parent_message_id: null }
          },
          { id: 'bad', body: 42 },
          { body: 'Missing required id' }
        ]
      })
    });

    await expect(client.fetchStocktwitsStream('msft')).resolves.toEqual({
      symbol: 'MSFT',
      messages: [{
        id: 1,
        body: 'Bullish',
        created_at: '2026-10-31T10:00:00Z',
        sentiment: { basic: 'Bullish' },
        likes: { total: 4 },
        user: { username: 'trader' },
        conversation: { parent_message_id: null }
      }],
      streamUrl: 'https://stocktwits.com/symbol/MSFT'
    });
  });

  it('shares concurrent reads for the same symbol but keeps feeds independent', async () => {
    const newsResponse = deferred<unknown>();
    const stocktwitsResponse = deferred<unknown>();
    const fetchNews = vi.fn(() => newsResponse.promise);
    const fetchStocktwits = vi.fn(() => stocktwitsResponse.promise);
    const client = createMarketInsightsProviderClient({ fetchNews, fetchStocktwits });

    const firstNews = client.fetchMarketNews('aapl');
    const secondNews = client.fetchMarketNews(' AAPL ');
    const messages = client.fetchStocktwitsStream('AAPL');
    await Promise.resolve();

    expect(fetchNews).toHaveBeenCalledTimes(1);
    expect(fetchStocktwits).toHaveBeenCalledTimes(1);

    newsResponse.resolve([{ headline: 'News' }]);
    stocktwitsResponse.resolve({ messages: [{ id: 1, body: 'Post' }] });
    await expect(Promise.all([firstNews, secondNews])).resolves.toEqual([
      [{ headline: 'News' }],
      [{ headline: 'News' }]
    ]);
    await expect(messages).resolves.toMatchObject({ messages: [{ id: 1, body: 'Post' }] });
  });

  it('lets one subscriber abort without cancelling the shared provider request', async () => {
    const response = deferred<unknown>();
    let transportSignal: AbortSignal | undefined;
    const client = createMarketInsightsProviderClient({
      fetchNews: vi.fn((_symbol: string, signal: AbortSignal) => {
        transportSignal = signal;
        return response.promise;
      }),
      fetchStocktwits: vi.fn().mockResolvedValue({ messages: [] })
    });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = client.fetchMarketNews('aapl', false, firstController.signal);
    const second = client.fetchMarketNews('AAPL', false, secondController.signal);
    await Promise.resolve();

    firstController.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(false);

    response.resolve([{ headline: 'Shared result' }]);
    await expect(second).resolves.toEqual([{ headline: 'Shared result' }]);
  });

  it('aborts transport when every subscriber cancels', async () => {
    let transportSignal: AbortSignal | undefined;
    const client = createMarketInsightsProviderClient({
      fetchNews: vi.fn((_symbol: string, signal: AbortSignal) => {
        transportSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      }),
      fetchStocktwits: vi.fn().mockResolvedValue({ messages: [] })
    });
    const controller = new AbortController();
    const request = client.fetchMarketNews('aapl', false, controller.signal);
    await Promise.resolve();

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
  });

  it('allows an immediate retry after the last subscriber cancels', async () => {
    const fetchNews = vi.fn()
      .mockImplementationOnce((_symbol: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      }))
      .mockResolvedValueOnce([{ headline: 'Recovered result' }]);
    const client = createMarketInsightsProviderClient({
      fetchNews,
      fetchStocktwits: vi.fn().mockResolvedValue({ messages: [] })
    });
    const controller = new AbortController();

    const cancelled = client.fetchMarketNews('AAPL', false, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    await expect(client.fetchMarketNews('AAPL')).resolves.toEqual([{ headline: 'Recovered result' }]);
    expect(fetchNews).toHaveBeenCalledTimes(2);
  });

  it('does not join an older in-flight request on force or cache its late response', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const fetchNews = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const client = createMarketInsightsProviderClient({
      fetchNews,
      fetchStocktwits: vi.fn().mockResolvedValue({ messages: [] })
    });

    const older = client.fetchMarketNews('AAPL');
    await Promise.resolve();
    const forced = client.fetchMarketNews('AAPL', true);
    await Promise.resolve();
    expect(fetchNews).toHaveBeenCalledTimes(2);

    second.resolve([{ headline: 'Fresh result' }]);
    await expect(forced).resolves.toEqual([{ headline: 'Fresh result' }]);
    first.resolve([{ headline: 'Late stale result' }]);
    await expect(older).resolves.toEqual([{ headline: 'Late stale result' }]);

    await expect(client.fetchMarketNews('AAPL')).resolves.toEqual([{ headline: 'Fresh result' }]);
    expect(fetchNews).toHaveBeenCalledTimes(2);
  });

  it('aborts pending provider requests when the client cache is cleared', async () => {
    let transportSignal: AbortSignal | undefined;
    const client = createMarketInsightsProviderClient({
      fetchNews: vi.fn((_symbol: string, signal: AbortSignal) => {
        transportSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(abortError()), { once: true });
        });
      }),
      fetchStocktwits: vi.fn().mockResolvedValue({ messages: [] })
    });
    const request = client.fetchMarketNews('aapl');
    await Promise.resolve();

    client.clear();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(transportSignal?.aborted).toBe(true);
  });

  it('returns empty values for an empty ticker without making provider calls', async () => {
    const fetchNews = vi.fn();
    const fetchStocktwits = vi.fn();
    const client = createMarketInsightsProviderClient({ fetchNews, fetchStocktwits });

    await expect(client.fetchMarketNews('  ')).resolves.toEqual([]);
    await expect(client.fetchStocktwitsStream('  ')).resolves.toEqual({
      symbol: '',
      messages: [],
      streamUrl: ''
    });
    expect(fetchNews).not.toHaveBeenCalled();
    expect(fetchStocktwits).not.toHaveBeenCalled();
  });
});
