import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { ensureFreedomTradeNetSession, fetchFreedomMarketDepthWithSid, fetchWithTimeout, normalizeMarketState, sanitizeFreedomPositions, sanitizeFreedomActiveOrders, sanitizeFreedomMarketDepth } from './worker.js';
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

describe('Freedom active orders proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requests active orders with a fixed read-only command and returns sanitized limit data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      orders: { order: [
        { order_id: 77, instr: 'AAPL.US', oper: 3, type: 2, p: 210.25, q: 10, leaves_qty: 6, stat: 'active', private_account: 'do-not-return' }
      ] }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-orders', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_PUBLIC_KEY: 'public-key',
      FREEDOM_PRIVATE_KEY: 'private-key'
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      provider: 'Freedom TradeNet',
      data: { orders: { order: [{
        order_id: '77', instr: 'AAPL.US', oper: 3, type: 2, p: 210.25, q: 10, leaves_qty: 6, stat: 'active'
      }] } }
    });
    expect(JSON.stringify(body)).not.toContain('do-not-return');
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(requestBody).toEqual({ cmd: 'getNotifyOrderJson', params: { active_only: 1 } });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://tradernet.com/api/getNotifyOrderJson');
  });
});

describe('sanitizeFreedomActiveOrders', () => {
  it('returns only safe order fields and preserves remaining quantity for partial fills', () => {
    const result = sanitizeFreedomActiveOrders({
      data: { result: { orders: { order: [
        { order_id: 42, instr: 'AAPL.US', oper: 3, type: 2, p: 212.5, q: 10, leaves_qty: 4, stat: 'active', account: 'private', token: 'secret' },
        { order_id: 43, instr: 'MSFT.US', oper: 1, type: 2, p: 400, q: 2, stat: 'active' }
      ] } } }
    });
    expect(result.orders.order).toEqual([
      { order_id: '42', instr: 'AAPL.US', oper: 3, type: 2, p: 212.5, q: 10, leaves_qty: 4, stat: 'active' },
      { order_id: '43', instr: 'MSFT.US', oper: 1, type: 2, p: 400, q: 2, leaves_qty: 2, stat: 'active' }
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('preserves orders that identify the instrument with instr_nm', () => {
    const result = sanitizeFreedomActiveOrders({
      orders: { order: [
        { order_id: 77, instr_nm: 'AAPL.US', oper: 3, type: 2, p: 353, q: 50, leaves_qty: 50, stat: 'active' }
      ] }
    });
    expect(result.orders.order).toEqual([
      { order_id: '77', instr: 'AAPL.US', oper: 3, type: 2, p: 353, q: 50, leaves_qty: 50, stat: 'active' }
    ]);
  });

  it('returns an empty order list for an unrecognized response shape', () => {
    expect(sanitizeFreedomActiveOrders({ unexpected: true })).toEqual({ orders: { order: [] } });
  });
});

describe('sanitizeFreedomPositions', () => {
  it('keeps only normalized USD balance and position fields', () => {
    const result = sanitizeFreedomPositions({
      data: { result: { ps: {
        loaded: true,
        key: 'private-account-key',
        acc: [
          { curr: 'USD', s: -17053.5, currval: 80.54, forecast_in: 1, forecast_out: 2, t2_in: 3, t2_out: 4, sql_exec_tm: 'timestamp', secret: 'remove' },
          { curr: 'AED', s: 22.09 }
        ],
        pos: [
          { i: 'GOOGL.US', name: 'Alphabet', q: 81, curr: 'USD', mkt_price: 321.09, market_value: 26001, bal_price_a: 338.01, profit_close: -1212.39, acc_pos_id: 159573060, instr_id: 123, issue_nb: 'secret', sql_exec_tm: 'timestamp' },
          { i: 'AED.STOCK', q: 1, curr: 'AED' }
        ]
      } } }
    });

    expect(result.data.result.ps.acc).toEqual([{
      curr: 'USD', s: -17053.5, currval: 80.54,
      forecast_in: 1, forecast_out: 2, t2_in: 3, t2_out: 4
    }]);
    expect(result.data.result.ps.pos).toEqual([{
      i: 'GOOGL.US', name: 'Alphabet', q: 81, curr: 'USD',
      mkt_price: 321.09, market_value: 26001,
      bal_price_a: 338.01, profit_close: -1212.39, acc_pos_id: 159573060
    }]);
    expect(JSON.stringify(result)).not.toContain('private-account-key');
    expect(JSON.stringify(result)).not.toContain('instr_id');
    expect(JSON.stringify(result)).not.toContain('issue_nb');
  });

  it.each([
    ['result.ps envelope', { result: { ps: { loaded: true, acc: [], pos: [] } } }],
    ['direct ps envelope', { ps: { loaded: 'true', acc: [], pos: [] } }],
    ['positions without loaded flag', { result: { ps: { acc: [], pos: [] } } }]
  ])('accepts %s', (_label, input) => {
    const result = sanitizeFreedomPositions(input);
    expect(result.data.result.ps.loaded).toBe(true);
    expect(result.data.result.ps.acc).toEqual([]);
    expect(result.data.result.ps.pos).toEqual([]);
  });

  it('rejects unloaded or malformed positions data', () => {
    expect(() => sanitizeFreedomPositions({ data: { result: { ps: { loaded: false } } } })).toThrow();
    expect(() => sanitizeFreedomPositions({})).toThrow();
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

  it('allows an origin configured through the environment and never returns a wildcard', async () => {
    const appOrigin = 'https://portfolio.example.test';
    const response = await worker.fetch(
      new Request('https://worker.test/?action=state', {
        headers: { Origin: appOrigin, 'X-App-Auth': 'test-secret' }
      }),
      {
        GATEWAY_SECRET: 'test-secret',
        ALLOWED_ORIGINS: appOrigin,
        PORTFOLIO_STATE_DO: {
          idFromName: vi.fn().mockReturnValue('personal-state'),
          get: vi.fn().mockReturnValue({
            fetch: vi.fn(async (request) => {
              if (new URL(request.url).pathname === '/api/auth/verify') {
                return new Response(JSON.stringify({ user: { id: 'admin-id', role: 'admin', name: 'Admin' } }), {
                  status: 200, headers: { 'Content-Type': 'application/json' }
                });
              }
              return new Response(JSON.stringify({ encryptedPayload: 'ciphertext' }), {
                status: 200, headers: { ETag: '"4"' }
              });
            })
          })
        }
      }
    );

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(appOrigin);
    expect(response.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    expect(response.headers.get('ETag')).toBe('"4"');
  });

  it('rejects browser origins outside the configured personal-app allowlist', async () => {
    const response = await worker.fetch(
      new Request('https://worker.test/?action=state', {
        headers: { Origin: 'https://untrusted.example', 'X-App-Auth': 'test-secret' }
      }),
      { GATEWAY_SECRET: 'test-secret', ALLOWED_ORIGINS: 'https://portfolio.example.test' }
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


describe('Freedom quote endpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the documented getStockQuotesJson command and tickers array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      quotes: [{
        c: 'GOOGL.US',
        ltp: '279.84',
        pp: '274.00',
        chg: '5.84',
        pcp: '2.1314',
        ltt: 1793450000
      }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.test/?action=freedom-quote&symbol=GOOGL.US', {
        headers: { 'X-App-Auth': 'test-secret' }
      }),
      {
        GATEWAY_SECRET: 'test-secret',
        FREEDOM_PUBLIC_KEY: 'public-key',
        FREEDOM_PRIVATE_KEY: 'private-key'
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'Freedom TradeNet',
      symbol: 'GOOGL.US',
      data: {
        quotes: [{ c: 'GOOGL.US', ltp: '279.84', pp: '274.00', chg: '5.84', pcp: '2.1314' }]
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0];
    expect(String(upstreamUrl)).toBe('https://tradernet.com/api/getStockQuotesJson');
    expect(upstreamInit.method).toBe('POST');
    expect(JSON.parse(upstreamInit.body)).toEqual({
      cmd: 'getStockQuotesJson',
      params: { tickers: ['GOOGL.US'] }
    });
  });
});

describe('Freedom news fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to Finnhub when the TradeNet news endpoint returns HTTP 404', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { headline: 'Alphabet earnings update', url: 'https://example.com/news', datetime: 1790000000 }
      ]), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(
      new Request('https://worker.test/?action=freedom-news&symbol=GOOGL.US', {
        headers: { 'X-App-Auth': 'test-secret' }
      }),
      {
        GATEWAY_SECRET: 'test-secret',
        FREEDOM_PUBLIC_KEY: 'public-key',
        FREEDOM_PRIVATE_KEY: 'private-key',
        FINNHUB_KEY: 'finnhub-key'
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'Finnhub fallback (TradeNet news unavailable)',
      symbol: 'GOOGL.US',
      data: [{ headline: 'Alphabet earnings update' }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('symbol=GOOGL');
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


  it('stores independent server-synced digests for portfolio and ticker keys', async () => {
    const store = makeDurableObject();
    const digest = {
      key: 'position:GOOGL',
      title: 'GOOGL · Position Review',
      scope: 'position',
      ticker: 'GOOGL',
      analysis: '**Stance** Hold.',
      articles: [{ ticker: 'GOOGL', headline: 'Example', source: 'Test', url: 'https://example.com' }],
      syncedAt: '2026-10-28T05:00:00.000Z'
    };
    const write = await store.fetch(new Request('https://worker.test/api/margin-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify(digest)
    }));
    expect(write.status).toBe(200);
    expect(write.headers.get('ETag')).toBe('"1"');

    const read = await store.fetch(new Request('https://worker.test/api/margin-digest?key=position%3AGOOGL'));
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual(digest);
    expect(read.headers.get('ETag')).toBe('"1"');

    const missing = await store.fetch(new Request('https://worker.test/api/margin-digest?key=portfolio'));
    expect(missing.status).toBe(404);
  });

  it('rejects invalid margin digest keys and stale writes', async () => {
    const store = makeDurableObject();
    const invalid = await store.fetch(new Request('https://worker.test/api/margin-digest?key=bad%2Fkey'));
    expect(invalid.status).toBe(400);

    const digest = { key: 'portfolio', title: 'Portfolio Review', scope: 'portfolio', analysis: 'Review', articles: [], syncedAt: '2026-10-28T05:00:00.000Z' };
    const first = await store.fetch(new Request('https://worker.test/api/margin-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify(digest)
    }));
    expect(first.status).toBe(200);
    const stale = await store.fetch(new Request('https://worker.test/api/margin-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body: JSON.stringify(digest)
    }));
    expect(stale.status).toBe(409);
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
      body: JSON.stringify({ encryptedPayload: 'x'.repeat(20 * 1024 * 1024) })
    }));
    expect(oversized.status).toBe(413);
  });

  it('rejects chunked oversized cloud writes without Content-Length', async () => {
    const store = makeDurableObject();
    const chunk = new Uint8Array(1024 * 1024);
    let chunksSent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (chunksSent === 21) {
          controller.close();
          return;
        }
        chunksSent += 1;
        controller.enqueue(chunk);
      }
    });
    const response = await store.fetch(new Request('https://worker.test/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'If-Match': '"0"' },
      body,
      duplex: 'half'
    }));

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Cloud state payload exceeds the 20 MB limit.' });
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

    // Let the request reach the upstream fetch before advancing its timeout.
    // The worker performs async request parsing before starting the Gemini attempt.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 1000 });
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await responsePromise;

    expect(firstSignal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  }, 15_000);

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
      body: JSON.stringify({ encryptedPayload: 'x'.repeat(20 * 1024 * 1024) })
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

 
describe('Freedom cashflows Worker action', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the documented getUserCashFlows command and returns cashflows as JSON with CORS headers', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ cashflows: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-cashflows', {
      headers: { 'X-App-Auth': 'test-secret', Origin: 'https://app.test' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      ALLOWED_ORIGINS: 'https://app.test',
      FREEDOM_PUBLIC_KEY: 'public-test-key',
      FREEDOM_PRIVATE_KEY: 'private-test-key'
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test');
    expect(await response.json()).toMatchObject({
      ok: true,
      provider: 'Freedom TradeNet',
      data: { cashflows: [] }
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0];
    expect(upstreamUrl).toBe('https://tradernet.com/api/getUserCashFlows');
    expect(upstreamInit.method).toBe('POST');
    expect(JSON.parse(upstreamInit.body)).toEqual({
      cmd: 'getUserCashFlows',
      params: {}
    });
  });
});


