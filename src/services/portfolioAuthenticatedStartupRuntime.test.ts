import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPortfolioAuthenticatedStartupRuntime,
  type AuthenticatedStartupRole,
  type PortfolioAuthenticatedStartupDependencies
} from './portfolioAuthenticatedStartupRuntime';

function createFixture(role: AuthenticatedStartupRole = 'admin', secret = 'valid-secret') {
  const calls: string[] = [];
  let currentRole = role;
  const dependencies: PortfolioAuthenticatedStartupDependencies = {
    loadBrokerRules: vi.fn(() => calls.push('load-rules')),
    publishCurrentUser: vi.fn(async () => { calls.push('publish-user'); }),
    clearAccountIdentity: vi.fn(() => { calls.push('clear-identity'); currentRole = null; }),
    initializeOfflineHistoryStorage: vi.fn(async () => { calls.push('initialize-offline-history'); }),
    setGatewaySecret: vi.fn((value) => calls.push(`secret:${value}`)),
    getAccountRole: () => currentRole,
    pullGuestPortfolioSnapshot: vi.fn(async () => calls.push('pull-guest-snapshot')),
    importSavedAdminWorkspace: vi.fn(() => calls.push('import-admin-workspace')),
    applyOvernightRollover: vi.fn(() => calls.push('rollover')),
    pullSharedCloudState: vi.fn(async () => calls.push('pull-shared-cloud')),
    getInitialQuoteRefreshInterval: vi.fn((accountRole) => {
      calls.push(`resolve-interval:${accountRole ?? 'none'}`);
      return accountRole === 'guest' ? 'guest-interval' : 'admin-interval';
    }),
    setQuoteRefreshInterval: vi.fn((interval) => { calls.push(`set-interval:${interval}`); return 0; }),
    configureAdminRollover: vi.fn((enabled) => calls.push(`rollover-timer:${enabled}`)),
    beginInitialQuoteRefresh: vi.fn(() => calls.push('quote-refresh-start')),
    showGuestBalanceView: vi.fn(() => calls.push('guest-balance')),
    showSavedAdminView: vi.fn(() => calls.push('saved-admin-view')),
    scrollWorkspace: vi.fn(() => calls.push('scroll')),
    refreshLivePrices: vi.fn(async () => calls.push('refresh-quotes')),
    finishInitialQuoteRefresh: vi.fn(() => calls.push('quote-refresh-finish')),
    renderBoardAnalystConsensus: vi.fn(() => calls.push('analyst-consensus')),
    recoverPendingCloudWrites: vi.fn(async () => { calls.push('recover-cloud-writes'); }),
    hideStartupLoading: vi.fn(() => calls.push('hide-loading')),
    reportBackgroundStartupError: vi.fn((task, error) => calls.push(`background-error:${task}:${String(error)}`))
  };
  return {
    calls,
    dependencies,
    start: () => createPortfolioAuthenticatedStartupRuntime(dependencies).startApp(secret)
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('portfolio authenticated startup runtime', () => {
  it('shows the saved admin workspace before waiting for background quotes and pending writes', async () => {
    const fixture = createFixture('admin');

    await fixture.start();

    expect(fixture.calls.slice(0, 12)).toEqual([
      'publish-user', 'load-rules', 'secret:valid-secret',
      'import-admin-workspace', 'rollover',
      'resolve-interval:admin', 'set-interval:admin-interval', 'rollover-timer:true',
      'quote-refresh-start', 'saved-admin-view', 'scroll', 'hide-loading'
    ]);
    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.initializeOfflineHistoryStorage).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(fixture.dependencies.pullSharedCloudState).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.finishInitialQuoteRefresh).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.renderBoardAnalystConsensus).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.recoverPendingCloudWrites).toHaveBeenCalledTimes(1);
    });
    expect(fixture.calls.indexOf('hide-loading')).toBeLessThan(fixture.calls.indexOf('pull-shared-cloud'));
    expect(fixture.calls.indexOf('hide-loading')).toBeLessThan(fixture.calls.indexOf('refresh-quotes'));
  });

  it('keeps pending cloud writes suppressed until the initial remote pull settles', async () => {
    const fixture = createFixture('admin');
    let finishCloudPull!: () => void;
    (fixture.dependencies.pullSharedCloudState as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => { finishCloudPull = resolve; }).then(() => {
        fixture.calls.push('pull-shared-cloud-finished');
      })
    );

    await fixture.start();
    await vi.waitFor(() => expect(fixture.dependencies.pullSharedCloudState).toHaveBeenCalledTimes(1));

    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.recoverPendingCloudWrites).not.toHaveBeenCalled();

    finishCloudPull();
    await vi.waitFor(() => expect(fixture.dependencies.recoverPendingCloudWrites).toHaveBeenCalledTimes(1));

    expect(fixture.calls.indexOf('pull-shared-cloud-finished'))
      .toBeLessThan(fixture.calls.indexOf('recover-cloud-writes'));
  });

  it('hydrates the guest-only workspace and restores Balance before background quotes', async () => {
    const fixture = createFixture('guest');

    await fixture.start();

    expect(fixture.dependencies.importSavedAdminWorkspace).not.toHaveBeenCalled();
    expect(fixture.dependencies.pullSharedCloudState).not.toHaveBeenCalled();
    expect(fixture.dependencies.showGuestBalanceView).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(fixture.dependencies.pullGuestPortfolioSnapshot).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.finishInitialQuoteRefresh).toHaveBeenCalledTimes(1);
    });
    expect(fixture.calls.indexOf('hide-loading')).toBeLessThan(fixture.calls.indexOf('pull-guest-snapshot'));
  });

  it('initializes the offline history cache only for unauthenticated startup', async () => {
    const fixture = createFixture(null, '');

    await fixture.start();

    expect(fixture.calls.slice(0, 4)).toEqual([
      'clear-identity', 'initialize-offline-history', 'load-rules', 'secret:'
    ]);
    expect(fixture.dependencies.publishCurrentUser).not.toHaveBeenCalled();
    expect(fixture.dependencies.pullSharedCloudState).not.toHaveBeenCalled();
    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
  });

  it('does not leave the startup shell blocked when the quote refresh never settles', async () => {
    vi.useFakeTimers();
    const fixture = createFixture('admin');
    (fixture.dependencies.refreshLivePrices as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>(() => undefined)
    );

    await fixture.start();
    await Promise.resolve();

    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(fixture.dependencies.recoverPendingCloudWrites).toHaveBeenCalledTimes(1));
    expect(fixture.dependencies.finishInitialQuoteRefresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(fixture.dependencies.finishInitialQuoteRefresh).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.reportBackgroundStartupError).toHaveBeenCalledWith(
      'initial-quotes',
      expect.any(Error)
    );
  });
});
