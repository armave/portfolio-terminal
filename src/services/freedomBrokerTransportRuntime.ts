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
  testFreedomTradeNetEventStream: (event: 'markets') => Promise<unknown>;
  fetchFreedomTradeNetPositions: () => Promise<unknown>;
  fetchFreedomTradeNetTrades: (fromDate?: string) => Promise<unknown>;
  fetchFreedomTradeNetActiveOrders: () => Promise<unknown>;
  fetchFreedomTradeNetQuoteStreamOnce: (symbol: string, fetchOptions?: RequestInit) => Promise<unknown | null>;
  fetchFreedomCashflows: (fromDate?: string) => Promise<unknown>;
  clearFreedomCashflowCache: () => void;
  clearFreedomStreamSnapshotCache: () => void;
}

/** Owns the read-only Freedom TradeNet transport and account-scoped cashflow cache. */
export function createFreedomBrokerTransportRuntime(
  dependencies: FreedomBrokerTransportRuntimeDependencies
): FreedomBrokerTransportRuntime {
  const now = dependencies.now || Date.now;
  const FREEDOM_CASHFLOW_CACHE_TTL_MS = 5 * 60 * 1000;
  let freedomCashflowCache: { secret: string; fromDate?: string; expiresAt: number; data: unknown } | null = null;
  let freedomCashflowRequest: { secret: string; fromDate?: string; promise: Promise<unknown> } | null = null;
  let streamScopeSecret = dependencies.getActiveGatewaySecret().trim();
  const streamSnapshotRequests = new Map<string, Promise<unknown>>();

  const syncStreamSnapshotScope = (): string => {
    const secret = dependencies.getActiveGatewaySecret().trim();
    if (secret !== streamScopeSecret) {
      streamSnapshotRequests.clear();
      streamScopeSecret = secret;
    }
    return secret;
  };

  const clearFreedomStreamSnapshotCache = (): void => {
    streamSnapshotRequests.clear();
    streamScopeSecret = dependencies.getActiveGatewaySecret().trim();
  };

  const runStreamSnapshotOnce = (
    key: string,
    requestSnapshot: () => Promise<unknown>,
    requestRest: () => Promise<unknown>,
    operation: string
  ): Promise<unknown> => {
    syncStreamSnapshotScope();
    const cached = streamSnapshotRequests.get(key);
    if (cached) {
      dependencies.recordMetric?.('stream_snapshot_cache_hit', { operation });
      return cached;
    }

    // The first load is the only attempt for this app session. Cache the final
    // outcome (WebSocket snapshot OR one REST recovery request), not merely the
    // in-flight promise, so scheduler ticks never repeat backup REST traffic.
    const request = (async () => {
      try {
        return await requestSnapshot();
      } catch {
        dependencies.recordMetric?.('provider_fallback', {
          operation,
          from: 'websocket_snapshot',
          to: 'rest'
        });
        return requestRest();
      }
    })();
    streamSnapshotRequests.set(key, request);
    return request;
  };

  const fetchFreedomTradeNetQuoteStreamOnce = (symbol: string, fetchOptions: RequestInit = {}): Promise<unknown | null> => {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) return Promise.reject(new Error('A ticker symbol is required.'));
    const ticker = normalized.includes('.') ? normalized : `${normalized}.US`;
    if (!/^[A-Z0-9.^=-]{1,32}$/.test(ticker)) {
      return Promise.reject(new Error('Enter one valid TradeNet ticker symbol.'));
    }
    const key = `quote:${ticker}`;
    syncStreamSnapshotScope();
    const cached = streamSnapshotRequests.get(key);
    if (cached) {
      dependencies.recordMetric?.('stream_snapshot_cache_hit', { operation: 'freedom_quote' });
      return cached;
    }
    const request = dependencies.proxyFetch(
      'freedom-quote-stream',
      { symbol: ticker },
      { ...fetchOptions, cache: 'no-store' }
    );
    streamSnapshotRequests.set(key, request);
    return request;
  };

  const testFreedomTradeNetEventStream = (event: 'markets'): Promise<unknown> => {
    if (event !== 'markets') {
      return Promise.reject(new Error('Only the not-yet-integrated markets event can be probed.'));
    }
    return dependencies.proxyFetch('freedom-event-stream', { event }, { cache: 'no-store' });
  };

  const fetchFreedomTradeNetPositions = (): Promise<unknown> =>
    runStreamSnapshotOnce(
      'portfolio',
      async () => {
        const snapshot = await dependencies.proxyFetch(
          'freedom-portfolio-snapshot',
          undefined,
          { cache: 'no-store' }
        );
        const portfolio = snapshot?.data?.result?.ps;
        if (
          snapshot?.ok !== true ||
          snapshot?.source !== 'authenticated_websocket' ||
          portfolio?.loaded !== true ||
          !Array.isArray(portfolio?.acc) ||
          !Array.isArray(portfolio?.pos)
        ) {
          throw new Error(snapshot?.error || 'TradeNet WebSocket portfolio snapshot is unavailable or incomplete.');
        }
        dependencies.recordMetric?.('broker_portfolio_source', {
          source: 'websocket_snapshot',
          account_count: portfolio.acc.length,
          position_count: portfolio.pos.length
        });
        return snapshot;
      },
      () => dependencies.proxyFetch('freedom-positions', undefined, { cache: 'no-store' }),
      'freedom_portfolio'
    );

  const fetchFreedomTradeNetTrades = (fromDate?: string): Promise<unknown> => {
    const startDate = typeof fromDate === 'string' && fromDate.trim() ? fromDate.trim() : undefined;
    return dependencies.proxyFetch('freedom-trades', startDate ? { fromDate: startDate } : undefined, { cache: 'no-store' });
  };

  const fetchFreedomTradeNetActiveOrders = (): Promise<unknown> =>
    runStreamSnapshotOnce(
      'active_orders',
      async () => {
        const snapshot = await dependencies.proxyFetch(
          'freedom-orders-stream',
          undefined,
          { cache: 'no-store' }
        );
        if (snapshot?.ok !== true || !Array.isArray(snapshot?.data?.orders?.order)) {
          throw new Error('TradeNet WebSocket did not return a valid active-orders snapshot.');
        }
        dependencies.recordMetric?.('broker_orders_source', {
          source: 'websocket_snapshot',
          order_count: snapshot.data.orders.order.length
        });
        return snapshot.data;
      },
      () => dependencies.proxyFetch(
        'freedom-orders',
        { active_only: 1 },
        { cache: 'no-store' }
      ),
      'freedom_active_orders'
    );

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
    testFreedomTradeNetEventStream,
    fetchFreedomTradeNetPositions,
    fetchFreedomTradeNetTrades,
    fetchFreedomTradeNetActiveOrders,
    fetchFreedomTradeNetQuoteStreamOnce,
    fetchFreedomCashflows,
    clearFreedomCashflowCache,
    clearFreedomStreamSnapshotCache
  };
}