describe('gateway authentication and request contract', () => {

  it('allows the exact local Vite origin for initial admin bootstrap', async () => {
    const forwarded = [];
    const response = await worker.fetch(new Request('https://worker.test/api/auth/bootstrap', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Primary Admin',
        password: 'a-long-password-123',
        bootstrapSecret: 'test-gateway-secret'
      })
    }), {
      GATEWAY_SECRET: 'test-gateway-secret',
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue('portfolio_state'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn(async (request) => {
            forwarded.push(request);
            return new Response(JSON.stringify({ token: 'session-token' }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' }
            });
          })
        })
      }
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(await response.json()).toEqual({ token: 'session-token' });
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].headers.get('X-Bootstrap-Authorized')).toBe('true');
    expect(forwarded[0].headers.get('X-Workspace-Encryption-Key')).toBe('test-gateway-secret');
    expect(await forwarded[0].json()).toEqual({
      name: 'Primary Admin',
      password: 'a-long-password-123'
    });
  });

  it('returns a CORS-readable diagnostic when the account Durable Object throws', async () => {
    const response = await worker.fetch(new Request('https://worker.test/api/auth/bootstrap', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Primary Admin',
        password: 'a-long-password-123',
        bootstrapSecret: 'test-gateway-secret'
      })
    }), {
      GATEWAY_SECRET: 'test-gateway-secret',
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue('portfolio_state'),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockRejectedValue(new Error('Durable Object unavailable'))
        })
      }
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(await response.json()).toEqual({
      error: 'Account service unavailable. Check the Cloudflare Worker logs.'
    });
  });


  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['missing credential', {}],
    ['incorrect app credential', { 'X-App-Auth': 'wrong-secret' }],
    ['incorrect bearer credential', { Authorization: 'Bearer wrong-secret' }]
  ])('rejects %s before invoking an upstream provider', async (_label, headers) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=provider-quote&provider=finnhub&symbol=AAPL', {
      headers
    }), {
      GATEWAY_SECRET: 'expected-secret',
      FINNHUB_KEY: 'provider-key'
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized gateway access.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported methods before proxying', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=quote&symbol=AAPL', {
      method: 'PUT',
      headers: { 'X-App-Auth': 'expected-secret' }
    }), { GATEWAY_SECRET: 'expected-secret' });

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ error: 'Method not allowed.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unknown actions after gateway authentication', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=unknown-action', {
      headers: { 'X-App-Auth': 'expected-secret' }
    }), { GATEWAY_SECRET: 'expected-secret' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported action.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('gateway input bounds', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects invalid provider symbols before making upstream requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=provider-quote&provider=finnhub&symbol=%3Cscript%3E', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FINNHUB_KEY: 'provider-key'
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Invalid symbol list.') });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects declared oversized request bodies before provider access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=provider-quote&provider=finnhub&symbol=AAPL', {
      headers: {
        'X-App-Auth': 'test-secret',
        'Content-Length': String(20 * 1024 * 1024 + 1)
      }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FINNHUB_KEY: 'provider-key'
    });

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('streamed request body limits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects a chunked oversized POST even when Content-Length is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const chunk = new Uint8Array(1024 * 1024);
    let chunksSent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (chunksSent === 21) {
          controller.close();
          return;
        }
        chunksSent += 1;
        controller.enqueue(chunk);
      }
    });
    const request = new Request('https://worker.test/?action=gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Auth': 'test-secret' },
      body,
      duplex: 'half'
    });

    const response = await worker.fetch(request, { GATEWAY_SECRET: 'test-secret' });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'Request body exceeds the 20 MB limit.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('authenticate before consuming request bodies', () => {
  it('rejects unauthenticated POSTs without reading their body stream', async () => {
    let reads = 0;
    const body = new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new TextEncoder().encode('{"prompt":"sensitive"}'));
      }
    }, { highWaterMark: 0 });
    const request = new Request('https://worker.test/?action=gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      duplex: 'half'
    });

    const response = await worker.fetch(request, { GATEWAY_SECRET: 'expected-secret' });

    expect(response.status).toBe(401);
    expect(reads).toBe(0);
  });

  it('rejects authenticated POSTs to GET-only actions before reading their body stream', async () => {
    let reads = 0;
    const body = new ReadableStream({
      pull(controller) {
        reads += 1;
        controller.enqueue(new TextEncoder().encode('{"unused":true}'));
      }
    }, { highWaterMark: 0 });
    const request = new Request('https://worker.test/?action=provider-quote&provider=finnhub&symbol=AAPL', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-App-Auth': 'expected-secret' },
      body,
      duplex: 'half'
    });

    const response = await worker.fetch(request, { GATEWAY_SECRET: 'expected-secret' });

    expect(response.status).toBe(405);
    expect(reads).toBe(0);
  });
});


