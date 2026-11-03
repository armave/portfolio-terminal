import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { fetchWithTimeout, normalizeMarketState, sanitizeFreedomPositions, sanitizeFreedomActiveOrders } from './worker.js';
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
    expect(requestBody).toEqual({ active_only: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://tradernet.com/api/getNotifyOrderJson');
  });
});

describe('Freedom authenticated orders WebSocket diagnostic', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the SID-authenticated socket and returns a sanitized orders snapshot plus preview', async () => {
    const listeners = new Map();
    const socket = {
      addEventListener: vi.fn((name, callback) => {
        const callbacks = listeners.get(name) || [];
        callbacks.push(callback);
        listeners.set(name, callbacks);
      }),
      accept: vi.fn(),
      send: vi.fn((message) => {
        expect(JSON.parse(message)).toEqual(['orders']);
        queueMicrotask(() => {
          for (const callback of listeners.get('message') || []) {
            callback({ data: JSON.stringify(['userData', { isDemo: false, mode: 'prod', account: 'private-account' }]) });
            callback({ data: JSON.stringify(['orders', [{ id: 77, instr: 'GOOGL.US', oper: 3, type: 2, p: 353, q: 2, leaves_qty: 2, stat: 'active', account: 'private-account' }]]) });
          }
        });
      }),
      close: vi.fn()
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, logged: true, SID: 's'.repeat(48), real: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce({ status: 101, headers: new Headers(), webSocket: socket });
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-orders-stream', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_LOGIN: 'broker-login',
      FREEDOM_PASSWORD: 'broker-password'
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      provider: 'Freedom TradeNet',
      diagnostics: {
        handshakeResponseReceived: true,
        handshakeStatus: 101,
        connectionOpened: true,
        ordersSubscriptionSent: true,
        userDataReceived: true,
        isDemo: false,
        sessionMode: 'prod',
        ordersEventReceived: true,
        phase: 'orders_event_received'
      }
    });
    expect(body.diagnostics).toMatchObject({
      ordersPayloadType: 'array',
      ordersPayloadItemKeys: ['id', 'instr', 'leaves_qty', 'oper', 'p', 'q', 'stat', 'type'],
      ordersPreviewCount: 1,
      ordersPreview: [{
        instr: 'GOOGL.US', oper: 3, type: 2, p: 353, q: 2, leaves_qty: 2, stat: 'active'
      }]
    });
    expect(body.data.orders.order).toEqual([{
      order_id: '77', instr: 'GOOGL.US', oper: 3, type: 2,
      p: 353, q: 2, leaves_qty: 2, stat: 'active'
    }]);
    expect(JSON.stringify(body)).not.toContain('private-account');
    expect(body.diagnostics.ordersPreview[0]).not.toHaveProperty('order_id');
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^https:\/\/wss\.tradernet\.com\//);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('SID')).toBe('s'.repeat(48));
    expect(socket.close).toHaveBeenCalled();
  });

  it('does not expose broker credentials or attempt a socket when login secrets are missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-orders-stream', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), { GATEWAY_SECRET: 'test-secret' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: 'FREEDOM_LOGIN and FREEDOM_PASSWORD must be configured as Worker secrets.',
      diagnostics: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Freedom authenticated portfolio and market WebSocket event diagnostics', () => {
  afterEach(() => vi.unstubAllGlobals());

  function makeEventSocket(expectedEvent, payload, userData = { mode: 'prod' }) {
    const listeners = new Map();
    const socket = {
      addEventListener: vi.fn((name, callback) => {
        const callbacks = listeners.get(name) || [];
        callbacks.push(callback);
        listeners.set(name, callbacks);
      }),
      accept: vi.fn(),
      send: vi.fn((message) => {
        expect(JSON.parse(message)).toEqual([expectedEvent]);
        queueMicrotask(() => {
          for (const callback of listeners.get('message') || []) {
            callback({ data: JSON.stringify(['userData', userData]) });
            callback({ data: JSON.stringify([expectedEvent, payload]) });
          }
        });
      }),
      close: vi.fn()
    };
    return socket;
  }

  async function runEventDiagnostic(eventName, payload, userData) {
    const socket = makeEventSocket(eventName, payload, userData);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, logged: true, SID: 's'.repeat(48), real: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce({ status: 101, headers: new Headers(), webSocket: socket });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request(
      'https://worker.test/?action=freedom-event-stream&event=' + eventName,
      { headers: { 'X-App-Auth': 'test-secret' } }
    ), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_LOGIN: 'broker-login',
      FREEDOM_PASSWORD: 'broker-password'
    });
    return { response, socket, fetchMock };
  }

  it('reports the full observed portfolio field schema without returning financial values or identifiers', async () => {
    const portfolio = {
      acc_srv_tm: '2026-11-03T09:00:00',
      loaded: true,
      m_id: 17,
      acc: [{
        curr: 'USD', currval: 1000, forecast_in: 10, forecast_out: 20,
        k: 1, s: 970, sql_exec_tm: '0.01', t: 2, t2_in: 3, t2_out: 4
      }],
      pos: [{
        Yield: 1, acc_pos_id: 99, accruedint_a: 2, acd: 3, bal_price_a: 4,
        base_contract_code: 'USD', base_currency: 'USD', close_price: 5,
        curr: 'USD', currval: 6, face_val_a: 7, fv: 8, go: 9, i: 'GOOGL.US',
        instr_id: 10, issue_nb: 'issue', k: 11, ltr: 'letter', market_value: 12,
        mkt_id: 13, mkt_price: 14, name: 'Google', name2: 'Alphabet',
        open_bal: 15, profit_close: 16, q: 17, s: 18, t: 19, vm: 20,
        owner_login: 'private-login'
      }],
      owner_login: 'private-login'
    };
    const { response, socket, fetchMock } = await runEventDiagnostic('portfolio', portfolio);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      event: 'portfolio',
      data: {
        event: 'portfolio',
        payloadType: 'object',
        topLevelKeys: ['acc', 'acc_srv_tm', 'loaded', 'm_id', 'owner_login', 'pos'],
        topLevelFieldTypes: {
          acc: { type: 'array', length: 1, item: { type: 'object' } },
          acc_srv_tm: 'string',
          loaded: 'boolean',
          m_id: 'number',
          pos: { type: 'array', length: 1, item: { type: 'object' } }
        },
        accountsCount: 1,
        accountItemKeys: ['curr', 'currval', 'forecast_in', 'forecast_out', 'k', 's', 'sql_exec_tm', 't', 't2_in', 't2_out'],
        accountItemTypes: {
          curr: 'string', currval: 'number', forecast_in: 'number', forecast_out: 'number',
          k: 'number', s: 'number', sql_exec_tm: 'string', t: 'number', t2_in: 'number', t2_out: 'number'
        },
        positionsCount: 1,
        positionItemKeys: [
          'Yield', 'acc_pos_id', 'accruedint_a', 'acd', 'bal_price_a', 'base_contract_code',
          'base_currency', 'close_price', 'curr', 'currval', 'face_val_a', 'fv', 'go',
          'i', 'instr_id', 'issue_nb', 'k', 'ltr', 'market_value', 'mkt_id', 'mkt_price',
          'name', 'name2', 'open_bal', 'profit_close', 'q', 's', 't', 'vm'
        ],
        positionItemTypes: {
          Yield: 'number', acc_pos_id: 'number', acd: 'number', accruedint_a: 'number',
          bal_price_a: 'number', base_contract_code: 'string', base_currency: 'string',
          close_price: 'number', curr: 'string', currval: 'number', face_val_a: 'number',
          fv: 'number', go: 'number', i: 'string', instr_id: 'number', issue_nb: 'string',
          k: 'number', ltr: 'string', market_value: 'number', mkt_id: 'number',
          mkt_price: 'number', name: 'string', name2: 'string', open_bal: 'number',
          profit_close: 'number', q: 'number', s: 'number', t: 'number', vm: 'number'
        }
      },
      diagnostics: {
        requestedEvent: 'portfolio',
        handshakeStatus: 101,
        connectionOpened: true,
        subscriptionSent: true,
        userDataReceived: true,
        sessionMode: 'prod',
        eventReceived: true,
        phase: 'event_received'
      }
    });
    const serialized = JSON.stringify(body);
    for (const secret of ['private-login', 'GOOGL.US', 'Google', 'Alphabet', '1000', '970', '293.94', '"issue"', 'letter']) {
      expect(serialized).not.toContain(secret);
    }
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/^https:\/\/wss\.tradernet\.com\//);
    expect(socket.close).toHaveBeenCalled();
  });

  it('reports all observed market metadata types without returning market names, schedules, or statuses', async () => {
    const { response, socket } = await runEventDiagnostic('markets', {
      t: '2026-11-03 09:00:00',
      m: [{
        c: '16:00', date: Array(12).fill('redacted'), dt: -420,
        ev: Array(8).fill('redacted'), mkt_id: 1, n: 'NASDAQ', n2: 'NASDAQ',
        o: '09:30', p: 'pre', post: 'post', s: 'OPEN', tz: 'America/New_York'
      }]
    }, { isDemo: false, mode: 'prod' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      event: 'markets',
      data: {
        event: 'markets',
        payloadType: 'object',
        topLevelKeys: ['m', 't'],
        topLevelFieldTypes: {
          m: { type: 'array', length: 1, item: { type: 'object' } },
          t: 'string'
        },
        marketsCount: 1,
        marketItemKeys: ['c', 'date', 'dt', 'ev', 'mkt_id', 'n', 'n2', 'o', 'p', 'post', 's', 'tz'],
        marketItemTypes: {
          c: 'string',
          date: { type: 'array', length: 12, item: 'string' },
          dt: 'number',
          ev: { type: 'array', length: 8, item: 'string' },
          mkt_id: 'number',
          n: 'string', n2: 'string', o: 'string', p: 'string',
          post: 'string', s: 'string', tz: 'string'
        }
      }
    });
    const serialized = JSON.stringify(body);
    for (const secret of ['NASDAQ', 'OPEN', '09:30', '16:00', 'America/New_York', 'redacted']) {
      expect(serialized).not.toContain(secret);
    }
    expect(socket.close).toHaveBeenCalled();
  });

  it('returns a sanitized USD portfolio snapshot for read-only REST reconciliation', async () => {
    const payload = {
      loaded: true,
      acc_srv_tm: '2026-11-03T09:00:00',
      m_id: 77,
      acc: [
        { curr: 'USD', s: 10000, currval: 10020, forecast_in: 50, forecast_out: 10, t2_in: 20, t2_out: 5, login: 'private-user' },
        { curr: 'EUR', s: 900, currval: 910 }
      ],
      pos: [
        { i: 'GOOGL.US', name: 'Google', q: 31, curr: 'USD', mkt_price: 300, market_value: 9300, bal_price_a: 280, profit_close: 620, acc_pos_id: 12, account_id: 'private-account' },
        { i: 'DUMMY.EU', q: 10, curr: 'EUR', mkt_price: 50, market_value: 500 }
      ]
    };
    const socket = makeEventSocket('portfolio', payload);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, logged: true, SID: 's'.repeat(48), real: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce({ status: 101, headers: new Headers(), webSocket: socket });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request(
      'https://worker.test/?action=freedom-portfolio-snapshot',
      { headers: { 'X-App-Auth': 'test-secret' } }
    ), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_LOGIN: 'broker-login',
      FREEDOM_PASSWORD: 'broker-password'
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      source: 'authenticated_websocket',
      data: {
        result: {
          ps: {
            loaded: true,
            acc: [{
              curr: 'USD', s: 10000, currval: 10020,
              forecast_in: 50, forecast_out: 10, t2_in: 20, t2_out: 5
            }],
            pos: [{
              i: 'GOOGL.US', name: 'Google', q: 31, curr: 'USD',
              mkt_price: 300, market_value: 9300, bal_price_a: 280,
              profit_close: 620, acc_pos_id: 12
            }]
          }
        }
      }
    });
    expect(body.data.result.ps.acc).toHaveLength(1);
    expect(body.data.result.ps.pos).toHaveLength(1);
    const serialized = JSON.stringify(body);
    for (const secret of ['private-user', 'private-account', 'DUMMY.EU', 'EUR', 'acc_srv_tm', 'm_id', 'SID']) {
      expect(serialized).not.toContain(secret);
    }
    expect(socket.close).toHaveBeenCalled();
  });

  it('rejects an unloaded portfolio WebSocket event instead of fabricating a loaded snapshot', async () => {
    const socket = makeEventSocket('portfolio', {
      loaded: false,
      acc: [{ curr: 'USD', s: 100 }],
      pos: []
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true, logged: true, SID: 's'.repeat(48), real: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce({ status: 101, headers: new Headers(), webSocket: socket });
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request(
      'https://worker.test/?action=freedom-portfolio-snapshot',
      { headers: { 'X-App-Auth': 'test-secret' } }
    ), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_LOGIN: 'broker-login',
      FREEDOM_PASSWORD: 'broker-password'
    });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('not fully loaded');
    expect(body).not.toHaveProperty('data');
    expect(socket.close).toHaveBeenCalled();
  });

  it('rejects event names outside the read-only allowlist before login or socket access', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request(
      'https://worker.test/?action=freedom-event-stream&event=orders',
      { headers: { 'X-App-Auth': 'test-secret' } }
    ), { GATEWAY_SECRET: 'test-secret' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Unsupported TradeNet stream event. Allowed events: portfolio, markets.'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sanitizeFreedomActiveOrders', () => {
  it('accepts the top-level array used by the authenticated WebSocket orders event', () => {
    const result = sanitizeFreedomActiveOrders([
      { id: 77, instr: 'GOOGL.US', oper: 3, type: 2, p: 353, q: 50, leaves_qty: 12, stat: 'active', account: 'private' }
    ]);
    expect(result.orders.order).toEqual([
      { order_id: '77', instr: 'GOOGL.US', oper: 3, type: 2, p: 353, q: 50, leaves_qty: 12, stat: 'active' }
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
  });

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
      q: [{
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
        q: [{ c: 'GOOGL.US', ltp: '279.84', pp: '274.00', chg: '5.84', pcp: '2.1314' }]
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0];
    expect(String(upstreamUrl)).toBe('https://tradernet.com/api/getStockQuotesJson');
    expect(upstreamInit.method).toBe('POST');
    expect(JSON.parse(upstreamInit.body)).toEqual({ tickers: ['GOOGL.US'] });
    const timestamp = upstreamInit.headers['X-NtApi-Timestamp'];
    expect(upstreamInit.headers['X-NtApi-Sig']).toBe(
      createHmac('sha256', 'private-key').update(upstreamInit.body + timestamp).digest('hex')
    );
  });
});

describe('Freedom trades Worker action', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the complete TradeNet history without the latest-100 cap', async () => {
    const fullHistory = {
      trades: {
        max_trade_id: [{ '@text': '900003' }],
        trade: [
          { id: '100001', instr_nm: 'META.US', type: '1', q: '14', p: '310', date: '2026-09-01T10:00:00' },
          { id: '900002', instr_nm: 'META.US', type: '2', q: '3', p: '620', date: '2026-10-29T10:00:00', profit: '930' }
        ]
      }
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(fullHistory), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-trades', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_PUBLIC_KEY: 'public-key',
      FREEDOM_PRIVATE_KEY: 'private-key'
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      provider: 'Freedom TradeNet',
      data: {
        trades: {
          trade: [
            expect.objectContaining({ id: '100001' }),
            expect.objectContaining({ id: '900002' })
          ]
        }
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [upstreamUrl, upstreamInit] = fetchMock.mock.calls[0];
    expect(String(upstreamUrl)).toBe('https://tradernet.com/api/getTradesHistory');
    expect(upstreamInit.method).toBe('POST');
    expect(JSON.parse(upstreamInit.body)).toEqual({ sort: 0 });
  });

  it('requests only executions on or after a validated date through now', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ trades: { trade: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-trades&fromDate=2026-10-29', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_PUBLIC_KEY: 'public-key',
      FREEDOM_PRIVATE_KEY: 'private-key'
    });

    expect(response.status).toBe(200);
    const [, upstreamInit] = fetchMock.mock.calls[0];
    const params = JSON.parse(upstreamInit.body);
    expect(params).toMatchObject({ beginDate: '2026-10-29T00:00:00', sort: 0 });
    expect(params.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(params).not.toHaveProperty('max');
  });

  it('rejects malformed incremental trade dates before calling TradeNet', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-trades&fromDate=not-a-date', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), { GATEWAY_SECRET: 'test-secret', FREEDOM_PUBLIC_KEY: 'public-key', FREEDOM_PRIVATE_KEY: 'private-key' });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
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
      delete: async (key) => values.delete(key),
      transaction: async (callback) => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key)
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
      delete: async (key) => values.delete(key),
      transaction: async (callback) => callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, value),
        delete: async (key) => values.delete(key)
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
    expect(JSON.parse(upstreamInit.body)).toEqual({});
  });

  it('filters cashflows inclusively from a validated start date', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ cashflow: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-cashflows&fromDate=2026-10-29', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), {
      GATEWAY_SECRET: 'test-secret',
      FREEDOM_PUBLIC_KEY: 'public-test-key',
      FREEDOM_PRIVATE_KEY: 'private-test-key'
    });
    expect(response.status).toBe(200);
    const [, upstreamInit] = fetchMock.mock.calls[0];
    expect(JSON.parse(upstreamInit.body)).toEqual({
      filters: [{ field: 'date', operator: 'eqormore', value: '2026-10-29' }],
      sort: { field: 'date', dir: 'ASC' }
    });
  });

  it('rejects malformed incremental cashflow dates before calling TradeNet', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await worker.fetch(new Request('https://worker.test/?action=freedom-cashflows&fromDate=2026-02-30', {
      headers: { 'X-App-Auth': 'test-secret' }
    }), { GATEWAY_SECRET: 'test-secret', FREEDOM_PUBLIC_KEY: 'public-key', FREEDOM_PRIVATE_KEY: 'private-key' });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});


