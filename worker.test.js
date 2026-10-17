import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { normalizeMarketState } from './worker.js';
import { PortfolioStateDO } from './state-store.js';

describe('normalizeMarketState', () => {
  it.each([
    ['PREPRE', 'PRE'],
    ['PRE', 'PRE'],
    ['REGULAR', 'REGULAR'],
    ['POSTPOST', 'POST'],
    ['POST', 'POST'],
    ['CLOSED', 'CLOSED'],
    [undefined, 'CLOSED'],
    [null, 'CLOSED']
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMarketState(input)).toBe(expected);
  });
});


describe('provider-quote proxy validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (query) => new Request(`https://worker.test/?action=provider-quote&${query}`, {
    headers: { 'X-App-Auth': 'test-secret' }
  });

  it('preserves an upstream rate-limit status instead of reporting a successful quote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'rate limit exceeded' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    )));

    const response = await worker.fetch(
      request('provider=finnhub&symbol=AAPL'),
      { GATEWAY_SECRET: 'test-secret', FINNHUB_KEY: 'provider-key' }
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate limit exceeded' });
  });

  it('rejects a missing provider key before making an upstream request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      request('provider=finnhub&symbol=AAPL'),
      { GATEWAY_SECRET: 'test-secret' }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not configured') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported providers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      request('provider=unknown&symbol=AAPL'),
      { GATEWAY_SECRET: 'test-secret' }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported quote provider.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing symbols', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      request('provider=finnhub'),
      { GATEWAY_SECRET: 'test-secret', FINNHUB_KEY: 'provider-key' }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('symbol') });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('PortfolioStateDO optimistic concurrency', () => {
  function makeDurableObject(legacyPayload = null) {
    const values = new Map();
    const storage = {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      transaction: async (callback) => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value)
      })
    };
    const ctx = { storage };
    const env = {
      PORTFOLIO_KV: { get: async (key) => key === 'portfolio_state' ? legacyPayload : null }
    };
    return new PortfolioStateDO(ctx, env);
  }

  it('accepts a write at the current revision and rejects a stale write', async () => {
    const store = makeDurableObject();
    const firstWrite = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify({ encryptedPayload: 'first' })
    }));
    expect(firstWrite.status).toBe(200);
    expect(firstWrite.headers.get('ETag')).toBe('"1"');

    const staleWrite = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify({ encryptedPayload: 'stale' })
    }));
    expect(staleWrite.status).toBe(409);
    expect(staleWrite.headers.get('ETag')).toBe('"1"');

    const latest = await store.fetch(new Request('https://worker.test/api/state'));
    expect(await latest.json()).toEqual({ encryptedPayload: 'first' });
    expect(latest.headers.get('ETag')).toBe('"1"');
  });

  it('migrates an existing KV portfolio without changing its payload', async () => {
    const store = makeDurableObject(JSON.stringify({ encryptedPayload: 'legacy' }));
    const response = await store.fetch(new Request('https://worker.test/api/state'));
    expect(response.status).toBe(200);
    expect(response.headers.get('ETag')).toBe('"1"');
    expect(await response.json()).toEqual({ encryptedPayload: 'legacy' });
  });

  it('requires a revision for every write', async () => {
    const store = makeDurableObject();
    const response = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptedPayload: 'unsafe' })
    }));
    expect(response.status).toBe(428);
  });
});