describe('Gateway compatibility during account migration', () => {
  it('accepts the existing Gateway credential only until the first account is bootstrapped', async () => {
    let setupRequired = true;
    const doStub = {
      fetch: vi.fn(async (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/api/auth/status") {
          return new Response(JSON.stringify({ setupRequired }), { status: 200 });
        }
        if (path === "/api/auth/verify") {
          return new Response(JSON.stringify({ error: "No account session" }), { status: 401 });
        }
        return new Response(JSON.stringify({ encryptedPayload: "existing-ciphertext" }), {
          status: 200,
          headers: { ETag: '"1"' }
        });
      })
    };
    const env = {
      GATEWAY_SECRET: "legacy-test-secret",
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue("portfolio_state"),
        get: vi.fn().mockReturnValue(doStub)
      }
    };
    const legacyRequest = () => new Request("https://worker.test/?action=state", {
      headers: { "X-App-Auth": "legacy-test-secret" }
    });

    const beforeBootstrap = await worker.fetch(legacyRequest(), env);
    expect(beforeBootstrap.status).toBe(200);
    expect(await beforeBootstrap.json()).toEqual({ encryptedPayload: "existing-ciphertext" });

    setupRequired = false;
    const afterBootstrap = await worker.fetch(legacyRequest(), env);
    expect(afterBootstrap.status).toBe(401);
  });
});



