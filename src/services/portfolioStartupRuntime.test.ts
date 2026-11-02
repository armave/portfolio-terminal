import { describe, expect, it, vi } from 'vitest';
import {
  createPortfolioStartupRuntime,
  type PortfolioStartupRuntimeDependencies
} from './portfolioStartupRuntime';

function createFixture(overrides: Partial<PortfolioStartupRuntimeDependencies> = {}) {
  const calls: string[] = [];
  let initialized = false;
  const baseDependencies: PortfolioStartupRuntimeDependencies = {
    isInitialized: () => initialized,
    setInitialized: (value) => { initialized = value; calls.push(`initialized:${value}`); },
    restoreGatewaySecret: vi.fn(async () => { calls.push('restore'); return ''; }),
    validateGatewaySecret: vi.fn(async () => false),
    getAuthStatus: vi.fn(async () => ({ setupRequired: false })),
    clearSavedGatewaySecret: vi.fn(() => calls.push('clear-secret')),
    persistGatewaySecret: vi.fn(async () => { calls.push('persist-secret'); return true; }),
    loadBrokerRules: vi.fn(() => calls.push('load-rules')),
    clearUnresolvedWorkspace: vi.fn(() => calls.push('clear-workspace')),
    showBalanceView: vi.fn(() => calls.push('balance')),
    hideStartupLoading: vi.fn(() => calls.push('hide-loading')),
    showAuthContainer: vi.fn(() => calls.push('show-auth')),
    hideAuthContainer: vi.fn(() => calls.push('hide-auth')),
    startApp: vi.fn(async () => { calls.push('start-app'); }),
    onStartupFailure: vi.fn((error) => calls.push(`failure:${String(error)}`))
  };
  const dependencies = { ...baseDependencies, ...overrides };
  const runtime = createPortfolioStartupRuntime({
    ...dependencies,
    setInitialized: (value) => {
      initialized = value;
      dependencies.setInitialized(value);
    }
  });

  return { calls, dependencies, runtime, isInitialized: () => initialized };
}

describe('portfolio startup runtime', () => {
  it('does nothing when initialization has already completed', async () => {
    const fixture = createFixture({ isInitialized: () => true });

    await fixture.runtime.initApp();

    expect(fixture.dependencies.restoreGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([]);
  });

  it('validates a restored credential before starting the authenticated app', async () => {
    const fixture = createFixture({
      restoreGatewaySecret: vi.fn(async () => 'valid-secret'),
      validateGatewaySecret: vi.fn(async () => true)
    });

    await fixture.runtime.initApp();

    expect(fixture.calls).toEqual(['restore', 'initialized:true', 'hide-auth', 'start-app']);
    expect(fixture.isInitialized()).toBe(true);
    expect(fixture.dependencies.onStartupFailure).not.toHaveBeenCalled();
  });

  it('clears an invalid saved credential after auth setup is complete', async () => {
    const fixture = createFixture({
      restoreGatewaySecret: vi.fn(async () => 'expired-secret')
    });

    await fixture.runtime.initApp();

    expect(fixture.calls).toEqual([
      'restore', 'clear-secret', 'persist-secret', 'load-rules',
      'clear-workspace', 'balance', 'hide-loading', 'show-auth'
    ]);
  });

  it('retains the previous credential while first-account setup is required', async () => {
    const fixture = createFixture({
      restoreGatewaySecret: vi.fn(async () => 'legacy-secret'),
      getAuthStatus: vi.fn(async () => ({ setupRequired: true }))
    });

    await fixture.runtime.initApp();

    expect(fixture.dependencies.clearSavedGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.persistGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.calls).toEqual([
      'restore', 'load-rules', 'clear-workspace', 'balance', 'hide-loading', 'show-auth'
    ]);
  });

  it('shows startup failure and resets initialization when authenticated startup rejects', async () => {
    const fixture = createFixture({
      restoreGatewaySecret: vi.fn(async () => 'valid-secret'),
      validateGatewaySecret: vi.fn(async () => true),
      startApp: vi.fn(async () => { throw new Error('startup failed'); })
    });

    await fixture.runtime.initApp();

    expect(fixture.isInitialized()).toBe(false);
    expect(fixture.dependencies.onStartupFailure).toHaveBeenCalledWith(expect.any(Error));
  });
});
