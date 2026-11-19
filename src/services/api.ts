import { resetMarketRequestGate, runMarketDataRequest } from './marketRequestGate';
import { createRequestScheduler, type RequestPriority, type RequestSchedulerSnapshot } from './requestScheduler';
import { createCloudStateSecurity } from './cloudStateSecurity';
import { createCloudRevisionCoordinator } from './cloudRevisionCoordinator';
import { createCloudStateSyncRuntime } from './cloudStateSyncRuntime';
import { createAuthTransportRuntime } from './authTransportRuntime';
import { createFreedomBrokerTransportRuntime } from './freedomBrokerTransportRuntime';
import { createMarketDataTransportRuntime } from './marketDataTransportRuntime';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchAndConsumeWithTimeout } from './requestTimeout';
import { createMarginDigestTransportRuntime } from './marginDigestTransportRuntime';
export type { AuthUser, AuthSession } from './authTransportRuntime';
export type { SyncOptions, CloudHistoryPushOptions } from './cloudStateSyncRuntime';
import { processRollovers } from '../domain/portfolio';
import type { RolloverState } from '../domain/portfolio';
import { getGatewaySecret, loadSavedHistory, loadSavedState, saveState } from './storage';
import { ActiveBrokerTranche, GuestTrancheLedgerRecord, PortfolioState } from '../types/portfolio';
import { normalizeFreedomTrades } from './freedomTradeContracts';
export type {
  SyncedMarginDigest,
  MarginDigestEncryptionMigrationStatus,
  LoadedSyncedMarginDigest,
  MarginDigestMigrationInventory,
  MarginDigestMigrationBatchResult,
  MarginDigestRequestOptions
} from './marginDigestTransportRuntime';
export { normalizeFreedomTrades } from './freedomTradeContracts';
export type { FreedomExecutedTrade } from '../types/freedomTrade';
export { normalizeFreedomActiveOrders, normalizeFreedomPortfolio } from './freedomAccountContracts';
export type { FreedomActiveOrder, FreedomCashBalance, FreedomOpenPosition, FreedomPortfolioSnapshot } from './freedomAccountContracts';
export type { MarketNewsItem, StocktwitsMessage, StocktwitsStream } from './marketInsightsProviders';
export {
  normalizeCurrencyCode,
  normalizeInstrumentIdentity,
  normalizeMarketQuoteObservation,
  normalizeMarketHistoryPoints,
  normalizeMarketHistoryResponse,
  findMissingMarketHistoryTimestamps,
  normalizeFxRate,
  createFxRateProviderRegistry,
  isFxRateUsableForConversion,
  getFxConversionRate,
  shouldAcceptMarketObservation
} from './marketDataContracts';
export type {
  MarketDelayClass,
  MarketFreshness,
  MarketDataQuality,
  MarketSession,
  MarketAssetType,
  InstrumentIdentityInput,
  InstrumentIdentity,
  InstrumentIdentityResult,
  MarketQuoteObservationInput,
  MarketQuoteObservation,
  MarketQuoteObservationResult,
  MarketPricePoint,
  MarketHistoryResult,
  MarketQuoteRequest,
  MarketHistoryRequest,
  MarketDataProviderAdapter,
  MarketHistoryResponseInput,
  FxRateInput,
  FxRate,
  FxRateProviderAdapter,
  FxRateProviderRegistry,
  FxRateProviderRegistryResult
} from './marketDataContracts';
export type { YahooDeepStockData, YahooDeepAnalystTargets, YahooDeepFinancialHealth, YahooDeepPrice, YahooDeepValuation, YahooEarningsHistoryItem, YahooUpgradeDowngrade } from './yahooDeepDataContracts';

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


const marginDigestTransportRuntime = createMarginDigestTransportRuntime({
  workerProxyUrl: WORKER_PROXY_URL,
  getActiveGatewaySecret,
  encryptCloudPayload,
  decryptCloudPayload,
  readCloudRevision
});
export const {
  loadSyncedMarginDigest,
  saveSyncedMarginDigest,
  fetchMarginDigestMigrationInventory,
  migrateMarginDigestBatch
} = marginDigestTransportRuntime;

