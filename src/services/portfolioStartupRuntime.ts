interface StartupAuthStatus {
  setupRequired: boolean;
}

export interface PortfolioStartupRuntimeDependencies {
  isInitialized: () => boolean;
  setInitialized: (initialized: boolean) => void;
  restoreGatewaySecret: () => Promise<string>;
  validateGatewaySecret: (secret: string) => Promise<boolean>;
  getAuthStatus: () => Promise<StartupAuthStatus>;
  clearSavedGatewaySecret: () => void;
  persistGatewaySecret: () => Promise<boolean>;
  loadBrokerRules: () => void;
  clearUnresolvedWorkspace: () => void;
  showBalanceView: () => void;
  hideStartupLoading: () => void;
  showAuthContainer: () => void;
  hideAuthContainer: () => void;
  startApp: (secret: string) => Promise<void>;
  onStartupFailure: (error: unknown) => void;
}

export interface PortfolioStartupRuntime {
  initApp: () => Promise<void>;
}

/**
 * Coordinates first-load credential restoration and auth fallback. Portfolio
 * hydration, quote bootstrap, cloud sync, and account switching remain app-owned.
 */
export function createPortfolioStartupRuntime(
  dependencies: PortfolioStartupRuntimeDependencies
): PortfolioStartupRuntime {
  const initApp = async (): Promise<void> => {
    if (dependencies.isInitialized()) return;

    try {
      const secret = await dependencies.restoreGatewaySecret();
      if (secret && await dependencies.validateGatewaySecret(secret)) {
        dependencies.setInitialized(true);
        dependencies.hideAuthContainer();
        await dependencies.startApp(secret);
      } else {
        const authStatus = await dependencies.getAuthStatus();
        // During first account setup the old Gateway Secret is still needed to
        // decrypt existing cloud state. Keep it until the admin bootstrap succeeds.
        if (secret && !authStatus.setupRequired) {
          dependencies.clearSavedGatewaySecret();
          await dependencies.persistGatewaySecret();
        }
        dependencies.loadBrokerRules();
        // Do not render a cached administrator workspace while identity is unresolved.
        dependencies.clearUnresolvedWorkspace();
        dependencies.showBalanceView();
        dependencies.hideStartupLoading();
        dependencies.showAuthContainer();
      }
    } catch (error) {
      dependencies.setInitialized(false);
      dependencies.onStartupFailure(error);
    }
  };

  return { initApp };
}
