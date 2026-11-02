const SUPPORTED_QUOTE_REFRESH_INTERVALS = [0, 15_000, 30_000, 60_000] as const;

export const DEFAULT_ADMIN_REFRESH_INTERVAL_MS = 60_000;
export const DEFAULT_GUEST_REFRESH_INTERVAL_MS = 15_000;
const SUPPLEMENTAL_REFRESH_INTERVAL_MS = 60_000;

type PortfolioAutoRefreshRole = 'admin' | 'guest' | null;
type QuoteRefreshSource = 'quotes' | 'supplemental';

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
    const existing = source === 'quotes' ? quoteInFlight : supplementalInFlight;
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
      });

    if (source === 'quotes') quoteInFlight = request;
    else supplementalInFlight = request;
    return request;
  };

  const refreshNow = async (): Promise<boolean> => {
    if (!canRefresh()) return false;

    // Guest supplemental refresh fetches the authenticated assignment snapshot
    // and then quotes the newly hydrated ticker set. Do not race it with old tickers.
    if (activeRole === 'guest') {
      return runTask('supplemental', options.refreshSupplemental);
    }

    const [quotes, supplemental] = await Promise.all([
      runTask('quotes', options.refreshQuotes),
      runTask('supplemental', options.refreshSupplemental)
    ]);
    return quotes && supplemental;
  };

  const configure = (interval: unknown, role: PortfolioAutoRefreshRole): number => {
    stopTimers();
    activeRole = role;
    const fallback = role === 'guest'
      ? DEFAULT_GUEST_REFRESH_INTERVAL_MS
      : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
    activeInterval = normalizeQuoteRefreshInterval(interval, fallback);

    if (!role || activeInterval === 0) return activeInterval;

    quoteTimer = setIntervalFn(() => {
      if (canRefresh()) void runTask('quotes', options.refreshQuotes);
    }, activeInterval);
    supplementalTimer = setIntervalFn(() => {
      if (canRefresh()) void runTask('supplemental', options.refreshSupplemental);
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
