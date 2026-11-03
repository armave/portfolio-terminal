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
  it('routes read-only broker endpoints without changing their query contracts', async () => {
    const { runtime, proxyFetch } = createRuntime({
      resolve: (action) => action === 'freedom-orders-stream'
        ? { ok: true, data: { orders: { order: [] } } }
        : undefined
    });
    await runtime.testFreedomTradeNetConnection();
    await runtime.testFreedomTradeNetOrdersStream();
    await runtime.fetchFreedomTradeNetPositions();
    await runtime.fetchFreedomTradeNetTrades(' 2026-01-02 ');
    await runtime.fetchFreedomTradeNetActiveOrders();
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-test', 'freedom-orders-stream', 'freedom-positions', 'freedom-trades', 'freedom-orders-stream'
    ]);
    expect(proxyFetch.mock.calls[0][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[1][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[3][1]).toEqual({ fromDate: '2026-01-02' });
    expect(proxyFetch.mock.calls[3][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[4][2]).toEqual({ cache: 'no-store' });
  });

  it('falls back to the existing REST active-orders endpoint when the WebSocket snapshot fails', async () => {
    const restSnapshot = { orders: { order: [{ order_id: 'rest-1', instr: 'GOOGL.US' }] } };
    const proxyFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'WebSocket snapshot timed out.' })
      .mockResolvedValueOnce(restSnapshot);
    const recordMetric = vi.fn();
    const runtime = createFreedomBrokerTransportRuntime({
      proxyFetch: proxyFetch as never,
      getActiveGatewaySecret: () => 'token-A',
      recordMetric
    });

    await expect(runtime.fetchFreedomTradeNetActiveOrders()).resolves.toEqual(restSnapshot);
    expect(proxyFetch.mock.calls.map(([action]) => action)).toEqual([
      'freedom-orders-stream', 'freedom-orders'
    ]);
    expect(proxyFetch.mock.calls[0][2]).toEqual({ cache: 'no-store' });
    expect(proxyFetch.mock.calls[1][1]).toEqual({ active_only: 1 });
    expect(proxyFetch.mock.calls[1][2]).toEqual({ cache: 'no-store' });
    expect(recordMetric).toHaveBeenCalledWith('provider_fallback', {
      operation: 'freedom_active_orders',
      from: 'websocket_snapshot',
      to: 'rest'
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
