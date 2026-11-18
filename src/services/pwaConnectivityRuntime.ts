export type PwaConnectivityStatus = 'online' | 'offline' | 'reconnecting' | 'unavailable';

export type PwaConnectivityTarget = Pick<
  Window,
  'addEventListener' | 'removeEventListener'
> & {
  navigator: Pick<Navigator, 'onLine'>;
};

export interface PwaConnectivityRuntime {
  getState: () => PwaConnectivityStatus;
  subscribe: (listener: (status: PwaConnectivityStatus) => void) => () => void;
  retry: () => Promise<void>;
  dispose: () => void;
}

/**
 * Online events only indicate a network interface is available. The banner is
 * cleared only after the unauthenticated app-status endpoint responds.
 */
export function createPwaConnectivityRuntime(
  target: PwaConnectivityTarget,
  checkApplicationService: () => Promise<unknown>
): PwaConnectivityRuntime {
  let status: PwaConnectivityStatus = target.navigator.onLine ? 'online' : 'offline';
  let generation = 0;
  const listeners = new Set<(next: PwaConnectivityStatus) => void>();

  const publish = (next: PwaConnectivityStatus): void => {
    if (status === next) return;
    status = next;
    listeners.forEach((listener) => listener(status));
  };

  const verifyApplicationService = async (): Promise<void> => {
    const requestGeneration = ++generation;
    if (!target.navigator.onLine) {
      publish('offline');
      return;
    }

    publish('reconnecting');
    try {
      await checkApplicationService();
      if (requestGeneration === generation && target.navigator.onLine) publish('online');
      else if (requestGeneration === generation) publish('offline');
    } catch {
      if (requestGeneration === generation) {
        publish(target.navigator.onLine ? 'unavailable' : 'offline');
      }
    }
  };

  const handleOnline = (): void => {
    void verifyApplicationService();
  };
  const handleOffline = (): void => {
    generation += 1;
    publish('offline');
  };

  target.addEventListener('online', handleOnline);
  target.addEventListener('offline', handleOffline);

  const subscribe = (listener: (next: PwaConnectivityStatus) => void): (() => void) => {
    listeners.add(listener);
    listener(status);
    return () => listeners.delete(listener);
  };

  const dispose = (): void => {
    generation += 1;
    target.removeEventListener('online', handleOnline);
    target.removeEventListener('offline', handleOffline);
    listeners.clear();
  };

  return {
    getState: () => status,
    subscribe,
    retry: verifyApplicationService,
    dispose
  };
}
