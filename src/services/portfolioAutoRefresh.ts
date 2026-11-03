const SUPPORTED_QUOTE_REFRESH_INTERVALS = [15_000, 30_000, 60_000] as const;

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
  refreshQuotes: () => void | Promise<unknown>;
  refreshSupplemental: () => void | Promise<unknown>;
  /** Sync the current admin portfolio snapshot after each scheduled quote cycle. */
  syncState?: () => void | Promise<unknown>;
  /** Checkpoint the independent admin Closed History record during each full cycle. */
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
  let timer: ReturnType<typeof setInterval> | null = null;
  let activeInterval = 0;
  let activeRole: PortfolioAutoRefreshRole = null;
  let quoteInFlight: Promise<boolean> | null = null;
  let supplementalInFlight: Promise<boolean> | null = null;
  let stateSyncInFlight: Promise<boolean> | null = null;
  let historySyncInFlight: Promise<boolean> | null = null;
  let cycleInFlight: Promise<boolean> | null = null;

  const stopTimer = () => {
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
  };

  const canRefresh = () =>
    activeInterval > 0 &&
    activeRole !== null &&
    options.getRole() === activeRole &&
    options.isVisible();

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
      .then(() => true)
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

  const refreshQuotesAndSyncState = async (): Promise<boolean> => {
    const quotes = await runTask('quotes', options.refreshQuotes);
    if (activeRole !== 'admin' || !options.syncState || !canRefresh()) return quotes;
    const synced = await runTask('state-sync', options.syncState);
    return quotes && synced;
  };

  const refreshSupplementalAndSyncHistory = async (): Promise<boolean> => {
    const supplemental = await runTask('supplemental', options.refreshSupplemental);
    if (activeRole !== 'admin' || !options.syncHistory || !canRefresh()) return supplemental;
    const history = await runTask('history-sync', options.syncHistory);
    if (!canRefresh() || !options.syncState) return supplemental && history;
    if (stateSyncInFlight) await stateSyncInFlight;
    if (!canRefresh()) return supplemental && history;
    const state = await runTask('state-sync', options.syncState);
    return supplemental && history && state;
  };

  const refreshNow = async (): Promise<boolean> => {
    if (!canRefresh()) return false;
    if (cycleInFlight) return cycleInFlight;

    let cycle: Promise<boolean>;
    if (activeRole === 'guest') {
      // The guest snapshot is fetched first; its newly assigned tickers are then quoted.
      cycle = runTask('supplemental', options.refreshSupplemental);
    } else {
      cycle = Promise.all([
        refreshQuotesAndSyncState(),
        refreshSupplementalAndSyncHistory()
      ]).then(([quotesAndSync, supplemental]) => quotesAndSync && supplemental);
    }

    let wrappedCycle: Promise<boolean>;
    wrappedCycle = cycle.finally(() => {
      if (cycleInFlight === wrappedCycle) cycleInFlight = null;
    });
    cycleInFlight = wrappedCycle;
    return wrappedCycle;
  };

  const configure = (interval: unknown, role: PortfolioAutoRefreshRole): number => {
    stopTimer();
    // A role switch must not make the new account await a previous account's cycle.
    quoteInFlight = null;
    supplementalInFlight = null;
    stateSyncInFlight = null;
    historySyncInFlight = null;
    cycleInFlight = null;
    activeRole = role;
    const fallback = role === 'guest'
      ? DEFAULT_GUEST_REFRESH_INTERVAL_MS
      : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
    activeInterval = normalizeQuoteRefreshInterval(interval, fallback);

    if (!role) return activeInterval;

    // Every selected interval runs the complete role-specific sync, not just quotes.
    timer = setIntervalFn(() => {
      if (canRefresh()) void refreshNow();
    }, activeInterval);
    return activeInterval;
  };

  const onVisibilityChange = async (): Promise<boolean> => {
    if (!options.isVisible()) return false;
    return refreshNow();
  };

  const stop = () => {
    stopTimer();
    activeInterval = 0;
    activeRole = null;
    cycleInFlight = null;
  };

  return { configure, refreshNow, onVisibilityChange, stop };
}