describe('guest data isolation at the Worker boundary', () => {
  it('denies guest access to shared portfolio state and account-wide broker reads', async () => {
    const stateStub = {
      fetch: vi.fn(async (request) => {
        if (new URL(request.url).pathname === '/api/auth/verify') {
          return new Response(JSON.stringify({ user: { id: 'guest-1', role: 'guest' } }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          });
        }
        throw new Error('Protected request reached the state service.');
      })
    };
    const env = {
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue('portfolio-state'),
        get: vi.fn().mockReturnValue(stateStub)
      }
    };
    const headers = { 'X-App-Auth': 'guest-session-token', Authorization: 'Bearer guest-session-token' };

    const stateResponse = await worker.fetch(new Request('https://worker.test/api/state', { headers }), env);
    const historyResponse = await worker.fetch(new Request('https://worker.test/api/history', { headers }), env);
    const tradesResponse = await worker.fetch(new Request('https://worker.test/?action=freedom-trades', { headers }), env);
    const positionsResponse = await worker.fetch(new Request('https://worker.test/?action=freedom-positions', { headers }), env);
    const marketDepthResponse = await worker.fetch(new Request('https://worker.test/?action=freedom-market-depth&symbol=GOOGL', { headers }), env);

    expect(stateResponse.status).toBe(403);
    expect(historyResponse.status).toBe(403);
    expect(tradesResponse.status).toBe(403);
    expect(positionsResponse.status).toBe(403);
    expect(marketDepthResponse.status).toBe(403);
    await expect(marketDepthResponse.json()).resolves.toMatchObject({
      error: 'This data is restricted to administrator accounts.'
    });
    expect(stateStub.fetch).toHaveBeenCalledTimes(5);
    expect(stateStub.fetch.mock.calls.every(([request]) => new URL(request.url).pathname === '/api/auth/verify')).toBe(true);
  });

  it('routes the guest endpoint without exposing the shared-state route', async () => {
    const stateStub = {
      fetch: vi.fn(async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/api/auth/verify') {
          return new Response(JSON.stringify({ user: { id: 'guest-1', role: 'guest' } }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          });
        }
        if (pathname === '/api/guest-portfolio') {
          return new Response(JSON.stringify({ snapshot: { updatedAt: 10, tranches: [] }, revision: 2 }), {
            status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
          });
        }
        throw new Error('Unexpected Durable Object path: ' + pathname);
      })
    };
    const response = await worker.fetch(new Request('https://worker.test/api/guest-portfolio', {
      headers: { 'X-App-Auth': 'guest-session-token', Authorization: 'Bearer guest-session-token' }
    }), {
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue('portfolio-state'),
        get: vi.fn().mockReturnValue(stateStub)
      }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      snapshot: { updatedAt: 10, tranches: [] },
      revision: 2
    });
    expect(stateStub.fetch.mock.calls.map(([request]) => new URL(request.url).pathname)).toEqual([
      '/api/auth/verify', '/api/guest-portfolio'
    ]);
  });
});

