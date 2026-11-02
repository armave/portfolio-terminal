import { resetMarketRequestGate, runMarketDataRequest } from './marketRequestGate';
import { createCloudStateSecurity } from './cloudStateSecurity';
import { createCloudRevisionCoordinator } from './cloudRevisionCoordinator';
import { createCloudStateSyncRuntime } from './cloudStateSyncRuntime';
export type { SyncOptions } from './cloudStateSyncRuntime';
import { processRollovers } from '../domain/portfolio';
import { getGatewaySecret, loadSavedHistory, loadSavedState, saveState } from './storage';
import { ActiveBrokerTranche, GuestTrancheLedgerRecord, PortfolioState } from '../types/portfolio';
import type { AppLanguage } from './i18n';
import { normalizeYahooBatchResults } from './yahooQuoteContracts';
import type { YahooBatchQuoteResult } from './yahooQuoteContracts';
import { createYahooDeepDataCache } from './yahooDeepDataCache';
import { createMarketInsightsProviderClient } from './marketInsightsProviders';
import { normalizeYahooDeepStockData } from './yahooDeepDataContracts';
import type { YahooDeepStockData } from './yahooDeepDataContracts';
import { normalizeFreedomTrades } from './freedomTradeContracts';
export { normalizeFreedomTrades } from './freedomTradeContracts';
export type { FreedomExecutedTrade } from '../types/freedomTrade';
import type { MarketNewsItem, StocktwitsStream } from './marketInsightsProviders';
export { normalizeFreedomActiveOrders, normalizeFreedomPortfolio } from './freedomAccountContracts';
export type { FreedomActiveOrder, FreedomCashBalance, FreedomOpenPosition, FreedomPortfolioSnapshot } from './freedomAccountContracts';
export type { MarketNewsItem, StocktwitsMessage, StocktwitsStream } from './marketInsightsProviders';
export type { YahooDeepStockData, YahooDeepAnalystTargets, YahooDeepFinancialHealth, YahooDeepPrice, YahooDeepValuation, YahooEarningsHistoryItem, YahooUpgradeDowngrade } from './yahooDeepDataContracts';

export interface SyncedMarginDigest {
  key: string;
  title: string;
  scope: 'position' | 'portfolio';
  ticker?: string;
  analysis: string;
  articles: Array<{ ticker: string; headline: string; source: string; url: string; publishedAt?: number; summary?: string }>;
  syncedAt: string;
}

const MARGIN_DIGEST_PATH = '/api/margin-digest';

export async function loadSyncedMarginDigest(key: string): Promise<{ digest: SyncedMarginDigest; revision: number } | null> {
  const secret = getActiveGatewaySecret().trim();
  if (!secret) throw new Error('Gateway Secret is not available.');
  const digestUrl = new URL(MARGIN_DIGEST_PATH, WORKER_PROXY_URL);
  digestUrl.searchParams.set('key', key);
  const response = await fetch(digestUrl, {
    headers: { 'X-App-Auth': secret, Authorization: `Bearer ${secret}` },
    cache: 'no-store'
  });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Could not load synced margin digest (HTTP ${response.status}).`);
  if (!data || data.key !== key || typeof data.analysis !== 'string' || !Array.isArray(data.articles) || typeof data.syncedAt !== 'string') return null;
  const revision = readCloudRevision(response.headers) ?? 0;
  return { digest: data as SyncedMarginDigest, revision };
}

export async function saveSyncedMarginDigest(digest: SyncedMarginDigest, revision: number): Promise<number> {
  const secret = getActiveGatewaySecret().trim();
  if (!secret) throw new Error('Gateway Secret is not available.');
  const response = await fetch(new URL(MARGIN_DIGEST_PATH, WORKER_PROXY_URL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Auth': secret,
      Authorization: `Bearer ${secret}`,
      'If-Match': `"${revision}"`
    },
    body: JSON.stringify(digest),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Could not save synced margin digest (HTTP ${response.status}).`);
  const nextRevision = readCloudRevision(response.headers) ?? Number(data?.revision);
  if (!Number.isSafeInteger(nextRevision) || nextRevision < 1) throw new Error('Server saved the digest but returned an invalid revision.');
  return nextRevision;
}

const WORKER_PROXY_URL = 'https://trading-proxy.armenavetisyan-sa.workers.dev';

const cloudRevisionCoordinator = createCloudRevisionCoordinator();

const cloudStateSecurity = createCloudStateSecurity({
  workerProxyUrl: WORKER_PROXY_URL,
  getStoredGatewaySecret: getGatewaySecret
});
const {
  getActiveGatewaySecret,
  encryptCloudPayload,
  decryptCloudPayload
} = cloudStateSecurity;

