import { addUiEventListener, removeUiEventListener } from '../ui/uiEventBus';

export type StartupAccountRole = 'admin' | 'guest' | null;
export type StartupIntervalHandle = ReturnType<typeof setInterval>;

export interface PortfolioStartupLifecycleDependencies {
  getAccountRole: () => StartupAccountRole;
  isDocumentVisible: () => boolean;
  applyOvernightRollover: () => void;
  refreshOnVisibilityChange: () => void;
  setStartupState: (visible: boolean, failed: boolean) => void;
  retryStartup: () => Promise<unknown> | void;
  continueStartupOffline: () => Promise<unknown> | void;
  addVisibilityChangeListener: (listener: () => void) => () => void;
  scheduleInterval: (callback: () => void, delayMs: number) => StartupIntervalHandle;
  clearScheduledInterval: (handle: StartupIntervalHandle) => void;
}

export interface PortfolioStartupLifecycleRuntime {
  configureAdminRollover: (enabled: boolean) => void;
  bind: () => () => void;
}

/**
 * Owns browser lifecycle bindings and the administrator-only rollover timer.
 * App initialization, session hydration, and rollover accounting remain
 * injected application responsibilities.
 */
export function createPortfolioStartupLifecycleRuntime(
  dependencies: PortfolioStartupLifecycleDependencies
): PortfolioStartupLifecycleRuntime {
  let rolloverTimer: StartupIntervalHandle | null = null;
  let isBound = false;

  const configureAdminRollover = (enabled: boolean): void => {
    if (rolloverTimer !== null) {
      dependencies.clearScheduledInterval(rolloverTimer);
      rolloverTimer = null;
    }
    if (!enabled) return;

    rolloverTimer = dependencies.scheduleInterval(() => {
      if (dependencies.getAccountRole() !== 'admin' || !dependencies.isDocumentVisible()) return;
      dependencies.applyOvernightRollover();
    }, 60 * 1000);
  };

  const handleVisibilityChange = (): void => {
    if (!dependencies.isDocumentVisible()) return;
    if (dependencies.getAccountRole() === 'admin') dependencies.applyOvernightRollover();
    dependencies.refreshOnVisibilityChange();
  };

  const handleStartupRetry = (): void => {
    dependencies.setStartupState(true, false);
    void dependencies.retryStartup();
  };

  const handleStartupOffline = (): void => {
    void dependencies.continueStartupOffline();
  };

  const bind = (): (() => void) => {
    if (isBound) return () => undefined;
    isBound = true;
    const removeVisibilityListener = dependencies.addVisibilityChangeListener(handleVisibilityChange);
    addUiEventListener('terminal:startup-retry', handleStartupRetry);
    addUiEventListener('terminal:startup-offline', handleStartupOffline);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      isBound = false;
      removeVisibilityListener();
      removeUiEventListener('terminal:startup-retry', handleStartupRetry);
      removeUiEventListener('terminal:startup-offline', handleStartupOffline);
      configureAdminRollover(false);
    };
  };

  return { configureAdminRollover, bind };
}
