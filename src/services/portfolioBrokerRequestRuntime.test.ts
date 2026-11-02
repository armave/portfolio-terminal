import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitBrokerEvent } from './brokerEventBus';
import {
  bindPortfolioBrokerRequestRuntime,
  type PortfolioBrokerRequestRuntimeDependencies
} from './portfolioBrokerRequestRuntime';

describe('portfolio broker request runtime', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.restoreAllMocks();
  });

  it('starts account-scoped refreshes in the established startup order', () => {
    const calls: string[] = [];
    const dependencies: PortfolioBrokerRequestRuntimeDependencies = {
      refreshExecutedTrades: vi.fn(async () => { calls.push('trades'); return true; }),
      refreshActiveOrders: vi.fn(async () => { calls.push('orders'); return true; }),
      refreshAccountInfo: vi.fn(async () => { calls.push('account'); return true; }),
      refreshAccountInfoForWait: vi.fn(async () => true)
    };

    dispose = bindPortfolioBrokerRequestRuntime(dependencies);

    expect(calls).toEqual(['trades', 'orders', 'account']);
  });

  it('routes ordinary refresh requests to the matching session-scoped loader', async () => {
    const dependencies: PortfolioBrokerRequestRuntimeDependencies = {
      refreshAccountInfo: vi.fn(async () => true),
      refreshAccountInfoForWait: vi.fn(async () => true),
      refreshExecutedTrades: vi.fn(async () => true),
      refreshActiveOrders: vi.fn(async () => true)
    };
    dispose = bindPortfolioBrokerRequestRuntime(dependencies);

    (dependencies.refreshAccountInfo as ReturnType<typeof vi.fn>).mockClear();
    (dependencies.refreshExecutedTrades as ReturnType<typeof vi.fn>).mockClear();
    (dependencies.refreshActiveOrders as ReturnType<typeof vi.fn>).mockClear();

    emitBrokerEvent('broker:request-account-info');
    emitBrokerEvent('broker:request-executed-trades');
    emitBrokerEvent('broker:request-active-orders');

    await vi.waitFor(() => {
      expect(dependencies.refreshAccountInfo).toHaveBeenCalledTimes(1);
      expect(dependencies.refreshExecutedTrades).toHaveBeenCalledTimes(1);
      expect(dependencies.refreshActiveOrders).toHaveBeenCalledTimes(1);
    });
  });

  it('resolves waitable requests and converts rejected reads to false', async () => {
    const dependencies: PortfolioBrokerRequestRuntimeDependencies = {
      refreshAccountInfo: vi.fn(async () => true),
      refreshAccountInfoForWait: vi.fn(async () => true),
      refreshExecutedTrades: vi.fn(async () => false),
      refreshActiveOrders: vi.fn(async () => { throw new Error('orders unavailable'); })
    };
    dispose = bindPortfolioBrokerRequestRuntime(dependencies);

    const account = vi.fn();
    const trades = vi.fn();
    const orders = vi.fn();
    emitBrokerEvent('broker:request-account-info-and-wait', { resolve: account });
    emitBrokerEvent('broker:request-executed-trades-and-wait', { resolve: trades });
    emitBrokerEvent('broker:request-active-orders-and-wait', { resolve: orders });

    await vi.waitFor(() => {
      expect(account).toHaveBeenCalledWith(true);
      expect(trades).toHaveBeenCalledWith(false);
      expect(orders).toHaveBeenCalledWith(false);
    });
  });

  it('removes all request listeners when disposed', async () => {
    const dependencies: PortfolioBrokerRequestRuntimeDependencies = {
      refreshAccountInfo: vi.fn(async () => true),
      refreshAccountInfoForWait: vi.fn(async () => true),
      refreshExecutedTrades: vi.fn(async () => true),
      refreshActiveOrders: vi.fn(async () => true)
    };
    dispose = bindPortfolioBrokerRequestRuntime(dependencies);
    dispose();
    dispose = undefined;

    (dependencies.refreshAccountInfo as ReturnType<typeof vi.fn>).mockClear();
    (dependencies.refreshExecutedTrades as ReturnType<typeof vi.fn>).mockClear();
    (dependencies.refreshActiveOrders as ReturnType<typeof vi.fn>).mockClear();

    emitBrokerEvent('broker:request-account-info');
    emitBrokerEvent('broker:request-executed-trades');
    emitBrokerEvent('broker:request-active-orders');

    await Promise.resolve();
    expect(dependencies.refreshAccountInfo).not.toHaveBeenCalled();
    expect(dependencies.refreshExecutedTrades).not.toHaveBeenCalled();
    expect(dependencies.refreshActiveOrders).not.toHaveBeenCalled();
  });
});