export function setSecretGetter(getter: () => string): void {
  cloudStateSecurity.setSecretGetter(getter);
}

/** Drop the administrator-only workspace key when the signed-in identity changes. */
export function clearCloudEncryptionSecretCache(): void {
  cloudStateSecurity.clearCloudEncryptionSecretCache();
}

function readCloudRevision(headers?: Headers | null): number | null {
  const etag = headers?.get('ETag');
  if (!etag) return null;
  const revision = Number(etag.replace(/^W\//, '').replace(/^"|"$/g, ''));
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

const cloudStateSyncRuntime = createCloudStateSyncRuntime({
  workerProxyUrl: WORKER_PROXY_URL,
  getActiveGatewaySecret,
  encryptCloudPayload,
  decryptCloudPayload,
  readCloudRevision,
  revisionCoordinator: cloudRevisionCoordinator,
  processRollovers: (state) => processRollovers(state),
  loadSavedState: (fallback) => loadSavedState(fallback),
  loadSavedHistory: () => loadSavedHistory(),
  saveState: (state) => saveState(state),
  normalizeFreedomTrades: (trades) => normalizeFreedomTrades(trades)
});

export const pullCloudState = cloudStateSyncRuntime.pullCloudState;
export const pushCloudState = cloudStateSyncRuntime.pushCloudState;
export const syncCloudState = cloudStateSyncRuntime.syncCloudState;
export const pushCloudHistory = cloudStateSyncRuntime.pushCloudHistory;
export const clearCloudHistory = cloudStateSyncRuntime.clearCloudHistory;
export const pullCloudHistory = cloudStateSyncRuntime.pullCloudHistory;


export interface ProxyFetchOptions extends RequestInit {
  secret?: string;
  state?: Record<string, any> | PortfolioState;
}

const proxyReadRequests = new Map<string, Promise<any>>();
const COALESCED_READ_ACTIONS = new Set(['', 'quote', 'provider-quote', 'news', 'stocktwits', 'freedom-quote']);
const MARKET_DATA_ACTIONS = new Set([
  '', 'quote', 'provider-quote', 'news', 'stocktwits',
  'freedom-quote', 'freedom-news', 'freedom-history', 'freedom-market-depth'
]);

function createMarketRequestIdentity(
  action: string,
  queryParams: Record<string, string | number | boolean | undefined | null>,
  fetchOptions: ProxyFetchOptions
): string {
  const normalizedParams = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const secret = (fetchOptions.secret || getActiveGatewaySecret()).trim();
  const body = typeof fetchOptions.body === 'string' ? fetchOptions.body : '';
  return JSON.stringify([action, method, normalizedParams, body, secret]);
}

function dispatchProxyFetch(
  action: string,
  queryParams: Record<string, string | number | boolean | undefined | null>,
  fetchOptions: ProxyFetchOptions
): Promise<any> {
  const isMarketData = MARKET_DATA_ACTIONS.has(action) &&
    (action !== '' || Boolean(queryParams.symbol));
  const request = () => performProxyFetch(action, queryParams, fetchOptions);
  return isMarketData && !fetchOptions.signal
    ? runMarketDataRequest(createMarketRequestIdentity(action, queryParams, fetchOptions), request)
    : request();
}

/**
 * Share identical in-flight market-data reads across features. This is deliberately
 * request coalescing only (not a second response cache): failures are not retained,
 * and writes / cloud state operations are never deduplicated.
 */
export function proxyFetch(
  action = '',
  queryParams: Record<string, string | number | boolean | undefined | null> = {},
  fetchOptions: ProxyFetchOptions = {}
): Promise<any> {
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const canCoalesce = !fetchOptions.signal && fetchOptions.cache !== 'no-store' && COALESCED_READ_ACTIONS.has(action) &&
    (method === 'GET' || (action === '' && method === 'POST')) &&
    !fetchOptions.body && !fetchOptions.state;
  if (!canCoalesce) return dispatchProxyFetch(action, queryParams, fetchOptions);

  const secret = (fetchOptions.secret || getActiveGatewaySecret()).trim();
  const normalizedParams = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([action, method, normalizedParams, secret]);
  const existing = proxyReadRequests.get(key);
  if (existing) {
    recordApiMetric('inflight_dedup', { operation: action || 'deep_data' });
    return existing;
  }

  const request = dispatchProxyFetch(action, queryParams, fetchOptions);
  proxyReadRequests.set(key, request);
  void request.finally(() => {
    if (proxyReadRequests.get(key) === request) proxyReadRequests.delete(key);
  }).catch(() => {
    // The original promise owns error handling; prevent the cleanup chain from
    // creating an unhandled rejection.
  });
  return request;
}

async function performProxyFetch(
  action = '',
  queryParams: Record<string, string | number | boolean | undefined | null> = {},
  fetchOptions: ProxyFetchOptions = {}
): Promise<any> {
  const url = new URL(WORKER_PROXY_URL);
  if (action) {
    if (action.startsWith('/')) {
      url.pathname = action;
    } else {
      url.searchParams.append('action', action);
    }
  }
  Object.entries(queryParams).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.append(k, String(v));
    }
  });

  const authSecret = (fetchOptions.secret || getActiveGatewaySecret()).trim();
  if (!authSecret) {
    throw new Error('Gateway Secret is not available. Restore or enter the Gateway Secret before requesting broker data.');
  }

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    headers: {
      ...(fetchOptions.headers || {}),
      'Content-Type': 'application/json',
      // Authentication headers are authoritative and cannot be overridden by
      // per-request headers supplied by a caller.
      'X-App-Auth': authSecret,
      Authorization: `Bearer ${authSecret}`
    }
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const errorMessage = typeof data === 'object' && data !== null
      ? (data.error || data.message || `HTTP ${res.status}`)
      : `HTTP ${res.status}`;
    throw new Error(errorMessage);
  }
  return data;
}

