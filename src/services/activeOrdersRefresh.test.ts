import { describe, expect, it, vi } from 'vitest';
import { refreshActiveOrders } from './activeOrdersRefresh';

describe('refreshActiveOrders', () => {
  it('reports missing credentials without making a broker request', async () => {
    const fetchActiveOrders = vi.fn(async () => ({ orders: [] }));
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await refreshActiveOrders({
      restoreGatewaySecret: async () => '   ',
      fetchActiveOrders,
      normalizeActiveOrders: (response) => response.orders,
      onSuccess,
      onError
    });

    expect(fetchActiveOrders).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports and logs provider failures while leaving prior UI state untouched', async () => {
    const error = new Error('TradeNet unavailable');
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const logError = vi.fn();

    await refreshActiveOrders({
      restoreGatewaySecret: async () => 'configured-secret',
      fetchActiveOrders: async (): Promise<{ orders: unknown[] }> => { throw error; },
      normalizeActiveOrders: (response) => response.orders,
      onSuccess,
      onError,
      logError
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(error);
  });

  it('emits a successful empty snapshot rather than treating no open orders as an error', async () => {
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await refreshActiveOrders({
      restoreGatewaySecret: async () => 'configured-secret',
      fetchActiveOrders: async () => ({ orders: [] }),
      normalizeActiveOrders: (response) => response.orders,
      onSuccess,
      onError
    });

    expect(onSuccess).toHaveBeenCalledWith([]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('normalizes and publishes the latest broker orders on success', async () => {
    const response = { rows: [{ id: 'order-1' }] };
    const normalized = [{ id: 'order-1', ticker: 'AAPL' }];
    const normalizeActiveOrders = vi.fn(() => normalized);
    const onSuccess = vi.fn();
    const onError = vi.fn();

    await refreshActiveOrders({
      restoreGatewaySecret: async () => 'configured-secret',
      fetchActiveOrders: async () => response,
      normalizeActiveOrders,
      onSuccess,
      onError
    });

    expect(normalizeActiveOrders).toHaveBeenCalledWith(response);
    expect(onSuccess).toHaveBeenCalledWith(normalized);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a credential restoration failure', async () => {
    const error = new Error('Secret storage unavailable');
    const onError = vi.fn();
    const logError = vi.fn();

    await refreshActiveOrders({
      restoreGatewaySecret: async () => { throw error; },
      fetchActiveOrders: async () => ({ orders: [] }),
      normalizeActiveOrders: (response) => response.orders,
      onSuccess: vi.fn(),
      onError,
      logError
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(error);
  });
});
