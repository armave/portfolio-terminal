export interface QuoteRefreshCoordinator {
  refresh: (force?: boolean) => Promise<boolean>;
  refreshAfterCurrent: (force?: boolean) => Promise<boolean>;
}

/**
 * Coalesce ordinary polling, but queue an explicit refresh behind any older
 * request so it snapshots the latest holdings after the earlier batch settles.
 */
export function createQuoteRefreshCoordinator(
  executeRefresh: (force: boolean) => Promise<boolean>
): QuoteRefreshCoordinator {
  let inFlight: Promise<boolean> | null = null;
  let forcedRequest: Promise<boolean> | null = null;
  let queuedRequest: Promise<boolean> | null = null;
  let queuedForce = false;

  const start = (force: boolean): Promise<boolean> => {
    let request: Promise<boolean>;
    request = Promise.resolve()
      .then(() => executeRefresh(force))
      .finally(() => {
        if (inFlight === request) inFlight = null;
        if (forcedRequest === request) forcedRequest = null;
      });
    inFlight = request;
    if (force) forcedRequest = request;
    return request;
  };

  const refreshAfterCurrent = (force = false): Promise<boolean> => {
    if (force && forcedRequest) return forcedRequest;
    if (queuedRequest) {
      if (force) {
        queuedForce = true;
        forcedRequest = queuedRequest;
      }
      return queuedRequest;
    }

    const pending = inFlight;
    if (!pending) return start(force);

    queuedForce = force;
    let request: Promise<boolean>;
    request = (async () => {
      await pending.catch(() => false);
      // Also wait for any ordinary poll that starts while the explicit refresh
      // is queued. The next batch then captures the latest canonical portfolio.
      while (inFlight) {
        const current = inFlight;
        await current.catch(() => false);
      }
      return start(queuedForce);
    })().finally(() => {
      if (queuedRequest === request) {
        queuedRequest = null;
        queuedForce = false;
      }
      if (forcedRequest === request) forcedRequest = null;
    });

    queuedRequest = request;
    if (force) forcedRequest = request;
    return request;
  };

  const refresh = (force = false): Promise<boolean> => {
    if (force && forcedRequest) return forcedRequest;
    if (inFlight) return force ? refreshAfterCurrent(true) : inFlight;
    if (queuedRequest) {
      if (force) {
        queuedForce = true;
        forcedRequest = queuedRequest;
      }
      return queuedRequest;
    }
    return start(force);
  };

  return { refresh, refreshAfterCurrent };
}
