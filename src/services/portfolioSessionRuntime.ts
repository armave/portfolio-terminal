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
  /** Cancel queued/in-flight API reads before changing account scope. */
  cancelPendingApiReads: () => void;
  clearCloudEncryptionSecretCache: () => void;
  clearPendingCloudWrite: () => void;
  activateWorkspaceStorage: (user: AuthUser) => Promise<void>;
  clearWorkspaceOnAuthFailure: () => Promise<void>;
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
  const initialRole = dependencies.getAccountRole();
  const initialAccountId = dependencies.getAccountId();
  let publishGeneration = 0;
  let activeWorkspaceIdentity: string | null =
    initialRole && initialAccountId ? `${initialRole}:${initialAccountId}` : null;
  let pendingWorkspaceActivation: { identity: string; promise: Promise<void> } | null = null;

  const publishCurrentUser = async (): Promise<AuthUser | null> => {
    const requestGeneration = ++publishGeneration;
    try {
      const user = await dependencies.getCurrentUser();
      // An older identity lookup must not publish after a newer auth request.
      if (requestGeneration !== publishGeneration) return null;

      const identity = `${user.role}:${user.id}`;
      const identityChanged =
        dependencies.getAccountRole() !== user.role ||
        dependencies.getAccountId() !== user.id;

      if (identityChanged) {
        activeWorkspaceIdentity = null;
        dependencies.setCloudWritePermission(false);
        dependencies.cancelPendingApiReads();
        dependencies.clearCloudEncryptionSecretCache();
        dependencies.clearPendingCloudWrite();
        dependencies.setSessionIdentity(identity);
      }

      dependencies.setAccountRole(user.role);
      dependencies.setAccountId(user.id);

      // Repeated checks for the same identity share the pending transition.
      // Different identities supersede it and are protected by requestGeneration.
      if (activeWorkspaceIdentity !== identity) {
        if (!identityChanged) dependencies.setCloudWritePermission(false);
        if (!pendingWorkspaceActivation || pendingWorkspaceActivation.identity !== identity) {
          const activation = {
            identity,
            promise: dependencies.activateWorkspaceStorage(user)
          };
          pendingWorkspaceActivation = activation;
          void activation.promise.catch(() => {
            if (pendingWorkspaceActivation === activation) pendingWorkspaceActivation = null;
          });
        }

        const activation = pendingWorkspaceActivation;
        await activation.promise;
        if (
          requestGeneration !== publishGeneration ||
          dependencies.getAccountRole() !== user.role ||
          dependencies.getAccountId() !== user.id
        ) return null;

        activeWorkspaceIdentity = identity;
        if (pendingWorkspaceActivation === activation) pendingWorkspaceActivation = null;
      }

      if (
        requestGeneration !== publishGeneration ||
        dependencies.getAccountRole() !== user.role ||
        dependencies.getAccountId() !== user.id
      ) return null;

      if (user.role === 'admin') dependencies.setCloudWritePermission(true);
      dependencies.emitUserChanged(user);
      return user;
    } catch {
      // A failed stale transition must never clear or invalidate a newer session.
      if (requestGeneration !== publishGeneration) return null;

      activeWorkspaceIdentity = null;
      pendingWorkspaceActivation = null;
      dependencies.setCloudWritePermission(false);
      dependencies.cancelPendingApiReads();
      dependencies.clearPendingCloudWrite();
      dependencies.setAccountRole(null);
      dependencies.setAccountId(null);
      dependencies.setSessionIdentity(null);
      try {
        await dependencies.clearWorkspaceOnAuthFailure();
      } catch {
        // Keep the invalid session blocked even if local cleanup is unavailable.
      }
      // A newer login may begin while offline storage cleanup is awaiting I/O.
      // Do not publish a stale signed-out event over that newer identity.
      if (requestGeneration !== publishGeneration) return null;
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
