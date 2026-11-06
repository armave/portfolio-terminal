import { describe, expect, it, vi } from 'vitest';
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
    onBackgroundStartupError: vi.fn((operation, _error) => calls.push(`background-error:${operation}`))
  };
  return {
    calls,
    dependencies,
    runtime: createPortfolioAuthenticatedStartupRuntime(dependencies),
    start: () => createPortfolioAuthenticatedStartupRuntime(dependencies).startApp(secret)
  };
}

describe('portfolio authenticated startup runtime', () => {
  it('loads admin workspace, applies rollover, pulls cloud, then bootstraps quotes in order', async () => {
    const fixture = createFixture('admin');

    await fixture.start();

    expect(fixture.calls).toEqual([
      'load-rules', 'publish-user', 'secret:valid-secret',
      'import-admin-workspace', 'rollover', 'pull-shared-cloud',
      'resolve-interval:admin', 'set-interval:admin-interval', 'rollover-timer:true',
      'quote-refresh-start', 'saved-admin-view', 'scroll', 'hide-loading',
      'refresh-quotes', 'recover-cloud-writes', 'quote-refresh-finish', 'analyst-consensus'
    ]);
    expect(fixture.dependencies.pullGuestPortfolioSnapshot).not.toHaveBeenCalled();
  });

  it('hydrates guest-only workspace and restores Balance before and after quote refresh', async () => {
    const fixture = createFixture('guest');

    await fixture.start();

    expect(fixture.calls).toEqual([
      'load-rules', 'publish-user', 'secret:valid-secret', 'pull-guest-snapshot',
      'resolve-interval:guest', 'set-interval:guest-interval', 'rollover-timer:false',
      'quote-refresh-start', 'guest-balance', 'scroll', 'hide-loading',
      'refresh-quotes', 'recover-cloud-writes', 'quote-refresh-finish', 'analyst-consensus'
    ]);
    expect(fixture.dependencies.importSavedAdminWorkspace).not.toHaveBeenCalled();
    expect(fixture.dependencies.pullSharedCloudState).not.toHaveBeenCalled();
    expect(fixture.dependencies.applyOvernightRollover).not.toHaveBeenCalled();
  });

  it('keeps unauthenticated startup on the local admin workspace without a cloud pull', async () => {
    const fixture = createFixture(null, '');

    await fixture.start();

    expect(fixture.calls).toEqual([
      'load-rules', 'clear-identity', 'secret:', 'import-admin-workspace', 'rollover',
      'resolve-interval:none', 'set-interval:admin-interval', 'rollover-timer:false',
      'quote-refresh-start', 'saved-admin-view', 'scroll', 'hide-loading',
      'refresh-quotes', 'recover-cloud-writes', 'quote-refresh-finish', 'analyst-consensus'
    ]);
    expect(fixture.dependencies.publishCurrentUser).not.toHaveBeenCalled();
    expect(fixture.dependencies.pullSharedCloudState).not.toHaveBeenCalled();
  });

  it('shows the hydrated workspace while quote refresh continues in the background', async () => {
    const fixture = createFixture('admin');
    let resolveQuotes: (() => void) | undefined;
    (fixture.dependencies.refreshLivePrices as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => { resolveQuotes = resolve; })
    );

    await fixture.start();

    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.recoverPendingCloudWrites).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.finishInitialQuoteRefresh).not.toHaveBeenCalled();
    expect(fixture.dependencies.renderBoardAnalystConsensus).not.toHaveBeenCalled();

    resolveQuotes?.();
    await vi.waitFor(() => expect(fixture.dependencies.finishInitialQuoteRefresh).toHaveBeenCalledTimes(1));
    expect(fixture.dependencies.renderBoardAnalystConsensus).toHaveBeenCalledTimes(1);
  });

  it('does not let background quote or cloud recovery failures block the usable workspace', async () => {
    const fixture = createFixture('admin');
    (fixture.dependencies.refreshLivePrices as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('quotes unavailable'));
    (fixture.dependencies.recoverPendingCloudWrites as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cloud unavailable'));

    await expect(fixture.start()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(fixture.dependencies.onBackgroundStartupError).toHaveBeenCalledTimes(2));

    expect(fixture.dependencies.hideStartupLoading).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.finishInitialQuoteRefresh).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.renderBoardAnalystConsensus).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.onBackgroundStartupError).toHaveBeenCalledWith(
      'quote-refresh',
      expect.any(Error)
    );
    expect(fixture.dependencies.onBackgroundStartupError).toHaveBeenCalledWith(
      'cloud-write-recovery',
      expect.any(Error)
    );
  });
});
