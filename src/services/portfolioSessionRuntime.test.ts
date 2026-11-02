import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitUiEvent } from '../ui/uiEventBus';
import type { AuthUser } from './api';
import {
  createPortfolioSessionRuntime,
  type PortfolioSessionRuntimeDependencies
} from './portfolioSessionRuntime';

const adminUser: AuthUser = {
  id: 'admin-a',
  name: 'Administrator',
  role: 'admin',
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z'
};

const guestUser: AuthUser = {
  id: 'guest-a',
  name: 'Guest',
  role: 'guest',
  language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z'
};

function createFixture(initialRole: AuthUser['role'] | null = 'admin', initialId: string | null = 'admin-a') {
  let role = initialRole;
  let accountId = initialId;
  let canWriteCloudState = initialRole === 'admin';
  const calls: string[] = [];

  const dependencies: PortfolioSessionRuntimeDependencies = {
    getCurrentUser: vi.fn(async () => guestUser),
    getAccountRole: () => role,
    getAccountId: () => accountId,
    setAccountRole: vi.fn((nextRole) => {
      role = nextRole;
      calls.push(`role:${nextRole ?? 'none'}`);
    }),
    setAccountId: vi.fn((nextId) => {
      accountId = nextId;
      calls.push(`account:${nextId ?? 'none'}`);
    }),
    setCloudWritePermission: vi.fn((allowed) => {
      canWriteCloudState = allowed;
      calls.push(`cloud-write:${allowed}`);
    }),
    setSessionIdentity: vi.fn((identity) => calls.push(`identity:${identity ?? 'none'}`)),
    clearCloudEncryptionSecretCache: vi.fn(() => calls.push('clear-encryption-cache')),
    clearPendingCloudWrite: vi.fn(() => calls.push('clear-cloud-write-timer')),
    clearGuestWorkspace: vi.fn(() => calls.push('clear-guest-workspace')),
    emitUserChanged: vi.fn((user) => calls.push(user ? `user:${user.role}:${user.id}` : 'user:none')),
    showToast: vi.fn((message, tone) => calls.push(`toast:${tone}:${message}`)),
    logoutAccount: vi.fn(async () => { calls.push('logout-api'); }),
    clearSavedGatewaySecret: vi.fn(() => calls.push('clear-saved-secret')),
    persistGatewaySecret: vi.fn(async () => {
      calls.push('persist-secret');
      return true;
    }),
    clearStoreGatewaySecret: vi.fn(() => calls.push('clear-store-secret')),
    reloadPage: vi.fn(() => calls.push('reload'))
  };

  return {
    dependencies,
    calls,
    getState: () => ({ role, accountId, canWriteCloudState })
  };
}

describe('portfolio session runtime', () => {
  let unbindLogout: (() => void) | undefined;

  afterEach(() => {
    unbindLogout?.();
    unbindLogout = undefined;
  });

  it('switches to a guest before clearing the previous shared workspace', async () => {
    const fixture = createFixture();
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);

    const user = await runtime.publishCurrentUser();

    expect(user).toEqual(guestUser);
    expect(fixture.getState()).toEqual({
      role: 'guest',
      accountId: 'guest-a',
      canWriteCloudState: false
    });
    expect(fixture.calls).toEqual([
      'clear-encryption-cache',
      'identity:guest:guest-a',
      'role:guest',
      'account:guest-a',
      'cloud-write:false',
      'clear-cloud-write-timer',
      'clear-guest-workspace',
      'user:guest:guest-a'
    ]);
  });

  it('enables administrator writes when switching from a guest without clearing guest workspace state', async () => {
    const fixture = createFixture('guest', 'guest-a');
    fixture.dependencies.getCurrentUser = vi.fn(async () => adminUser);
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);

    const user = await runtime.publishCurrentUser();

    expect(user).toEqual(adminUser);
    expect(fixture.getState()).toEqual({
      role: 'admin',
      accountId: 'admin-a',
      canWriteCloudState: true
    });
    expect(fixture.dependencies.clearGuestWorkspace).not.toHaveBeenCalled();
    expect(fixture.calls).toContain('cloud-write:true');
    expect(fixture.calls.at(-1)).toBe('user:admin:admin-a');
  });

  it('does not invalidate caches or clear workspace for a repeated identity notification', async () => {
    const fixture = createFixture('guest', 'guest-a');
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);

    await runtime.publishCurrentUser();

    expect(fixture.dependencies.clearCloudEncryptionSecretCache).not.toHaveBeenCalled();
    expect(fixture.dependencies.setSessionIdentity).not.toHaveBeenCalled();
    expect(fixture.dependencies.clearPendingCloudWrite).not.toHaveBeenCalled();
    expect(fixture.dependencies.clearGuestWorkspace).not.toHaveBeenCalled();
  });

  it('clears account permissions and invalidates the session when identity lookup fails', async () => {
    const fixture = createFixture();
    fixture.dependencies.getCurrentUser = vi.fn(async () => {
      throw new Error('Authentication service unavailable');
    });
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);

    const user = await runtime.publishCurrentUser();

    expect(user).toBeNull();
    expect(fixture.getState()).toEqual({
      role: null,
      accountId: null,
      canWriteCloudState: false
    });
    expect(fixture.dependencies.setSessionIdentity).toHaveBeenCalledWith(null);
    expect(fixture.dependencies.emitUserChanged).toHaveBeenCalledWith(null);
  });

  it('allows administrator-only operations for an admin session', async () => {
    const fixture = createFixture();
    fixture.dependencies.getCurrentUser = vi.fn(async () => adminUser);
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);

    await expect(runtime.requireAdmin('export backups')).resolves.toBe(true);
    expect(fixture.dependencies.showToast).not.toHaveBeenCalled();
  });

  it('rejects administrator-only operations for a guest session', async () => {
    const fixture = createFixture();
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);

    await expect(runtime.requireAdmin('export backups')).resolves.toBe(false);
    expect(fixture.dependencies.showToast).toHaveBeenCalledWith(
      'Only administrators can export backups.',
      'error'
    );
  });

  it('logs out, clears the local credential, and reloads even when server logout fails', async () => {
    const fixture = createFixture();
    fixture.dependencies.logoutAccount = vi.fn(async () => {
      fixture.calls.push('logout-api');
      throw new Error('Remote logout failed');
    });
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);
    unbindLogout = runtime.bindLogout();

    emitUiEvent('auth:logout');

    await vi.waitFor(() => expect(fixture.dependencies.reloadPage).toHaveBeenCalledTimes(1));

    expect(fixture.calls).toEqual([
      'logout-api',
      'toast:error:Remote logout failed',
      'clear-saved-secret',
      'persist-secret',
      'clear-store-secret',
      'reload'
    ]);
  });

  it('removes the logout listener when disposed', () => {
    const fixture = createFixture();
    const runtime = createPortfolioSessionRuntime(fixture.dependencies);
    unbindLogout = runtime.bindLogout();
    unbindLogout();
    unbindLogout = undefined;

    emitUiEvent('auth:logout');

    expect(fixture.dependencies.logoutAccount).not.toHaveBeenCalled();
    expect(fixture.dependencies.reloadPage).not.toHaveBeenCalled();
  });
});