describe('Durable Object guest portfolio ownership', () => {
  async function makeScopedStore() {
    const values = new Map();
    const storage = {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
      list: async ({ prefix }) => new Map([...values.entries()].filter(([key]) => key.startsWith(prefix))),
      transaction: async (callback) => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key)
      })
    };
    const users = [
      { id: 'admin-1', name: 'Admin', role: 'admin' },
      { id: 'guest-1', name: 'Guest One', role: 'guest' },
      { id: 'guest-2', name: 'Guest Two', role: 'guest' }
    ];
    values.set('auth:users', users);
    values.set('auth:cloud-encryption-key', 'workspace-secret');
    const issueTestSession = async (token, userId) => {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
      const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      values.set('auth:session:' + hex, { userId, expiresAt: Date.now() + 60_000 });
    };
    await issueTestSession('admin-token', 'admin-1');
    await issueTestSession('guest-one-token', 'guest-1');
    await issueTestSession('guest-two-token', 'guest-2');
    return { store: new PortfolioStateDO({ storage }, {}), values };
  }

  const authHeaders = (token, extra = {}) => ({
    'Content-Type': 'application/json',
    'X-App-Auth': token,
    Authorization: 'Bearer ' + token,
    ...extra
  });

  it('lets admins publish a projection and binds guest reads to the active session', async () => {
    const { store, values } = await makeScopedStore();
    const write = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        guestId: 'guest-1',
        snapshot: {
          updatedAt: 20,
          tranches: [{
            id: 'AAPL:buy-1', ticker: 'aapl', name: 'Apple', quantity: 2.5,
            averagePrice: 100, marketPrice: 120, unexpected: 'must-not-persist'
          }]
        }
      })
    }));
    expect(write.status).toBe(200);
    expect(write.headers.get('ETag')).toBe('"1"');
    const storedProjection = values.get('guest-portfolio:guest-1');
    expect(storedProjection.encryptedSnapshot).toMatch(/^aesgcm:v1:/);
    expect(storedProjection.snapshot).toBeUndefined();

    const guestOne = await store.fetch(new Request('https://store.test/api/guest-portfolio?guestId=guest-2', {
      headers: authHeaders('guest-one-token')
    }));
    expect(guestOne.status).toBe(200);
    const guestOneBody = await guestOne.json();
    expect(guestOneBody.snapshot.tranches).toEqual([{
      id: 'AAPL:buy-1', ticker: 'AAPL', name: 'Apple', quantity: 2.5,
      averagePrice: 100, marketPrice: 120, marketValue: 300, purchasedAt: null
    }]);
    expect(JSON.stringify(guestOneBody)).not.toContain('unexpected');

    const guestTwo = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-two-token')
    }));
    await expect(guestTwo.json()).resolves.toMatchObject({ snapshot: { updatedAt: 0, tranches: [] } });
  });

  it('publishes multiple guest projections in one atomic batch request', async () => {
    const { store, values } = await makeScopedStore();
    const response = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        snapshots: [
          {
            guestId: 'guest-1',
            snapshot: {
              updatedAt: 20,
              tranches: [{
                id: 'AAPL:buy-1', ticker: 'aapl', name: 'Apple', quantity: 2.5,
                averagePrice: 100, marketPrice: 120, unexpected: 'must-not-persist'
              }]
            }
          },
          {
            guestId: 'guest-2',
            snapshot: { updatedAt: 30, tranches: [] }
          }
        ]
      })
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      revisions: { 'guest-1': 1, 'guest-2': 1 }
    });
    expect(values.get('guest-portfolio:guest-1').encryptedSnapshot).toMatch(/^aesgcm:v1:/);
    expect(values.get('guest-portfolio:guest-2').encryptedSnapshot).toMatch(/^aesgcm:v1:/);

    const guestOne = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(guestOne.json()).resolves.toMatchObject({
      snapshot: {
        updatedAt: 20,
        tranches: [{ id: 'AAPL:buy-1', ticker: 'AAPL', quantity: 2.5, marketValue: 300 }]
      }
    });
    const guestTwo = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-two-token')
    }));
    await expect(guestTwo.json()).resolves.toMatchObject({
      snapshot: { updatedAt: 30, tranches: [] }
    });
  });

  it('rejects an invalid guest batch without partially writing any projection', async () => {
    const { store, values } = await makeScopedStore();
    const response = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        snapshots: [
          { guestId: 'guest-1', snapshot: { updatedAt: 20, tranches: [] } },
          { guestId: 'not-a-guest', snapshot: { updatedAt: 30, tranches: [] } }
        ]
      })
    }));
    expect(response.status).toBe(404);
    expect(values.has('guest-portfolio:guest-1')).toBe(false);
    expect(values.has('guest-portfolio:guest-2')).toBe(false);
  });

  it('rejects guest writes, cross-guest reads, and guest access to the workspace key', async () => {
    const { store } = await makeScopedStore();
    const guestWrite = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('guest-one-token'),
      body: JSON.stringify({ guestId: 'guest-2', snapshot: { updatedAt: 1, tranches: [] } })
    }));
    const cloudKey = await store.fetch(new Request('https://store.test/api/auth/cloud-key', {
      headers: authHeaders('guest-one-token')
    }));
    const adminRead = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('admin-token')
    }));
    expect(guestWrite.status).toBe(403);
    expect(cloudKey.status).toBe(403);
    expect(adminRead.status).toBe(403);
  });

  it('persists an encrypted per-guest tranche ledger and keeps it scoped to that guest', async () => {
    const { store, values } = await makeScopedStore();
    const assignment = {
      assignmentId: 'assignment-aapl-1',
      trancheId: 'AAPL:buy-1',
      ticker: 'AAPL',
      name: 'Apple',
      assignedQuantity: 3,
      openQuantity: 3,
      averagePrice: 100,
      marketPrice: 120,
      purchasedAt: 10,
      assignedAt: 20,
      updatedAt: 30,
      endedAt: null,
      status: 'active'
    };
    const write = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        snapshots: [{
          guestId: 'guest-1',
          snapshot: {
            updatedAt: 30,
            tranches: [{
              id: 'AAPL:buy-1', ticker: 'AAPL', name: 'Apple', quantity: 3,
              averagePrice: 100, marketPrice: 120, purchasedAt: 10
            }]
          },
          ledgerUpserts: [assignment],
          retainedAssignmentIds: ['assignment-aapl-1']
        }]
      })
    }));
    expect(write.status).toBe(200);
    const stored = values.get('guest-portfolio:guest-1');
    expect(stored.encryptedLedger).toMatch(/^aesgcm:v1:/);
    expect(stored.ledger).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain('assignment-aapl-1');

    const guestOne = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(guestOne.json()).resolves.toMatchObject({
      ledger: [{
        assignmentId: 'assignment-aapl-1',
        trancheId: 'AAPL:buy-1',
        assignedQuantity: 3,
        openQuantity: 3,
        marketValue: 360,
        status: 'active'
      }]
    });

    const guestTwo = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-two-token')
    }));
    await expect(guestTwo.json()).resolves.toMatchObject({ ledger: [] });
  });

  it('updates open shares, marks sold tranches closed, and preserves assignment history', async () => {
    const { store } = await makeScopedStore();
    const publish = async (openQuantity, retainedAssignmentIds, ledgerUpserts = []) => store.fetch(
      new Request('https://store.test/api/guest-portfolio', {
        method: 'POST',
        headers: authHeaders('admin-token'),
        body: JSON.stringify({
          snapshots: [{
            guestId: 'guest-1',
            snapshot: { updatedAt: 40, tranches: [] },
            ledgerUpserts,
            retainedAssignmentIds
          }]
        })
      })
    );
    const base = {
      assignmentId: 'assignment-msft-1',
      trancheId: 'MSFT:buy-1',
      ticker: 'MSFT',
      name: 'Microsoft',
      assignedQuantity: 4,
      openQuantity: 4,
      averagePrice: 100,
      marketPrice: 110,
      purchasedAt: 5,
      assignedAt: 10,
      updatedAt: 20,
      endedAt: null,
      status: 'active'
    };
    await expect(publish(4, [base.assignmentId], [base])).resolves.toMatchObject({ status: 200 });
    await expect(publish(1.5, [base.assignmentId], [{
      ...base, openQuantity: 1.5, marketPrice: 120, updatedAt: 30
    }])).resolves.toMatchObject({ status: 200 });

    const partial = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(partial.json()).resolves.toMatchObject({
      ledger: [{
        assignedQuantity: 4,
        openQuantity: 1.5,
        marketValue: 180,
        status: 'active'
      }]
    });

    await expect(publish(0, [base.assignmentId])).resolves.toMatchObject({ status: 200 });
    const closed = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(closed.json()).resolves.toMatchObject({
      ledger: [{
        assignmentId: base.assignmentId,
        assignedQuantity: 4,
        openQuantity: 0,
        marketValue: null,
        status: 'closed',
        endedAt: 40
      }]
    });

    await expect(publish(0, [])).resolves.toMatchObject({ status: 200 });
    const afterUnassign = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(afterUnassign.json()).resolves.toMatchObject({
      ledger: [{ status: 'closed', openQuantity: 0 }]
    });
  });

  it('marks a still-open tranche unassigned when the guest link is removed', async () => {
    const { store } = await makeScopedStore();
    const record = {
      assignmentId: 'assignment-nvda-1', trancheId: 'NVDA:buy-1', ticker: 'NVDA', name: 'NVIDIA',
      assignedQuantity: 5, openQuantity: 5, averagePrice: 100, marketPrice: 120,
      purchasedAt: 10, assignedAt: 20, updatedAt: 30, endedAt: null, status: 'active'
    };
    const publish = (retainedAssignmentIds) => store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        snapshots: [{
          guestId: 'guest-1',
          snapshot: { updatedAt: 40, tranches: [] },
          ledgerUpserts: retainedAssignmentIds.length ? [record] : [],
          retainedAssignmentIds
        }]
      })
    }));
    expect((await publish([record.assignmentId])).status).toBe(200);
    expect((await publish([])).status).toBe(200);

    const guestRead = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(guestRead.json()).resolves.toMatchObject({
      ledger: [{
        assignmentId: record.assignmentId,
        assignedQuantity: 5,
        openQuantity: 0,
        marketValue: null,
        status: 'unassigned',
        endedAt: 40
      }]
    });
  });

  it('keeps an existing ledger when a legacy client only posts the live snapshot', async () => {
    const { store } = await makeScopedStore();
    const record = {
      assignmentId: 'assignment-tsla-1', trancheId: 'TSLA:buy-1', ticker: 'TSLA', name: 'Tesla',
      assignedQuantity: 2, openQuantity: 2, averagePrice: 200, marketPrice: 210,
      purchasedAt: 10, assignedAt: 20, updatedAt: 30, endedAt: null, status: 'active'
    };
    await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        guestId: 'guest-1',
        snapshot: { updatedAt: 30, tranches: [] },
        ledgerUpserts: [record],
        retainedAssignmentIds: [record.assignmentId]
      })
    }));
    const legacyWrite = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        guestId: 'guest-1',
        snapshot: { updatedAt: 40, tranches: [] }
      })
    }));
    expect(legacyWrite.status).toBe(200);

    const guestRead = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(guestRead.json()).resolves.toMatchObject({
      ledger: [{ assignmentId: record.assignmentId, status: 'active', openQuantity: 2 }]
    });
  });

  it('rejects malformed tranche ledger records before writing', async () => {
    const { store, values } = await makeScopedStore();
    const response = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        snapshots: [{
          guestId: 'guest-1',
          snapshot: { updatedAt: 20, tranches: [] },
          ledgerUpserts: [{
            assignmentId: 'bad', trancheId: 'AAPL:buy-1', ticker: 'AAPL',
            assignedQuantity: 2, openQuantity: -1, assignedAt: 10, updatedAt: 20, status: 'active'
          }],
          retainedAssignmentIds: ['bad']
        }]
      })
    }));
    expect(response.status).toBe(400);
    expect(values.has('guest-portfolio:guest-1')).toBe(false);
  });

  it('rejects malformed projections and nonexistent guest targets', async () => {
    const { store } = await makeScopedStore();
    const invalid = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        guestId: 'guest-1',
        snapshot: { updatedAt: 1, tranches: [{ id: 'bad', ticker: 'AAPL', quantity: -2 }] }
      })
    }));
    const missing = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({ guestId: 'not-a-guest', snapshot: { updatedAt: 1, tranches: [] } })
    }));
    expect(invalid.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});


