import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { fetchWithTimeout, normalizeMarketState } from './worker.js';
import { PortfolioStateDO } from './state-store.js';

describe('upstream timeout coverage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps the timeout active until the upstream response body is consumed', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_input, init) => new Response(new ReadableStream({
      start(controller) {
        init.signal.addEventListener('abort', () => controller.error(new Error('upstream aborted')), { once: true });
      }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchWithTimeout('https://upstream.test/data', {}, 50);
    const bodyRead = response.text();
    const rejectedBody = expect(bodyRead).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(51);
    await rejectedBody;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

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


describe('gateway browser-origin boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('allows the hosted app origin and returns an explicit origin rather than a wildcard', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/?action=state', {
        headers: { Origin: 'https://armave.github.io', 'X-App-Auth': 'test-secret' }
      }),
      {
        GATEWAY_SECRET: 'test-secret',
        PORTFOLIO_STATE_DO: {
          idFromName: vi.fn().mockReturnValue('personal-state'),
          get: vi.fn().mockReturnValue({
            fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ encryptedPayload: 'ciphertext' }), {
              status: 200, headers: { ETag: '"4"' }
            }))
          })
        }
      }
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://armave.github.io');
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    expect(response.headers.get('ETag')).toBe('"4"');
  });

  it('rejects browser origins outside the configured personal-app allowlist', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/?action=state', {
        headers: { Origin: 'https://untrusted.example', 'X-App-Auth': 'test-secret' }
      }),
      { GATEWAY_SECRET: 'test-secret' }
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Origin is not allowed.' });
  });

  it('supports an explicitly configured trusted deployment origin', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/?action=state', {
        headers: { Origin: 'https://portfolio.example', 'X-App-Auth': 'test-secret' }
      }),
      { GATEWAY_SECRET: 'test-secret', ALLOWED_ORIGINS: 'https://portfolio.example' }
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://portfolio.example');
  });
});

describe('stocktwits proxy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a bounded public symbol stream through the authenticated proxy', async () => {
    const upstreamMessages = Array.from({ length: 45 }, (_, id) => ({
      id,
      body: `Message ${id}`,
      created_at: '2026-10-20T12:00:00Z',
      ...(id % 3 === 0 ? { conversation: { parent_message_id: id - 1 } } : {})
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      symbol: { symbol: 'AAPL' },
      messages: upstreamMessages
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.test/?action=stocktwits&symbol=AAPL', {
        headers: { 'X-App-Auth': 'test-secret' }
      }),
      { GATEWAY_SECRET: 'test-secret' }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.symbol).toBe('AAPL');
    expect(data.messages).toHaveLength(30);
    expect(data.messages.every((message) => message.conversation?.parent_message_id == null)).toBe(true);
    expect(data.streamUrl).toBe('https://stocktwits.com/symbol/AAPL');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.stocktwits.com/api/2/streams/symbol/AAPL.json',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: 'application/json' }) })
    );
  });

  it('preserves upstream errors and rejects multiple symbols', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429, headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.test/?action=stocktwits&symbol=AAPL', {
        headers: { 'X-App-Auth': 'test-secret' }
      }),
      { GATEWAY_SECRET: 'test-secret' }
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Rate limited' });

    const multiple = await worker.fetch(
      new Request('https://worker.test/?action=stocktwits&symbol=AAPL%2CMSFT', {
        headers: { 'X-App-Auth': 'test-secret' }
      }),
      { GATEWAY_SECRET: 'test-secret' }
    );
    expect(multiple.status).toBe(400);
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

  it('rejects malformed cloud state payloads and oversized bodies', async () => {
    const store = makeDurableObject();
    const malformed = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify({ unexpected: 'plain-text-state' })
    }));
    expect(malformed.status).toBe(400);

    const oversized = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify({ encryptedPayload: 'x'.repeat(65 * 1024) })
    }));
    expect(oversized.status).toBe(413);
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


describe('news proxy validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = () => new Request('https://worker.test/?action=news&symbol=AAPL', {
    headers: { 'X-App-Auth': 'test-secret' }
  });

  it('preserves Finnhub upstream rate-limit errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'rate limit exceeded' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    )));
    const response = await worker.fetch(request(), { GATEWAY_SECRET: 'test-secret', FINNHUB_KEY: 'provider-key' });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate limit exceeded' });
  });

  it('returns a configuration error without calling Finnhub when the key is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(request(), { GATEWAY_SECRET: 'test-secret' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not configured') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns at most ten news items for the frontend', async () => {
    const news = Array.from({ length: 100 }, (_, index) => ({ headline: `News ${index + 1}` }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(news), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    })));
    const response = await worker.fetch(request(), { GATEWAY_SECRET: 'test-secret', FINNHUB_KEY: 'provider-key' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(news.slice(0, 10));
  });

  it('rejects a successful but malformed Finnhub response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ unexpected: true }), { status: 200 })));
    const response = await worker.fetch(request(), { GATEWAY_SECRET: 'test-secret', FINNHUB_KEY: 'provider-key' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('invalid news response') });
  });
});


