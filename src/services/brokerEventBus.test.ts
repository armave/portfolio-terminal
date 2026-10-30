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
      balances: [{ currency: 'USD', amount: 1250 }],
      positions: [{ ticker: 'AAPL', quantity: 3, marketPrice: 190 }]
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

    emitBrokerEvent('broker:executed-trades', [{ ticker: 'AAPL', side: 'buy', quantity: 2, price: 100 }]);

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports payload-free refresh requests and multiple subscribers', () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = addBrokerEventListener('broker:request-active-orders', first);
    const removeSecond = addBrokerEventListener('broker:request-active-orders', second);

    emitBrokerEvent('broker:request-active-orders');

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(undefined);
    expect(second).toHaveBeenCalledTimes(1);
    removeFirst();
    removeSecond();
  });
});