const cloudStateSyncRuntime = createCloudStateSyncRuntime({
  workerProxyUrl: WORKER_PROXY_URL,
  getActiveGatewaySecret,
  encryptCloudPayload,
  decryptCloudPayload,
  readCloudRevision,
  revisionCoordinator: cloudRevisionCoordinator,
  // Cloud snapshots are container-validated but preserve optional legacy fields.
  processRollovers: (state) => processRollovers(state as unknown as RolloverState),
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

const authTransportRuntime = createAuthTransportRuntime({
  apiUrl: WORKER_PROXY_URL,
  getActiveGatewaySecret,
  clearAllRequestCaches: () => clearApiRequestCaches()
});
export const getAuthStatus = authTransportRuntime.getAuthStatus;
export const loginAccount = authTransportRuntime.loginAccount;
export const bootstrapAdmin = authTransportRuntime.bootstrapAdmin;
export const startAdminGuestPreviewSession = authTransportRuntime.startAdminGuestPreview;
export const endAdminGuestPreviewSession = authTransportRuntime.endAdminGuestPreview;
export const getCurrentUser = authTransportRuntime.getCurrentUser;
export const listUsers = authTransportRuntime.listUsers;
export const getCachedUsers = authTransportRuntime.getCachedUsers;
export const createUser = authTransportRuntime.createUser;
export const updateUser = authTransportRuntime.updateUser;
export const updateMyLanguage = authTransportRuntime.updateMyLanguage;
export const deleteUser = authTransportRuntime.deleteUser;
export const logoutAccount = authTransportRuntime.logoutAccount;



export interface ProxyFetchOptions extends RequestInit {
  /** Per-request deadline; removed before passing options to fetch. */
  timeoutMs?: number;
  secret?: string;
  state?: Record<string, any> | PortfolioState;
  /** Optional override for the shared read-only request scheduler. */
  requestPriority?: RequestPriority;
}

const proxyReadRequests = new Map<string, Promise<any>>();
const COALESCED_READ_ACTIONS = new Set(['', 'quote', 'provider-quote', 'news', 'stocktwits', 'freedom-quote', 'provider-history', 'market-events', 'market-calendar']);
const MARKET_DATA_ACTIONS = new Set([
  '', 'quote', 'provider-quote', 'news', 'stocktwits',
  'freedom-quote', 'freedom-news', 'freedom-history', 'provider-history', 'market-events', 'market-calendar'
]);

// Only read-only broker / market-data actions enter the priority queue.
// Cloud state, history records, auth, guest projections, and all writes retain
// their independent transport and revision semantics.
const SCHEDULED_READ_ACTIONS = new Set([
  ...MARKET_DATA_ACTIONS,
  'freedom-positions',
  'freedom-trades',
  'freedom-orders',
  'freedom-cashflows',
  'freedom-orders-stream',
  'freedom-portfolio-snapshot',
  'freedom-account-stream-ticket',
  'freedom-quote-stream-ticket',
  'freedom-market-depth',
  'freedom-market-depth-stream-ticket',
  'freedom-market-status'
]);

const CRITICAL_READ_ACTIONS = new Set([
  'quote',
  'provider-quote',
  'freedom-quote',
  'freedom-positions',
  'freedom-orders',
  'freedom-orders-stream',
  'freedom-portfolio-snapshot',
  'freedom-account-stream-ticket',
  'freedom-quote-stream-ticket'
]);

const INTERACTIVE_READ_ACTIONS = new Set([
  'news',
  'stocktwits',
  'freedom-news',
  'freedom-market-depth',
  'freedom-market-depth-stream-ticket',
  'freedom-market-status'
]);

const readRequestScheduler = createRequestScheduler({ concurrency: 4, maxQueued: 128 });

function resolveReadRequestPriority(action: string): RequestPriority {
  if (CRITICAL_READ_ACTIONS.has(action)) return 'critical';
  if (INTERACTIVE_READ_ACTIONS.has(action)) return 'interactive';
  return 'background';
}

function createMarketRequestIdentity(
  action: string,
  queryParams: Record<string, string | number | boolean | undefined | null>,
  fetchOptions: ProxyFetchOptions
): string {
  const normalizedParams = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const method = (fetchOptions.method || 'GET').toUpperCase();
  const secret = (fetchOptions.secret ?? getActiveGatewaySecret()).trim();
  const body = typeof fetchOptions.body === 'string' ? fetchOptions.body : '';
  const priority = fetchOptions.requestPriority ?? resolveReadRequestPriority(action);
  return JSON.stringify([action, method, normalizedParams, body, secret, priority]);
}

function dispatchProxyFetch(
  action: string,
  queryParams: Record<string, string | number | boolean | undefined | null>,
  fetchOptions: ProxyFetchOptions
): Promise<any> {
  const isMarketData = MARKET_DATA_ACTIONS.has(action) &&
    (action !== '' || Boolean(queryParams.symbol));
  const shouldSchedule = SCHEDULED_READ_ACTIONS.has(action) ||
    (action === '' && Boolean(queryParams.symbol));
  // Capture the request credential when the caller dispatches. A queued read
  // must never inherit a different account's active credential when it starts.
  const requestOptions: ProxyFetchOptions = {
    ...fetchOptions,
    secret: fetchOptions.secret ?? getActiveGatewaySecret()
  };
  const request = () => shouldSchedule
    ? readRequestScheduler.schedule(
      (signal) => performProxyFetch(action, queryParams, { ...requestOptions, signal }),
      {
        priority: requestOptions.requestPriority ?? resolveReadRequestPriority(action),
        signal: requestOptions.signal ?? undefined
      }
    )
    : performProxyFetch(action, queryParams, requestOptions);

  return isMarketData && !requestOptions.signal && requestOptions.cache !== 'no-store'
    ? runMarketDataRequest(createMarketRequestIdentity(action, queryParams, requestOptions), request)
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

  const secret = (fetchOptions.secret ?? getActiveGatewaySecret()).trim();
  const normalizedParams = Object.entries(queryParams)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const priority = fetchOptions.requestPriority ?? resolveReadRequestPriority(action);
  const key = JSON.stringify([action, method, normalizedParams, secret, priority]);
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
  const requestInit = { ...fetchOptions };
  const timeoutMs = requestInit.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  delete requestInit.timeoutMs;
  delete requestInit.requestPriority;
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

  const authSecret = (fetchOptions.secret ?? getActiveGatewaySecret()).trim();
  if (!authSecret) {
    throw new Error('Gateway Secret is not available. Restore or enter the Gateway Secret before requesting broker data.');
  }

  return fetchAndConsumeWithTimeout(fetch, url.toString(), {
    ...requestInit,
    headers: {
      ...(requestInit.headers || {}),
      'Content-Type': 'application/json',
      // Authentication headers are authoritative and cannot be overridden by
      // per-request headers supplied by a caller.
      'X-App-Auth': authSecret,
      Authorization: `Bearer ${authSecret}`
    }
  }, async (res) => {
    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const errorMessage = typeof data === 'object' && data !== null
        ? (data.error || data.message || `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
      throw new Error(errorMessage);
    }
    return data;
  }, timeoutMs);
}

function recordApiMetric(metric: string, details: Record<string, unknown> = {}): void {
  // Keep metrics low-cardinality: never include credentials or full request URLs.
  console.info('[api-metric]', JSON.stringify({ metric, ...details }));
}

const marketDataTransportRuntime = createMarketDataTransportRuntime({
  proxyFetch: (action, queryParams, options) => proxyFetch(action, queryParams, options),
  recordMetric: recordApiMetric
});
export type { FallbackQuoteProvider, NormalizedFallbackQuote } from './marketDataTransportRuntime';
export { normalizeYahooBatchResults } from './yahooQuoteContracts';
export type { YahooBatchQuoteResult, YahooQuotePricePayload } from './yahooQuoteContracts';
export const fetchYahooQuoteData = marketDataTransportRuntime.fetchYahooQuoteData;
export const fetchYahooStockData = marketDataTransportRuntime.fetchYahooStockData;
export const fetchFallbackQuote = marketDataTransportRuntime.fetchFallbackQuote;
export const rememberYahooDeepStockData = marketDataTransportRuntime.rememberYahooDeepStockData;
export const fetchYahooDeepStockData = marketDataTransportRuntime.fetchYahooDeepStockData;
export const fetchMarketNews = marketDataTransportRuntime.fetchMarketNews;
export const fetchStocktwitsStream = marketDataTransportRuntime.fetchStocktwitsStream;
export const clearYahooDeepStockDataCache = marketDataTransportRuntime.clearYahooDeepStockDataCache;
export const validateGatewaySecret = authTransportRuntime.validateGatewaySecret;
export const getUserForGatewaySecret = authTransportRuntime.getUserForGatewaySecret;


const freedomBrokerTransportRuntime = createFreedomBrokerTransportRuntime({
  proxyFetch: (action, queryParams, options) => proxyFetch(action, queryParams, options),
  getActiveGatewaySecret,
  recordMetric: recordApiMetric
});

export const fetchFreedomTradeNetPositions = freedomBrokerTransportRuntime.fetchFreedomTradeNetPositions;
export const fetchFreedomTradeNetTrades = freedomBrokerTransportRuntime.fetchFreedomTradeNetTrades;
export const fetchFreedomTradeNetActiveOrders = freedomBrokerTransportRuntime.fetchFreedomTradeNetActiveOrders;
export const fetchFreedomTradeNetQuoteStreamOnce = freedomBrokerTransportRuntime.fetchFreedomTradeNetQuoteStreamOnce;
export const clearFreedomTradeNetStreamSnapshotCache = freedomBrokerTransportRuntime.clearFreedomStreamSnapshotCache;
export const fetchFreedomCashflows = freedomBrokerTransportRuntime.fetchFreedomCashflows;
export const clearFreedomCashflowCache = freedomBrokerTransportRuntime.clearFreedomCashflowCache;

export type FreedomMarketPhase = 'PREMARKET' | 'MARKET' | 'POSTMARKET' | 'CLOSED' | 'MIXED';
export type FreedomMarketScheduleValue = string | number | null;

export interface FreedomExchangeMarketState {
  name: string | null;
  code: string | null;
  providerStatus: string | null;
  openTime: FreedomMarketScheduleValue;
  closeTime: FreedomMarketScheduleValue;
  timezoneOffset: FreedomMarketScheduleValue;
}

export interface FreedomUsMarketStatus extends FreedomExchangeMarketState {
  market: string;
  status: FreedomMarketPhase;
  source: string;
  providerTime: string | null;
  exchanges: FreedomExchangeMarketState[];
}

export interface FreedomMarketStatusResponse {
  ok: true;
  provider: string;
  marketStatus: FreedomUsMarketStatus;
  updatedAt: number;
}

function readMarketScheduleValue(value: unknown): FreedomMarketScheduleValue {
  if (typeof value === 'string') return value.slice(0, 64);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function readExchangeMarketState(value: unknown): FreedomExchangeMarketState {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    name: typeof row.name === 'string' ? row.name.slice(0, 64) : null,
    code: typeof row.code === 'string' ? row.code.slice(0, 32) : null,
    providerStatus: typeof row.providerStatus === 'string' ? row.providerStatus.slice(0, 32) : null,
    openTime: readMarketScheduleValue(row.openTime),
    closeTime: readMarketScheduleValue(row.closeTime),
    timezoneOffset: readMarketScheduleValue(row.timezoneOffset)
  };
}

/** Fetch a compact public market state and its documented exchange schedule fields. */
export async function fetchFreedomMarketStatus(): Promise<FreedomMarketStatusResponse> {
  const response = await proxyFetch('freedom-market-status', undefined, { cache: 'no-store' });
  const phase = typeof response?.marketStatus?.status === 'string'
    ? response.marketStatus.status.trim().toUpperCase()
    : '';
  if (response?.ok !== true || !['PREMARKET', 'MARKET', 'POSTMARKET', 'CLOSED', 'MIXED'].includes(phase)) {
    throw new Error(response?.error || 'US equity market status is unavailable.');
  }
  const rawMarket = response.marketStatus as Record<string, unknown>;
  const exchanges = Array.isArray(rawMarket.exchanges)
    ? rawMarket.exchanges.slice(0, 2).map(readExchangeMarketState)
    : [];
  return {
    ok: true,
    provider: typeof response.provider === 'string' ? response.provider : 'Freedom TradeNet',
    marketStatus: {
      market: typeof rawMarket.market === 'string' ? rawMarket.market.slice(0, 64) : 'US equities',
      status: phase as FreedomMarketPhase,
      source: typeof rawMarket.source === 'string' ? rawMarket.source.slice(0, 32) : 'US_EXCHANGES',
      ...readExchangeMarketState(rawMarket),
      code: typeof rawMarket.code === 'string' ? rawMarket.code.slice(0, 32) : 'US',
      providerTime: typeof rawMarket.providerTime === 'string' ? rawMarket.providerTime.slice(0, 64) : null,
      exchanges
    },
    updatedAt: Number.isFinite(Number(response.updatedAt)) && Number(response.updatedAt) > 0
      ? Number(response.updatedAt)
      : Date.now()
  };
}

export interface FreedomQuoteStreamTicket {
  ticket: string;
  expiresAt: number;
  symbols: string[];
}

/** Mint a one-use, short-lived ticket for the authenticated browser WebSocket. */
export async function createFreedomQuoteStreamTicket(tickers: string[]): Promise<FreedomQuoteStreamTicket> {
  const symbols = [...new Set(tickers.map((ticker) => {
    const normalized = ticker.trim().toUpperCase();
    return normalized && !normalized.includes('.') ? `${normalized}.US` : normalized;
  }).filter(Boolean))];
  if (symbols.length < 1 || symbols.length > 10 || symbols.some((symbol) => !/^[A-Z0-9.^=-]{1,32}$/.test(symbol))) {
    throw new Error('Select between 1 and 10 valid tickers for the live quote stream.');
  }
  const response = await proxyFetch(
    'freedom-quote-stream-ticket',
    { symbols: symbols.join(',') },
    { cache: 'no-store' }
  );
  if (response?.ok !== true || typeof response.ticket !== 'string' || !/^[a-f0-9]{64}$/i.test(response.ticket)) {
    throw new Error(response?.error || 'The server did not issue a valid quote stream ticket.');
  }
  return {
    ticket: response.ticket,
    expiresAt: Number(response.expiresAt) || 0,
    symbols
  };
}

/** Build the browser-visible Worker WebSocket URL; it contains only a one-use ticket, never the broker SID. */
export function buildFreedomQuoteStreamSocketUrl(ticket: string): string {
  if (!/^[a-f0-9]{64}$/i.test(ticket)) throw new Error('A valid quote stream ticket is required.');
  const url = new URL(WORKER_PROXY_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('action', 'freedom-quote-socket');
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

export interface FreedomAccountStreamTicket {
  ticket: string;
  expiresAt: number;
  events: ['portfolio', 'orders'];
}

/** Mint an administrator-only, one-use ticket for portfolio and order updates. */
export async function createFreedomAccountStreamTicket(): Promise<FreedomAccountStreamTicket> {
  const response = await proxyFetch(
    'freedom-account-stream-ticket',
    undefined,
    { cache: 'no-store' }
  );
  if (response?.ok !== true || typeof response.ticket !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(response.ticket)) {
    throw new Error(response?.error || 'The server did not issue a valid account stream ticket.');
  }
  return {
    ticket: response.ticket,
    expiresAt: Number(response.expiresAt) || 0,
    events: ['portfolio', 'orders']
  };
}

/** The browser URL carries only a short-lived ticket, never the broker SID. */
export function buildFreedomAccountStreamSocketUrl(ticket: string): string {
  if (!/^[a-f0-9]{64}$/i.test(ticket)) throw new Error('A valid account stream ticket is required.');
  const url = new URL(WORKER_PROXY_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('action', 'freedom-account-socket');
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

export interface FreedomMarketDepthStreamTicket {
  ticket: string;
  expiresAt: number;
  symbol: string;
}

/** Mint a one-use administrator ticket bound to one ticker for the live depth socket. */
export async function createFreedomMarketDepthStreamTicket(ticker: string): Promise<FreedomMarketDepthStreamTicket> {
  const normalized = ticker.trim().toUpperCase();
  const symbol = normalized && !normalized.includes('.') ? `${normalized}.US` : normalized;
  if (!/^[A-Z0-9.^=-]{1,32}$/.test(symbol)) {
    throw new Error('Provide one valid ticker for the Market Depth stream.');
  }
  const response = await proxyFetch(
    'freedom-market-depth-stream-ticket',
    { symbol },
    { cache: 'no-store' }
  );
  if (response?.ok !== true || typeof response.ticket !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(response.ticket) || response.symbol !== symbol) {
    throw new Error(response?.error || 'The server did not issue a valid Market Depth stream ticket.');
  }
  return {
    ticket: response.ticket,
    expiresAt: Number(response.expiresAt) || 0,
    symbol
  };
}

/** The browser URL carries only a short-lived single-use ticket, never the TradeNet SID. */
export function buildFreedomMarketDepthStreamSocketUrl(ticket: string): string {
  if (!/^[a-f0-9]{64}$/i.test(ticket)) throw new Error('A valid Market Depth stream ticket is required.');
  const url = new URL(WORKER_PROXY_URL);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('action', 'freedom-market-depth-socket');
  url.searchParams.set('ticket', ticket);
  return url.toString();
}


const guestPortfolioPublicationFingerprints = new Map<string, string>();
const guestPortfolioPublicationRequests = new Map<string, Promise<void>>();

export function clearGuestPortfolioPublicationCache(): void {
  guestPortfolioPublicationFingerprints.clear();
  guestPortfolioPublicationRequests.clear();
}

export function getApiRequestSchedulerSnapshot(): RequestSchedulerSnapshot {
  return readRequestScheduler.getSnapshot();
}

/** Cancel API reads and deduplication state when the active account identity changes. */
export function cancelPendingApiReads(reason: unknown = new Error('Active account identity changed.')): void {
  readRequestScheduler.cancelAll(reason);
  proxyReadRequests.clear();
  resetMarketRequestGate();
}

export function clearApiRequestCaches(): void {
  cancelPendingApiReads(new Error('API request context was reset.'));
  authTransportRuntime.clearRequestCaches();
  cloudStateSyncRuntime.clearRequestCache();
  clearGuestPortfolioPublicationCache();
  clearFreedomCashflowCache();
  clearFreedomTradeNetStreamSnapshotCache();
}

const authRequest = authTransportRuntime.authRequest;

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