describe('sanitizeFreedomMarketDepth', () => {
  it('normalizes and sorts the initial full TradeNet order-book snapshot', () => {
    const result = sanitizeFreedomMarketDepth({
      dom: [{ i: 'AAPL.US', min_step: 0.01, cnt: 3, n: 19, ins: [
        { p: 101.2, s: 'S', q: 5, k: 0 }, { p: 100.9, s: 'B', q: 8, k: 1 },
        { p: 101.1, s: 'S', q: 7, k: 2 }, { p: 100.8, s: 'B', q: 2, k: 3 },
        { p: 0, s: 'B', q: 100, k: 4 }, { p: 101, s: 'X', q: 1, k: 5 }
      ] }]
    }, 'AAPL.US');
    expect(result).toMatchObject({
      symbol: 'AAPL.US', depth: 3, minPriceStep: 0.01, sequence: 19,
      bids: [{ price: 100.9, quantity: 8, position: 1 }, { price: 100.8, quantity: 2, position: 3 }],
      asks: [{ price: 101.1, quantity: 7, position: 2 }, { price: 101.2, quantity: 5, position: 0 }]
    });
    expect(JSON.stringify(result)).not.toContain('"side"');
  });
  it('rejects another ticker and an empty order book', () => {
    expect(() => sanitizeFreedomMarketDepth({ dom: [{ i: 'MSFT.US', ins: [] }] }, 'AAPL.US')).toThrow();
    expect(() => sanitizeFreedomMarketDepth({ dom: [{ i: 'AAPL.US', ins: [] }] }, 'AAPL.US')).toThrow();
  });
  it('accepts the production WebSocket snapshot shape', () => {
    const result = sanitizeFreedomMarketDepth({
      i: 'AAPL.US', n: 21, cnt: 2,
      ins: [
        { p: 100.5, s: 'B', q: 12, k: 0 },
        { p: 100.7, s: 'S', q: 9, k: 0 }
      ]
    }, 'AAPL.US');
    expect(result).toMatchObject({
      symbol: 'AAPL.US', sequence: 21, depth: 2,
      bids: [{ price: 100.5, quantity: 12, position: 0 }],
      asks: [{ price: 100.7, quantity: 9, position: 0 }]
    });
  });
});



