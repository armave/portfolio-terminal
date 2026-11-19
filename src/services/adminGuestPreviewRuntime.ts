import type { AuthSession, AuthUser } from './authTransportRuntime';

export interface AdminGuestPreviewRuntimeDependencies {
  getAccountRole: () => AuthUser['role'] | null;
  getActiveGatewaySecret: () => string;
  getActiveView: () => string;
  setActiveGatewaySecret: (secret: string) => void;
  setPortfolioGatewaySecret: (secret: string) => void;
  setActiveView: (view: string) => void;
  startPreviewSession: (guestUserId: string) => Promise<AuthSession>;
  endPreviewSession: () => Promise<void>;
  getUserForGatewaySecret: (secret: string) => Promise<AuthUser | null>;
  clearSavedGatewaySecret: () => Promise<void>;
  startWorkspace: (secret: string) => Promise<void>;
  showAuthContainer: () => void;
  showToast: (message: string, variant: 'success' | 'warning') => void;
}

export interface AdminGuestPreviewRuntime {
  start: (guestUserId: string) => Promise<void>;
  returnToAdmin: () => Promise<void>;
  isActive: () => boolean;
}

export function createAdminGuestPreviewRuntime(
  dependencies: AdminGuestPreviewRuntimeDependencies
): AdminGuestPreviewRuntime {
  let originalAdminSecret = '';
  let originalAdminView = '';
  let transitioning = false;

  const isActive = (): boolean => Boolean(originalAdminSecret);

  const start = async (guestUserId: string): Promise<void> => {
    if (transitioning) throw new Error('An account transition is already in progress.');
    if (isActive()) throw new Error('A guest preview is already active.');
    if (dependencies.getAccountRole() !== 'admin') {
      throw new Error('Only administrators can preview guest accounts.');
    }
    const adminSecret = dependencies.getActiveGatewaySecret().trim();
    if (!adminSecret) throw new Error('The administrator session is unavailable.');

    transitioning = true;
    let previewSession: AuthSession | null = null;
    try {
      previewSession = await dependencies.startPreviewSession(guestUserId);
      if (previewSession.user.role !== 'guest') {
        throw new Error('Only guest accounts have a separate dashboard to preview.');
      }

      // Keep the original credential in this module's memory only. The encrypted
      // device credential remains the admin token; the short-lived preview token
      // must never be persisted as the device's normal sign-in credential.
      originalAdminSecret = adminSecret;
      originalAdminView = dependencies.getActiveView();
      dependencies.setActiveGatewaySecret(previewSession.token);
      dependencies.setPortfolioGatewaySecret(previewSession.token);
      await dependencies.startWorkspace(previewSession.token);
      if (dependencies.getAccountRole() !== 'guest') {
        throw new Error('The guest preview session could not be activated.');
      }
    } catch (error) {
      if (previewSession) {
        try {
          await dependencies.endPreviewSession();
        } catch {
          // The 30-minute server expiry remains the final cleanup boundary.
        }
      }
      originalAdminSecret = '';
      dependencies.setActiveGatewaySecret(adminSecret);
      dependencies.setPortfolioGatewaySecret(adminSecret);
      try {
        await dependencies.startWorkspace(adminSecret);
        if (originalAdminView) dependencies.setActiveView(originalAdminView);
      } catch {
        dependencies.setActiveGatewaySecret('');
        dependencies.setPortfolioGatewaySecret('');
        await dependencies.clearSavedGatewaySecret();
        dependencies.showAuthContainer();
      }
      throw error;
    } finally {
      transitioning = false;
    }
  };

  const returnToAdmin = async (): Promise<void> => {
    if (transitioning) throw new Error('An account transition is already in progress.');
    if (!originalAdminSecret) throw new Error('No administrator preview is active.');
    transitioning = true;
    const adminSecret = originalAdminSecret;
    const previousView = originalAdminView;

    try {
      const parentAdminUser = await dependencies.getUserForGatewaySecret(adminSecret);
      if (!parentAdminUser) {
        originalAdminSecret = '';
        originalAdminView = '';
        dependencies.setActiveGatewaySecret('');
        dependencies.setPortfolioGatewaySecret('');
        await dependencies.clearSavedGatewaySecret();
        await dependencies.startWorkspace('');
        dependencies.showAuthContainer();
        throw new Error('The original administrator session has expired. Sign in again.');
      }

      try {
        await dependencies.endPreviewSession();
      } catch {
        // A lost return response must not strand the administrator. The preview
        // token is memory-only and the server also expires it after 30 minutes.
      }

      dependencies.setActiveGatewaySecret(adminSecret);
      dependencies.setPortfolioGatewaySecret(adminSecret);
      await dependencies.startWorkspace(adminSecret);
      originalAdminSecret = '';
      originalAdminView = '';

      if (dependencies.getAccountRole() === 'admin') {
        if (previousView) dependencies.setActiveView(previousView);
        dependencies.showToast('Returned to the administrator workspace.', 'success');
      } else if (dependencies.getAccountRole() === 'guest') {
        dependencies.showToast('The original account no longer has administrator access.', 'warning');
      } else {
        dependencies.showAuthContainer();
      }
    } finally {
      transitioning = false;
    }
  };

  return { start, returnToAdmin, isActive };
}