const MAX_API_CACHE_ENTRIES = 500;

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T): void {
  cache.set(key, value);
  if (cache.size > MAX_API_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

const YAHOO_QUOTE_CACHE_TTL_MS = 8 * 1000;
const yahooQuoteCache = new Map<string, { expiresAt: number; data: YahooBatchQuoteResult }>();
const yahooQuoteRequests = new Map<string, Promise<YahooBatchQuoteResult>>();
const yahooQuoteQueue = new Map<string, {
  request: Promise<YahooBatchQuoteResult>;
  resolvers: Array<(value: YahooBatchQuoteResult) => void>;
  rejecters: Array<(error: unknown) => void>;
}>();
let yahooQuoteFlushScheduled = false;

function recordApiMetric(metric: string, details: Record<string, unknown> = {}): void {
  // Keep metrics low-cardinality: never include credentials or full request URLs.
  console.info('[api-metric]', JSON.stringify({ metric, ...details }));
}

async function flushYahooQuoteQueue(): Promise<void> {
  yahooQuoteFlushScheduled = false;
  const entries = [...yahooQuoteQueue.entries()];
  yahooQuoteQueue.clear();
  if (!entries.length) return;
  const symbols = entries.map(([symbol]) => symbol);
  const startedAt = Date.now();
  try {
    const response = await proxyFetch('quote', { symbol: symbols.join(',') });
    const results = normalizeYahooBatchResults(response, symbols);
    const bySymbol = new Map<string, YahooBatchQuoteResult>();
    results.forEach((item) => {
      const symbol = normalizeYahooSymbol(item.symbol);
      if (symbol) bySymbol.set(symbol, item);
    });
    recordApiMetric('provider_request', { provider: 'yahoo', operation: 'quote_batch', count: symbols.length, durationMs: Date.now() - startedAt, success: true });
    for (const [symbol, pending] of entries) {
      const data = bySymbol.get(symbol) ?? { symbol, error: 'Yahoo quote missing from batch response' };
      if (!data.error && data.price && typeof data.price === 'object') {
        setBoundedCache(yahooQuoteCache, symbol, { expiresAt: Date.now() + YAHOO_QUOTE_CACHE_TTL_MS, data });
      }
      if (yahooQuoteRequests.get(symbol) === pending.request) yahooQuoteRequests.delete(symbol);
      pending.resolvers.forEach(resolve => resolve(data));
    }
  } catch (error) {
    recordApiMetric('provider_failure', { provider: 'yahoo', operation: 'quote_batch', count: symbols.length, durationMs: Date.now() - startedAt });
    for (const [symbol, pending] of entries) {
      if (yahooQuoteRequests.get(symbol) === pending.request) yahooQuoteRequests.delete(symbol);
      pending.rejecters.forEach(reject => reject(error));
    }
  }
}

/** Lightweight quote path. Calls queued in the same turn are batched by the Worker. */
export async function fetchYahooQuoteData(ticker: string, force = false): Promise<YahooBatchQuoteResult | null> {
  const symbol = normalizeYahooSymbol(ticker);
  if (!symbol) return null;
  const cached = yahooQuoteCache.get(symbol);
  if (!force && cached && cached.expiresAt > Date.now()) {
    recordApiMetric('cache_hit', { cache: 'yahoo_quote' });
    return cached.data;
  }
  if (cached) yahooQuoteCache.delete(symbol);
  const existing = yahooQuoteRequests.get(symbol);
  if (!force && existing) {
    recordApiMetric('inflight_dedup', { operation: 'yahoo_quote' });
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
    // A forced refresh may join a batch that has not been sent yet; it still
    // bypasses cached data and never strands an earlier caller's promise.
    pending.resolvers.push(resolveRequest);
    pending.rejecters.push(rejectRequest);
  } else {
    yahooQuoteQueue.set(symbol, { request, resolvers: [resolveRequest], rejecters: [rejectRequest] });
    yahooQuoteRequests.set(symbol, request);
  }
  if (!yahooQuoteFlushScheduled) {
    yahooQuoteFlushScheduled = true;
    queueMicrotask(() => { void flushYahooQuoteQueue(); });
  }
  return request;
}

export async function fetchYahooStockData(ticker: string): Promise<unknown | null> {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    const data: unknown = await proxyFetch('', { symbol: cleanTicker });
    rememberYahooDeepStockData(data);
    return data;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Yahoo Data Error for ${cleanTicker}]:`, message);
    return null;
  }
}

// Backward-compatible export; the contract and normalization live separately
// from the API transport so the provider boundary can be tested in isolation.
export { normalizeYahooBatchResults };
export type { YahooBatchQuoteResult, YahooQuotePricePayload } from './yahooQuoteContracts';

export type FallbackQuoteProvider = 'finnhub' | 'twelvedata';

export interface NormalizedFallbackQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sourceName: 'Finnhub' | 'Twelve Data';
}

function isFallbackQuoteRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseProviderNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Fetch and normalize a single quote from a configured fallback provider. */
export async function fetchFallbackQuote(
  ticker: string,
  provider: FallbackQuoteProvider
): Promise<NormalizedFallbackQuote> {
  const symbol = normalizeYahooSymbol(ticker);
  if (!symbol) throw new Error('A ticker symbol is required for fallback quotes.');

  const responseData: unknown = await proxyFetch('provider-quote', { symbol, provider });
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
  const change = suppliedChange !== null
    ? suppliedChange
    : hasPrevious ? price - previous : null;
  const changePercent = suppliedPercent !== null
    ? suppliedPercent
    : hasPrevious && change !== null ? (change / previous) * 100 : null;

  return {
    symbol,
    price,
    previousClose: hasPrevious ? previous : null,
    change,
    changePercent,
    sourceName: provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'
  };
}

function normalizeYahooSymbol(symbol: unknown): string {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

const yahooDeepDataCache = createYahooDeepDataCache({
  fetchData: (symbol, force, signal) => proxyFetch('', { symbol }, {
    method: 'POST',
    ...(signal ? { signal } : {}),
    ...(force ? { cache: 'no-store' as RequestCache } : {})
  }),
  recordMetric: recordApiMetric
});

/** Seed the shared deep-data cache with a successful item from a batch quote response. */
export function rememberYahooDeepStockData(value: unknown): void {
  yahooDeepDataCache.remember(value);
}

/**
 * Fetches the full Yahoo payload once per ticker and shares it between board
 * analyst targets and all Market Insights tabs. Explicit refreshes bypass cache.
 */
export function fetchYahooDeepStockData(
  ticker: string,
  force = false,
  signal?: AbortSignal
): Promise<YahooDeepStockData> {
  return yahooDeepDataCache.fetch(ticker, force, signal).then(normalizeYahooDeepStockData);
}

const marketInsightsProviders = createMarketInsightsProviderClient({
  fetchNews: (symbol, signal, force) => proxyFetch('news', { symbol }, {
    signal,
    ...(force ? { cache: 'no-store' as RequestCache } : {})
  }),
  fetchStocktwits: (symbol, signal, force) => proxyFetch('stocktwits', { symbol }, {
    signal,
    ...(force ? { cache: 'no-store' as RequestCache } : {})
  }),
  onNewsError: (symbol, error) => {
    console.warn('[Market News Error for ' + symbol + ']:', error instanceof Error ? error.message : error);
  }
});

export function fetchMarketNews(
  ticker: string,
  force = false,
  signal?: AbortSignal
): Promise<MarketNewsItem[]> {
  return marketInsightsProviders.fetchMarketNews(ticker, force, signal);
}

export function fetchStocktwitsStream(
  ticker: string,
  force = false,
  signal?: AbortSignal
): Promise<StocktwitsStream> {
  return marketInsightsProviders.fetchStocktwitsStream(ticker, force, signal);
}

/** Clears shared deep-data and market-insights cache state, primarily for isolated tests. */
export function clearYahooDeepStockDataCache(): void {
  yahooDeepDataCache.clear();
  yahooQuoteCache.clear();
  yahooQuoteRequests.clear();
  yahooQuoteQueue.clear();
  yahooQuoteFlushScheduled = false;
  marketInsightsProviders.clear();
}

export async function validateGatewaySecret(secret: string): Promise<boolean> {
  const cleanSecret = typeof secret === 'string' ? secret.trim() : '';
  if (!cleanSecret) return false;

  try {
    // Validate the session through the identity endpoint. Do not use /api/state:
    // guests must never download the shared encrypted administrator portfolio.
    const response = await fetch(new URL('/api/auth/me', WORKER_PROXY_URL), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': cleanSecret,
        Authorization: `Bearer ${cleanSecret}`
      },
      cache: 'no-store'
    });
      if (!response.ok) {
      currentUserCache = null;
      return false;
    }
    // Reuse the identity returned during validation instead of issuing a second
    // identical /api/auth/me read during startup.
    const payload = typeof response.json === 'function'
      ? await response.json().catch(() => null)
      : null;
    const user = normalizeAuthUser(payload?.user);
    if (user) rememberCurrentUser(cleanSecret, user);
    return true;
  } catch (error) {
      console.warn('Account session validation failed:', error);
    return false;
  }
}

/** Read-only connectivity test for Freedom Broker Armenia TradeNet. */
export async function testFreedomTradeNetConnection(): Promise<unknown> {
  return proxyFetch('freedom-test');
}

/** Fetch raw read-only TradeNet positions so the actual broker schema can be verified. */
export async function fetchFreedomTradeNetPositions(): Promise<unknown> {
  return proxyFetch('freedom-positions', undefined, { cache: 'no-store' });
}

/** Fetch read-only TradeNet executions, optionally bounded from the latest locally closed trade date. */
export async function fetchFreedomTradeNetTrades(fromDate?: string): Promise<unknown> {
  const startDate = typeof fromDate === 'string' && fromDate.trim() ? fromDate.trim() : undefined;
  return proxyFetch('freedom-trades', startDate ? { fromDate: startDate } : undefined, { cache: 'no-store' });
}

/** Fetch current active TradeNet orders without reusing a cached response. */
export async function fetchFreedomTradeNetActiveOrders(): Promise<unknown> {
  return proxyFetch('freedom-orders', { active_only: 1 }, { cache: 'no-store' });
}

/** Fetch one read-only TradeNet order-book snapshot without response caching. */
export async function fetchFreedomTradeNetMarketDepth(ticker: string): Promise<unknown> {
  const symbol = String(ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,20}$/.test(symbol)) throw new Error('A valid ticker is required to load market depth.');
  return proxyFetch('freedom-market-depth', { symbol }, { cache: 'no-store' });
}

/** Ensure the administrator's live TradeNet SID is present in server-side storage. */
export async function ensureFreedomTradeNetSession(): Promise<unknown> {
  return proxyFetch('freedom-session', {}, {
    method: 'POST',
    body: JSON.stringify({}),
    cache: 'no-store'
  });
}

/** Cache each broker cashflow date range briefly to avoid repeat reads on quick Trades navigation. */
const FREEDOM_CASHFLOW_CACHE_TTL_MS = 5 * 60 * 1000;
let freedomCashflowCache: { secret: string; fromDate?: string; expiresAt: number; data: unknown } | null = null;
let freedomCashflowRequest: { secret: string; fromDate?: string; promise: Promise<unknown> } | null = null;

export async function fetchFreedomCashflows(fromDate?: string): Promise<unknown> {
  const secret = getActiveGatewaySecret().trim();
  const startDate = typeof fromDate === 'string' && fromDate.trim() ? fromDate.trim() : undefined;
  if (
    freedomCashflowCache &&
    freedomCashflowCache.secret === secret &&
    freedomCashflowCache.fromDate === startDate &&
    freedomCashflowCache.expiresAt > Date.now()
  ) {
    recordApiMetric('cache_hit', { cache: 'freedom_cashflows' });
    return freedomCashflowCache.data;
  }
  if (freedomCashflowRequest?.secret === secret && freedomCashflowRequest.fromDate === startDate) {
    recordApiMetric('inflight_dedup', { operation: 'freedom_cashflows' });
    return freedomCashflowRequest.promise;
  }

  const request: Promise<unknown> = proxyFetch(
    'freedom-cashflows',
    startDate ? { fromDate: startDate } : {},
    { cache: 'no-store' }
  )
    .then((data: unknown) => {
      freedomCashflowCache = {
        secret,
        fromDate: startDate,
        expiresAt: Date.now() + FREEDOM_CASHFLOW_CACHE_TTL_MS,
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
}

/** Clear the in-memory snapshot between isolated tests or account changes. */
export function clearFreedomCashflowCache(): void {
  freedomCashflowCache = null;
  freedomCashflowRequest = null;
}


export interface AuthUser {
  id: string;
  name: string;
  role: "guest" | "admin";
  language: AppLanguage;
  createdAt: string;
}
export interface AuthSession { token: string; user: AuthUser; expiresAt: number; }
const AUTH_API_URL = WORKER_PROXY_URL;

const AUTH_READ_TTL_MS = 15_000;
const CURRENT_USER_READ_TTL_MS = 5_000;
const authReadRequests = new Map<string, Promise<unknown>>();
const guestPortfolioPublicationFingerprints = new Map<string, string>();
const guestPortfolioPublicationRequests = new Map<string, Promise<void>>();

let currentUserCache: { token: string; expiresAt: number; user: AuthUser } | null = null;
let usersCache: { token: string; expiresAt: number; users: AuthUser[] } | null = null;
let usersRequest: { token: string; generation: number; promise: Promise<AuthUser[]> } | null = null;
let usersCacheGeneration = 0;

function normalizeAuthUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== "object") return null;
  const user = value as Partial<AuthUser>;
  if (typeof user.id !== "string" || typeof user.name !== "string" ||
      (user.role !== "admin" && user.role !== "guest") || typeof user.createdAt !== "string") {
    return null;
  }
  // Accounts created before language preferences were introduced remain English by default.
  return { ...user, language: user.language === "ru" ? "ru" : "en" } as AuthUser;
}

function normalizeAuthSession(session: AuthSession): AuthSession {
  const user = normalizeAuthUser(session?.user);
  if (!user) throw new Error("The authenticated user response was invalid.");
  return { ...session, user };
}

function rememberCurrentUser(token: string, user: AuthUser): void {
  currentUserCache = { token, user, expiresAt: Date.now() + CURRENT_USER_READ_TTL_MS };
}

function invalidateUserDirectoryCache(token: string): void {
  usersCacheGeneration += 1;
  usersCache = null;
  usersRequest = null;
  currentUserCache = null;
  authReadRequests.delete(JSON.stringify(["/api/auth/users", token]));
}

export function clearGuestPortfolioPublicationCache(): void {
  guestPortfolioPublicationFingerprints.clear();
  guestPortfolioPublicationRequests.clear();
}

export function clearApiRequestCaches(): void {
  authReadRequests.clear();
  currentUserCache = null;
  usersCache = null;
  usersRequest = null;
  usersCacheGeneration += 1;
  cloudStateSyncRuntime.clearRequestCache();
  clearGuestPortfolioPublicationCache();
  clearFreedomCashflowCache();
  resetMarketRequestGate();
}

function authRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown>; token?: string } = {}
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  if (method === "GET" && !options.body) {
    const key = JSON.stringify([path, options.token || ""]);
    const existing = authReadRequests.get(key);
    if (existing) return existing as Promise<T>;
    const request = performAuthRequest<T>(path, options);
    authReadRequests.set(key, request);
    void request.finally(() => {
      if (authReadRequests.get(key) === request) authReadRequests.delete(key);
    }).catch(() => {
      // The original caller owns error handling; ignore the cleanup chain.
    });
    return request;
  }
  return performAuthRequest<T>(path, options);
}

async function performAuthRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown>; token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
    headers["X-App-Auth"] = options.token;
  }
  const response = await fetch(new URL(path, AUTH_API_URL), {
    method: options.method || "GET", headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}), cache: "no-store"
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Authentication request failed (HTTP ${response.status}).`);
  return payload as T;
}
export function getAuthStatus(): Promise<{ setupRequired: boolean; userCount: number }> {
  return authRequest("/api/auth/status");
}
export async function loginAccount(name: string, password: string): Promise<AuthSession> {
  const session = await authRequest<AuthSession>("/api/auth/login", { method: "POST", body: { name, password } });
  return normalizeAuthSession(session);
}
export async function bootstrapAdmin(name: string, password: string, bootstrapSecret: string): Promise<AuthSession> {
  const session = await authRequest<AuthSession>("/api/auth/bootstrap", { method: "POST", body: { name, password, bootstrapSecret } });
  return normalizeAuthSession(session);
}
export function getCurrentUser(): Promise<AuthUser> {
  const token = getActiveGatewaySecret();
  if (!token) return Promise.reject(new Error("Not signed in."));
  if (currentUserCache?.token === token && currentUserCache.expiresAt > Date.now()) {
    return Promise.resolve(currentUserCache.user);
  }
  return authRequest<{ user: unknown }>("/api/auth/me", { token }).then((payload) => {
    const user = normalizeAuthUser(payload?.user);
    if (!user) throw new Error("The authenticated user response was invalid.");
    rememberCurrentUser(token, user);
    return user;
  });
}

