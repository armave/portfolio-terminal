import { describe, expect, it, vi } from 'vitest';
import type { AuthSession, AuthUser } from './authTransportRuntime';
import { createAdminGuestPreviewRuntime } from './adminGuestPreviewRuntime';

const admin: AuthUser = {
  id: 'admin-1', name: 'Admin', role: 'admin', language: 'en', createdAt: '2026-01-01T00:00:00.000Z'
};
const guest: AuthUser = {
  id: 'guest-1', name: 'Guest', role: 'guest', language: 'ru', createdAt: '2026-01-01T00:00:00.000Z'
};
const previewSession: AuthSession = {
  token: 'temporary-preview-token', user: guest, expiresAt: 10_000
};

function createFixture(options: {
  validate?: boolean;
  failPreviewWorkspace?: boolean;
  returnRole?: AuthUser['role'] | null;
} = {}) {
  let activeSecret = 'original-admin-token';
  let activeRole: AuthUser['role'] | null = 'admin';
  let activeView = 'SETTINGS';
  const calls: string[] = [];
  const dependencies = {
    getAccountRole: () => activeRole,
    getActiveGatewaySecret: () => activeSecret,
    getActiveView: () => activeView,
    setActiveGatewaySecret: vi.fn((secret: string) => { activeSecret = secret; calls.push(`secret:${secret}`); }),
    setPortfolioGatewaySecret: vi.fn((secret: string) => calls.push(`store:${secret}`)),
    setActiveView: vi.fn((view: string) => { activeView = view; calls.push(`view:${view}`); }),
    startPreviewSession: vi.fn(async () => previewSession),
    endPreviewSession: vi.fn(async () => { calls.push('end-preview'); }),
    validateGatewaySecret: vi.fn(async () => options.validate ?? true),
    clearSavedGatewaySecret: vi.fn(async () => { calls.push('clear-saved-secret'); activeSecret = ''; }),
    startWorkspace: vi.fn(async (secret: string) => {
      calls.push(`start:${secret}`);
      if (secret === previewSession.token) {
        if (options.failPreviewWorkspace) throw new Error('Guest workspace failed.');
        activeRole = 'guest';
      } else if (secret === 'original-admin-token') {
        activeRole = options.returnRole === undefined ? 'admin' : options.returnRole;
      } else {
        activeRole = null;
      }
    }),
    showAuthContainer: vi.fn(() => calls.push('show-auth')),
    showToast: vi.fn((message: string, variant: 'success' | 'warning') => calls.push(`toast:${variant}:${message}`))
  };
  return {
    runtime: createAdminGuestPreviewRuntime(dependencies),
    dependencies,
    calls,
    getState: () => ({ activeSecret, activeRole, activeView })
  };
}

describe('administrator guest preview runtime', () => {
  it('switches into a guest workspace without persisting the temporary preview token', async () => {
    const fixture = createFixture();
    await fixture.runtime.start(guest.id);

    expect(fixture.getState()).toMatchObject({ activeSecret: previewSession.token, activeRole: 'guest', activeView: 'SETTINGS' });
    expect(fixture.runtime.isActive()).toBe(true);
    expect(fixture.dependencies.startPreviewSession).toHaveBeenCalledWith(guest.id);
    expect(fixture.dependencies.setActiveGatewaySecret).toHaveBeenCalledWith(previewSession.token);
    expect(fixture.dependencies.clearSavedGatewaySecret).not.toHaveBeenCalled();
    expect(fixture.dependencies.startWorkspace).toHaveBeenCalledWith(previewSession.token);
  });

  it('revokes the preview and restores the original administrator token and desk', async () => {
    const fixture = createFixture();
    await fixture.runtime.start(guest.id);
    await fixture.runtime.returnToAdmin();

    expect(fixture.getState()).toEqual({
      activeSecret: 'original-admin-token',
      activeRole: 'admin',
      activeView: 'SETTINGS'
    });
    expect(fixture.runtime.isActive()).toBe(false);
    expect(fixture.dependencies.endPreviewSession).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.setActiveGatewaySecret).toHaveBeenLastCalledWith('original-admin-token');
    expect(fixture.dependencies.setPortfolioGatewaySecret).toHaveBeenLastCalledWith('original-admin-token');
    expect(fixture.dependencies.setActiveView).toHaveBeenCalledWith('SETTINGS');
    expect(fixture.dependencies.clearSavedGatewaySecret).not.toHaveBeenCalled();
  });

  it('clears the saved admin credential and requires sign-in after parent-session expiry', async () => {
    const fixture = createFixture({ validate: false });
    await fixture.runtime.start(guest.id);

    await expect(fixture.runtime.returnToAdmin()).rejects.toThrow('administrator session has expired');
    expect(fixture.dependencies.clearSavedGatewaySecret).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.showAuthContainer).toHaveBeenCalledTimes(1);
    expect(fixture.getState().activeRole).toBeNull();
    expect(fixture.runtime.isActive()).toBe(false);
    expect(fixture.dependencies.endPreviewSession).not.toHaveBeenCalled();
  });

  it('restores the original account even when its admin role was removed during preview', async () => {
    const fixture = createFixture({ returnRole: 'guest' });
    await fixture.runtime.start(guest.id);
    await fixture.runtime.returnToAdmin();

    expect(fixture.getState()).toMatchObject({ activeSecret: 'original-admin-token', activeRole: 'guest' });
    expect(fixture.runtime.isActive()).toBe(false);
    expect(fixture.dependencies.showToast).toHaveBeenCalledWith(
      'The original account no longer has administrator access.',
      'warning'
    );
  });

  it('rolls back to the admin workspace when guest workspace activation fails', async () => {
    const fixture = createFixture({ failPreviewWorkspace: true });

    await expect(fixture.runtime.start(guest.id)).rejects.toThrow('Guest workspace failed.');
    expect(fixture.getState()).toMatchObject({ activeSecret: 'original-admin-token', activeRole: 'admin' });
    expect(fixture.dependencies.endPreviewSession).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.startWorkspace).toHaveBeenNthCalledWith(2, 'original-admin-token');
    expect(fixture.runtime.isActive()).toBe(false);
  });

  it('rejects preview requests from guests before creating a preview session', async () => {
    const fixture = createFixture();
    (fixture as any).dependencies.getAccountRole = () => 'guest';

    await expect(fixture.runtime.start(guest.id)).rejects.toThrow('Only administrators');
    expect(fixture.dependencies.startPreviewSession).not.toHaveBeenCalled();
  });
});
