import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitUiEvent } from '../ui/uiEventBus';
import { bindPortfolioSyncRuntime, type PortfolioSyncRuntimeDependencies } from './portfolioSyncRuntime';

function createDependencies(
  overrides: Partial<PortfolioSyncRuntimeDependencies> = {}
): PortfolioSyncRuntimeDependencies {
  return {
    getAccountRole: () => 'admin',
    getAccountSessionKey: () => {
      const role = overrides.getAccountRole ? overrides.getAccountRole() : 'admin';
      return role ? `${role}:test-account` : null;
    },
    refreshQuotes: vi.fn(async () => true),
    refreshBrokerAccount: vi.fn(async () => true),
    refreshExecutedTrades: vi.fn(async () => true),
    refreshActiveOrders: vi.fn(async () => true),
    pushCloud: vi.fn(async () => true),
    syncClosedHistory: vi.fn(async () => true),
    pullGuestSnapshot: vi.fn(async () => true),
    translateText: vi.fn((message: string) => `translated:${message}`),
    showToast: vi.fn(),
    logAppMessage: vi.fn(),
    getSyncStatus: () => ({ status: 'idle' }),
    setSyncStatus: vi.fn(),
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
    expect(dependencies.setSyncStatus).toHaveBeenNthCalledWith(1, { status: 'syncing', text: 'Portfolio sync in progress' });
    expect(dependencies.setSyncStatus).toHaveBeenLastCalledWith({ status: 'synced', text: 'Synced' });
    expect(dependencies.logAppMessage).toHaveBeenCalledWith(
      '[Sync]: Broker data, market quotes, portfolio snapshot and Closed History are up to date.'
    );
  });

  it('coalesces repeated manual Sync requests within the same authenticated session', async () => {
    let releaseQuotes: (succeeded: boolean) => void = () => undefined;
    const quoteRequest = new Promise<boolean>((resolve) => { releaseQuotes = resolve; });
    const dependencies = createDependencies({
      refreshQuotes: vi.fn(() => quoteRequest)
    });
    const firstResolve = vi.fn();
    const secondResolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve: firstResolve });
    await vi.waitFor(() => expect(dependencies.refreshQuotes).toHaveBeenCalledTimes(1));

    emitUiEvent('portfolio:sync-request', { resolve: secondResolve });
    await Promise.resolve();

    expect(dependencies.refreshBrokerAccount).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshExecutedTrades).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshActiveOrders).toHaveBeenCalledTimes(1);
    expect(dependencies.refreshQuotes).toHaveBeenCalledTimes(1);
    expect(dependencies.setSyncStatus).toHaveBeenCalledTimes(1);
    expect(firstResolve).not.toHaveBeenCalled();
    expect(secondResolve).not.toHaveBeenCalled();

    releaseQuotes(true);
    await vi.waitFor(() => {
      expect(firstResolve).toHaveBeenCalledTimes(1);
      expect(secondResolve).toHaveBeenCalledTimes(1);
    });
    expect(secondResolve).toHaveBeenCalledWith(firstResolve.mock.calls[0][0]);
    expect(dependencies.syncClosedHistory).toHaveBeenCalledTimes(1);
    expect(dependencies.pushCloud).toHaveBeenCalledTimes(1);
    expect(dependencies.showToast).toHaveBeenCalledTimes(1);
    expect(dependencies.setSyncStatus).toHaveBeenCalledTimes(2);
  });

  it('does not let an older account sync overwrite the current account status', async () => {
    let sessionKey = 'admin:first';
    const quoteResults: Array<{ resolve: (succeeded: boolean) => void; promise: Promise<boolean> }> = [];
    const refreshQuotes = vi.fn(() => {
      let resolve: (succeeded: boolean) => void = () => undefined;
      const promise = new Promise<boolean>((done) => { resolve = done; });
      quoteResults.push({ resolve, promise });
      return promise;
    });
    const statuses: Array<{ status: 'syncing' | 'synced' | 'error'; text: string }> = [];
    const dependencies = createDependencies({
      getAccountSessionKey: () => sessionKey,
      getSyncStatus: () => ({ status: statuses[statuses.length - 1]?.status || 'idle' }),
      setSyncStatus: (next) => { statuses.push(next); },
      refreshQuotes
    });
    const firstResolve = vi.fn();
    const secondResolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve: firstResolve });
    await vi.waitFor(() => expect(refreshQuotes).toHaveBeenCalledTimes(1));

    sessionKey = 'admin:second';
    emitUiEvent('portfolio:sync-request', { resolve: secondResolve });
    await vi.waitFor(() => expect(refreshQuotes).toHaveBeenCalledTimes(2));

    quoteResults[0].resolve(true);
    await vi.waitFor(() => expect(firstResolve).toHaveBeenCalledTimes(1));
    expect(statuses).toHaveLength(2);
    expect(statuses[statuses.length - 1]).toMatchObject({ status: 'syncing' });
    expect(dependencies.showToast).not.toHaveBeenCalled();

    quoteResults[1].resolve(true);
    await vi.waitFor(() => expect(secondResolve).toHaveBeenCalledTimes(1));
    expect(statuses[statuses.length - 1]).toMatchObject({ status: 'synced' });
    expect(dependencies.showToast).toHaveBeenCalledTimes(1);
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
    expect(dependencies.setSyncStatus).toHaveBeenLastCalledWith({ status: 'synced', text: 'Assigned data refreshed' });
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
    expect(dependencies.logAppMessage).toHaveBeenCalledWith(
      '[Sync Warning]: One or more portfolio data sources could not be refreshed.'
    );
  });

  it('marks a guest refresh with source failures as failed', async () => {
    const dependencies = createDependencies({
      getAccountRole: () => 'guest',
      refreshQuotes: vi.fn(async () => false)
    });
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(resolve.mock.calls[0][0]).toMatchObject({
      role: 'guest', guestSnapshot: true, quotes: false, success: false
    });
    expect(dependencies.setSyncStatus).toHaveBeenLastCalledWith({
      status: 'error', text: 'Assigned data refresh failed'
    });
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

  it('does not overwrite a cloud revision conflict when the in-flight manual sync completes', async () => {
    let cloudStatus = { status: 'idle' };
    const setSyncStatus = vi.fn((next: { status: 'syncing' | 'synced' | 'error'; text: string }) => {
      cloudStatus = next;
    });
    const dependencies = createDependencies({
      getSyncStatus: () => cloudStatus,
      setSyncStatus,
      pushCloud: vi.fn(async () => {
        cloudStatus = { status: 'conflict' };
        return false;
      })
    });
    const resolve = vi.fn();

    unbind = bindPortfolioSyncRuntime(dependencies);
    emitUiEvent('portfolio:sync-request', { resolve });
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));

    expect(cloudStatus.status).toBe('conflict');
    expect(setSyncStatus).toHaveBeenNthCalledWith(1, {
      status: 'syncing', text: 'Portfolio sync in progress'
    });
    expect(setSyncStatus).not.toHaveBeenLastCalledWith({
      status: 'error', text: 'Sync failed'
    });
});
});