describe('Cloudflare authentication edge rate limiting', () => {
  const origin = 'https://portfolio.example.test';
  const clientIp = '203.0.113.42';

  function buildEnv({
    decision = { success: true },
    limiter = { limit: vi.fn(async () => decision) },
    required = 'true',
    doFetch = vi.fn(async () => new Response(JSON.stringify({ token: 'session-token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }))
  } = {}) {
    return {
      GATEWAY_SECRET: 'test-gateway-secret',
      ALLOWED_ORIGINS: origin,
      AUTH_EDGE_LIMITER_REQUIRED: required,
      AUTH_EDGE_RATE_LIMITER: limiter,
      PORTFOLIO_STATE_DO: {
        idFromName: vi.fn().mockReturnValue('portfolio_state'),
        get: vi.fn().mockReturnValue({ fetch: doFetch })
      },
      doFetch,
      limiter
    };
  }

  function authRequest(pathname, headers = {}, body = '{}') {
    return new Request(`https://worker.test${pathname}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': clientIp,
        ...headers
      },
      body
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('checks the Cloudflare-generated client address before forwarding a login request', async () => {
    const env = buildEnv();
    const response = await worker.fetch(authRequest('/api/auth/login', {
      'X-Forwarded-For': '198.51.100.200'
    }), env);

    expect(response.status).toBe(200);
    expect(env.limiter.limit).toHaveBeenCalledWith({
      key: `auth:/api/auth/login:${clientIp}`
    });
    expect(env.doFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects over-limit auth requests before the Durable Object and preserves retry/CORS headers', async () => {
    const env = buildEnv({ decision: { success: false } });
    const response = await worker.fetch(authRequest('/api/auth/login'), env);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: 'Too many authentication requests. Try again shortly.'
    });
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(env.doFetch).not.toHaveBeenCalled();
  });

  it('uses independent route keys for login and account/password mutations', async () => {
    const env = buildEnv();
    await worker.fetch(authRequest('/api/auth/login'), env);
    await worker.fetch(authRequest('/api/auth/me'), env);
    await worker.fetch(authRequest('/api/auth/users'), env);

    expect(env.limiter.limit.mock.calls.map(([argument]) => argument.key)).toEqual([
      `auth:/api/auth/login:${clientIp}`,
      `auth:/api/auth/me:${clientIp}`,
      `auth:/api/auth/users:${clientIp}`
    ]);
    expect(env.doFetch).toHaveBeenCalledTimes(3);
  });

  it('fails closed in production when the required binding is missing', async () => {
    const env = buildEnv({ limiter: undefined });
    delete env.AUTH_EDGE_RATE_LIMITER;
    const response = await worker.fetch(authRequest('/api/auth/login'), env);

    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(env.doFetch).not.toHaveBeenCalled();
  });

  it('fails closed in production when the edge limiter cannot make a decision', async () => {
    const env = buildEnv({
      limiter: { limit: vi.fn().mockRejectedValue(new Error('internal binding detail')) }
    });
    const response = await worker.fetch(authRequest('/api/auth/login'), env);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Authentication protection is temporarily unavailable.'
    });
    expect(env.doFetch).not.toHaveBeenCalled();
  });

  it('fails closed when a production request has no trusted Cloudflare client address', async () => {
    const env = buildEnv();
    const request = authRequest('/api/auth/login', {
      'CF-Connecting-IP': '',
      'X-Forwarded-For': clientIp
    });
    const response = await worker.fetch(request, env);

    expect(response.status).toBe(503);
    expect(env.limiter.limit).not.toHaveBeenCalled();
    expect(env.doFetch).not.toHaveBeenCalled();
  });

  it('does not rate-limit non-sensitive auth reads or non-auth routes', async () => {
    const env = buildEnv();
    const status = await worker.fetch(new Request('https://worker.test/api/auth/status', {
      headers: { Origin: origin }
    }), env);
    expect(status.status).toBe(200);
    expect(env.limiter.limit).not.toHaveBeenCalled();
  });

  it('allows development/unit-test mode to run without a configured edge binding', async () => {
    const env = buildEnv({ required: 'false', limiter: undefined });
    delete env.AUTH_EDGE_RATE_LIMITER;
    const response = await worker.fetch(authRequest('/api/auth/login'), env);

    expect(response.status).toBe(200);
    expect(env.doFetch).toHaveBeenCalledTimes(1);
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

    expect(stateResponse.status).toBe(403);
    expect(historyResponse.status).toBe(403);
    expect(tradesResponse.status).toBe(403);
    expect(positionsResponse.status).toBe(403);
    expect(stateStub.fetch).toHaveBeenCalledTimes(4);
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
      list: async ({ prefix = "", limit = Number.POSITIVE_INFINITY, startAfter } = {}) =>
        new Map([...values.entries()]
          .filter(([key]) => key.startsWith(prefix) && (typeof startAfter !== "string" || key > startAfter))
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .slice(0, limit)),
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
      const issuedAt = Date.now();
      values.set('auth:session:' + hex, {
        userId,
        issuedAt,
        expiresAt: issuedAt + 60_000
      });
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

  it('replaces the assigned quantity when a closed-trade LOTS row is edited', async () => {
    const { store } = await makeScopedStore();
    const publish = (assignedQuantity, updatedAt) => store.fetch(
      new Request('https://store.test/api/guest-portfolio', {
        method: 'POST',
        headers: authHeaders('admin-token'),
        body: JSON.stringify({
          snapshots: [{
            guestId: 'guest-1',
            snapshot: { updatedAt, tranches: [] },
            ledgerUpserts: [{
              assignmentId: 'closed-trade:row-a:guest-a',
              trancheId: 'closed-trade:row-a',
              ticker: 'AAPL',
              name: 'Apple',
              assignedQuantity,
              openQuantity: 0,
              averagePrice: null,
              marketPrice: null,
              purchasedAt: null,
              assignedAt: 10,
              updatedAt,
              endedAt: 10,
              status: 'closed'
            }],
            retainedAssignmentIds: []
          }]
        })
      })
    );

    expect((await publish(4, 20)).status).toBe(200);
    expect((await publish(2, 30)).status).toBe(200);
    const guestRead = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(guestRead.json()).resolves.toMatchObject({
      ledger: [{
        assignmentId: 'closed-trade:row-a:guest-a',
        assignedQuantity: 2,
        openQuantity: 0,
        status: 'closed'
      }]
    });
  });

  it('persists optional realized net P&L for closed-trade LOTS records', async () => {
    const { store } = await makeScopedStore();
    const response = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      method: 'POST',
      headers: authHeaders('admin-token'),
      body: JSON.stringify({
        snapshots: [{
          guestId: 'guest-1',
          snapshot: { updatedAt: 500, tranches: [] },
          ledgerUpserts: [{
            assignmentId: 'closed-trade:row-pnl:guest-1',
            trancheId: 'closed-trade:row-pnl',
            ticker: 'META',
            name: 'Meta',
            assignedQuantity: 3,
            openQuantity: 0,
            averagePrice: 450,
            netProfit: -75.5,
            marketPrice: null,
            operationAt: 1721000000000,
            value: 1350,
            purchasedAt: 1720000000000,
            assignedAt: 100,
            updatedAt: 500,
            endedAt: 100,
            status: 'closed'
          }],
          retainedAssignmentIds: []
        }]
      })
    }));
    expect(response.status).toBe(200);
    const guestRead = await store.fetch(new Request('https://store.test/api/guest-portfolio', {
      headers: authHeaders('guest-one-token')
    }));
    await expect(guestRead.json()).resolves.toMatchObject({
      ledger: [{
        assignmentId: 'closed-trade:row-pnl:guest-1',
        averagePrice: 450,
        netProfit: -75.5,
        operationAt: 1721000000000,
        value: 1350,
        purchasedAt: 1720000000000,
        status: 'closed'
      }]
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


describe('retired TradeNet session cleanup', () => {
  it('deletes the stored Market Depth SID once and records the migration', async () => {
    const values = new Map([['freedom:tradenet-session', {
      sid: 'sensitive-sid-value-123456',
      expiresAt: Date.now() + 60_000,
      real: true
    }]]);
    const storage = {
      get: vi.fn(async key => values.get(key)),
      put: vi.fn(async (key, value) => { values.set(key, value); }),
      delete: vi.fn(async key => values.delete(key))
    };
    const store = new PortfolioStateDO({ storage }, {});

    await store.clearRetiredTradeNetSession();
    expect(values.has('freedom:tradenet-session')).toBe(false);
    expect(values.get('migration:market-depth-session-cleanup')).toBe(true);

    await store.clearRetiredTradeNetSession();
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
});