describe('Freedom market-depth proxy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function createMockWebSocket() {
    return class MockWebSocket extends EventTarget {
      static instances = [];
      constructor(url) {
        super();
        this.url = url;
        this.sent = [];
        this.closed = false;
        MockWebSocket.instances.push(this);
      }
      send(data) {
        this.sent.push(data);
      }
      close() {
        this.closed = true;
      }
      emit(type, properties = {}) {
        const event = new Event(type);
        for (const [key, value] of Object.entries(properties)) {
          Object.defineProperty(event, key, { configurable: true, value });
        }
        this.dispatchEvent(event);
      }
    };
  }

  it('reports connection, session, event and timeout diagnostics without exposing the SID', async () => {
    vi.useFakeTimers();
    const MockWebSocket = createMockWebSocket();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = fetchFreedomMarketDepthWithSid('GOOGL', { sid: 'sensitive-sid-value-123456' });
    const socket = MockWebSocket.instances[0];

    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify(['userData', {
        isDemo: false, mode: 'prod', authLogin: 'private-login@example.test'
      }])
    });
    socket.emit('message', { data: JSON.stringify(['markets', { m: [] }]) });
    socket.emit('message', { data: JSON.stringify(['q', { c: 'GOOGL', l: 100 }]) });
    socket.emit('message', { data: JSON.stringify(['b', { i: 'GOOGL.US', n: 1, cnt: 0, ins: [] }]) });
    socket.emit('message', { data: 'not-json' });

    const rejected = expect(pending).rejects.toMatchObject({
      status: 504,
      diagnostics: expect.objectContaining({
        requestedSymbol: 'GOOGL',
        phase: 'snapshot_timeout',
        connectionOpened: true,
        subscriptionSent: true,
        subscriptionConfirmed: false,
        userDataReceived: true,
        isDemo: false,
        sessionMode: 'prod',
        messageCount: 5,
        parseErrorCount: 1,
        eventsReceived: ['userData', 'markets', 'q', 'b'],
        eventCounts: { userData: 1, markets: 1, q: 1, b: 1 },
        quoteSubscriptionSent: true,
        quoteEventsReceived: 1,
        quoteSymbolsReceived: ['GOOGL'],
        orderBookEventsReceived: 1,
        orderBookSymbolsReceived: ['GOOGL.US'],
        unmatchedOrderBooks: 1
      })
    });
    await vi.advanceTimersByTimeAsync(10001);
    await rejected;

    expect(JSON.parse(socket.sent[0])).toEqual(['orderBook', ['GOOGL']]);
    const logged = log.mock.calls.map(([value]) => String(value)).join('\n');
    expect(logged).not.toContain('sensitive-sid-value');
    expect(logged).not.toContain('private-login@example.test');
  });

  it('returns a matching production order-book snapshot and diagnostics', async () => {
    const MockWebSocket = createMockWebSocket();
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const pending = fetchFreedomMarketDepthWithSid('GOOGL.US', { sid: 'sensitive-sid-value-123456' });
    const socket = MockWebSocket.instances[0];

    socket.emit('open');
    socket.emit('message', {
      data: JSON.stringify(['userData', { isDemo: false, mode: 'prod' }])
    });
    socket.emit('message', {
      data: JSON.stringify(['b', {
        i: 'GOOGL.US', n: 7, cnt: 2,
        ins: [
          { p: 200, s: 'B', q: 10, k: 0 },
          { p: 200.1, s: 'S', q: 8, k: 0 }
        ]
      }])
    });

    const result = await pending;
    expect(result.data).toMatchObject({
      symbol: 'GOOGL.US',
      sequence: 7,
      bids: [{ price: 200, quantity: 10 }],
      asks: [{ price: 200.1, quantity: 8 }]
    });
    expect(result.diagnostics).toMatchObject({
      phase: 'snapshot_received',
      connectionOpened: true,
      subscriptionSent: true,
      subscriptionConfirmed: true,
      userDataReceived: true,
      isDemo: false,
      sessionMode: 'prod',
      eventsReceived: ['userData', 'b'],
      orderBookEventsReceived: 1,
      orderBookSymbolsReceived: ['GOOGL.US']
    });
  });

  it('does not open a WebSocket when TradeNet session storage is missing', async () => {
    const WebSocketMock = vi.fn();
    vi.stubGlobal('WebSocket', WebSocketMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-market-depth&symbol=AAPL.US', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), { GATEWAY_SECRET: 'test-secret' });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('session storage') });
    expect(WebSocketMock).not.toHaveBeenCalled();
  });
});


