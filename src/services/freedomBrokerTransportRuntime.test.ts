import { describe, expect, it, vi } from 'vitest';
import { createFreedomBrokerTransportRuntime } from './freedomBrokerTransportRuntime';

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
  it('routes diagnostic and trade-history endpoints without changing their query contracts', async () => {
    const { runtime, proxyFetch } = createRuntime();
    await runtime.testFreedomTradeNetConnection();
    await runtime.fetchFreedomTradeNetTrades(' 2026-01-02 ');
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-test', 'freedom-trades'
    ]);
    expect(proxyFetch.mock.calls[1][1]).toEqual({ fromDate: '2026-01-02' });
    expect(proxyFetch.mock.calls[1][2]).toEqual({ cache: 'no-store' });
  });

  it('uses the authenticated portfolio WebSocket snapshot as the primary account source', async () => {
    const portfolio = {
      loaded: true,
      acc: [{ curr: 'USD', s: 1200 }],
      pos: [{ i: 'GOOGL.US', q: 4 }]
    };
    const snapshot = {
      ok: true,
      source: 'authenticated_websocket',
      data: { result: { ps: portfolio } }
    };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot' ? snapshot : undefined
    });
    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(snapshot.data);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual(['freedom-portfolio-snapshot']);
    expect(proxyFetch.mock.calls[0][2]).toEqual({ cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('broker_portfolio_source', {
      source: 'websocket_snapshot',
      account_count: 1,
      position_count: 1
    });
  });

  it('falls back to the existing REST positions endpoint for a failed or incomplete WebSocket snapshot', async () => {
    const restSnapshot = { ok: true, data: { result: { ps: { loaded: true, acc: [], pos: [] } } } };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-portfolio-snapshot'
        ? { ok: false, error: 'TradeNet login failed or requested additional verification.' }
        : restSnapshot
    });
    await expect(runtime.fetchFreedomTradeNetPositions()).resolves.toEqual(restSnapshot);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-portfolio-snapshot', 'freedom-positions'
    ]);
    expect(proxyFetch.mock.calls[1][2]).toEqual({ cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('provider_fallback', {
      operation: 'freedom_portfolio',
      from: 'websocket_snapshot',
      to: 'rest'
    });
  });

  it('uses the authenticated orders WebSocket snapshot as the primary active-orders source, including empty snapshots', async () => {
    const snapshot = { ok: true, data: { orders: { order: [] } } };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-orders-stream' ? snapshot : undefined
    });
    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(snapshot.data);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual(['freedom-orders-stream']);
    expect(proxyFetch.mock.calls[0][2]).toEqual({ cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('broker_orders_source', {
      source: 'websocket_snapshot',
      order_count: 0
    });
  });

  it('falls back to REST active orders when the authenticated orders WebSocket is unavailable', async () => {
    const restOrders = { ok: true, data: { orders: { order: [{ order_id: '17' }] } } };
    const { runtime, proxyFetch, recordMetric } = createRuntime({
      resolve: (action) => action === 'freedom-orders-stream'
        ? { ok: false, error: 'TradeNet authentication failed.' }
        : restOrders
    });
    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(restOrders);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-orders-stream', 'freedom-orders'
    ]);
    expect(proxyFetch.mock.calls[1][1]).toEqual({ active_only: 1 });
    expect(proxyFetch.mock.calls[1][2]).toEqual({ cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('provider_fallback', {
      operation: 'freedom_active_orders',
      from: 'websocket_snapshot',
      to: 'rest'
    });
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
