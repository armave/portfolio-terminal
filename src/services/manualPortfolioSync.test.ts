import { describe, expect, it, vi } from 'vitest';
import { runManualPortfolioSync, type ManualPortfolioSyncOperations } from './manualPortfolioSync';

function createOperations(overrides: Partial<ManualPortfolioSyncOperations> = {}): ManualPortfolioSyncOperations {
  return {
    role: 'admin',
    refreshQuotes: vi.fn(async () => true),
    refreshBrokerAccount: vi.fn(async () => true),
    refreshExecutedTrades: vi.fn(async () => true),
    refreshActiveOrders: vi.fn(async () => true),
    pushCloud: vi.fn(async () => true),
    pullGuestSnapshot: vi.fn(async () => true),
    ...overrides
  };
}

describe('runManualPortfolioSync', () => {
  it('waits for admin broker reads before quotes and the cloud push', async () => {
    const sequence: string[] = [];
    const result = await runManualPortfolioSync(createOperations({
      refreshBrokerAccount: async () => { sequence.push('account'); return true; },
      refreshExecutedTrades: async () => { sequence.push('trades'); return true; },
      refreshActiveOrders: async () => { sequence.push('orders'); return true; },
      refreshQuotes: async () => { sequence.push('quotes'); return true; },
      pushCloud: async () => { sequence.push('cloud'); return true; }
    }));
    expect(sequence).toEqual(['account', 'trades', 'orders', 'quotes', 'cloud']);
    expect(result).toEqual({
      role: 'admin', brokerAccount: true, executedTrades: true, activeOrders: true,
      quotes: true, cloud: true, success: true
    });
  });

  it('continues after a failed broker source and reports partial status', async () => {
    const operations = createOperations({
      refreshBrokerAccount: async () => { throw new Error('Broker unavailable'); }
    });
    const result = await runManualPortfolioSync(operations);
    expect(result.success).toBe(false);
    expect(result.brokerAccount).toBe(false);
    expect(result.executedTrades).toBe(true);
    expect(result.activeOrders).toBe(true);
    expect(result.quotes).toBe(true);
    expect(result.cloud).toBe(true);
  });

  it('limits guest sync to its own snapshot and quotes', async () => {
    const operations = createOperations({ role: 'guest' });
    const result = await runManualPortfolioSync(operations);
    expect(result).toEqual({ role: 'guest', guestSnapshot: true, quotes: true, success: true });
    expect(operations.refreshBrokerAccount).not.toHaveBeenCalled();
    expect(operations.refreshExecutedTrades).not.toHaveBeenCalled();
    expect(operations.refreshActiveOrders).not.toHaveBeenCalled();
    expect(operations.pushCloud).not.toHaveBeenCalled();
  });

  it('refreshes the guest-owned snapshot and quote data sequentially without broker-wide reads', async () => {
    const sequence: string[] = [];
    const operations = createOperations({
      role: 'guest',
      pullGuestSnapshot: async () => { sequence.push('assigned holdings and LOTS ledger'); return true; },
      refreshQuotes: async () => { sequence.push('assigned ticker quotes'); return true; }
    });

    const result = await runManualPortfolioSync(operations);

    expect(sequence).toEqual(['assigned holdings and LOTS ledger', 'assigned ticker quotes']);
    expect(result).toEqual({ role: 'guest', guestSnapshot: true, quotes: true, success: true });
    expect(operations.refreshBrokerAccount).not.toHaveBeenCalled();
    expect(operations.refreshExecutedTrades).not.toHaveBeenCalled();
    expect(operations.refreshActiveOrders).not.toHaveBeenCalled();
    expect(operations.pushCloud).not.toHaveBeenCalled();
  });

  it('still refreshes guest quotes and reports a failed guest snapshot', async () => {
    const operations = createOperations({
      role: 'guest',
      pullGuestSnapshot: async () => { throw new Error('Cloud unavailable'); }
    });
    const result = await runManualPortfolioSync(operations);
    expect(result.success).toBe(false);
    expect(result.guestSnapshot).toBe(false);
    expect(result.quotes).toBe(true);
  });

  it('does not issue sync calls without an authenticated account role', async () => {
    const operations = createOperations({ role: null });
    const result = await runManualPortfolioSync(operations);
    expect(result).toEqual({ role: null, quotes: false, success: false });
    expect(operations.refreshQuotes).not.toHaveBeenCalled();
    expect(operations.refreshBrokerAccount).not.toHaveBeenCalled();
    expect(operations.pushCloud).not.toHaveBeenCalled();
  });
});
