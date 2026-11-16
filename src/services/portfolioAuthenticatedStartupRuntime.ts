export type AuthenticatedStartupRole = 'admin' | 'guest' | null;

type StartupBackgroundTask = 'initial-quotes' | 'pending-cloud-writes' | 'shared-cloud-pull' | 'guest-snapshot';

export interface PortfolioAuthenticatedStartupDependencies {
  loadBrokerRules: () => void;
  publishCurrentUser: () => Promise<unknown>;
  clearAccountIdentity: () => void;
  initializeOfflineHistoryStorage: () => Promise<unknown>;
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
  reportBackgroundStartupError?: (task: StartupBackgroundTask, error: unknown) => void;
}

export interface PortfolioAuthenticatedStartupRuntime {
  startApp: (secret: string) => Promise<void>;
}

const INITIAL_QUOTE_REFRESH_DEADLINE_MS = 15_000;

function reportBackgroundError(
  dependencies: PortfolioAuthenticatedStartupDependencies,
  task: StartupBackgroundTask,
  error: unknown
): void {
  dependencies.reportBackgroundStartupError?.(task, error);
}

/**
 * Sequences authenticated admin/guest workspace startup without taking ownership
 * of portfolio storage, quote providers, cloud sync, or financial calculations.
 * The saved workspace becomes interactive before nonessential live-price and
 * pending-write work finishes; those tasks must never hold the startup shell open.
 */
export function createPortfolioAuthenticatedStartupRuntime(
  dependencies: PortfolioAuthenticatedStartupDependencies
): PortfolioAuthenticatedStartupRuntime {
  const startInitialQuoteRefresh = (role: AuthenticatedStartupRole): void => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const refresh = Promise.resolve().then(() => dependencies.refreshLivePrices());
    const deadline = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Initial market-data refresh exceeded its startup deadline.'));
      }, INITIAL_QUOTE_REFRESH_DEADLINE_MS);
    });

    void Promise.race([refresh, deadline])
      .catch((error) => reportBackgroundError(dependencies, 'initial-quotes', error))
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        dependencies.finishInitialQuoteRefresh();
        if (role === 'guest') dependencies.showGuestBalanceView();
        try {
          dependencies.renderBoardAnalystConsensus();
        } catch (error) {
          reportBackgroundError(dependencies, 'initial-quotes', error);
        }
      });
  };

  const recoverPendingCloudWritesInBackground = (): void => {
    void Promise.resolve()
      .then(() => dependencies.recoverPendingCloudWrites())
      .catch((error) => reportBackgroundError(dependencies, 'pending-cloud-writes', error));
  };

  const synchronizeWorkspaceInBackground = (role: AuthenticatedStartupRole, secret: string): void => {
    if (role === 'guest') {
      void Promise.resolve()
        .then(() => dependencies.pullGuestPortfolioSnapshot())
        .catch((error) => reportBackgroundError(dependencies, 'guest-snapshot', error));
      return;
    }
    if (secret) {
      void Promise.resolve()
        .then(() => dependencies.pullSharedCloudState())
        .catch((error) => reportBackgroundError(dependencies, 'shared-cloud-pull', error));
    }
  };

  const startApp = async (secret: string): Promise<void> => {
    // Resolve identity and activate its account-scoped storage before reading rules.
    // Offline history is initialized only after we know no account workspace applies.
    if (secret) await dependencies.publishCurrentUser();
    if (!secret) dependencies.clearAccountIdentity();
    if (!secret || dependencies.getAccountRole() === null) {
      await dependencies.initializeOfflineHistoryStorage();
    }

    dependencies.loadBrokerRules();
    dependencies.setGatewaySecret(secret);
    const role = dependencies.getAccountRole();
    if (role !== 'guest') {
      dependencies.importSavedAdminWorkspace();
      dependencies.applyOvernightRollover();
    }

    dependencies.setQuoteRefreshInterval(dependencies.getInitialQuoteRefreshInterval(role));
    dependencies.configureAdminRollover(role === 'admin');

    // Avoid duplicate per-ticker analyst requests while the initial quote batch
    // already includes deep data for the tracked symbols.
    dependencies.beginInitialQuoteRefresh();
    if (role === 'guest') dependencies.showGuestBalanceView();
    else dependencies.showSavedAdminView();

    dependencies.scrollWorkspace();

    // Local/account workspace and its initial cloud/guest snapshot are ready.
    // Live quotes and cloud-write recovery continue without blocking navigation.
    dependencies.hideStartupLoading();
    synchronizeWorkspaceInBackground(role, secret);
    startInitialQuoteRefresh(role);
    recoverPendingCloudWritesInBackground();
  };

  return { startApp };
}
