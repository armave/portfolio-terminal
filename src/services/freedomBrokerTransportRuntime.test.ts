import { describe, expect, it, vi } from 'vitest';
import { createFreedomBrokerTransportRuntime } from './freedomBrokerTransportRuntime';
import { normalizeFreedomPortfolio } from './freedomAccountContracts';

function createRuntime(options: { token?: string; now?: () => number; resolve?: (action: string, params: unknown, init: unknown) => unknown } = {}) {
  const proxyFetch = vi.fn((action?: string, params?: unknown, init?: unknown) =>
    Promise.resolve(options.resolve?.(action || '', params, init) ?? { action, params })
  );
  const recordMetric = vi.fn();
  const runtime = createFreedomBrokerTransportRuntime({
    proxyFetch: proxyFetch as never,
    getActiveGatewaySecret: () => options.token ?? 'token-A',
    recordMetric,
    now: options.now
  });
  return { runtime, proxyFetch, recordMetric };
}

describe('Freedom broker transport runtime', () => {
  it('routes the remaining read-only broker endpoints without changing their query contracts', async () => {
    const { runtime, proxyFetch } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot'
        ? { ok: true, source: 'authenticated_websocket', data: { result: { ps: { loaded: true, acc: [], pos: [] } } } }
        : action === 'freedom-orders-stream'
          ? { ok: true, data: { orders: { order: [] } } }
          : undefined
    });
    await runtime.testFreedomTradeNetEventStream('markets');
    await runtime.fetchFreedomTradeNetPositions();
    await runtime.fetchFreedomTradeNetTrades(' 2026-01-02 ');
    await runtime.fetchFreedomTradeNetActiveOrders();
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-event-stream', 'freedom-portfolio-snapshot', 'freedom-trades', 'freedom-orders-stream'
    ]);
    expect(proxyFetch.mock.calls[0][1]).toEqual({ event: 'markets' });
    expect(proxyFetch.mock.calls[0][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[1][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[2][1]).toEqual({ fromDate: '2026-01-02' });
    expect(proxyFetch.mock.calls[2][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[3][2]).toEqual({ cache: 'no-store' });
  });

  it('uses the authenticated portfolio WebSocket as primary and returns the normalizer envelope', async () => {
    const data = {
      result: {
        ps: {
          loaded: true,
          acc: [{ curr: 'USD', s: -22299.41, currval: 80.9734 }],
          pos: [{ i: 'GOOGL.US', q: 106, curr: 'USD', mkt_price: 280.49 }]
        }
      }
    };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot'
        ? { ok: true, source: 'authenticated_websocket', data }
        : undefined
    });

    const response = { ok: true, source: 'authenticated_websocket', data };
    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(response);
    expect(normalizeFreedomPortfolio(response)).toMatchObject({
      loaded: true,
      balances: [{ currency: 'USD', amount: -22299.41 }],
      positions: [{ ticker: 'GOOGL.US', quantity: 106, marketPrice: 280.49 }]
    });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith('freedom-portfolio-snapshot', undefined, { cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('broker_portfolio_source', {
      source: 'websocket_snapshot',
      account_count: 1,
      position_count: 1
    });
  });

  it('reuses the initial portfolio WebSocket snapshot without recurring REST backups', async () => {
    const websocket = {
      ok: true,
      source: 'authenticated_websocket',
      data: { result: { ps: { loaded: true, acc: [], pos: [] } } }
    };
    const rest = { ok: true, data: { result: { ps: { loaded: true, acc: [], pos: [] } } } };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot' ? websocket : action === 'freedom-positions' ? rest : undefined
    });

    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(websocket);
    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(websocket);
    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(websocket);

    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-portfolio-snapshot'
    ]);
    expect(recordMetric).toHaveBeenCalledWith('stream_snapshot_cache_hit', {
      operation: 'freedom_portfolio'
    });
  });

  it('falls back to getPositionJson when the WebSocket portfolio snapshot is unavailable or incomplete', async () => {
    const rest = { data: { result: { ps: { loaded: true, acc: [], pos: [] } } } };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot'
        ? { ok: false, error: 'socket timed out' }
        : action === 'freedom-positions' ? rest : undefined
    });

    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(rest);
    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(rest);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-portfolio-snapshot', 'freedom-positions'
    ]);
    expect(proxyFetch.mock.calls.every(([, , options]) =>
      (options as { cache?: string } | undefined)?.cache === 'no-store'
    )).toBe(true);
    expect(recordMetric).toHaveBeenCalledWith('provider_fallback', {
      operation: 'freedom_portfolio',
      from: 'websocket_snapshot',
      to: 'rest'
    });
    expect(recordMetric).toHaveBeenCalledWith('stream_snapshot_cache_hit', {
      operation: 'freedom_portfolio'
    });
  });

  it('falls back when a successful WebSocket response is missing a loaded USD snapshot envelope', async () => {
    const rest = { data: { result: { ps: { loaded: true, acc: [], pos: [] } } } };
    const { runtime, proxyFetch } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot'
        ? { ok: true, source: 'authenticated_websocket', data: { result: { ps: { loaded: false, acc: [], pos: [] } } } }
        : action === 'freedom-positions' ? rest : undefined
    });

    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(rest);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-portfolio-snapshot', 'freedom-positions'
    ]);
  });

  it('rejects probes for account events already delivered by the persistent app stream', async () => {
    const { runtime, proxyFetch } = createRuntime();
    await expect(runtime.testFreedomTradeNetEventStream('portfolio' as never))
      .rejects.toThrow('Only the not-yet-integrated markets event can be probed.');
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it('uses the REST active-orders fallback only once when the initial WebSocket snapshot fails', async () => {
    const restSnapshot = { orders: { order: [{ order_id: 'rest-1', instr: 'GOOGL.US' }] } };
    const proxyFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'WebSocket snapshot timed out.' })
      .mockResolvedValue(restSnapshot);
    const recordMetric = vi.fn();
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A',
      recordMetric
    });

    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(restSnapshot);
    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(restSnapshot);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-orders-stream', 'freedom-orders'
    ]);
    expect(proxyFetch.mock.calls[0][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls.slice(1).every(([action, params, options]) =>
      action === 'freedom-orders' &&
      (params as { active_only?: number } | undefined)?.active_only === 1 &&
      (options as { cache?: string } | undefined)?.cache === 'no-store'
    )).toBe(true);
    expect(recordMetric).toHaveBeenCalledWith('provider_fallback', {
      operation: 'freedom_active_orders',
      from: 'websocket_snapshot',
      to: 'rest'
    });
    expect(recordMetric).toHaveBeenCalledWith('stream_snapshot_cache_hit', {
      operation: 'freedom_active_orders'
    });
  });

  it('reuses the initial active-orders WebSocket snapshot without recurring REST backups', async () => {
    const websocket = { ok: true, data: { orders: { order: [] } } };
    const rest = { orders: { order: [{ order_id: 'rest-order', instr: 'GOOGL.US' }] } };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-orders-stream' ? websocket : action === 'freedom-orders' ? rest : undefined
    });

    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(websocket.data);
    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(websocket.data);
    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(websocket.data);

    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-orders-stream'
    ]);
    expect(recordMetric).toHaveBeenCalledWith('stream_snapshot_cache_hit', {
      operation: 'freedom_active_orders'
    });
  });

  it('returns the sanitized WebSocket order snapshot for the existing normalizer', async () => {
    const data = { orders: { order: [{
      order_id: 'active-1', instr: 'GOOGL.US', oper: 3, type: 4,
      p: 335, q: 68, leaves_qty: 68, stat: '10'
    }] } };
    const proxyFetch = vi.fn().mockResolvedValue({ ok: true, data });
    const recordMetric = vi.fn();
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A',
      recordMetric
    });

    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(data);
    expect(proxyFetch).toHaveBeenCalledWith('freedom-orders-stream', undefined, { cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('broker_orders_source', {
      source: 'websocket_snapshot',
      order_count: 1
    });
  });

  it('uses a valid empty WebSocket order snapshot without treating it as a failure', async () => {
    const emptySnapshot = { ok: true, data: { orders: { order: [] } } };
    const proxyFetch = vi.fn().mockResolvedValue(emptySnapshot);
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A'
    });

    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(emptySnapshot.data);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith('freedom-orders-stream', undefined, { cache: 'no-store' });
  });

  it('requests a q stream once per ticker and coalesces concurrent requests', async () => {
    let resolveQuote!: (value: unknown) => void;
    const proxyFetch = vi.fn(() => new Promise((resolve) => { resolveQuote = resolve; }));
    const recordMetric = vi.fn();
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A',
      recordMetric
    });

    const first = runtime.fetchFreedomTradeNetQuoteStreamOnce('googl.us');
    const concurrent = runtime.fetchFreedomTradeNetQuoteStreamOnce('GOOGL');
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(proxyFetch).toHaveBeenCalledWith(
      'freedom-quote-stream',
      { symbol: 'GOOGL.US' },
      { cache: 'no-store' }
    );
    const quote = { ok: true, source: 'authenticated_websocket', symbol: 'GOOGL.US' };
    resolveQuote(quote);
    await expect(Promise.all([first, concurrent])).resolves.toEqual([quote, quote]);

    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('GOOGL.US')).resolves.toEqual(quote);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(recordMetric).toHaveBeenCalledWith('stream_snapshot_cache_hit', {
      operation: 'freedom_quote'
    });
  });

  it('does not retry a failed first q snapshot on the next quote refresh', async () => {
    const proxyFetch = vi.fn().mockRejectedValueOnce(new Error('429 rate limited'));
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A'
    });

    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('AAPL')).rejects.toThrow('429 rate limited');
    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('AAPL')).rejects.toThrow('429 rate limited');
    expect(proxyFetch).toHaveBeenCalledTimes(1);
  });

  it('resets one-shot stream guards when the credential changes or request caches are cleared', async () => {
    let secret = 'token-A';
    const proxyFetch = vi.fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 })
      .mockResolvedValueOnce({ version: 3 });
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => secret
    });

    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('AAPL')).resolves.toEqual({ version: 1 });
    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('AAPL')).resolves.toEqual({ version: 1 });
    secret = 'token-B';
    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('AAPL')).resolves.toEqual({ version: 2 });
    runtime.clearFreedomStreamSnapshotCache();
    await expect(runtime.fetchFreedomTradeNetQuoteStreamOnce('AAPL')).resolves.toEqual({ version: 3 });
    expect(proxyFetch).toHaveBeenCalledTimes(3);
  });

  it('caches cashflows by token and normalized date range for five minutes', async () => {
    let now = 100;
    let version = 0;
    const { runtime, proxyFetch } = createRuntime({
      now: () => now,
      resolve: () => ({ version: ++version })
    });
    await expect(runtime.fetchFreedomCashflows(' 2026-01-01 ')).resolves.toEqual({ version: 1 });
    await expect(runtime.fetchFreedomCashflows('2026-01-01')).resolves.toEqual({ version: 1 });
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    now += 5 * 60 * 1000 + 1;
    await expect(runtime.fetchFreedomCashflows('2026-01-01')).resolves.toEqual({ version: 2 });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps cashflow cache entries isolated by active credential and date range', async () => {
    let token = 'token-A';
    let version = 0;
    const proxyFetch = vi.fn(async () => ({ version: ++version }));
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => token
    });
    await runtime.fetchFreedomCashflows('2026-01-01');
    token = 'token-B';
    await runtime.fetchFreedomCashflows('2026-01-01');
    await runtime.fetchFreedomCashflows('2026-01-02');
    expect(proxyFetch).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent cashflow reads and reports dedup metrics', async () => {
    let resolve!: (value: unknown) => void;
    const proxyFetch = vi.fn(() => new Promise((done) => { resolve = done; }));
    const recordMetric = vi.fn();
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A',
      recordMetric
    });
    const first = runtime.fetchFreedomCashflows('2026-01-01');
    const second = runtime.fetchFreedomCashflows('2026-01-01');
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(recordMetric).toHaveBeenCalledWith('inflight_dedup', { operation: 'freedom_cashflows' });
    resolve({ rows: [] });
    await expect(Promise.all([first, second])).resolves.toEqual([{ rows: [] }, { rows: [] }]);
  });

  it('does not cache failures and allows a subsequent retry', async () => {
    const proxyFetch = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ rows: ['recovered'] });
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A'
    });
    await expect(runtime.fetchFreedomCashflows()).rejects.toThrow('temporary');
    await expect(runtime.fetchFreedomCashflows()).resolves.toEqual({ rows: ['recovered'] });
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

  it('clears snapshots and pending request references on reset', async () => {
    let version = 0;
    const { runtime, proxyFetch } = createRuntime({ resolve: () => ({ version: ++version }) });
    await runtime.fetchFreedomCashflows();
    runtime.clearFreedomCashflowCache();
    await runtime.fetchFreedomCashflows();
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });
});
