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
  let queuedRequest: Promise<boolean> | null = null;
  let queuedForce = false;

  const start = (force: boolean): Promise<boolean> => {
    let request: Promise<boolean>;
    request = Promise.resolve()
      .then(() => executeRefresh(force))
      .finally(() => {
        if (inFlight === request) inFlight = null;
      });
    inFlight = request;
    return request;
  };

  const refreshAfterCurrent = (force = false): Promise<boolean> => {
    if (queuedRequest) {
      queuedForce = queuedForce || force;
      return queuedRequest;
    }

    const pending = inFlight;
    if (!pending) return start(force);

    queuedForce = force;
    let request!: Promise<boolean>;
    request = (async () => {
      await pending.catch(() => false);
      // Also wait for any ordinary poll that starts while this request is
      // queued. The next batch then captures the latest canonical portfolio.
      while (inFlight) {
        const current = inFlight;
        await current.catch(() => false);
      }
      const runForce = queuedForce;
      // Clear the queue before starting the follow-up. A new explicit trigger
      // during that follow-up can then reserve one further latest-state batch.
      if (queuedRequest === request) {
        queuedRequest = null;
        queuedForce = false;
      }
      return start(runForce);
    })().finally(() => {
      if (queuedRequest === request) {
        queuedRequest = null;
        queuedForce = false;
      }
    });

    queuedRequest = request;
    return request;
  };

  const refresh = (force = false): Promise<boolean> => {
    if (inFlight) return force ? refreshAfterCurrent(true) : inFlight;
    if (queuedRequest) {
      queuedForce = queuedForce || force;
      return queuedRequest;
    }
    return start(force);
  };

  return { refresh, refreshAfterCurrent };
}
