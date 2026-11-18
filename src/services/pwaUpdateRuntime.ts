export const PWA_UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1_000;

type PwaUpdateState =
  | 'not_checked'
  | 'checking'
  | 'up_to_date'
  | 'update_waiting'
  | 'error'
  | 'unsupported';

export interface PwaUpdateSnapshot {
  status: PwaUpdateState;
  lastCheckedAt: number | null;
}

export interface PwaUpdateRuntime {
  getState: () => PwaUpdateSnapshot;
  subscribe: (listener: (snapshot: PwaUpdateSnapshot) => void) => () => void;
  start: (checkForUpdate: () => Promise<unknown>) => void;
  checkNow: () => Promise<void>;
  canCheckNow: () => boolean;
  markUpdateAvailable: () => void;
  markUnsupported: () => void;
  markError: () => void;
  dispose: () => void;
}

type IntervalHandle = ReturnType<typeof globalThis.setInterval>;

interface PwaUpdateEnvironment {
  setInterval: (callback: () => void, delayMs: number) => IntervalHandle;
  clearInterval: (handle: IntervalHandle) => void;
  now: () => number;
  isVisible: () => boolean;
  addVisibilityChangeListener: (listener: () => void) => void;
  removeVisibilityChangeListener: (listener: () => void) => void;
}

const browserEnvironment: PwaUpdateEnvironment = {
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
  now: () => Date.now(),
  isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
  addVisibilityChangeListener: (listener) => {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', listener);
  },
  removeVisibilityChangeListener: (listener) => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', listener);
  }
};

/**
 * Checks the app-scoped service worker at startup and every 30 minutes while
 * the page is visible. Returning to a visible tab triggers a catch-up check
 * when the last attempt is at least one interval old.
 */
export function createPwaUpdateRuntime(
  environment: PwaUpdateEnvironment = browserEnvironment
): PwaUpdateRuntime {
  let snapshot: PwaUpdateSnapshot = { status: 'not_checked', lastCheckedAt: null };
  const listeners = new Set<(next: PwaUpdateSnapshot) => void>();
  let checkForUpdate: (() => Promise<unknown>) | null = null;
  let intervalHandle: IntervalHandle | null = null;
  let started = false;
  let disposed = false;
  let checkInFlight = false;
  let updateWaiting = false;

  const publish = (next: PwaUpdateSnapshot): void => {
    snapshot = next;
    listeners.forEach((listener) => listener({ ...snapshot }));
  };

  const checkNow = async (): Promise<void> => {
    if (
      disposed ||
      !started ||
      !checkForUpdate ||
      checkInFlight ||
      updateWaiting ||
      !environment.isVisible()
    ) return;

    checkInFlight = true;
    publish({ ...snapshot, status: 'checking' });
    try {
      await checkForUpdate();
      publish({
        status: updateWaiting ? 'update_waiting' : 'up_to_date',
        lastCheckedAt: environment.now()
      });
    } catch {
      publish({
        status: updateWaiting ? 'update_waiting' : 'error',
        lastCheckedAt: environment.now()
      });
    } finally {
      checkInFlight = false;
    }
  };

  const handleVisibilityChange = (): void => {
    if (!environment.isVisible()) return;
    const elapsed = snapshot.lastCheckedAt === null
      ? Number.POSITIVE_INFINITY
      : environment.now() - snapshot.lastCheckedAt;
    if (elapsed >= PWA_UPDATE_CHECK_INTERVAL_MS) void checkNow();
  };

  const subscribe = (listener: (next: PwaUpdateSnapshot) => void): (() => void) => {
    listeners.add(listener);
    listener({ ...snapshot });
    return () => listeners.delete(listener);
  };

  const start = (updateCheck: () => Promise<unknown>): void => {
    if (started || disposed) return;
    started = true;
    checkForUpdate = updateCheck;
    void checkNow();
    intervalHandle = environment.setInterval(() => {
      if (environment.isVisible()) void checkNow();
    }, PWA_UPDATE_CHECK_INTERVAL_MS);
    environment.addVisibilityChangeListener(handleVisibilityChange);
  };

  const canCheckNow = (): boolean =>
    started && !disposed && Boolean(checkForUpdate) && !checkInFlight && !updateWaiting && environment.isVisible();

  const markUpdateAvailable = (): void => {
    updateWaiting = true;
    publish({ ...snapshot, status: 'update_waiting' });
  };

  const markUnsupported = (): void => {
    publish({ ...snapshot, status: 'unsupported' });
  };

  const markError = (): void => {
    publish({ ...snapshot, status: 'error' });
  };

  const dispose = (): void => {
    disposed = true;
    if (intervalHandle !== null) environment.clearInterval(intervalHandle);
    intervalHandle = null;
    environment.removeVisibilityChangeListener(handleVisibilityChange);
    listeners.clear();
  };

  return {
    getState: () => ({ ...snapshot }),
    subscribe,
    start,
    checkNow,
    canCheckNow,
    markUpdateAvailable,
    markUnsupported,
    markError,
    dispose
  };
}

export const pwaUpdateRuntime = createPwaUpdateRuntime();
