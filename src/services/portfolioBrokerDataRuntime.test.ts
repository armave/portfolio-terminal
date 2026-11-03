import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import type { FreedomPortfolioSnapshot } from './freedomAccountContracts';
import type { SessionIdentityToken } from '../utils/sessionIdentityGuard';
import {
  createPortfolioBrokerDataRuntime,
  type PortfolioBrokerDataRuntimeDependencies
} from './portfolioBrokerDataRuntime';
import {
  markFreedomAccountStreamSnapshot,
  resetFreedomAccountStreamHealth,
  setFreedomAccountStreamStatus
} from './freedomAccountStreamHealth';

afterEach(() => resetFreedomAccountStreamHealth());

function trade(
  id: string,
  side = 'sell',
  executedAt = '2026-10-28T12:00:00.000Z',
  extra: Partial<FreedomExecutedTrade> = {}
): FreedomExecutedTrade {
  return {
    id,
    ticker: 'AAPL',
    side,
    quantity: 1,
    price: 100,
    currency: 'USD',
    executedAt,
    tradeValue: 100,
    profit: 0,
    marginFee: null,
    commission: 0,
    commissionCurrency: 'USD',
    raw: {},
    ...extra
  };
}

function createFixture(overrides: Partial<PortfolioBrokerDataRuntimeDependencies> = {}) {
  const session: SessionIdentityToken = { identity: 'admin:1', generation: 1 };
  let current = true;
  let saved: FreedomExecutedTrade[] = [];
  let portfolioExecutions: FreedomExecutedTrade[] = [];
  const closedTrades: unknown[] = [];
  const events: Array<{ type: string; payload?: unknown }> = [];
  const snapshot: FreedomPortfolioSnapshot = { loaded: true, balances: [], positions: [] };
  const dependencies: PortfolioBrokerDataRuntimeDependencies = {
    getAccountId: () => 'admin-1',
    isSessionCurrent: () => current,
    restoreGatewaySecret: vi.fn(async () => 'valid-secret'),
    fetchAccountInfo: vi.fn(async () => ({ provider: 'broker' })),
    normalizeAccountInfo: vi.fn(() => snapshot),
    fetchExecutedTrades: vi.fn(async () => []),
    normalizeExecutedTrades: vi.fn((response) => response as FreedomExecutedTrade[]),
    loadSavedBrokerExecutions: () => saved,
    getCurrentBrokerExecutions: () => portfolioExecutions,
    getClosedTrades: () => closedTrades,
    hasHistoryBaseline: vi.fn(() => true),
    markHistoryBaseline: vi.fn(() => true),
    setBrokerExecutions: vi.fn((trades) => { portfolioExecutions = trades; }),
    fetchActiveOrders: vi.fn(async () => ({ orders: [] })),
    normalizeActiveOrders: vi.fn(() => []),
    refreshOrders: vi.fn(async (refresh) => {
      const secret = await refresh.restoreGatewaySecret();
      if (!refresh.isCurrent?.()) return;
      if (!secret.trim()) {
        refresh.onError();
        return;
      }
      refresh.onSuccess(refresh.normalizeActiveOrders(await refresh.fetchActiveOrders()));
    }),
    emit: ((type: string, payload?: unknown) => { events.push({ type, payload }); }) as PortfolioBrokerDataRuntimeDependencies['emit'],
    logError: vi.fn(),
    ...overrides
  };

  return {
    session,
    dependencies,
    events,
    runtime: createPortfolioBrokerDataRuntime(dependencies),
    setCurrent: (value: boolean) => { current = value; },
    setSaved: (value: FreedomExecutedTrade[]) => { saved = value; },
    setPortfolioExecutions: (value: FreedomExecutedTrade[]) => { portfolioExecutions = value; },
    getPortfolioExecutions: () => portfolioExecutions
  };
}

