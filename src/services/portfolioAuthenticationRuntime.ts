import type { AuthUser } from './api';

type AuthRole = AuthUser['role'];

export interface PortfolioAuthenticationRuntimeDependencies {
  validateGatewaySecret: (secret: string) => Promise<boolean>;
  saveGatewaySecret: (secret: string) => void;
  publishCurrentUser: () => Promise<AuthUser | null>;
  getAccountRole: () => AuthRole | null;
  isAppInitialized: () => boolean;
  setAppInitialized: (initialized: boolean) => void;
  persistGatewaySecret: () => Promise<boolean>;
  setPortfolioGatewaySecret: (secret: string) => void;
  showToast: (message: string, tone: 'error') => void;
  emitGatewaySecretAuthenticated: (secret: string) => void;
  setActiveView: (view: string) => void;
  resolveRefreshInterval: (role: AuthRole) => number;
  setQuoteRefreshInterval: (intervalMs: number) => void;
  pullGuestPortfolioSnapshot: () => Promise<unknown>;
  pullAdminPortfolioSnapshot: () => Promise<unknown>;
  refreshAllLivePrices: () => Promise<unknown>;
  startApp: (secret: string) => Promise<void>;
  hideAuthContainer: () => void;
}

export interface PortfolioAuthenticationRuntime {
  handleSaveGatewaySecret: (secret: string) => Promise<boolean>;
}

/**
 * Coordinates credential verification, persistence, and the first authenticated
 * account refresh. App/store ownership stays in the injected callbacks; this
 * module does not read browser storage or mutate portfolio state directly.
 */
export function createPortfolioAuthenticationRuntime(
  dependencies: PortfolioAuthenticationRuntimeDependencies
): PortfolioAuthenticationRuntime {
  const handleSaveGatewaySecret = async (secret: string): Promise<boolean> => {
    const submittedSecret = secret.trim();
    if (!submittedSecret) {
      dependencies.showToast('Please sign in with your account.', 'error');
      return false;
    }

    // Validate first so a wrong or unverified secret is never written to device storage.
    const authenticated = await dependencies.validateGatewaySecret(submittedSecret);
    if (!authenticated) return false;

    dependencies.saveGatewaySecret(submittedSecret);
    // Resolve the account role before any store update can trigger the cloud-write subscriber.
    const authenticatedUser = await dependencies.publishCurrentUser();
    // Move a guest into their own Balance view immediately. The startup/pull path
    // below may take time or fail transiently; navigation must not depend on it.
    if (authenticatedUser?.role === 'guest') dependencies.setActiveView('BALANCE');

    const persisted = await dependencies.persistGatewaySecret();
    dependencies.setPortfolioGatewaySecret(submittedSecret);
    if (!persisted) {
      dependencies.showToast('Secure session storage failed. Sign in again after refresh.', 'error');
    }

    dependencies.emitGatewaySecretAuthenticated(submittedSecret);
    if (!dependencies.isAppInitialized()) {
      await dependencies.startApp(submittedSecret);
      dependencies.setAppInitialized(true);
    } else {
      await dependencies.publishCurrentUser();
      const refreshScope: AuthRole = dependencies.getAccountRole() === 'guest' ? 'guest' : 'admin';
      dependencies.setQuoteRefreshInterval(dependencies.resolveRefreshInterval(refreshScope));

      // Guests load only their server-scoped projection; administrators load the shared workspace.
      if (refreshScope === 'guest') await dependencies.pullGuestPortfolioSnapshot();
      else await dependencies.pullAdminPortfolioSnapshot();
      await dependencies.refreshAllLivePrices();
    }

    // Guests always land on their own Balance view, but only after data is ready.
    if (dependencies.getAccountRole() === 'guest') dependencies.setActiveView('BALANCE');
    // Keep the modal visible until startup, cloud data, and initial quotes finish.
    dependencies.hideAuthContainer();
    return true;
  };

  return { handleSaveGatewaySecret };
}