export function listUsers(): Promise<AuthUser[]> {
  const token = getActiveGatewaySecret();
  if (!token) return Promise.reject(new Error("Not signed in."));
  if (usersCache?.token === token && usersCache.expiresAt > Date.now()) {
    return Promise.resolve(usersCache.users);
  }
  if (usersRequest?.token === token && usersRequest.generation === usersCacheGeneration) {
    return usersRequest.promise;
  }
  const generation = usersCacheGeneration;
  const request = authRequest<{ users: unknown[] }>("/api/auth/users", { token })
    .then((payload) => {
      const users = Array.isArray(payload?.users)
        ? payload.users.map(normalizeAuthUser).filter((user): user is AuthUser => user !== null)
        : [];
      if (generation === usersCacheGeneration) {
        usersCache = { token, users, expiresAt: Date.now() + AUTH_READ_TTL_MS };
      }
      return users;
    })
    .finally(() => {
      if (usersRequest?.promise === request) usersRequest = null;
    });
  usersRequest = { token, generation, promise: request };
  return request;
}
export async function createUser(input: { name: string; password: string; role: "guest" | "admin"; language?: AppLanguage }): Promise<AuthUser> {
  const token = getActiveGatewaySecret();
  if (!token) throw new Error("Not signed in.");
  invalidateUserDirectoryCache(token);
  try {
    return (await authRequest<{ user: AuthUser }>("/api/auth/users", { method: "POST", token, body: { action: "create", ...input } })).user;
  } finally {
    invalidateUserDirectoryCache(token);
  }
}
export async function updateUser(id: string, input: { name: string; role: "guest" | "admin"; language?: AppLanguage; password?: string }): Promise<AuthUser> {
  const token = getActiveGatewaySecret();
  if (!token) throw new Error("Not signed in.");
  invalidateUserDirectoryCache(token);
  try {
    return (await authRequest<{ user: AuthUser }>("/api/auth/users", { method: "POST", token, body: { action: "update", id, ...input } })).user;
  } finally {
    invalidateUserDirectoryCache(token);
  }
}

