import { describe, expect, it, vi } from 'vitest';
import {
  createPortfolioStartupRuntime,
  type PortfolioStartupRuntimeDependencies
} from './portfolioStartupRuntime';

interface FixtureOptions {
  initialized?: boolean;
  secret?: string;
  credentialValid?: boolean;
  setupRequired?: boolean;
  startupError?: Error;
}

function createFixture(options: FixtureOptions = {}) {
  const calls: string[] = [];
  let initialized = options.initialized ?? false;
  const dependencies: PortfolioStartupRuntimeDependencies = {
    isInitialized: () => initialized,
    setInitialized: (value) => { initialized = value; calls.push(`initialized:${value}`); },
    restoreGatewaySecret: vi.fn(async () => {
      calls.push('restore');
      return options.secret ?? '';
    }),
    validateGatewaySecret: vi.fn(async () => options.credentialValid ?? false),
    getAuthStatus: vi.fn(async () => ({ setupRequired: options.setupRequired ?? false })),
    clearSavedGatewaySecret: vi.fn(() => calls.push('clear-secret')),
    persistGatewaySecret: vi.fn(async () => { calls.push('persist-secret'); return true; }),
    loadBrokerRules: vi.fn(() => calls.push('load-rules')),
    clearUnresolvedWorkspace: vi.fn(() => calls.push('clear-workspace')),
    showBalanceView: vi.fn(() => calls.push('balance')),
    hideStartupLoading: vi.fn(() => calls.push('hide-loading')),
    showAuthContainer: vi.fn(() => calls.push('show-auth')),
    hideAuthContainer: vi.fn(() => calls.push('hide-auth')),
    startApp: vi.fn(async () => {
      calls.push('start-app');
      if (options.startupError) throw options.startupError;
    }),
    onStartupFailure: vi.fn((error) => calls.push(`failure:${String(error)}`))
  };
  const runtime = createPortfolioStartupRuntime(dependencies);

  return { calls, dependencies, runtime, isInitialized: () => initialized };
}

describe('portfolio startup runtime', () => {
  it('does nothing when initialization has already completed', async () => {
    const fixture = createFixture({ initialized: true });

    await fixture.runtime.initApp();

    expect(fixture.dependencies.restoreGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([]);
  });

  it('validates a restored credential before starting the authenticated app', async () => {
    const fixture = createFixture({ secret: 'valid-secret', credentialValid: true });

    await fixture.runtime.initApp();

    expect(fixture.calls).toEqual(['restore', 'initialized:true', 'hide-auth', 'start-app']);
    expect(fixture.isInitialized()).toBe(true);
    expect(fixture.dependencies.onStartupFailure).not.toHaveBeenCalled();
  });

  it('clears an invalid saved credential after auth setup is complete', async () => {
    const fixture = createFixture({ secret: 'expired-secret' });

    await fixture.runtime.initApp();

    expect(fixture.calls).toEqual([
      'restore', 'clear-secret', 'persist-secret', 'load-rules',
      'clear-workspace', 'balance', 'hide-loading', 'show-auth'
    ]);
  });

  it('retains the previous credential while first-account setup is required', async () => {
    const fixture = createFixture({ secret: 'legacy-secret', setupRequired: true });

    await fixture.runtime.initApp();

    expect(fixture.dependencies.clearSavedGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.persistGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([
      'restore', 'load-rules', 'clear-workspace', 'balance', 'hide-loading', 'show-auth'
    ]);
  });

  it('shows startup failure and resets initialization when authenticated startup rejects', async () => {
    const fixture = createFixture({
      secret: 'valid-secret',
      credentialValid: true,
      startupError: new Error('startup failed')
    });

    await fixture.runtime.initApp();

    expect(fixture.isInitialized()).toBe(false);
    expect(fixture.dependencies.onStartupFailure).toHaveBeenCalledWith(expect.any(Error));
  });
});
