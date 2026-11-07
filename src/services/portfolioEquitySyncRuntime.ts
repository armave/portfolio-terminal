import type { PortfolioState } from '../types/portfolio';
import type { PortfolioStoreChangeSource } from '../store/portfolioStore';

export interface PortfolioEquitySyncRuntimeDependencies {
  subscribe: (
    listener: (state: PortfolioState, source: PortfolioStoreChangeSource) => void
  ) => () => void;
  getState: () => PortfolioState;
  calculateEquity: (state: PortfolioState) => number;
  setDerivedEquity: (equity: number, updatedAt: number, persist: boolean) => void;
  onDurableEquityChanged: () => void;
  /** Capture daily performance evidence independently of equity projection changes. */
  recordPerformanceSnapshot?: (state: PortfolioState, timestamp: number) => boolean;
  onPerformanceSnapshotChanged?: () => void;
  now?: () => number;
}

export interface PortfolioEquitySyncRuntime {
  dispose: () => void;
}

/**
 * Keeps the portfolio-equity projection current without treating live market
 * ticks as durable portfolio edits. Only durable mutations may request a
 * cloud write; derived updates are ignored to prevent recursive notifications.
 */
export function createPortfolioEquitySyncRuntime(
  dependencies: PortfolioEquitySyncRuntimeDependencies
): PortfolioEquitySyncRuntime {
  const now = dependencies.now || Date.now;

  const sync = (state: PortfolioState, source: PortfolioStoreChangeSource = 'durable'): void => {
    if (source === 'derived') return;

    const timestamp = now();
    if (dependencies.recordPerformanceSnapshot?.(state, timestamp)) {
      dependencies.onPerformanceSnapshotChanged?.();
    }

    const rawEquity = Number(dependencies.calculateEquity(state));
    if (!Number.isFinite(rawEquity)) return;
    const equity = Number(rawEquity.toFixed(2));
    if (
      Number.isFinite(state.portfolioEquity) &&
      Number(state.portfolioEquity) === equity
    ) return;

    const isLiveQuote = source === 'live-quote';
    dependencies.setDerivedEquity(equity, timestamp, !isLiveQuote);
    if (!isLiveQuote) dependencies.onDurableEquityChanged();
  };

  const unsubscribe = dependencies.subscribe(sync);
  // Retain initial canonical equity hydration behavior. Startup cloud-write
  // suppression remains owned by the app-level sync coordinator.
  sync(dependencies.getState(), 'durable');

  return { dispose: unsubscribe };
}