export async function updateMyLanguage(language: AppLanguage): Promise<AuthUser> {
  const token = getActiveGatewaySecret();
  if (!token) throw new Error("Not signed in.");
  invalidateUserDirectoryCache(token);
  const payload = await authRequest<{ user: unknown }>("/api/auth/me", {
    method: "POST",
    token,
    body: { language }
  });
  const user = normalizeAuthUser(payload?.user);
  if (!user) throw new Error("The authenticated user response was invalid.");
  rememberCurrentUser(token, user);
  return user;
}
export async function deleteUser(id: string): Promise<void> {
  const token = getActiveGatewaySecret();
  if (!token) throw new Error("Not signed in.");
  invalidateUserDirectoryCache(token);
  try {
    await authRequest<{ success: boolean }>("/api/auth/users", { method: "POST", token, body: { action: "delete", id } });
  } finally {
    invalidateUserDirectoryCache(token);
  }
}
export async function logoutAccount(): Promise<void> {
  const token = getActiveGatewaySecret();
  if (token) await authRequest<{ success: boolean }>("/api/auth/logout", { method: "POST", token, body: {} });
  clearApiRequestCaches();
}


export interface GuestPortfolioSnapshot {
  updatedAt: number;
  tranches: ActiveBrokerTranche[];
  ledger: GuestTrancheLedgerRecord[];
  ledgerUpdatedAt: number;
}

