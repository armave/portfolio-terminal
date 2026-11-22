import { addUiEventListener, removeUiEventListener, type UiEvent } from '../ui/uiEventBus';
import {
  runManualPortfolioSync,
  type ManualPortfolioSyncOperations,
  type ManualPortfolioSyncResult
} from './manualPortfolioSync';

export interface PortfolioSyncRuntimeDependencies {
  getAccountRole: () => ManualPortfolioSyncOperations['role'];
  /** Stable authenticated role/account scope; prevents cross-session sync coalescing. */
  getAccountSessionKey: () => string | null;
  refreshQuotes: ManualPortfolioSyncOperations['refreshQuotes'];
  refreshBrokerAccount: ManualPortfolioSyncOperations['refreshBrokerAccount'];
  refreshExecutedTrades: ManualPortfolioSyncOperations['refreshExecutedTrades'];
  refreshActiveOrders: ManualPortfolioSyncOperations['refreshActiveOrders'];
  pushCloud: ManualPortfolioSyncOperations['pushCloud'];
  syncClosedHistory: ManualPortfolioSyncOperations['syncClosedHistory'];
  pullGuestSnapshot: ManualPortfolioSyncOperations['pullGuestSnapshot'];
  translateText: (message: string) => string;
  showToast: (message: string, tone: 'success' | 'warning' | 'error') => void;
  logAppMessage: (message: string) => void;
  getSyncStatus: () => { status: string };
  setSyncStatus: (status: { status: 'syncing' | 'synced' | 'error'; text: string }) => void;
}

type ManualSyncRequestEvent = UiEvent<{
  resolve: (result: ManualPortfolioSyncResult) => void;
}>;

function notifySyncResult(
  result: ManualPortfolioSyncResult,
  dependencies: PortfolioSyncRuntimeDependencies
): void {
  const anySourceSucceeded = result.role === 'admin'
    ? Boolean(result.brokerAccount || result.executedTrades || result.activeOrders || result.quotes || result.cloud || result.cloudHistory)
    : Boolean(result.guestSnapshot || result.quotes);

  if (result.success) {
    dependencies.showToast(dependencies.translateText('Portfolio sync completed.'), 'success');
    dependencies.logAppMessage('[Sync]: Broker data, market quotes, portfolio snapshot and Closed History are up to date.');
  } else if (anySourceSucceeded) {
    dependencies.showToast(
      dependencies.translateText('Portfolio sync completed with issues. Check the activity log.'),
      'warning'
    );
    dependencies.logAppMessage('[Sync Warning]: One or more portfolio data sources could not be refreshed.');
  } else {
    dependencies.showToast(
      dependencies.translateText('Could not sync portfolio. Check your connection and try again.'),
      'error'
    );
    dependencies.logAppMessage('[Sync Error]: No portfolio data source completed successfully.');
  }
}

/**
 * Bind the UI sync request to injected application operations. The runtime
 * adapter owns event lifecycle and user feedback; role-specific sync ordering
 * remains in runManualPortfolioSync for independent testing.
 */
export function bindPortfolioSyncRuntime(
  dependencies: PortfolioSyncRuntimeDependencies
): () => void {
  const activeSyncs = new Map<string, Promise<ManualPortfolioSyncResult>>();

  const handleSyncRequest = (event: ManualSyncRequestEvent) => {
    const role = dependencies.getAccountRole();
    const getCurrentSessionKey = () => dependencies.getAccountSessionKey() ??
      `role:${dependencies.getAccountRole() || 'none'}`;
    const sessionKey = getCurrentSessionKey();
    const existing = activeSyncs.get(sessionKey);
    if (existing) {
      // Repeated clicks in one authenticated session join the same operation.
      // They do not start duplicate provider requests or race the header status.
      void existing.then(
        (result) => event.detail.resolve(result),
        () => event.detail.resolve({ role, success: false, quotes: false })
      );
      return;
    }

    if (dependencies.getSyncStatus().status !== 'conflict') {
      dependencies.setSyncStatus({ status: 'syncing', text: 'Portfolio sync in progress' });
    }

    const request = (async (): Promise<ManualPortfolioSyncResult> => {
      try {
        const result = await runManualPortfolioSync({
          role,
          refreshBrokerAccount: dependencies.refreshBrokerAccount,
          refreshExecutedTrades: dependencies.refreshExecutedTrades,
          refreshActiveOrders: dependencies.refreshActiveOrders,
          refreshQuotes: dependencies.refreshQuotes,
          pushCloud: dependencies.pushCloud,
          syncClosedHistory: dependencies.syncClosedHistory,
          pullGuestSnapshot: dependencies.pullGuestSnapshot
        });

        // A late response from a signed-out or previous account may resolve its
        // caller, but must not overwrite the active account's status or toasts.
        if (getCurrentSessionKey() === sessionKey) {
          notifySyncResult(result, dependencies);
          if (dependencies.getSyncStatus().status !== 'conflict') {
            dependencies.setSyncStatus({
              status: result.success ? 'synced' : 'error',
              text: result.role === 'guest'
                ? result.success ? 'Assigned data refreshed' : 'Assigned data refresh failed'
                : result.success ? 'Synced' : 'Sync failed'
            });
          }
        }
        return result;
      } catch (error) {
        if (getCurrentSessionKey() === sessionKey) {
          const message = error instanceof Error ? error.message : String(error);
          if (dependencies.getSyncStatus().status !== 'conflict') {
            dependencies.setSyncStatus({ status: 'error', text: 'Sync failed' });
          }
          dependencies.logAppMessage(`[Sync Error]: ${message}`);
          dependencies.showToast(
            dependencies.translateText('Could not sync portfolio. Check your connection and try again.'),
            'error'
          );
        }
        return { role, success: false, quotes: false };
      }
    })();

    activeSyncs.set(sessionKey, request);
    void request.then(
      (result) => event.detail.resolve(result),
      () => event.detail.resolve({ role, success: false, quotes: false })
    );
    void request.finally(() => {
      if (activeSyncs.get(sessionKey) === request) activeSyncs.delete(sessionKey);
    }).catch(() => undefined);
  };

  addUiEventListener('portfolio:sync-request', handleSyncRequest);
  return () => removeUiEventListener('portfolio:sync-request', handleSyncRequest);
}
