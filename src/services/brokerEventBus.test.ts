import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBrokerEventListener, emitBrokerEvent } from './brokerEventBus';

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

  it('supports payload-free refresh requests and multiple subscribers', () => {
    const first = vi.fn();
    const second = vi.fn();
    const accountRefresh = vi.fn();
    const awaitableTradesRefresh = vi.fn();
    const resolveTradesRefresh = vi.fn();
    const removeFirst = addBrokerEventListener('broker:request-active-orders', first);
    const removeSecond = addBrokerEventListener('broker:request-active-orders', second);
    const removeAccount = addBrokerEventListener('broker:request-account-info', accountRefresh);
    const removeAwaitableTrades = addBrokerEventListener('broker:request-executed-trades-and-wait', awaitableTradesRefresh);

    emitBrokerEvent('broker:request-active-orders');
    emitBrokerEvent('broker:request-account-info');
    emitBrokerEvent('broker:request-executed-trades-and-wait', { resolve: resolveTradesRefresh });

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(undefined);
    expect(second).toHaveBeenCalledTimes(1);
    expect(accountRefresh).toHaveBeenCalledTimes(1);
    expect(accountRefresh).toHaveBeenCalledWith(undefined);
    expect(awaitableTradesRefresh).toHaveBeenCalledWith({ resolve: resolveTradesRefresh });
    removeFirst();
    removeSecond();
    removeAccount();
    removeAwaitableTrades();
  });
});