export type GuestPortfolioProjection = Pick<GuestPortfolioSnapshot, 'updatedAt' | 'tranches'>;

function normalizeGuestLedgerRecords(value: unknown): GuestTrancheLedgerRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((record): record is GuestTrancheLedgerRecord => Boolean(
    record && typeof record === "object" &&
    typeof (record as GuestTrancheLedgerRecord).assignmentId === "string" &&
    typeof (record as GuestTrancheLedgerRecord).trancheId === "string" &&
    typeof (record as GuestTrancheLedgerRecord).ticker === "string" &&
    ["active", "closed", "unassigned"].includes((record as GuestTrancheLedgerRecord).status) &&
    Number.isFinite(Number((record as GuestTrancheLedgerRecord).assignedQuantity)) &&
    Number.isFinite(Number((record as GuestTrancheLedgerRecord).openQuantity))
  ));
}

function guestPublicationFingerprint(publication: GuestPortfolioPublication): string {
  const ledgerUpserts = (publication.ledgerUpserts || []).map(({ updatedAt: _updatedAt, ...record }) => record);
  return JSON.stringify({
    tranches: publication.snapshot.tranches,
    ledgerUpserts,
    retainedAssignmentIds: publication.retainedAssignmentIds
      ? [...publication.retainedAssignmentIds].sort()
      : null
  });
}

