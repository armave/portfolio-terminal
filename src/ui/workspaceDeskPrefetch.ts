type WorkspaceDeskPrefetchKey =
  | 'balance'
  | 'trades'
  | 'guest-history'
  | 'settings'
  | 'margin';

type WorkspaceDeskModuleLoader = () => Promise<unknown>;
type WorkspaceDeskModuleLoaders = Record<WorkspaceDeskPrefetchKey, WorkspaceDeskModuleLoader>;

function resolveWorkspaceDeskPrefetchKey(view: string, isAdmin: boolean): WorkspaceDeskPrefetchKey | null {
  if (view === 'BALANCE' || view === 'CASH_CUSHION') return 'balance';
  if (view === 'CLOSED_HISTORY') return isAdmin ? 'trades' : null;
  if (view === 'GUEST_HISTORY') return isAdmin ? null : 'guest-history';
  if (view === 'SETTINGS') return 'settings';
  return isAdmin ? 'margin' : null;
}

/**
 * Preloads a desk's existing lazy module only after pointer/keyboard intent.
 * Successful loads are remembered; failed loads can be retried on the next intent.
 */
export function createWorkspaceDeskPrefetcher(
  loaders: WorkspaceDeskModuleLoaders
): (view: string, isAdmin: boolean) => Promise<void> | undefined {
  const started = new Set<WorkspaceDeskPrefetchKey>();

  return (view, isAdmin) => {
    const key = resolveWorkspaceDeskPrefetchKey(view, isAdmin);
    if (!key || started.has(key)) return;

    started.add(key);
    try {
      return loaders[key]()
        .then(() => undefined)
        .catch(() => {
          started.delete(key);
        });
    } catch {
      started.delete(key);
      return undefined;
    }
  };
}

const prefetchDesk = createWorkspaceDeskPrefetcher({
  balance: () => import('../components/CashCushionDesk'),
  trades: () => import('../components/ClosedHistoryDesk'),
  'guest-history': () => import('../components/GuestTrancheHistory'),
  settings: () => import('../components/SettingsDesk'),
  margin: () => Promise.all([
    import('../components/SummaryMetricsGrid'),
    import('../components/PortfolioPerformancePanel'),
    import('../components/MarketInsightsPanel')
  ])
});

export function prefetchWorkspaceDesk(view: string, isAdmin: boolean): void {
  void prefetchDesk(view, isAdmin);
}