describe('portfolio broker data runtime', () => {
  it('skips one-shot account and orders snapshots after both live channels are current', async () => {
    const fixture = createFixture();
    setFreedomAccountStreamStatus(fixture.session.identity, 'connected');
    markFreedomAccountStreamSnapshot(fixture.session.identity, 'portfolio');
    markFreedomAccountStreamSnapshot(fixture.session.identity, 'orders');

    await expect(Promise.all([
      fixture.runtime.loadFreedomAccount(fixture.session),
      fixture.runtime.loadActiveOrders(fixture.session)
    ])).resolves.toEqual([true, true]);

    expect(fixture.dependencies.fetchAccountInfo).not.toHaveBeenCalled();
    expect(fixture.dependencies.fetchActiveOrders).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      { type: 'broker:account-info-refresh-complete', payload: undefined }
    ]);
  });

  it('completes the balance refresh lifecycle when the live portfolio snapshot is already applied', async () => {
    const fixture = createFixture();
    setFreedomAccountStreamStatus(fixture.session.identity, 'connected');
    markFreedomAccountStreamSnapshot(fixture.session.identity, 'portfolio');

    await expect(fixture.runtime.refreshAccountInfo(fixture.session)).resolves.toBe(true);

    expect(fixture.dependencies.fetchAccountInfo).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([
      { type: 'broker:account-info-refresh-complete', payload: undefined }
    ]);
  });

  it('discards a portfolio snapshot that resolves after a newer live portfolio event', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fixture = createFixture({
      fetchAccountInfo: vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }))
    });
    setFreedomAccountStreamStatus(fixture.session.identity, 'connected');

    const request = fixture.runtime.loadFreedomAccount(fixture.session);
    await vi.waitFor(() => expect(fixture.dependencies.fetchAccountInfo).toHaveBeenCalledTimes(1));
    markFreedomAccountStreamSnapshot(fixture.session.identity, 'portfolio');
    resolveFetch?.({ raw: 'stale one-shot snapshot' });

    await expect(request).resolves.toBe(true);
    expect(fixture.events).toEqual([
      { type: 'broker:account-info-refreshing', payload: undefined },
      { type: 'broker:account-info-refresh-complete', payload: undefined }
    ]);
  });

  it('discards an orders snapshot and embedded fills that resolve after a newer live orders event', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fixture = createFixture({
      fetchActiveOrders: vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }))
    });
    setFreedomAccountStreamStatus(fixture.session.identity, 'connected');

    const request = fixture.runtime.loadActiveOrders(fixture.session);
    await vi.waitFor(() => expect(fixture.dependencies.fetchActiveOrders).toHaveBeenCalledTimes(1));
    markFreedomAccountStreamSnapshot(fixture.session.identity, 'orders');
    resolveFetch?.({
      orders: { order: [{ order_id: 'stale-order' }] },
      trades: { trade: [{ id: 'stale-fill' }] }
    });

    await expect(request).resolves.toBe(true);
    expect(fixture.events).not.toContainEqual(expect.objectContaining({ type: 'broker:active-orders' }));
    expect(fixture.events).not.toContainEqual(expect.objectContaining({ type: 'broker:executed-trades' }));
    expect(fixture.getPortfolioExecutions()).toEqual([]);
  });

  it('coalesces concurrent account-info reads for the same session', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fixture = createFixture({
      fetchAccountInfo: vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }))
    });

    const first = fixture.runtime.loadFreedomAccount(fixture.session);
    const second = fixture.runtime.loadFreedomAccount(fixture.session);

    expect(fixture.events).toEqual([{ type: 'broker:account-info-refreshing' }]);
    await vi.waitFor(() => expect(fixture.dependencies.fetchAccountInfo).toHaveBeenCalledTimes(1));

    resolveFetch?.({ raw: true });
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fixture.events[1]).toEqual({
      type: 'broker:account-info',
      payload: { loaded: true, balances: [], positions: [] }
    });
  });

  it('does not publish an account snapshot after the account session changes', async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    const fixture = createFixture({
      fetchAccountInfo: vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }))
    });

    const request = fixture.runtime.loadFreedomAccount(fixture.session);
    await vi.waitFor(() => expect(fixture.dependencies.fetchAccountInfo).toHaveBeenCalledTimes(1));
    fixture.setCurrent(false);
    resolveFetch?.({ raw: true });

    await expect(request).resolves.toBe(false);
    expect(fixture.events).toEqual([{ type: 'broker:account-info-refreshing' }]);
  });

  it('merges incremental executions and preserves previously allocated margin fees', async () => {
    const oldSale = trade('sale-1', 'sell', '2026-10-27T12:00:00.000Z', {
      marginFeeAllocations: { 'guest-1': 2.5 }
    });
    const fixture = createFixture({
      hasHistoryBaseline: vi.fn(() => true),
      fetchExecutedTrades: vi.fn(async () => [
        trade('sale-1', 'sell', '2026-10-27T12:00:00.000Z'),
        trade('sale-2', 'sell', '2026-10-28T12:00:00.000Z')
      ])
    });
    fixture.setSaved([oldSale]);

    await expect(fixture.runtime.loadExecutedTrades(fixture.session)).resolves.toBe(true);

    expect(fixture.dependencies.fetchExecutedTrades).toHaveBeenCalledWith('2026-10-27');
    expect(fixture.getPortfolioExecutions()).toHaveLength(2);
    expect(fixture.getPortfolioExecutions()[0].marginFeeAllocations).toEqual({ 'guest-1': 2.5 });
    expect(fixture.events[fixture.events.length - 1]?.type).toBe('broker:executed-trades');
  });

  it('merges executions embedded in the authenticated orders snapshot into canonical history', async () => {
    const oldTrade = trade('history-existing', 'buy', '2026-10-30T10:00:00.000Z');
    const fill = {
      id: 'trade-from-order-1',
      order_id: 'order-77',
      instr: 'GOOGL.US',
      side: 'SELL',
      curr: 'USD',
      date: '2026-11-03T09:40:00',
      p: 352.5,
      q: 2,
      v: 705,
      profit: 12.5
    };
    const fixture = createFixture({
      fetchActiveOrders: vi.fn(async () => ({
        orders: { order: [{ order_id: 'order-77', instr: 'GOOGL.US' }] },
        trades: { trade: [fill] }
      })),
      normalizeActiveOrders: vi.fn(() => [{ id: 'order-77' }] as never)
    });
    fixture.setSaved([oldTrade]);

    await expect(fixture.runtime.loadActiveOrders(fixture.session)).resolves.toBe(true);

    expect(fixture.dependencies.fetchExecutedTrades).not.toHaveBeenCalled();
    expect(fixture.getPortfolioExecutions()).toHaveLength(2);
    expect(fixture.getPortfolioExecutions()).toEqual(expect.arrayContaining([
      oldTrade,
      expect.objectContaining({
        id: 'trade-from-order-1',
        ticker: 'GOOGL.US',
        side: 'SELL',
        quantity: 2,
        price: 352.5,
        currency: 'USD',
        executedAt: '2026-11-03T09:40:00',
        tradeValue: 705,
        profit: 12.5
      })
    ]));
    expect(fixture.events).toContainEqual({
      type: 'broker:executed-trades',
      payload: fixture.getPortfolioExecutions()
    });
    expect(fixture.events).toContainEqual({
      type: 'broker:active-orders',
      payload: [{ id: 'order-77' }]
    });
  });

  it('deduplicates the same TradeNet fill ID when the orders snapshot is replayed', async () => {
    const fill = {
      id: 'trade-replayed-1',
      order_id: 'order-88',
      instr: 'AAPL.US',
      side: 'BUY',
      curr: 'USD',
      date: '2026-11-03T09:41:00',
      p: 210,
      q: 1,
      v: 210
    };
    const fetchActiveOrders = vi.fn(async () => ({
      orders: { order: [] },
      trades: { trade: [fill] }
    }));
    const fixture = createFixture({
      fetchActiveOrders,
      normalizeActiveOrders: vi.fn(() => [] as never)
    });

    await expect(fixture.runtime.loadActiveOrders(fixture.session)).resolves.toBe(true);
    const firstHistory = fixture.getPortfolioExecutions();
    await expect(fixture.runtime.loadActiveOrders(fixture.session)).resolves.toBe(true);

    expect(fetchActiveOrders).toHaveBeenCalledTimes(2);
    expect(fixture.getPortfolioExecutions()).toHaveLength(1);
    expect(fixture.getPortfolioExecutions()[0].id).toBe('trade-replayed-1');
    expect(fixture.events.filter((event) => event.type === 'broker:executed-trades')).toHaveLength(1);
    expect(firstHistory).toEqual(fixture.getPortfolioExecutions());
  });

  it('marks a missing broker secret as a history error without calling the provider', async () => {
    const fixture = createFixture({
      restoreGatewaySecret: vi.fn(async () => '')
    });

    await expect(fixture.runtime.loadExecutedTrades(fixture.session)).resolves.toBe(false);

    expect(fixture.dependencies.fetchExecutedTrades).not.toHaveBeenCalled();
    expect(fixture.events).toContainEqual({ type: 'broker:executed-trades-error' });
  });

  it('does not write or publish history after the session changes during the provider read', async () => {
    const fixture = createFixture({
      fetchExecutedTrades: vi.fn(async () => {
        fixture.setCurrent(false);
        return [trade('late-sale')];
      })
    });

    await expect(fixture.runtime.loadExecutedTrades(fixture.session)).resolves.toBe(false);

    expect(fixture.dependencies.setBrokerExecutions).not.toHaveBeenCalled();
    expect(fixture.events).not.toContainEqual(expect.objectContaining({ type: 'broker:executed-trades' }));
  });

  it('coalesces active-order reads and publishes normalized results only for the current session', async () => {
    const fixture = createFixture({
      normalizeActiveOrders: vi.fn(() => [{ id: 'order-1' }] as never)
    });

    const first = fixture.runtime.loadActiveOrders(fixture.session);
    const second = fixture.runtime.loadActiveOrders(fixture.session);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(fixture.dependencies.fetchActiveOrders).toHaveBeenCalledTimes(1);
    expect(fixture.events).toContainEqual({
      type: 'broker:active-orders',
      payload: [{ id: 'order-1' }]
    });
  });

  it('publishes no active-order response after the account session changes', async () => {
    const fixture = createFixture({
      refreshOrders: vi.fn(async (refresh) => {
        fixture.setCurrent(false);
        refresh.onSuccess([{ id: 'late-order' }] as never);
      })
    });

    await expect(fixture.runtime.loadActiveOrders(fixture.session)).resolves.toBe(false);
    expect(fixture.events).not.toContainEqual(expect.objectContaining({ type: 'broker:active-orders' }));
  });

  it('reports account-info provider failures only for the current session', async () => {
    const fixture = createFixture({
      fetchAccountInfo: vi.fn(async () => { throw new Error('network error'); })
    });

    await expect(fixture.runtime.refreshAccountInfo(fixture.session)).resolves.toBe(false);
    expect(fixture.events).toContainEqual({ type: 'broker:account-info-error' });

    const stale = createFixture({
      fetchAccountInfo: vi.fn(async () => { throw new Error('network error'); })
    });
    stale.setCurrent(false);
    await expect(stale.runtime.refreshAccountInfo(stale.session)).resolves.toBe(false);
    expect(stale.events).toEqual([]);
  });
});
