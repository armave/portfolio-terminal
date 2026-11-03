const SUPPORTED_QUOTE_REFRESH_INTERVALS = [15_000, 30_000, 60_000] as const;

export const DEFAULT_ADMIN_REFRESH_INTERVAL_MS = 60_000;
export const DEFAULT_GUEST_REFRESH_INTERVAL_MS = 15_000;
const SUPPLEMENTAL_REFRESH_INTERVAL_MS = 60_000;

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

/** Invalid persisted values fall back rather than breaking application startup. */
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
  /** Checkpoint the independent admin Closed History record during the 60-second supplemental cycle. */
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
  let quoteInFlight: Promise<boolean> | null = null;
  let supplementalInFlight: Promise<boolean> | null = null;
  let stateSyncInFlight: Promise<boolean> | null = null;
  let historySyncInFlight: Promise<boolean> | null = null;

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

    // Only administrators own the shared portfolio cloud record. Guests refresh
    // their own server-scoped snapshot through the supplemental path, read-only.
    if (activeRole !== 'admin' || !options.syncState || !canRefresh()) return quotes;
    const synced = await runTask('state-sync', options.syncState);
    return quotes && synced;
  };

  const refreshSupplementalAndSyncHistory = async (): Promise<boolean> => {
    const supplemental = await runTask('supplemental', options.refreshSupplemental);
    // The independent encrypted Closed History record is admin-owned; guest data
    // remains exclusively in the authenticated guest assignment snapshot.
    if (activeRole !== 'admin' || !options.syncHistory || !canRefresh()) return supplemental;
    const history = await runTask('history-sync', options.syncHistory);
    if (!canRefresh()) return supplemental && history;

    // Broker cashflow allocation can update app-owned closed-trade fields that
    // live in the shared portfolio state record. Wait for any quote-cycle state
    // write that started before this history calculation, then checkpoint again.
    if (stateSyncInFlight) await stateSyncInFlight;
    if (!canRefresh() || !options.syncState) return supplemental && history;
    const state = await runTask('state-sync', options.syncState);
    return supplemental && history && state;
  };

  const refreshNow = async (): Promise<boolean> => {
    if (!canRefresh()) return false;

    // Guest supplemental refresh fetches the authenticated assignment snapshot
    // and then quotes the newly hydrated ticker set. Do not race it with old tickers.
    if (activeRole === 'guest') {
      return runTask('supplemental', options.refreshSupplemental);
    }

    const [quotesAndSync, supplemental] = await Promise.all([
      refreshQuotesAndSyncState(),
      refreshSupplementalAndSyncHistory()
    ]);
    return quotesAndSync && supplemental;
  };

  const configure = (interval: unknown, role: PortfolioAutoRefreshRole): number => {
    stopTimers();
    activeRole = role;
    const fallback = role === 'guest'
      ? DEFAULT_GUEST_REFRESH_INTERVAL_MS
      : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
    activeInterval = normalizeQuoteRefreshInterval(interval, fallback);

    if (!role) return activeInterval;

    // One selected cadence controls both quote refresh/stream maintenance and
    // the cloud-state checkpoint that follows it.
    quoteTimer = setIntervalFn(() => {
      if (canRefresh()) void refreshQuotesAndSyncState();
    }, activeInterval);
    supplementalTimer = setIntervalFn(() => {
      if (canRefresh()) void refreshSupplementalAndSyncHistory();
    }, SUPPLEMENTAL_REFRESH_INTERVAL_MS);

    return activeInterval;
  };

  const onVisibilityChange = async (): Promise<boolean> => {
    if (!options.isVisible()) return false;
    return refreshNow();
  };

  const stop = () => {
    stopTimers();
    activeInterval = 0;
    activeRole = null;
  };

  return { configure, refreshNow, onVisibilityChange, stop };
}