describe('TradeNet SID session storage', () => {
  it('requires Worker-only authorization and persists the SID inside the Durable Object', async () => {
    const values = new Map();
    const storage = {
      get: async key => values.get(key),
      put: async (key, value) => { values.set(key, value); },
      delete: async key => values.delete(key)
    };
    const store = new PortfolioStateDO({ storage }, { GATEWAY_SECRET: 'worker-internal-secret' });
    const url = 'https://store.test/internal/freedom-session';
    const unauthorized = await store.fetch(new Request(url));
    expect(unauthorized.status).toBe(401);

    const stored = await store.fetch(new Request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Worker-Auth': 'worker-internal-secret'
      },
      body: JSON.stringify({
        sid: 'sensitive-sid-value-123456',
        expiresAt: Date.now() + 60_000,
        real: true
      })
    }));
    expect(stored.status).toBe(200);
    const read = await store.fetch(new Request(url, {
      headers: { 'X-Internal-Worker-Auth': 'worker-internal-secret' }
    }));
    expect((await read.json()).session.sid).toBe('sensitive-sid-value-123456');
    expect(values.size).toBe(1);
  });

  it('authenticates once using authByLogin and reuses a valid persisted real-account SID', async () => {
    let persisted = null;
    const internalStub = {
      fetch: vi.fn(async request => {
        if (request.method === 'GET') {
          return persisted
            ? new Response(JSON.stringify({ session: persisted }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            : new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        persisted = await request.json();
        return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      })
    };
    const env = {
      GATEWAY_SECRET: 'worker-internal-secret',
      FREEDOM_LOGIN: 'account@example.test',
      FREEDOM_PASSWORD: 'test-password',
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue('portfolio_state'),
        get: vi.fn().mockReturnValue(internalStub)
      }
    };
    const fetchMock = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://tradernet.am/api/');
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const requestBody = new URLSearchParams(init.body);
      const query = JSON.parse(requestBody.get('q'));
      expect(query).toEqual({
        cmd: 'authByLogin',
        params: {
          login: 'account@example.test',
          password: 'test-password',
          rememberMe: 1,
          getAccounts: false
        }
      });
      return new Response(JSON.stringify({
        success: true, logged: true, SID: 'sensitive-sid-value-123456',
        real: true, userId: 12345
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await ensureFreedomTradeNetSession(env);
    const second = await ensureFreedomTradeNetSession(env);
    expect(first).toMatchObject({ authenticated: true, real: true, refreshed: true });
    expect(second).toMatchObject({ authenticated: true, real: true, refreshed: false });
    expect(first).not.toHaveProperty('sid');
    expect(JSON.stringify(first)).not.toContain('sensitive-sid-value');
    expect(persisted).toMatchObject({ sid: 'sensitive-sid-value-123456', real: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects demo login results and does not persist a demo SID', async () => {
    let persisted = null;
    const internalStub = {
      fetch: vi.fn(async request => {
        if (request.method === 'GET') return new Response('{}', { status: 404 });
        persisted = await request.json();
        return new Response('{}', { status: 200 });
      })
    };
    const env = {
      GATEWAY_SECRET: 'worker-internal-secret',
      FREEDOM_LOGIN: 'account@example.test',
      FREEDOM_PASSWORD: 'test-password',
      PORTFOLIO_STATE_DO: { idFromName: () => 'portfolio_state', get: () => internalStub }
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: true, logged: true, SID: 'demo-sid-value-123456', real: false
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(ensureFreedomTradeNetSession(env)).rejects.toThrow('demo or non-production');
    expect(persisted).toBeNull();
  });
});
