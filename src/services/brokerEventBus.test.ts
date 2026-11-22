import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBrokerEventListener, emitBrokerEvent, getLastExecutedTradesRefreshAt } from './brokerEventBus';

describe('typed broker event bus', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers normalized broker snapshots to active subscribers', () => {
    const listener = vi.fn();
    const snapshot = {
      loaded: true,
      balances: [{ currency: 'USD', amount: 1250, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 }],
      positions: [{
        ticker: 'AAPL',
        name: 'Apple',
        quantity: 3,
        currency: 'USD',
        marketPrice: 190,
        marketValue: 570,
        averagePrice: 180,
        profitClose: 30,
        accountPositionId: 1
      }]
    };
    const unsubscribe = addBrokerEventListener('broker:account-info', listener);

    emitBrokerEvent('broker:account-info', snapshot);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(snapshot);
    unsubscribe();
  });

  it('notifies Balance subscribers when a full account refresh starts', () => {
    const listener = vi.fn();
    const unsubscribe = addBrokerEventListener('broker:account-info-refreshing', listener);
    emitBrokerEvent('broker:account-info-refreshing');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(undefined);
    unsubscribe();
  });

  it('stops delivering events after a subscriber is removed', () => {
    const listener = vi.fn();
    const unsubscribe = addBrokerEventListener('broker:executed-trades', listener);
    unsubscribe();

    emitBrokerEvent('broker:executed-trades', [{
      id: 'trade-1',
      ticker: 'AAPL',
      side: 'buy',
      quantity: 2,
      price: 100,
      currency: 'USD',
      executedAt: '2026-10-30T10:00:00Z',
      tradeValue: 200,
      profit: null,
      marginFee: null,
      commission: null,
      commissionCurrency: 'USD',
      raw: {}
    }]);

    expect(listener).not.toHaveBeenCalled();
  });


  it('delivers normalized active orders to subscribers', () => {
    const listener = vi.fn();
    const orders = [{
      id: 'order-1',
      ticker: 'AAPL',
      operation: 3,
      orderType: 2,
      limitPrice: 220,
      remainingQuantity: 3,
      status: '10',
      raw: {}
    }];
    const unsubscribe = addBrokerEventListener('broker:active-orders', listener);

    emitBrokerEvent('broker:active-orders', orders);

    expect(listener).toHaveBeenCalledWith(orders);
    unsubscribe();
  });

  it('delivers execution-history priority and keeps payload-free requests compatible', () => {
    const listener = vi.fn();
    const unsubscribe = addBrokerEventListener('broker:request-executed-trades', listener);

    emitBrokerEvent('broker:request-executed-trades', { priority: 'interactive' });
    expect(listener).toHaveBeenCalledWith({ priority: 'interactive' });

    emitBrokerEvent('broker:request-executed-trades');
    expect(listener).toHaveBeenLastCalledWith(undefined);
    unsubscribe();
  });

  it('supports payload-free refresh requests and multiple subscribers', () => {
    const first = vi.fn();
    const second = vi.fn();
    const accountRefresh = vi.fn();
    const awaitableAccountRefresh = vi.fn();
    const awaitableTradesRefresh = vi.fn();
    const awaitableOrdersRefresh = vi.fn();
    const resolveAccountRefresh = vi.fn();
    const resolveTradesRefresh = vi.fn();
    const resolveOrdersRefresh = vi.fn();
    const removeFirst = addBrokerEventListener('broker:request-active-orders', first);
    const removeSecond = addBrokerEventListener('broker:request-active-orders', second);
    const removeAccount = addBrokerEventListener('broker:request-account-info', accountRefresh);
    const removeAwaitableAccount = addBrokerEventListener('broker:request-account-info-and-wait', awaitableAccountRefresh);
    const removeAwaitableTrades = addBrokerEventListener('broker:request-executed-trades-and-wait', awaitableTradesRefresh);
    const removeAwaitableOrders = addBrokerEventListener('broker:request-active-orders-and-wait', awaitableOrdersRefresh);

    emitBrokerEvent('broker:request-active-orders');
    emitBrokerEvent('broker:request-account-info');
    emitBrokerEvent('broker:request-account-info-and-wait', { resolve: resolveAccountRefresh });
    emitBrokerEvent('broker:request-executed-trades-and-wait', { resolve: resolveTradesRefresh });
    emitBrokerEvent('broker:request-active-orders-and-wait', { resolve: resolveOrdersRefresh });

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(undefined);
    expect(second).toHaveBeenCalledTimes(1);
    expect(accountRefresh).toHaveBeenCalledTimes(1);
    expect(accountRefresh).toHaveBeenCalledWith(undefined);
    expect(awaitableAccountRefresh).toHaveBeenCalledWith({ resolve: resolveAccountRefresh });
    expect(awaitableTradesRefresh).toHaveBeenCalledWith({ resolve: resolveTradesRefresh });
    expect(awaitableOrdersRefresh).toHaveBeenCalledWith({ resolve: resolveOrdersRefresh });
    removeFirst();
    removeSecond();
    removeAccount();
    removeAwaitableAccount();
    removeAwaitableTrades();
    removeAwaitableOrders();
  });
});


describe('execution-history provider freshness', () => {
  it('retains confirmed provider refreshes per authenticated session', () => {
    const refresh = { source: 'rest' as const, completedAt: 1_800_000_000_000, sessionIdentity: 'admin:freshness-test' };
    expect(getLastExecutedTradesRefreshAt(refresh.sessionIdentity)).toBeNull();
    emitBrokerEvent('broker:executed-trades-refresh-complete', refresh);
    expect(getLastExecutedTradesRefreshAt(refresh.sessionIdentity)).toBe(refresh.completedAt);
    expect(getLastExecutedTradesRefreshAt('admin:another-session')).toBeNull();
  });
  it('does not accept invalid provider completion timestamps', () => {
    emitBrokerEvent('broker:executed-trades-refresh-complete', { source: 'rest', completedAt: Number.NaN, sessionIdentity: 'admin:invalid-freshness-test' });
    expect(getLastExecutedTradesRefreshAt('admin:invalid-freshness-test')).toBeNull();
  });
});
