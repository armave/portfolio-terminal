export type AuthenticatedStartupRole = 'admin' | 'guest' | null;

export type BackgroundStartupOperation = 'quote-refresh' | 'cloud-write-recovery';

export interface PortfolioAuthenticatedStartupDependencies {
  loadBrokerRules: () => void;
  publishCurrentUser: () => Promise<unknown>;
  clearAccountIdentity: () => void;
  setGatewaySecret: (secret: string) => void;
  getAccountRole: () => AuthenticatedStartupRole;
  pullGuestPortfolioSnapshot: () => Promise<unknown>;
  importSavedAdminWorkspace: () => void;
  applyOvernightRollover: () => void;
  pullSharedCloudState: () => Promise<unknown>;
  getInitialQuoteRefreshInterval: (role: AuthenticatedStartupRole) => number | string;
  setQuoteRefreshInterval: (interval: number | string) => number;
  configureAdminRollover: (enabled: boolean) => void;
  beginInitialQuoteRefresh: () => void;
  showGuestBalanceView: () => void;
  showSavedAdminView: () => void;
  scrollWorkspace: () => void;
  refreshLivePrices: () => Promise<unknown>;
  finishInitialQuoteRefresh: () => void;
  renderBoardAnalystConsensus: () => void;
  recoverPendingCloudWrites: () => Promise<void>;
  hideStartupLoading: () => void;
  onBackgroundStartupError?: (operation: BackgroundStartupOperation, error: unknown) => void;
}

export interface PortfolioAuthenticatedStartupRuntime {
  startApp: (secret: string) => Promise<void>;
}

/**
 * Sequences authenticated admin/guest workspace startup without taking ownership
 * of portfolio storage, quote providers, cloud sync, or financial calculations.
 */
export function createPortfolioAuthenticatedStartupRuntime(
  dependencies: PortfolioAuthenticatedStartupDependencies
): PortfolioAuthenticatedStartupRuntime {
  const startApp = async (secret: string): Promise<void> => {
    dependencies.loadBrokerRules();

    // Establish role and write permission before importing state or refreshing quotes.
    if (secret) await dependencies.publishCurrentUser();
    else dependencies.clearAccountIdentity();

    dependencies.setGatewaySecret(secret);
    const role = dependencies.getAccountRole();
    if (role === 'guest') {
      // Replace any administrator workspace before the guest UI can render.
      await dependencies.pullGuestPortfolioSnapshot();
    } else {
      dependencies.importSavedAdminWorkspace();
      dependencies.applyOvernightRollover();
      if (secret) await dependencies.pullSharedCloudState();
    }

    dependencies.setQuoteRefreshInterval(dependencies.getInitialQuoteRefreshInterval(role));
    dependencies.configureAdminRollover(role === 'admin');

    // Avoid duplicate per-ticker analyst requests while the initial quote batch
    // already includes deep data for the tracked symbols.
    dependencies.beginInitialQuoteRefresh();
    if (role === 'guest') dependencies.showGuestBalanceView();
    else dependencies.showSavedAdminView();

    dependencies.scrollWorkspace();

    // The selected workspace is now fully hydrated and safe to use. Market data
    // and pending cloud-write recovery must not keep the blocking startup overlay
    // visible when their providers are slow or unavailable.
    dependencies.hideStartupLoading();

    const refreshQuotesInBackground = async (): Promise<void> => {
      try {
        await dependencies.refreshLivePrices();
      } catch (error) {
        dependencies.onBackgroundStartupError?.('quote-refresh', error);
      } finally {
        dependencies.finishInitialQuoteRefresh();
        dependencies.renderBoardAnalystConsensus();
      }
    };
    const recoverCloudWritesInBackground = async (): Promise<void> => {
      try {
        await dependencies.recoverPendingCloudWrites();
      } catch (error) {
        dependencies.onBackgroundStartupError?.('cloud-write-recovery', error);
      }
    };

    // Start both independent operations after the workspace is visible. The
    // quote completion path no longer changes navigation, so a user who starts
    // navigating immediately after startup is not sent back to Balance.
    void refreshQuotesInBackground();
    void recoverCloudWritesInBackground();
  };

  return { startApp };
}