describe('Worker request hardening', () => {
  afterEach(() => vi.unstubAllGlobals());

  const authed = (url, init = {}) => new Request(url, {
    ...init,
    headers: { 'X-App-Auth': 'test-secret', ...(init.headers || {}) }
  });

  it('rejects unsupported methods before any upstream fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(authed('https://worker.test/?symbol=AAPL', { method: 'DELETE' }), { GATEWAY_SECRET: 'test-secret' });
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid symbols and batches larger than ten tickers', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invalid = await worker.fetch(authed('https://worker.test/?symbol=AAPL%2F..'), { GATEWAY_SECRET: 'test-secret' });
    expect(invalid.status).toBe(400);
    const oversized = await worker.fetch(authed('https://worker.test/?symbol=A,B,C,D,E,F,G,H,I,J,K'), { GATEWAY_SECRET: 'test-secret' });
    expect(oversized.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the Gemini attempt timeout active until its response body is consumed', async () => {
    vi.useFakeTimers();
    let firstSignal;
    const fetchMock = vi.fn()
      .mockImplementationOnce(async (_input, init) => {
        firstSignal = init.signal;
        return new Response(new ReadableStream({
          start(controller) {
            init.signal.addEventListener('abort', () => controller.error(new Error('Gemini body aborted')), { once: true });
          }
        }), { status: 200 });
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = worker.fetch(authed('https://worker.test/?action=gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' })
    }), { GATEWAY_SECRET: 'test-secret', GEMINI_KEY: 'provider-key' });

    await vi.advanceTimersByTimeAsync(3500);
    const response = await responsePromise;

    expect(firstSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it('rejects invalid Gemini payloads, oversized prompts, and unapproved models', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const env = { GATEWAY_SECRET: 'test-secret', GEMINI_KEY: 'provider-key' };
    const invalid = await worker.fetch(authed('https://worker.test/?action=gemini', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 42 })
    }), env);
    expect(invalid.status).toBe(400);
    const oversized = await worker.fetch(authed('https://worker.test/?action=gemini', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'x'.repeat(12001) })
    }), env);
    expect(oversized.status).toBe(413);
    const model = await worker.fetch(authed('https://worker.test/?action=gemini', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'hello', model: 'attacker-model' })
    }), env);
    expect(model.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized request bodies and unsupported actions', async () => {
    const oversized = await worker.fetch(authed('https://worker.test/?action=gemini', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'x'.repeat(70000) })
    }), { GATEWAY_SECRET: 'test-secret', GEMINI_KEY: 'provider-key' });
    expect(oversized.status).toBe(413);
    const unknown = await worker.fetch(authed('https://worker.test/?action=unknown&symbol=AAPL'), { GATEWAY_SECRET: 'test-secret' });
    expect(unknown.status).toBe(400);
  });
});


describe('PortfolioStateDO payload validation', () => {
  function makeStore() {
    const values = new Map();
    const storage = {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      transaction: async (callback) => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value)
      })
    };
    return new PortfolioStateDO({ storage }, {});
  }

  it('rejects missing or empty encrypted payloads without creating a revision', async () => {
    const store = makeStore();
    for (const body of [{}, { encryptedPayload: '   ' }, { encryptedPayload: 123 }]) {
      const response = await store.fetch(new Request('https://worker.test/api/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
        body: JSON.stringify(body)
      }));
      expect(response.status).toBe(400);
    }
    const latest = await store.fetch(new Request('https://worker.test/api/state'));
    expect(latest.status).toBe(404);
    expect(latest.headers.get('ETag')).toBe('"0"');
  });

  it('rejects oversized cloud payloads before writing', async () => {
    const store = makeStore();
    const response = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify({ encryptedPayload: 'x'.repeat(70_000) })
    }));
    expect(response.status).toBe(413);
    const latest = await store.fetch(new Request('https://worker.test/api/state'));
    expect(latest.status).toBe(404);
  });
});


describe('legacy Yahoo quote POST compatibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('allows a JSON POST to the default Yahoo market-data route', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 200, headers: { 'Set-Cookie': 'A1=test-cookie; Path=/' } }))
      .mockResolvedValueOnce(new Response('test-crumb', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        chart: { result: [{ meta: { symbol: 'AAPL' }, timestamp: [], indicators: { quote: [{ close: [] }] } }], error: null }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?symbol=AAPL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Auth': 'test-secret' },
      body: JSON.stringify({})
    }), { GATEWAY_SECRET: 'test-secret' });

    expect(response.status).not.toBe(405);
    expect(await response.json()).not.toHaveProperty('error', 'POST is only supported for Gemini and cloud state actions.');
  });

  it('continues to reject POST for GET-only provider actions', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=provider-quote&provider=finnhub&symbol=AAPL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Auth': 'test-secret' },
      body: JSON.stringify({})
    }), { GATEWAY_SECRET: 'test-secret', FINNHUB_KEY: 'provider-key' });
    expect(response.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
