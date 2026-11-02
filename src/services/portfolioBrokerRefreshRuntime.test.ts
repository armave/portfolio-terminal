import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBrokerEventListener } from './brokerEventBus';
import {
  createPortfolioBrokerRefreshRuntime,
  type BrokerEventEmitter
} from './portfolioBrokerRefreshRuntime';

describe('portfolio broker refresh runtime', () => {
  const disposers: Array<() => void> = [];

  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
  });

  it('emits all scheduled broker refresh requests in the existing order', () => {
    const emit = vi.fn() as unknown as BrokerEventEmitter;
    const runtime = createPortfolioBrokerRefreshRuntime(emit);

    runtime.requestAll();

    expect(emit).toHaveBeenNthCalledWith(1, 'broker:request-account-info');
    expect(emit).toHaveBeenNthCalledWith(2, 'broker:request-executed-trades');
    expect(emit).toHaveBeenNthCalledWith(3, 'broker:request-active-orders');
  });

  it('exposes individual payload-free refresh requests', () => {
    const emit = vi.fn() as unknown as BrokerEventEmitter;
    const runtime = createPortfolioBrokerRefreshRuntime(emit);

    runtime.requestAccountInfo();
    runtime.requestExecutedTrades();
    runtime.requestActiveOrders();

    expect(emit).toHaveBeenNthCalledWith(1, 'broker:request-account-info');
    expect(emit).toHaveBeenNthCalledWith(2, 'broker:request-executed-trades');
    expect(emit).toHaveBeenNthCalledWith(3, 'broker:request-active-orders');
  });

  it('resolves each waitable broker request from its corresponding broker event', async () => {
    const runtime = createPortfolioBrokerRefreshRuntime();

    const accountListener = vi.fn((payload: { resolve: (success: boolean) => void }) => payload.resolve(true));
    const tradesListener = vi.fn((payload: { resolve: (success: boolean) => void }) => payload.resolve(false));
    const ordersListener = vi.fn((payload: { resolve: (success: boolean) => void }) => payload.resolve(true));

    disposers.push(addBrokerEventListener('broker:request-account-info-and-wait', accountListener));
    disposers.push(addBrokerEventListener('broker:request-executed-trades-and-wait', tradesListener));
    disposers.push(addBrokerEventListener('broker:request-active-orders-and-wait', ordersListener));

    await expect(runtime.refreshAccountInfo()).resolves.toBe(true);
    await expect(runtime.refreshExecutedTrades()).resolves.toBe(false);
    await expect(runtime.refreshActiveOrders()).resolves.toBe(true);

    expect(accountListener).toHaveBeenCalledTimes(1);
    expect(tradesListener).toHaveBeenCalledTimes(1);
    expect(ordersListener).toHaveBeenCalledTimes(1);
  });
});
