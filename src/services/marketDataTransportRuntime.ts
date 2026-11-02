import { createYahooDeepDataCache } from './yahooDeepDataCache';
import { createMarketInsightsProviderClient } from './marketInsightsProviders';
import { normalizeYahooBatchResults, type YahooBatchQuoteResult } from './yahooQuoteContracts';
import { normalizeYahooDeepStockData } from './yahooDeepDataContracts';
import type { YahooDeepStockData } from './yahooDeepDataContracts';
import type { MarketNewsItem, StocktwitsStream } from './marketInsightsProviders';

export type FallbackQuoteProvider = 'finnhub' | 'twelvedata';
export interface NormalizedFallbackQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sourceName: 'Finnhub' | 'Twelve Data';
}
export interface MarketDataTransportRuntimeDependencies {
  proxyFetch: (action?: string, queryParams?: Record<string, string | number | boolean | undefined | null>, fetchOptions?: RequestInit) => Promise<any>;
  recordMetric: (metric: string, details?: Record<string, unknown>) => void;
  now?: () => number;
  warn?: (...args: unknown[]) => void;
}
export interface MarketDataTransportRuntime {
  fetchYahooQuoteData: (ticker: string, force?: boolean) => Promise<YahooBatchQuoteResult | null>;
  fetchYahooStockData: (ticker: string) => Promise<unknown | null>;
  fetchFallbackQuote: (ticker: string, provider: FallbackQuoteProvider, force?: boolean) => Promise<NormalizedFallbackQuote>;
  rememberYahooDeepStockData: (value: unknown) => void;
  fetchYahooDeepStockData: (ticker: string, force?: boolean, signal?: AbortSignal) => Promise<YahooDeepStockData>;
  fetchMarketNews: (ticker: string, force?: boolean, signal?: AbortSignal) => Promise<MarketNewsItem[]>;
  fetchStocktwitsStream: (ticker: string, force?: boolean, signal?: AbortSignal) => Promise<StocktwitsStream>;
  clearYahooDeepStockDataCache: () => void;
}

