export interface FreedomBrokerTransportRuntimeDependencies {
  proxyFetch: (
    action?: string,
    queryParams?: Record<string, string | number | boolean | undefined | null>,
    fetchOptions?: RequestInit & { secret?: string; state?: Record<string, any> }
  ) => Promise<any>;
  getActiveGatewaySecret: () => string;
  recordMetric?: (metric: string, details?: Record<string, unknown>) => void;
  now?: () => number;
}

export interface FreedomBrokerTransportRuntime {
  testFreedomTradeNetConnection: () => Promise<unknown>;
  fetchFreedomTradeNetPositions: () => Promise<unknown>;
  fetchFreedomTradeNetTrades: (fromDate?: string) => Promise<unknown>;
  fetchFreedomTradeNetActiveOrders: () => Promise<unknown>;
  fetchFreedomTradeNetMarketDepth: (ticker: string) => Promise<unknown>;
  ensureFreedomTradeNetSession: () => Promise<unknown>;
  fetchFreedomCashflows: (fromDate?: string) => Promise<unknown>;
  clearFreedomCashflowCache: () => void;
}

/** Owns the read-only Freedom TradeNet transport and account-scoped cashflow cache. */
export function createFreedomBrokerTransportRuntime(
  dependencies: FreedomBrokerTransportRuntimeDependencies
): FreedomBrokerTransportRuntime {
  const now = dependencies.now || Date.now;
  const FREEDOM_CASHFLOW_CACHE_TTL_MS = 5 * 60 * 1000;
  let freedomCashflowCache: { secret: string; fromDate?: string; expiresAt: number; data: unknown } | null = null;
  let freedomCashflowRequest: { secret: string; fromDate?: string; promise: Promise<unknown> } | null = null;

  const testFreedomTradeNetConnection = (): Promise<unknown> =>
    dependencies.proxyFetch('freedom-test');

  const fetchFreedomTradeNetPositions = (): Promise<unknown> =>
    dependencies.proxyFetch('freedom-positions', undefined, { cache: 'no-store' });

  const fetchFreedomTradeNetTrades = (fromDate?: string): Promise<unknown> => {
    const startDate = typeof fromDate === 'string' && fromDate.trim() ? fromDate.trim() : undefined;
    return dependencies.proxyFetch('freedom-trades', startDate ? { fromDate: startDate } : undefined, { cache: 'no-store' });
  };

  const fetchFreedomTradeNetActiveOrders = (): Promise<unknown> =>
    dependencies.proxyFetch('freedom-orders', { active_only: 1 }, { cache: 'no-store' });

  const fetchFreedomTradeNetMarketDepth = (ticker: string): Promise<unknown> => {
    const symbol = String(ticker || '').trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error('A valid ticker is required to load market depth.');
    return dependencies.proxyFetch('freedom-market-depth', { symbol }, { cache: 'no-store' });
  };

  const ensureFreedomTradeNetSession = (): Promise<unknown> =>
    dependencies.proxyFetch('freedom-session', {}, {
      method: 'POST',
      body: JSON.stringify({}),
      cache: 'no-store'
    });

  const fetchFreedomCashflows = (fromDate?: string): Promise<unknown> => {
    const secret = dependencies.getActiveGatewaySecret().trim();
    const startDate = typeof fromDate === 'string' && fromDate.trim() ? fromDate.trim() : undefined;
    if (
      freedomCashflowCache &&
      freedomCashflowCache.secret === secret &&
      freedomCashflowCache.fromDate === startDate &&
      freedomCashflowCache.expiresAt > now()
    ) {
      dependencies.recordMetric?.('cache_hit', { cache: 'freedom_cashflows' });
      return Promise.resolve(freedomCashflowCache.data);
    }
    if (freedomCashflowRequest?.secret === secret && freedomCashflowRequest.fromDate === startDate) {
      dependencies.recordMetric?.('inflight_dedup', { operation: 'freedom_cashflows' });
      return freedomCashflowRequest.promise;
    }

    const request: Promise<unknown> = dependencies.proxyFetch(
      'freedom-cashflows',
      startDate ? { fromDate: startDate } : {},
      { cache: 'no-store' }
    )
      .then((data: unknown) => {
        freedomCashflowCache = {
          secret,
          fromDate: startDate,
          expiresAt: now() + FREEDOM_CASHFLOW_CACHE_TTL_MS,
          data
        };
        return data;
      })
      .catch((error) => {
        if (error instanceof Error) throw error;
        throw new Error('Failed to fetch Freedom Broker cashflows due to a network error.');
      })
      .finally(() => {
        if (freedomCashflowRequest?.promise === request) freedomCashflowRequest = null;
      });
    freedomCashflowRequest = { secret, fromDate: startDate, promise: request };
    return request;
  };

  const clearFreedomCashflowCache = (): void => {
    freedomCashflowCache = null;
    freedomCashflowRequest = null;
  };

  return {
    testFreedomTradeNetConnection,
    fetchFreedomTradeNetPositions,
    fetchFreedomTradeNetTrades,
    fetchFreedomTradeNetActiveOrders,
    fetchFreedomTradeNetMarketDepth,
    ensureFreedomTradeNetSession,
    fetchFreedomCashflows,
    clearFreedomCashflowCache
  };
}
