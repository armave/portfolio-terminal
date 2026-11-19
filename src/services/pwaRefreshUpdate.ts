export const PWA_REFRESH_CLIENT_QUERY = 'PORTFOLIO_TERMINAL_QUERY_APP_CLIENTS';
export const PWA_REFRESH_CLIENT_QUERY_RESULT = 'PORTFOLIO_TERMINAL_APP_CLIENT_COUNT';

/** PerformanceNavigationTiming reports "reload" for browser-initiated page refreshes. */
export function isPageRefreshNavigation(navigationType: string | undefined): boolean {
  return navigationType === 'reload';
}

/**
 * Ask the waiting worker how many open window clients belong to this app scope.
 * Fail closed: unsupported messaging, missing replies, and malformed responses
 * leave the update staged rather than unexpectedly replacing other open tabs.
 */
export function isOnlyOpenAppClient(
  waitingWorker: Pick<ServiceWorker, 'postMessage'>,
  timeoutMs = 750
): Promise<boolean> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve(false);

  let channel: MessageChannel;
  try {
    channel = new MessageChannel();
  } catch {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => finish(false), timeoutMs);

    const finish = (safeToActivate: boolean): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(safeToActivate);
    };

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      const response = data as { type?: unknown; clientCount?: unknown };
      if (
        response.type !== PWA_REFRESH_CLIENT_QUERY_RESULT ||
        !Number.isSafeInteger(response.clientCount)
      ) return;
      finish(response.clientCount === 1);
    };

    try {
      waitingWorker.postMessage(
        { type: PWA_REFRESH_CLIENT_QUERY },
        [channel.port2]
      );
    } catch {
      finish(false);
    }
  });
}