/** Read the current projection and durable assignment history scoped by the server to this guest. */
export async function getGuestPortfolioSnapshot(): Promise<GuestPortfolioSnapshot> {
  const token = getActiveGatewaySecret();
  if (!token) throw new Error("Not signed in.");
  const response = await authRequest<{
    snapshot?: { updatedAt?: number; tranches?: ActiveBrokerTranche[] };
    ledger?: unknown;
    ledgerUpdatedAt?: number;
  }>("/api/guest-portfolio", { token });
  const snapshot = response?.snapshot;
  return {
    updatedAt: Number(snapshot?.updatedAt) || 0,
    tranches: Array.isArray(snapshot?.tranches) ? snapshot.tranches.filter((tranche) =>
      tranche && typeof tranche.id === "string" && typeof tranche.ticker === "string" &&
      Number.isFinite(Number(tranche.quantity)) && Number(tranche.quantity) > 0
    ) : [],
    ledger: normalizeGuestLedgerRecords(response?.ledger),
    ledgerUpdatedAt: Number(response?.ledgerUpdatedAt) || 0
  };
}

/** Administrator-only publication of one already-filtered guest projection. */
export function publishGuestPortfolioSnapshot(
  guestId: string,
  snapshot: GuestPortfolioProjection,
  ledgerUpserts?: GuestTrancheLedgerRecord[],
  retainedAssignmentIds?: string[]
): Promise<void> {
  return publishGuestPortfolioSnapshots([{
    guestId,
    snapshot,
    ...(ledgerUpserts ? { ledgerUpserts } : {}),
    ...(retainedAssignmentIds ? { retainedAssignmentIds } : {})
  }]);
}

