const SUPPORTED_QUOTE_REFRESH_INTERVALS = [15_000, 30_000, 60_000] as const;
const SUPPLEMENTAL_REFRESH_INTERVAL_MS = 60_000;

export const DEFAULT_ADMIN_REFRESH_INTERVAL_MS = 60_000;
export const DEFAULT_GUEST_REFRESH_INTERVAL_MS = 15_000;

type PortfolioAutoRefreshRole = 'admin' | 'guest' | null;
type QuoteRefreshSource = 'quotes' | 'supplemental' | 'state-sync' | 'history-sync';

export function isSupportedQuoteRefreshInterval(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) &&
    SUPPORTED_QUOTE_REFRESH_INTERVALS.includes(parsed as typeof SUPPORTED_QUOTE_REFRESH_INTERVALS[number]);
}

/** A mandatory supported cadence is always selected, including for legacy Off values. */
export function normalizeQuoteRefreshInterval(value: unknown, fallback = DEFAULT_ADMIN_REFRESH_INTERVAL_MS): number {
  if (isSupportedQuoteRefreshInterval(value)) return Number(value);
  if (isSupportedQuoteRefreshInterval(fallback)) return Number(fallback);
  return DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
}

interface PortfolioAutoRefreshSchedulerOptions {
  getRole: () => PortfolioAutoRefreshRole;
  isVisible: () => boolean;
  /** Hold automatic refresh until the authenticated workspace's initial cloud pull settles. */
  isWorkspaceReady?: () => boolean;
  refreshQuotes: () => void | Promise<unknown>;
  refreshSupplemental: () => void | Promise<unknown>;
  /** Checkpoint the current admin portfolio snapshot at the selected quote cadence. */
  syncState?: () => void | Promise<unknown>;
  /** Checkpoint the independent admin Closed History record on the 60-second cadence. */
  syncHistory?: () => void | Promise<unknown>;
  onError?: (source: QuoteRefreshSource, error: unknown) => void;
  setIntervalFn?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}

interface PortfolioAutoRefreshScheduler {
  configure: (interval: unknown, role: PortfolioAutoRefreshRole) => number;
  refreshNow: () => Promise<boolean>;
  onVisibilityChange: () => Promise<boolean>;
  stop: () => void;
}

