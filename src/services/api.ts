import { resetMarketRequestGate, runMarketDataRequest } from './marketRequestGate';
import { createCloudStateSecurity } from './cloudStateSecurity';
import { createCloudRevisionCoordinator } from './cloudRevisionCoordinator';
import { createCloudStateSyncRuntime } from './cloudStateSyncRuntime';
import { createAuthTransportRuntime } from './authTransportRuntime';
import { createFreedomBrokerTransportRuntime } from './freedomBrokerTransportRuntime';
import { createMarketDataTransportRuntime } from './marketDataTransportRuntime';
export type { AuthUser, AuthSession } from './authTransportRuntime';
export type { SyncOptions } from './cloudStateSyncRuntime';
import { processRollovers } from '../domain/portfolio';
import { getGatewaySecret, loadSavedHistory, loadSavedState, saveState } from './storage';
import { ActiveBrokerTranche, GuestTrancheLedgerRecord, PortfolioState } from '../types/portfolio';
import { normalizeFreedomTrades } from './freedomTradeContracts';
export { normalizeFreedomTrades } from './freedomTradeContracts';
export type { FreedomExecutedTrade } from '../types/freedomTrade';
export { compareFreedomPortfolioSnapshots, normalizeFreedomActiveOrders, normalizeFreedomPortfolio } from './freedomAccountContracts';
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

const authTransportRuntime = createAuthTransportRuntime({
  apiUrl: WORKER_PROXY_URL,
  getActiveGatewaySecret,
  clearAllRequestCaches: () => clearApiRequestCaches()
});
export const getAuthStatus = authTransportRuntime.getAuthStatus;
export const loginAccount = authTransportRuntime.loginAccount;
export const bootstrapAdmin = authTransportRuntime.bootstrapAdmin;
export const getCurrentUser = authTransportRuntime.getCurrentUser;
export const listUsers = authTransportRuntime.listUsers;
export const createUser = authTransportRuntime.createUser;
export const updateUser = authTransportRuntime.updateUser;
export const updateMyLanguage = authTransportRuntime.updateMyLanguage;
export const deleteUser = authTransportRuntime.deleteUser;
export const logoutAccount = authTransportRuntime.logoutAccount;



export interface ProxyFetchOptions extends RequestInit {
  secret?: string;
  state?: Record<string, any> | PortfolioState;
}

const proxyReadRequests = new Map<string, Promise<any>>();
const COALESCED_READ_ACTIONS = new Set(['', 'quote', 'provider-quote', 'news', 'stocktwits', 'freedom-quote']);
const MARKET_DATA_ACTIONS = new Set([
  '', 'quote', 'provider-quote', 'news', 'stocktwits',
  'freedom-quote', 'freedom-news', 'freedom-history'
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
  return isMarketData && !fetchOptions.signal && fetchOptions.cache !== 'no-store'
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


const freedomBrokerTransportRuntime = createFreedomBrokerTransportRuntime({
  proxyFetch: (action, queryParams, options) => proxyFetch(action, queryParams, options),
  getActiveGatewaySecret,
  recordMetric: recordApiMetric
});

export const testFreedomTradeNetConnection = freedomBrokerTransportRuntime.testFreedomTradeNetConnection;
export const testFreedomTradeNetOrdersStream = freedomBrokerTransportRuntime.testFreedomTradeNetOrdersStream;
export const testFreedomTradeNetEventStream = freedomBrokerTransportRuntime.testFreedomTradeNetEventStream;
export const testFreedomTradeNetQuoteStream = freedomBrokerTransportRuntime.testFreedomTradeNetQuoteStream;
export const testFreedomTradeNetPortfolioReconciliation = freedomBrokerTransportRuntime.testFreedomTradeNetPortfolioReconciliation;
export const fetchFreedomTradeNetPositions = freedomBrokerTransportRuntime.fetchFreedomTradeNetPositions;
export const fetchFreedomTradeNetTrades = freedomBrokerTransportRuntime.fetchFreedomTradeNetTrades;
export const fetchFreedomTradeNetActiveOrders = freedomBrokerTransportRuntime.fetchFreedomTradeNetActiveOrders;
export const fetchFreedomTradeNetQuoteStreamOnce = freedomBrokerTransportRuntime.fetchFreedomTradeNetQuoteStreamOnce;
export const clearFreedomTradeNetStreamSnapshotCache = freedomBrokerTransportRuntime.clearFreedomStreamSnapshotCache;
export const fetchFreedomCashflows = freedomBrokerTransportRuntime.fetchFreedomCashflows;
export const clearFreedomCashflowCache = freedomBrokerTransportRuntime.clearFreedomCashflowCache;

const guestPortfolioPublicationFingerprints = new Map<string, string>();
const guestPortfolioPublicationRequests = new Map<string, Promise<void>>();

export function clearGuestPortfolioPublicationCache(): void {
  guestPortfolioPublicationFingerprints.clear();
  guestPortfolioPublicationRequests.clear();
}

export function clearApiRequestCaches(): void {
  authTransportRuntime.clearRequestCaches();
  cloudStateSyncRuntime.clearRequestCache();
  clearGuestPortfolioPublicationCache();
  clearFreedomCashflowCache();
  clearFreedomTradeNetStreamSnapshotCache();
  resetMarketRequestGate();
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
