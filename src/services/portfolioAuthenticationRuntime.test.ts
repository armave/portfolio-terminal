import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './api';
import {
  createPortfolioAuthenticationRuntime,
  type PortfolioAuthenticationRuntimeDependencies
} from './portfolioAuthenticationRuntime';

const guestUser: AuthUser = {
  id: 'guest-a',
  name: 'Guest',
  role: 'guest',
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z'
};

const adminUser: AuthUser = {
  id: 'admin-a',
  name: 'Administrator',
  role: 'admin',
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z'
};

function createFixture(options: {
  initialized?: boolean;
  user?: AuthUser;
  valid?: boolean;
  persisted?: boolean;
  startApp?: () => Promise<void>;
} = {}) {
  let role: AuthRole | null = null;
  let initialized = options.initialized ?? false;
  const calls: string[] = [];
  const user = options.user ?? guestUser;
  const dependencies: PortfolioAuthenticationRuntimeDependencies = {
    validateGatewaySecret: vi.fn(async (secret: string) => {
      calls.push(`validate:${secret}`);
      return options.valid ?? true;
    }),
    saveGatewaySecret: vi.fn((secret: string) => calls.push(`save:${secret}`)),
    publishCurrentUser: vi.fn(async () => {
      role = user.role;
      calls.push(`publish:${user.role}`);
      return user;
    }),
    getAccountRole: () => role,
    isAppInitialized: () => initialized,
    setAppInitialized: vi.fn((value: boolean) => {
      initialized = value;
      calls.push(`initialized:${value}`);
    }),
    persistGatewaySecret: vi.fn(async () => {
      calls.push('persist');
      return options.persisted ?? true;
    }),
    setPortfolioGatewaySecret: vi.fn((secret: string) => calls.push(`store-secret:${secret}`)),
    showToast: vi.fn((message: string, tone: 'error') => calls.push(`toast:${tone}:${message}`)),
    emitGatewaySecretAuthenticated: vi.fn((secret: string) => calls.push(`event:${secret}`)),
    setActiveView: vi.fn((view: string) => calls.push(`view:${view}`)),
    resolveRefreshInterval: vi.fn((accountRole: AuthRole) => {
      calls.push(`resolve-interval:${accountRole}`);
      return accountRole === 'guest' ? 15_000 : 60_000;
    }),
    setQuoteRefreshInterval: vi.fn((intervalMs: number) => calls.push(`interval:${intervalMs}`)),
    pullGuestPortfolioSnapshot: vi.fn(async () => { calls.push('pull-guest'); }),
    pullAdminPortfolioSnapshot: vi.fn(async () => { calls.push('pull-admin'); }),
    refreshAllLivePrices: vi.fn(async () => { calls.push('refresh-quotes'); }),
    startApp: vi.fn(async () => {
      calls.push('start-app');
      if (options.startApp) await options.startApp();
    }),
    hideAuthContainer: vi.fn(() => calls.push('hide-auth'))
  };

  return {
    dependencies,
    calls,
    getState: () => ({ role, initialized })
  };
}

type AuthRole = AuthUser['role'];

describe('portfolio authentication runtime', () => {
  it('rejects an empty credential before making validation or persistence requests', async () => {
    const fixture = createFixture();
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret('   ')).resolves.toBe(false);

    expect(fixture.dependencies.validateGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.saveGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.persistGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.showToast).toHaveBeenCalledWith(
      'Please sign in with your account.',
      'error'
    );
  });

  it('does not persist or publish an invalid credential', async () => {
    const fixture = createFixture({ valid: false });
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret(' bad-token ')).resolves.toBe(false);

    expect(fixture.dependencies.validateGatewaySecret).toHaveBeenCalledWith('bad-token');
    expect(fixture.dependencies.saveGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.publishCurrentUser).not.toHaveBeenCalled();
    expect(fixture.dependencies.persistGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.hideAuthContainer).not.toHaveBeenCalled();
  });

  it('initializes a newly authenticated guest after saving the verified credential', async () => {
    const fixture = createFixture();
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret(' session-token ')).resolves.toBe(true);

    expect(fixture.calls).toEqual([
      'validate:session-token',
      'save:session-token',
      'publish:guest',
      'view:BALANCE',
      'persist',
      'store-secret:session-token',
      'event:session-token',
      'start-app',
      'initialized:true',
      'view:BALANCE',
      'hide-auth'
    ]);
    expect(fixture.dependencies.pullGuestPortfolioSnapshot).not.toHaveBeenCalled();
    expect(fixture.dependencies.pullAdminPortfolioSnapshot).not.toHaveBeenCalled();
    expect(fixture.dependencies.refreshAllLivePrices).not.toHaveBeenCalled();
  });

  it('refreshes only the guest projection and quotes when an existing session switches to a guest', async () => {
    const fixture = createFixture({ initialized: true, user: guestUser });
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret('guest-token')).resolves.toBe(true);

    expect(fixture.dependencies.publishCurrentUser).toHaveBeenCalledTimes(2);
    expect(fixture.dependencies.resolveRefreshInterval).toHaveBeenCalledWith('guest');
    expect(fixture.dependencies.setQuoteRefreshInterval).toHaveBeenCalledWith(15_000);
    expect(fixture.dependencies.pullGuestPortfolioSnapshot).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.pullAdminPortfolioSnapshot).not.toHaveBeenCalled();
    expect(fixture.dependencies.refreshAllLivePrices).toHaveBeenCalledTimes(1);
    expect(fixture.calls.indexOf('pull-guest')).toBeLessThan(fixture.calls.indexOf('refresh-quotes'));
    expect(fixture.dependencies.setActiveView).toHaveBeenCalledTimes(2);
  });

  it('refreshes the shared workspace and quotes when an existing session switches to an administrator', async () => {
    const fixture = createFixture({ initialized: true, user: adminUser });
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret('admin-token')).resolves.toBe(true);

    expect(fixture.dependencies.resolveRefreshInterval).toHaveBeenCalledWith('admin');
    expect(fixture.dependencies.setQuoteRefreshInterval).toHaveBeenCalledWith(60_000);
    expect(fixture.dependencies.pullAdminPortfolioSnapshot).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.pullGuestPortfolioSnapshot).not.toHaveBeenCalled();
    expect(fixture.dependencies.refreshAllLivePrices).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.setActiveView).not.toHaveBeenCalled();
  });

  it('continues authentication with a warning when secure local persistence fails', async () => {
    const fixture = createFixture({ persisted: false });
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret('session-token')).resolves.toBe(true);

    expect(fixture.dependencies.showToast).toHaveBeenCalledWith(
      'Secure session storage failed. Sign in again after refresh.',
      'error'
    );
    expect(fixture.dependencies.setPortfolioGatewaySecret).toHaveBeenCalledWith('session-token');
    expect(fixture.dependencies.startApp).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.hideAuthContainer).toHaveBeenCalledTimes(1);
  });

  it('does not mark startup complete or hide authentication if startup rejects', async () => {
    const fixture = createFixture({
      startApp: async () => { throw new Error('Startup failed'); }
    });
    const runtime = createPortfolioAuthenticationRuntime(fixture.dependencies);

    await expect(runtime.handleSaveGatewaySecret('session-token')).rejects.toThrow('Startup failed');

    expect(fixture.dependencies.setAppInitialized).not.toHaveBeenCalled();
    expect(fixture.dependencies.hideAuthContainer).not.toHaveBeenCalled();
  });
});
