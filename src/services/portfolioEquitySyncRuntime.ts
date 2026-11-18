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
  recordPerformanceSnapshot?: (state: PortfolioState, timestamp: number) => boolean | Promise<boolean>;
  onPerformanceSnapshotChanged?: () => void;
  /** Do not mutate protected performance history until the initial cloud pull settles. */
  isPerformanceSnapshotReady?: () => boolean;
  now?: () => number;
}

export interface PortfolioEquitySyncRuntime {
  dispose: () => void;
  /** Commit one coalesced performance snapshot after the workspace readiness gate opens. */
  flushDeferredPerformanceSnapshot: () => void;
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
  let performanceSnapshotDeferred = false;

  const recordPerformanceSnapshot = (state: PortfolioState, timestamp: number): void => {
    const record = dependencies.recordPerformanceSnapshot;
    if (!record) return;
    if (dependencies.isPerformanceSnapshotReady?.() === false) {
      performanceSnapshotDeferred = true;
      return;
    }

    const recordedSnapshot = record(state, timestamp);
    if (recordedSnapshot && typeof (recordedSnapshot as Promise<boolean>).then === 'function') {
      void Promise.resolve(recordedSnapshot)
        .then((changed) => {
          if (changed) dependencies.onPerformanceSnapshotChanged?.();
        })
        .catch(() => undefined);
    } else if (recordedSnapshot) {
      dependencies.onPerformanceSnapshotChanged?.();
    }
  };

  const sync = (state: PortfolioState, source: PortfolioStoreChangeSource = 'durable'): void => {
    if (source === 'derived') return;

    const timestamp = now();
    recordPerformanceSnapshot(state, timestamp);

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

  return {
    dispose: unsubscribe,
    flushDeferredPerformanceSnapshot: () => {
      if (!performanceSnapshotDeferred || dependencies.isPerformanceSnapshotReady?.() === false) return;
      performanceSnapshotDeferred = false;
      recordPerformanceSnapshot(dependencies.getState(), now());
    }
  };
}
