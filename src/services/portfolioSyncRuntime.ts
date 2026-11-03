import { addUiEventListener, removeUiEventListener, type UiEvent } from '../ui/uiEventBus';
import {
  runManualPortfolioSync,
  type ManualPortfolioSyncOperations,
  type ManualPortfolioSyncResult
} from './manualPortfolioSync';

export interface PortfolioSyncRuntimeDependencies {
  getAccountRole: () => ManualPortfolioSyncOperations['role'];
  refreshQuotes: ManualPortfolioSyncOperations['refreshQuotes'];
  refreshBrokerAccount: ManualPortfolioSyncOperations['refreshBrokerAccount'];
  refreshExecutedTrades: ManualPortfolioSyncOperations['refreshExecutedTrades'];
  refreshActiveOrders: ManualPortfolioSyncOperations['refreshActiveOrders'];
  pushCloud: ManualPortfolioSyncOperations['pushCloud'];
  syncClosedHistory: ManualPortfolioSyncOperations['syncClosedHistory'];
  pullGuestSnapshot: ManualPortfolioSyncOperations['pullGuestSnapshot'];
  translateText: (message: string) => string;
  showToast: (message: string, tone: 'success' | 'warning' | 'error') => void;
  logTerminal: (message: string) => void;
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
    dependencies.logTerminal('[Sync]: Broker data, market quotes, portfolio snapshot and Closed History are up to date.');
  } else if (anySourceSucceeded) {
    dependencies.showToast(
      dependencies.translateText('Portfolio sync completed with issues. Check the activity log.'),
      'warning'
    );
    dependencies.logTerminal('[Sync Warning]: One or more portfolio data sources could not be refreshed.');
  } else {
    dependencies.showToast(
      dependencies.translateText('Could not sync portfolio. Check your connection and try again.'),
      'error'
    );
    dependencies.logTerminal('[Sync Error]: No portfolio data source completed successfully.');
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
  const handleSyncRequest = (event: ManualSyncRequestEvent) => {
    void (async () => {
      const role = dependencies.getAccountRole();
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
        notifySyncResult(result, dependencies);
        event.detail.resolve(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.logTerminal(`[Sync Error]: ${message}`);
        dependencies.showToast(
          dependencies.translateText('Could not sync portfolio. Check your connection and try again.'),
          'error'
        );
        event.detail.resolve({
          role,
          success: false,
          quotes: false
        });
      }
    })();
  };

  addUiEventListener('portfolio:sync-request', handleSyncRequest);
  return () => removeUiEventListener('portfolio:sync-request', handleSyncRequest);
}
