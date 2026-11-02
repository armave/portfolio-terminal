import { addUiEventListener, removeUiEventListener, type UiEvent } from '../ui/uiEventBus';
import type { AuthUser } from './api';

export interface PortfolioSessionRuntimeDependencies {
  getCurrentUser: () => Promise<AuthUser>;
  getAccountRole: () => AuthUser['role'] | null;
  getAccountId: () => string | null;
  setAccountRole: (role: AuthUser['role'] | null) => void;
  setAccountId: (accountId: string | null) => void;
  setCloudWritePermission: (allowed: boolean) => void;
  setSessionIdentity: (identity: string | null) => void;
  clearCloudEncryptionSecretCache: () => void;
  clearPendingCloudWrite: () => void;
  clearGuestWorkspace: () => void;
  emitUserChanged: (user: AuthUser | null) => void;
  showToast: (message: string, tone: 'error') => void;
  logoutAccount: () => Promise<void>;
  clearSavedGatewaySecret: () => void;
  persistGatewaySecret: () => Promise<boolean>;
  clearStoreGatewaySecret: () => void;
  reloadPage: () => void;
}

export interface PortfolioSessionRuntime {
  publishCurrentUser: () => Promise<AuthUser | null>;
  requireAdmin: (action: string) => Promise<boolean>;
  bindLogout: () => () => void;
}

/**
 * Coordinates the active account identity, cloud-write permission, and session
 * cleanup. App-specific workspace operations remain injected so this service
 * cannot become a second portfolio state owner.
 */
export function createPortfolioSessionRuntime(
  dependencies: PortfolioSessionRuntimeDependencies
): PortfolioSessionRuntime {
  const publishCurrentUser = async (): Promise<AuthUser | null> => {
    try {
      const user = await dependencies.getCurrentUser();
      const identityChanged =
        dependencies.getAccountRole() !== user.role ||
        dependencies.getAccountId() !== user.id;

      if (identityChanged) {
        dependencies.clearCloudEncryptionSecretCache();
        dependencies.setSessionIdentity(`${user.role}:${user.id}`);
      }

      // Permissions must change before guest workspace clearing can notify the
      // store, otherwise a pending administrator subscription could enqueue a
      // shared-workspace write for the guest session.
      dependencies.setAccountRole(user.role);
      dependencies.setAccountId(user.id);
      dependencies.setCloudWritePermission(user.role === 'admin');

      if (identityChanged && user.role === 'guest') {
        // Clear a previously hydrated administrator workspace before the UI
        // receives the guest identity event or renders the Balance screen.
        dependencies.clearPendingCloudWrite();
        dependencies.clearGuestWorkspace();
      }

      dependencies.emitUserChanged(user);
      return user;
    } catch {
      dependencies.setAccountRole(null);
      dependencies.setAccountId(null);
      dependencies.setCloudWritePermission(false);
      dependencies.setSessionIdentity(null);
      dependencies.emitUserChanged(null);
      return null;
    }
  };

  const requireAdmin = async (action: string): Promise<boolean> => {
    const user = await publishCurrentUser();
    if (user?.role === 'admin') return true;
    dependencies.showToast(`Only administrators can ${action}.`, 'error');
    return false;
  };

  const handleLogout = (_event: UiEvent<undefined>): void => {
    void (async () => {
      try {
        await dependencies.logoutAccount();
      } catch (error) {
        dependencies.showToast(
          error instanceof Error ? error.message : 'Could not sign out cleanly.',
          'error'
        );
      } finally {
        dependencies.clearSavedGatewaySecret();
        await dependencies.persistGatewaySecret();
        dependencies.clearStoreGatewaySecret();
        dependencies.reloadPage();
      }
    })();
  };

  const bindLogout = (): (() => void) => {
    addUiEventListener('auth:logout', handleLogout);
    return () => removeUiEventListener('auth:logout', handleLogout);
  };

  return { publishCurrentUser, requireAdmin, bindLogout };
}
