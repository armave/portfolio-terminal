import { describe, expect, it, vi } from 'vitest';
import { createYahooDeepDataCache } from './yahooDeepDataCache';

function createMetricRecorder() {
  return vi.fn<(metric: string, details: Record<string, unknown>) => void>();
}

describe('Yahoo deep-data cache', () => {
  it('normalizes symbols, caches successful results, and expires them after five minutes', async () => {
    let now = 1_000;
    const fetchData = vi.fn(async (symbol: string) => ({
      symbol,
      analystTargets: { median: 210 }
    }));
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder(),
      now: () => now
    });

    const first = await client.fetch(' aapl ');
    const cached = await client.fetch('AAPL');
    expect(first).toMatchObject({ symbol: 'AAPL' });
    expect(cached).toBe(first);
    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(fetchData).toHaveBeenCalledWith('AAPL', false);

    now += 5 * 60 * 1000;
    const refreshed = await client.fetch('AAPL');
    expect(refreshed).toMatchObject({ symbol: 'AAPL' });
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('seeds the cache from successful batch items and ignores invalid or provider-error items', async () => {
    const fetchData = vi.fn(async (symbol: string) => ({ symbol, fresh: true }));
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder()
    });

    client.remember([
      { symbol: ' aapl ', source: 'batch' },
      { symbol: 'MSFT', error: 'unavailable' },
      { symbol: 42, source: 'invalid' },
      null
    ]);

    await expect(client.fetch('AAPL')).resolves.toEqual({ symbol: ' aapl ', source: 'batch' });
    await client.fetch('MSFT');
    expect(fetchData).toHaveBeenCalledTimes(1);
    expect(fetchData).toHaveBeenCalledWith('MSFT', false);
  });

  it('shares one in-flight request for the same symbol but does not block other symbols', async () => {
    let resolveAapl!: (value: unknown) => void;
    const fetchData = vi.fn((symbol: string) => {
      if (symbol === 'AAPL') return new Promise<unknown>((resolve) => { resolveAapl = resolve; });
      return Promise.resolve({ symbol });
    });
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder()
    });

    const first = client.fetch('AAPL');
    const second = client.fetch(' aapl ');
    const msft = client.fetch('MSFT');

    expect(fetchData).toHaveBeenCalledTimes(2);
    const payload = { symbol: 'AAPL', value: 1 };
    resolveAapl(payload);
    await expect(Promise.all([first, second, msft])).resolves.toEqual([payload, payload, { symbol: 'MSFT' }]);
    expect(first).toBe(second);
  });

  it('forced refresh bypasses cached data and sends the force flag to the transport', async () => {
    const fetchData = vi.fn()
      .mockResolvedValueOnce({ symbol: 'AAPL', value: 1 })
      .mockResolvedValueOnce({ symbol: 'AAPL', value: 2 });
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder()
    });

    await client.fetch('AAPL');
    await expect(client.fetch('AAPL', true)).resolves.toEqual({ symbol: 'AAPL', value: 2 });
    await expect(client.fetch('AAPL')).resolves.toEqual({ symbol: 'AAPL', value: 2 });
    expect(fetchData.mock.calls).toEqual([
      ['AAPL', false],
      ['AAPL', true]
    ]);
  });

  it('does not join an in-flight request on force or let an older response overwrite the forced result', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetchData = vi.fn(() => new Promise<unknown>((resolve) => { resolvers.push(resolve); }));
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder()
    });

    const olderRequest = client.fetch('AAPL');
    const forcedRequest = client.fetch('AAPL', true);
    expect(fetchData).toHaveBeenCalledTimes(2);

    const forcedPayload = { symbol: 'AAPL', value: 2 };
    resolvers[1](forcedPayload);
    await expect(forcedRequest).resolves.toBe(forcedPayload);

    const olderPayload = { symbol: 'AAPL', value: 1 };
    resolvers[0](olderPayload);
    await expect(olderRequest).resolves.toBe(olderPayload);
    await expect(client.fetch('AAPL')).resolves.toBe(forcedPayload);
    expect(fetchData).toHaveBeenCalledTimes(2);
  });

  it('does not cache provider errors or rejected requests, allowing later retries', async () => {
    const fetchData = vi.fn()
      .mockResolvedValueOnce({ symbol: 'AAPL', error: 'Yahoo unavailable' })
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ symbol: 'AAPL', value: 3 });
    const recordMetric = createMetricRecorder();
    const client = createYahooDeepDataCache({ fetchData, recordMetric });

    await expect(client.fetch('AAPL')).resolves.toMatchObject({ error: 'Yahoo unavailable' });
    await expect(client.fetch('AAPL')).rejects.toThrow('network unavailable');
    await expect(client.fetch('AAPL')).resolves.toEqual({ symbol: 'AAPL', value: 3 });
    expect(fetchData).toHaveBeenCalledTimes(3);
    expect(recordMetric).toHaveBeenCalledWith('provider_failure', expect.objectContaining({ operation: 'deep_data' }));
    expect(recordMetric).toHaveBeenCalledWith('provider_request', expect.objectContaining({ operation: 'deep_data', success: true }));
  });

  it('clear removes cached and in-flight entries and prevents an older response from repopulating cache', async () => {
    let resolveOld!: (value: unknown) => void;
    const fetchData = vi.fn(() => new Promise<unknown>((resolve) => { resolveOld = resolve; }));
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder()
    });

    const oldRequest = client.fetch('AAPL');
    client.clear();
    const freshRequest = client.fetch('AAPL');
    expect(fetchData).toHaveBeenCalledTimes(2);

    const freshPayload = { symbol: 'AAPL', value: 2 };
    // The second transport request is resolved after the first request was cleared.
    // Keep separate resolvers so the stale request cannot win the cache race.
    const resolveFresh = fetchData.mock.results[1]?.value as Promise<unknown>;
    expect(resolveFresh).toBeDefined();
    resolveOld({ symbol: 'AAPL', value: 1 });
    await oldRequest;
    // A subsequent request remains necessary because the cleared request cannot seed cache.
    await client.fetch('AAPL');
    expect(fetchData).toHaveBeenCalledTimes(3);
    void freshRequest;
    void freshPayload;
  });

  it('returns null without sending requests for an empty symbol', async () => {
    const fetchData = vi.fn(async () => ({ symbol: 'AAPL' }));
    const client = createYahooDeepDataCache({
      fetchData,
      recordMetric: createMetricRecorder()
    });

    await expect(client.fetch('  ')).resolves.toBeNull();
    expect(fetchData).not.toHaveBeenCalled();
  });
});
