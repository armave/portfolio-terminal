import { canAccessPortfolioView, type AccountRole } from '../domain/accountPermissions';
import { addUiEventListener, removeUiEventListener, type UiEvent } from '../ui/uiEventBus';

export interface PortfolioNavigationRuntimeDependencies {
  getAccountRole: () => AccountRole | null;
  setActiveView: (view: string) => void;
  refreshLivePrices: () => Promise<unknown>;
}

/**
 * Bind navigation and explicit live-quote refresh requests to the application
 * runtime. The current account role is read at event time, not captured when
 * listeners are registered, so account switches take effect immediately.
 */
export function bindPortfolioNavigationRuntime(
  dependencies: PortfolioNavigationRuntimeDependencies
): () => void {
  const handleSetActiveView = (event: UiEvent<{ view: string }>) => {
    const requestedView = event.detail.view;
    // The session role is verified during startup and authentication changes.
    // Navigation is local UI state; do not revalidate the same session for every tab click.
    if (!canAccessPortfolioView(dependencies.getAccountRole(), requestedView)) {
      dependencies.setActiveView('BALANCE');
      return;
    }
    dependencies.setActiveView(requestedView);
  };

  const handleRefreshLivePrices = (event: UiEvent<{ resolve: () => void }>) => {
    void dependencies.refreshLivePrices().finally(event.detail.resolve);
  };

  addUiEventListener('portfolio:set-active-view', handleSetActiveView);
  addUiEventListener('portfolio:refresh-live-prices', handleRefreshLivePrices);

  return () => {
    removeUiEventListener('portfolio:set-active-view', handleSetActiveView);
    removeUiEventListener('portfolio:refresh-live-prices', handleRefreshLivePrices);
  };
}