export function createPortfolioAutoRefreshScheduler(
  options: PortfolioAutoRefreshSchedulerOptions
): PortfolioAutoRefreshScheduler {
  const setIntervalFn: NonNullable<PortfolioAutoRefreshSchedulerOptions['setIntervalFn']> =
    options.setIntervalFn ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
  const clearIntervalFn: NonNullable<PortfolioAutoRefreshSchedulerOptions['clearIntervalFn']> =
    options.clearIntervalFn ?? ((timer) => clearInterval(timer));
  let quoteTimer: ReturnType<typeof setInterval> | null = null;
  let supplementalTimer: ReturnType<typeof setInterval> | null = null;
  let activeInterval = 0;
  let activeRole: PortfolioAutoRefreshRole = null;
  let quoteTickCount = 0;
  let configuredAt = 0;
  let quoteInFlight: Promise<boolean> | null = null;
  let supplementalInFlight: Promise<boolean> | null = null;
  let stateSyncInFlight: Promise<boolean> | null = null;
  let historySyncInFlight: Promise<boolean> | null = null;
  let cycleInFlight: Promise<boolean> | null = null;

  const stopTimers = () => {
    if (quoteTimer !== null) clearIntervalFn(quoteTimer);
    if (supplementalTimer !== null) clearIntervalFn(supplementalTimer);
    quoteTimer = null;
    supplementalTimer = null;
  };

  const canRefresh = () =>
    activeInterval > 0 &&
    activeRole !== null &&
    options.getRole() === activeRole &&
    options.isVisible() &&
    (options.isWorkspaceReady?.() ?? true);

  const runTask = (
    source: QuoteRefreshSource,
    task: () => void | Promise<unknown>
  ): Promise<boolean> => {
    const existing = source === 'quotes' ? quoteInFlight
      : source === 'supplemental' ? supplementalInFlight
        : source === 'state-sync' ? stateSyncInFlight : historySyncInFlight;
    if (existing) return existing;

    let request: Promise<boolean>;
    request = Promise.resolve()
      .then(task)
      .then((result) => result !== false)
      .catch((error) => {
        options.onError?.(source, error);
        return false;
      })
      .finally(() => {
        if (source === 'quotes' && quoteInFlight === request) quoteInFlight = null;
        if (source === 'supplemental' && supplementalInFlight === request) supplementalInFlight = null;
        if (source === 'state-sync' && stateSyncInFlight === request) stateSyncInFlight = null;
        if (source === 'history-sync' && historySyncInFlight === request) historySyncInFlight = null;
      });

    if (source === 'quotes') quoteInFlight = request;
    else if (source === 'supplemental') supplementalInFlight = request;
    else if (source === 'state-sync') stateSyncInFlight = request;
    else historySyncInFlight = request;
    return request;
  };

  const refreshAdminQuoteCheckpoint = async (checkpointSharesHistoryBoundary: boolean): Promise<boolean> => {
    const quotes = await runTask('quotes', options.refreshQuotes);
    if (!canRefresh()) return quotes;

    // At a shared 60-second boundary, the supplemental cycle checkpoints state
    // after Closed History has been reconciled. Avoid a duplicate earlier write.
    const synced = checkpointSharesHistoryBoundary || !options.syncState
      ? true
      : await runTask('state-sync', options.syncState);
    return quotes && synced;
  };

  const refreshAdminSupplementalCheckpoint = async (): Promise<boolean> => {
    const supplemental = await runTask('supplemental', options.refreshSupplemental);
    if (!canRefresh()) return supplemental;

    const history = options.syncHistory
      ? await runTask('history-sync', options.syncHistory)
      : true;
    if (!canRefresh()) return supplemental && history;

    // Closed History fee totals are stored in the shared portfolio snapshot too.
    // Checkpoint it after history processing, even when a source reported failure.
    const synced = options.syncState
      ? await runTask('state-sync', options.syncState)
      : true;
    return supplemental && history && synced;
  };

  const refreshGuestSupplemental = (): Promise<boolean> =>
    runTask('supplemental', options.refreshSupplemental);

  const refreshNow = async (): Promise<boolean> => {
    if (!canRefresh()) return false;
    if (cycleInFlight) return cycleInFlight;

    let cycle: Promise<boolean>;
    if (activeRole === 'guest') {
      // Guest hydration fetches the latest assignment and then quotes its tickers.
      cycle = refreshGuestSupplemental();
    } else {
      // Manual admin Sync remains comprehensive and immediate.
      cycle = (async () => {
        const [quotes, supplemental] = await Promise.all([
          runTask('quotes', options.refreshQuotes),
          runTask('supplemental', options.refreshSupplemental)
        ]);
        if (!canRefresh()) return quotes && supplemental;

        const history = options.syncHistory
          ? await runTask('history-sync', options.syncHistory)
          : true;
        if (!canRefresh()) return quotes && supplemental && history;

        const synced = options.syncState
          ? await runTask('state-sync', options.syncState)
          : true;
        return quotes && supplemental && history && synced;
      })();
    }

    let wrappedCycle: Promise<boolean>;
    wrappedCycle = cycle.finally(() => {
      if (cycleInFlight === wrappedCycle) cycleInFlight = null;
    });
    cycleInFlight = wrappedCycle;
    return wrappedCycle;
  };

  const configure = (interval: unknown, role: PortfolioAutoRefreshRole): number => {
    stopTimers();
    // A role switch must not make the new account await a previous account's cycle.
    quoteInFlight = null;
    supplementalInFlight = null;
    stateSyncInFlight = null;
    historySyncInFlight = null;
    cycleInFlight = null;
    quoteTickCount = 0;
    configuredAt = Date.now();
    activeRole = role;
    const fallback = role === 'guest'
      ? DEFAULT_GUEST_REFRESH_INTERVAL_MS
      : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
    activeInterval = normalizeQuoteRefreshInterval(interval, fallback);

    if (!role) return activeInterval;

    quoteTimer = setIntervalFn(() => {
      if (!canRefresh()) return;
      quoteTickCount = Math.max(
        quoteTickCount + 1,
        Math.floor((Date.now() - configuredAt) / activeInterval)
      );
      if (activeRole === 'admin') {
        const sharesHistoryBoundary =
          (quoteTickCount * activeInterval) % SUPPLEMENTAL_REFRESH_INTERVAL_MS === 0;
        void refreshAdminQuoteCheckpoint(sharesHistoryBoundary);
      } else {
        void runTask('quotes', options.refreshQuotes);
      }
    }, activeInterval);

    supplementalTimer = setIntervalFn(() => {
      if (!canRefresh()) return;
      if (activeRole === 'admin') {
        void refreshAdminSupplementalCheckpoint();
      } else {
        void refreshGuestSupplemental();
      }
    }, SUPPLEMENTAL_REFRESH_INTERVAL_MS);

    return activeInterval;
  };

  const onVisibilityChange = async (): Promise<boolean> => {
    if (!options.isVisible()) return false;
    const refreshed = await refreshNow();
    // Set the quote timer's phase from wall time so skipped hidden-tab ticks
    // cannot desynchronize its 60-second boundary from the supplemental timer.
    if (activeInterval > 0) {
      quoteTickCount = Math.max(
        quoteTickCount,
        Math.floor((Date.now() - configuredAt) / activeInterval)
      );
    }
    return refreshed;
  };

  const stop = () => {
    stopTimers();
    activeInterval = 0;
    activeRole = null;
    quoteTickCount = 0;
    configuredAt = 0;
    cycleInFlight = null;
  };

  return { configure, refreshNow, onVisibilityChange, stop };
}
