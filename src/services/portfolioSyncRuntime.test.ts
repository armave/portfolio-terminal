import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitUiEvent } from '../ui/uiEventBus';
import { bindPortfolioSyncRuntime, type PortfolioSyncRuntimeDependencies } from './portfolioSyncRuntime';

function createDependencies(
  overrides: Partial<PortfolioSyncRuntimeDependencies> = {}
): PortfolioSyncRuntimeDependencies {
  return {
    getAccountRole: () => 'admin',
    refreshQuotes: vi.fn(async () => true),
    refreshBrokerAccount: vi.fn(async () => true),
    refreshExecutedTrades: vi.fn(async () => true),
    refreshActiveOrders: vi.fn(async () => true),
    pushCloud: vi.fn(async () => true),
    syncClosedHistory: vi.fn(async () => true),
    pullGuestSnapshot: vi.fn(async () => true),
    translateText: vi.fn((message: string) => `translated:${message}`),
    showToast: vi.fn(),
    logTerminal: vi.fn(),
    ...overrides
  };
}

describe('portfolio sync runtime bindings', () => {
  let unbind: (() => void) | undefined;

  afterEach(() => {
    unbind?.();
    unbind = undefined;
  });

  it('runs the admin sync and reports the successful result', async () => {
    const dependencies = createDependencies();
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(resolve).toHaveBeenCalledWith({
      role: 'admin',
      brokerAccount: true,
      executedTrades: true,
      activeOrders: true,
      quotes: true,
      cloud: true,
      cloudHistory: true,
      success: true
    });
    expect(dependencies.refreshBrokerAccount).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshExecutedTrades).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshActiveOrders).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshQuotes).toHaveBeenCalledTimes(1);
    expect(dependencies.pushCloud).toHaveBeenCalledTimes(1);
    expect(dependencies.syncClosedHistory).toHaveBeenCalledTimes(1);
    expect(dependencies.pullGuestSnapshot).not.toHaveBeenCalled();
    expect(dependencies.translateText).toHaveBeenCalledWith('Portfolio sync completed.');
    expect(dependencies.showToast).toHaveBeenCalledWith(
      'translated:Portfolio sync completed.',
      'success'
    );
    expect(dependencies.logTerminal).toHaveBeenCalledWith(
      '[Sync]: Broker data, market quotes, portfolio snapshot and Closed History are up to date.'
    );
  });

  it('keeps guest sync limited to the guest snapshot and quotes', async () => {
    const dependencies = createDependencies({ getAccountRole: () => 'guest' });
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(resolve).toHaveBeenCalledWith({
      role: 'guest',
      guestSnapshot: true,
      quotes: true,
      success: true
    });
    expect(dependencies.pullGuestSnapshot).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshQuotes).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshBrokerAccount).not.toHaveBeenCalled();
    expect(dependencies.refreshExecutedTrades).not.toHaveBeenCalled();
    expect(dependencies.refreshActiveOrders).not.toHaveBeenCalled();
    expect(dependencies.pushCloud).not.toHaveBeenCalled();
    expect(dependencies.syncClosedHistory).not.toHaveBeenCalled();
    expect(dependencies.showToast).toHaveBeenCalledWith(
      'translated:Portfolio sync completed.',
      'success'
    );
  });

  it('reports partial admin syncs as warnings', async () => {
    const dependencies = createDependencies({
      refreshBrokerAccount: vi.fn(async () => false)
    });
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(resolve.mock.calls[0][0]).toMatchObject({
      role: 'admin',
      brokerAccount: false,
      executedTrades: true,
      activeOrders: true,
      quotes: true,
      cloud: true,
      success: false
    });
    expect(dependencies.showToast).toHaveBeenCalledWith(
      'translated:Portfolio sync completed with issues. Check the activity log.',
      'warning'
    );
    expect(dependencies.logTerminal).toHaveBeenCalledWith(
      '[Sync Warning]: One or more portfolio data sources could not be refreshed.'
    );
  });

  it('does not run sync operations when no account role is active', async () => {
    const dependencies = createDependencies({ getAccountRole: () => null });
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(resolve).toHaveBeenCalledWith({ role: null, quotes: false, success: false });
    expect(dependencies.refreshBrokerAccount).not.toHaveBeenCalled();
    expect(dependencies.refreshQuotes).not.toHaveBeenCalled();
    expect(dependencies.pushCloud).not.toHaveBeenCalled();
    expect(dependencies.showToast).toHaveBeenCalledWith(
      'translated:Could not sync portfolio. Check your connection and try again.',
      'error'
    );
  });

  it('resolves a failed sync request when the injected operation adapter throws', async () => {
    const dependencies = createDependencies({
      getAccountRole: () => 'guest',
      pullGuestSnapshot: vi.fn(async () => { throw new Error('Guest snapshot unavailable'); })
    });
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    // The sync policy catches individual source failures and reports partial status.
    expect(resolve.mock.calls[0][0]).toMatchObject({
      role: 'guest',
      guestSnapshot: false,
      quotes: true,
      success: false
    });
    expect(dependencies.showToast).toHaveBeenCalledWith(
      'translated:Portfolio sync completed with issues. Check the activity log.',
      'warning'
    );
  });

  it('removes the UI event listener when disposed', () => {
    const dependencies = createDependencies();
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    unbind();
    unbind = undefined;

    emitUiEvent('portfolio:sync-request', { resolve });

    expect(resolve).not.toHaveBeenCalled();
    expect(dependencies.refreshQuotes).not.toHaveBeenCalled();
  });
});
