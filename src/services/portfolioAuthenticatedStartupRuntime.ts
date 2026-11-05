export type AuthenticatedStartupRole = 'admin' | 'guest' | null;

export interface PortfolioAuthenticatedStartupDependencies {
  hydrateLocalPortfolioState: () => Promise<void>;
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
    // Establish role and write permission before reading any local administrator
    // state. Guest sessions must never hydrate the administrator's local database.
    // The local IndexedDB snapshot is reconciled before admin portfolio import.
    //
    if (secret) await dependencies.publishCurrentUser();
    else dependencies.clearAccountIdentity();

    dependencies.setGatewaySecret(secret);
    const role = dependencies.getAccountRole();
    if (role === 'guest') {
      dependencies.loadBrokerRules();
      // Replace any administrator workspace before the guest UI can render.
      await dependencies.pullGuestPortfolioSnapshot();
    } else {
      await dependencies.hydrateLocalPortfolioState();
      dependencies.loadBrokerRules();
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
    await dependencies.refreshLivePrices();
    dependencies.finishInitialQuoteRefresh();

    if (role === 'guest') dependencies.showGuestBalanceView();
    dependencies.renderBoardAnalystConsensus();
    await dependencies.recoverPendingCloudWrites();
    dependencies.hideStartupLoading();
  };

  return { startApp };
}