/** Owns Yahoo quote batching, deep-data cache wiring, fallback quotes and insights feeds. */
export function createMarketDataTransportRuntime(dependencies: MarketDataTransportRuntimeDependencies): MarketDataTransportRuntime {
  const now = dependencies.now || Date.now;
  const warn = dependencies.warn || ((...args: unknown[]) => console.warn(...args));
  const MAX_API_CACHE_ENTRIES = 500;
  const setBoundedCache = <T>(cache: Map<string, T>, key: string, value: T): void => {
    cache.set(key, value);
    if (cache.size > MAX_API_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
  };
  const YAHOO_QUOTE_CACHE_TTL_MS = 8 * 1000;
  const yahooQuoteCache = new Map<string, { expiresAt: number; data: YahooBatchQuoteResult }>();
  const yahooQuoteRequests = new Map<string, Promise<YahooBatchQuoteResult>>();
  const yahooQuoteQueue = new Map<string, {
    request: Promise<YahooBatchQuoteResult>;
    resolvers: Array<(value: YahooBatchQuoteResult) => void>;
    rejecters: Array<(error: unknown) => void>;
    force: boolean;
  }>();
  let yahooQuoteFlushScheduled = false;

  const normalizeYahooSymbol = (symbol: unknown): string =>
    typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';

  const flushYahooQuoteQueue = async (): Promise<void> => {
    yahooQuoteFlushScheduled = false;
    const entries = [...yahooQuoteQueue.entries()];
    yahooQuoteQueue.clear();
    if (!entries.length) return;
    const symbols = entries.map(([symbol]) => symbol);
    const force = entries.some(([, pending]) => pending.force);
    const startedAt = now();
    try {
      const response = await dependencies.proxyFetch(
        'quote',
        { symbol: symbols.join(',') },
        force ? { cache: 'no-store' } : {}
      );
      const results = normalizeYahooBatchResults(response, symbols);
      const bySymbol = new Map<string, YahooBatchQuoteResult>();
      results.forEach((item) => {
        const symbol = normalizeYahooSymbol(item.symbol);
        if (symbol) bySymbol.set(symbol, item);
      });
      dependencies.recordMetric('provider_request', {
        provider: 'yahoo', operation: 'quote_batch', count: symbols.length,
        durationMs: now() - startedAt, success: true
      });
      for (const [symbol, pending] of entries) {
        const data = bySymbol.get(symbol) ?? { symbol, error: 'Yahoo quote missing from batch response' };
        if (!data.error && data.price && typeof data.price === 'object') {
          setBoundedCache(yahooQuoteCache, symbol, { expiresAt: now() + YAHOO_QUOTE_CACHE_TTL_MS, data });
        }
        if (yahooQuoteRequests.get(symbol) === pending.request) yahooQuoteRequests.delete(symbol);
        pending.resolvers.forEach(resolve => resolve(data));
      }
    } catch (error) {
      dependencies.recordMetric('provider_failure', {
        provider: 'yahoo', operation: 'quote_batch', count: symbols.length, durationMs: now() - startedAt
      });
      for (const [symbol, pending] of entries) {
        if (yahooQuoteRequests.get(symbol) === pending.request) yahooQuoteRequests.delete(symbol);
        pending.rejecters.forEach(reject => reject(error));
      }
    }
  };

  const fetchYahooQuoteData = (ticker: string, force = false): Promise<YahooBatchQuoteResult | null> => {
    const symbol = normalizeYahooSymbol(ticker);
    if (!symbol) return Promise.resolve(null);
    const cached = yahooQuoteCache.get(symbol);
    if (!force && cached && cached.expiresAt > now()) {
      dependencies.recordMetric('cache_hit', { cache: 'yahoo_quote' });
      return Promise.resolve(cached.data);
    }
    if (cached) yahooQuoteCache.delete(symbol);
    const existing = yahooQuoteRequests.get(symbol);
    if (!force && existing) {
      dependencies.recordMetric('inflight_dedup', { operation: 'yahoo_quote' });
      return existing;
    }
    let resolveRequest!: (value: YahooBatchQuoteResult) => void;
    let rejectRequest!: (error: unknown) => void;
    const request = new Promise<YahooBatchQuoteResult>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const pending = yahooQuoteQueue.get(symbol);
    if (pending) {
      pending.resolvers.push(resolveRequest);
      pending.rejecters.push(rejectRequest);
      pending.force = pending.force || force;
    } else {
      yahooQuoteQueue.set(symbol, { request, resolvers: [resolveRequest], rejecters: [rejectRequest], force });
      yahooQuoteRequests.set(symbol, request);
    }
    if (!yahooQuoteFlushScheduled) {
      yahooQuoteFlushScheduled = true;
      queueMicrotask(() => { void flushYahooQuoteQueue(); });
    }
    return request;
  };

  const yahooDeepDataCache = createYahooDeepDataCache({
    fetchData: (symbol, force, signal) => dependencies.proxyFetch('', { symbol }, {
      method: 'POST',
      ...(signal ? { signal } : {}),
      ...(force ? { cache: 'no-store' as RequestCache } : {})
    }),
    recordMetric: (metric, details) => dependencies.recordMetric(metric, details || {})
  });
  const rememberYahooDeepStockData = (value: unknown): void => yahooDeepDataCache.remember(value);

  const fetchYahooStockData = async (ticker: string): Promise<unknown | null> => {
    if (!ticker) return null;
    const cleanTicker = ticker.trim().toUpperCase();
    try {
      const data: unknown = await dependencies.proxyFetch('', { symbol: cleanTicker });
      rememberYahooDeepStockData(data);
      return data;
    } catch (error: unknown) {
      warn(`[Yahoo Data Error for ${cleanTicker}]:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  const isFallbackQuoteRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const parseProviderNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fetchFallbackQuote = async (
    ticker: string,
    provider: FallbackQuoteProvider,
    force = false
  ): Promise<NormalizedFallbackQuote> => {
    const symbol = normalizeYahooSymbol(ticker);
    if (!symbol) throw new Error('A ticker symbol is required for fallback quotes.');
    const responseData: unknown = await dependencies.proxyFetch(
      'provider-quote',
      { symbol, provider },
      force ? { cache: 'no-store' } : {}
    );
    const data = isFallbackQuoteRecord(responseData) ? responseData : {};
    const currentValue = provider === 'finnhub' ? data.c : data.close;
    const previousValue = provider === 'finnhub' ? data.pc : data.previous_close;
    const changeValue = provider === 'finnhub' ? data.d : data.change;
    const percentValue = provider === 'finnhub' ? data.dp : data.percent_change;
    const price = parseProviderNumber(currentValue);
    const previous = parseProviderNumber(previousValue);
    const suppliedChange = parseProviderNumber(changeValue);
    const suppliedPercent = parseProviderNumber(percentValue);
    if (price === null || price <= 0) {
      throw new Error(`${provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'} returned no valid quote for ${symbol}.`);
    }
    const hasPrevious = previous !== null && previous > 0;
    const change = suppliedChange !== null ? suppliedChange : hasPrevious ? price - previous : null;
    const changePercent = suppliedPercent !== null ? suppliedPercent :
      hasPrevious && change !== null ? (change / previous) * 100 : null;
    return {
      symbol, price,
      previousClose: hasPrevious ? previous : null,
      change, changePercent,
      sourceName: provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'
    };
  };

  const fetchYahooDeepStockData = (ticker: string, force = false, signal?: AbortSignal): Promise<YahooDeepStockData> =>
    yahooDeepDataCache.fetch(ticker, force, signal).then(normalizeYahooDeepStockData);
  const marketInsightsProviders = createMarketInsightsProviderClient({
    fetchNews: (symbol, signal, force) => dependencies.proxyFetch('news', { symbol }, {
      signal, ...(force ? { cache: 'no-store' as RequestCache } : {})
    }),
    fetchStocktwits: (symbol, signal, force) => dependencies.proxyFetch('stocktwits', { symbol }, {
      signal, ...(force ? { cache: 'no-store' as RequestCache } : {})
    }),
    onNewsError: (symbol, error) => {
      warn('[Market News Error for ' + symbol + ']:', error instanceof Error ? error.message : error);
    }
  });
  const fetchMarketNews = (ticker: string, force = false, signal?: AbortSignal): Promise<MarketNewsItem[]> =>
    marketInsightsProviders.fetchMarketNews(ticker, force, signal);
  const fetchStocktwitsStream = (ticker: string, force = false, signal?: AbortSignal): Promise<StocktwitsStream> =>
    marketInsightsProviders.fetchStocktwitsStream(ticker, force, signal);
  const clearYahooDeepStockDataCache = (): void => {
    yahooDeepDataCache.clear();
    yahooQuoteCache.clear();
    yahooQuoteRequests.clear();
    yahooQuoteQueue.clear();
    yahooQuoteFlushScheduled = false;
    marketInsightsProviders.clear();
  };
  return {
    fetchYahooQuoteData, fetchYahooStockData, fetchFallbackQuote,
    rememberYahooDeepStockData, fetchYahooDeepStockData,
    fetchMarketNews, fetchStocktwitsStream, clearYahooDeepStockDataCache
  };
}