export interface GuestPortfolioPublication {
  guestId: string;
  snapshot: GuestPortfolioProjection;
  /** Rows to append or refresh in the durable, guest-scoped assignment ledger. */
  ledgerUpserts?: GuestTrancheLedgerRecord[];
  /** Complete set of assignments that remain linked to this guest. */
  retainedAssignmentIds?: string[];
}

/** Publish all changed guest projections and optional durable ledger updates atomically. */
export function publishGuestPortfolioSnapshots(
  publications: GuestPortfolioPublication[]
): Promise<void> {
  const token = getActiveGatewaySecret();
  if (!token) return Promise.reject(new Error("Not signed in."));
  if (!Array.isArray(publications) || publications.length === 0) return Promise.resolve();

  const seenGuestIds = new Set<string>();
  const changed = publications.filter((publication) => {
    const id = String(publication?.guestId || "").trim();
    if (!id || seenGuestIds.has(id)) throw new Error("Guest portfolio batch contains a duplicate or missing guest ID.");
    seenGuestIds.add(id);
    if (!publication.snapshot || !Array.isArray(publication.snapshot.tranches)) {
      throw new Error("Invalid guest portfolio snapshot.");
    }
    if (publication.ledgerUpserts !== undefined && !Array.isArray(publication.ledgerUpserts)) {
      throw new Error("Invalid guest tranche ledger updates.");
    }
    if (publication.retainedAssignmentIds !== undefined && !Array.isArray(publication.retainedAssignmentIds)) {
      throw new Error("Invalid retained guest assignment IDs.");
    }
    const normalized = { ...publication, guestId: id };
    const cacheKey = JSON.stringify([token, id]);
    return guestPortfolioPublicationFingerprints.get(cacheKey) !== guestPublicationFingerprint(normalized);
  }).map((publication) => ({ ...publication, guestId: publication.guestId.trim() }));

  if (changed.length === 0) return Promise.resolve();
  const requestKey = JSON.stringify([
    "batch",
    token,
    changed.map((publication) => [publication.guestId, guestPublicationFingerprint(publication)])
  ]);
  const existing = guestPortfolioPublicationRequests.get(requestKey);
  if (existing) return existing;

  const request = authRequest<{ success: boolean; revisions?: Record<string, number> }>("/api/guest-portfolio", {
    method: "POST",
    token,
    body: {
      snapshots: changed.map(({ guestId, snapshot, ledgerUpserts, retainedAssignmentIds }) => ({
        guestId,
        snapshot: { updatedAt: snapshot.updatedAt, tranches: snapshot.tranches },
        ...(ledgerUpserts !== undefined ? { ledgerUpserts } : {}),
        ...(retainedAssignmentIds !== undefined ? { retainedAssignmentIds } : {})
      }))
    }
  }).then(() => {
    for (const publication of changed) {
      guestPortfolioPublicationFingerprints.set(
        JSON.stringify([token, publication.guestId]),
        guestPublicationFingerprint(publication)
      );
    }
  }).finally(() => {
    if (guestPortfolioPublicationRequests.get(requestKey) === request) {
      guestPortfolioPublicationRequests.delete(requestKey);
    }
  });
  guestPortfolioPublicationRequests.set(requestKey, request);
  return request;
}
