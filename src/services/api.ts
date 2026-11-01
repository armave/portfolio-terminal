import CryptoJS from 'crypto-js';
import { resetMarketRequestGate, runMarketDataRequest } from './marketRequestGate';
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

// Persist each browser's last-seen cloud revision so a reload cannot reset it to zero.
const CLOUD_REVISION_STORAGE_KEY = 'portfolio_cloud_revision_v1';

function loadCloudRevision(): number {
  try {
    const raw = typeof localStorage !== 'undefined'
      ? localStorage.getItem(CLOUD_REVISION_STORAGE_KEY)
      : null;
    const revision = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  } catch {
    return 0;
  }
}

let cloudRevision = loadCloudRevision();
let cloudPullGeneration = 0;
let cloudPushQueue: Promise<void> = Promise.resolve();

function setCloudRevision(revision: number): void {
  cloudRevision = revision;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CLOUD_REVISION_STORAGE_KEY, String(revision));
    }
  } catch {
    // The in-memory revision still protects this running app instance.
  }
}

const CLOUD_CIPHERTEXT_V2_PREFIX = 'aesgcm:v2:';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveCloudEncryptionKey(secret: string): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure cloud encryption is unavailable in this browser.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptCloudPayload(plaintext: string, secret: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure cloud encryption is unavailable in this browser.');
  const encryptionSecret = await resolveCloudEncryptionSecret(secret);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCloudEncryptionKey(encryptionSecret);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, new TextEncoder().encode(plaintext));
  return CLOUD_CIPHERTEXT_V2_PREFIX + bytesToBase64(nonce) + ':' + bytesToBase64(new Uint8Array(ciphertext));
}

async function decryptCloudPayload(payload: string, secret: string): Promise<{ plaintext: string; legacy: boolean }> {
  const encryptionSecret = await resolveCloudEncryptionSecret(secret);
  if (!payload.startsWith(CLOUD_CIPHERTEXT_V2_PREFIX)) {
    const bytes = CryptoJS.AES.decrypt(payload, encryptionSecret);
    const plaintext = bytes ? bytes.toString(CryptoJS.enc.Utf8) : '';
    if (!plaintext) throw new Error('Legacy decryption failed — verify the Gateway Secret.');
    return { plaintext, legacy: true };
  }

  const encoded = payload.slice(CLOUD_CIPHERTEXT_V2_PREFIX.length);
  const separator = encoded.indexOf(':');
  if (separator <= 0 || separator === encoded.length - 1) throw new Error('Invalid AES-GCM cloud payload envelope.');
  const nonce = base64ToBytes(encoded.slice(0, separator));
  const ciphertext = base64ToBytes(encoded.slice(separator + 1));
  if (nonce.byteLength !== 12 || ciphertext.byteLength < 16) throw new Error('Invalid AES-GCM cloud payload envelope.');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure cloud decryption is unavailable in this browser.');
  const key = await deriveCloudEncryptionKey(encryptionSecret);
  // Copy to standalone ArrayBuffers to satisfy strict DOM BufferSource typing.
  const iv = nonce.slice().buffer as ArrayBuffer;
  const encryptedBytes = ciphertext.slice().buffer as ArrayBuffer;
  const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encryptedBytes);
  return { plaintext: new TextDecoder().decode(plaintext), legacy: false };
}

function readCloudRevision(headers?: Headers | null): number | null {
  const etag = headers?.get('ETag');
  if (!etag) return null;
  const revision = Number(etag.replace(/^W\//, '').replace(/^"|"$/g, ''));
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

let activeSecretGetter: (() => string) | null = null;

export function setSecretGetter(getter: () => string): void {
  activeSecretGetter = getter;
}

let cloudEncryptionSecretPromise: Promise<string> | null = null;

/** Drop the administrator-only workspace key when the signed-in identity changes. */
export function clearCloudEncryptionSecretCache(): void {
  cloudEncryptionSecretPromise = null;
}

async function resolveCloudEncryptionSecret(sessionToken: string): Promise<string> {
  if (!activeSecretGetter) return sessionToken;
  if (!cloudEncryptionSecretPromise) {
    cloudEncryptionSecretPromise = (async () => {
      const response = await fetch(new URL("/api/auth/cloud-key", WORKER_PROXY_URL), {
        method: "GET",
        headers: {
          "X-App-Auth": sessionToken,
          Authorization: `Bearer ${sessionToken}`
        },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.key !== "string" || !payload.key) {
        throw new Error(payload?.error || "Could not retrieve the shared cloud encryption key.");
      }
      return payload.key;
    })().catch((error) => {
      cloudEncryptionSecretPromise = null;
      throw error;
    });
  }
  return cloudEncryptionSecretPromise;
}


function getActiveGatewaySecret(): string {
  // Credentials are managed only by the dedicated secret store/input. Portfolio
  // state may come from an imported backup or cloud payload and is never trusted.
  const stored = getGatewaySecret();
  if (stored) return stored;
  try {
    const supplied = activeSecretGetter?.();
    return typeof supplied === 'string' ? supplied.trim() : '';
  } catch {
    return '';
  }
}

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
    signal,
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
  validatedCloudResponse = null;
}

export interface SyncOptions {
  state?: any;
  secret?: string;
  pullCloudAndRewriteLocal?: (state: any) => void;
  getState?: () => any;
  showToast?: (msg: string, type: string) => void;
  logTerminal?: (msg: string) => void;
  onStatusChange?: (status: 'synced' | 'error') => void;
  /** Guest sessions may pull shared state but must not perform migration/upgrade writes. */
  allowCloudWrites?: boolean;
}

/**
 * Validates the Gateway Secret without requiring a portfolio to already exist.
 * The Worker authenticates before forwarding requests to the state store, so
 * a 404 from /api/state means the credentials are valid but cloud state is empty.
 */
interface ValidatedCloudResponse {
  secret: string;
  checkedAt: number;
  status: number;
  etag: string | null;
  contentType: string | null;
  body: string;
}

let validatedCloudResponse: ValidatedCloudResponse | null = null;
const VALIDATED_CLOUD_RESPONSE_TTL_MS = 30 * 1000;

function consumeValidatedCloudResponse(secret: string): Response | null {
  const cached = validatedCloudResponse;
  validatedCloudResponse = null;
  if (!cached || cached.secret !== secret || Date.now() - cached.checkedAt > VALIDATED_CLOUD_RESPONSE_TTL_MS) {
    return null;
  }
  const headers = new Headers();
  if (cached.etag) headers.set('ETag', cached.etag);
  if (cached.contentType) headers.set('Content-Type', cached.contentType);
  return new Response(cached.body, { status: cached.status, headers });
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
    validatedCloudResponse = null;
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
    validatedCloudResponse = null;
    console.warn('Account session validation failed:', error);
    return false;
  }
}

export async function pullCloudState(
  options: SyncOptions | ((state: any) => void) = {},
  reportResult?: (success: boolean) => void
): Promise<any> {
  const handlers: SyncOptions = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  const {
    state,
    pullCloudAndRewriteLocal,
    showToast = (msg: string, type: string) => console.log(`[${type}] ${msg}`),
    logTerminal = (msg: string) => console.log(msg)
  } = handlers;

  const currentSecret = handlers.secret || getActiveGatewaySecret();

  if (!currentSecret) {
    reportResult?.(false);
    showToast('Gateway Secret required to access cloud state.', 'error');
    return loadSavedState(state || {});
  }

  // showToast('Pulling portfolio from KV cloud...', 'info');

  try {
    const cachedValidationResponse = consumeValidatedCloudResponse(currentSecret);
    const url = new URL('/api/state', WORKER_PROXY_URL);
    const res = cachedValidationResponse || await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': currentSecret,
        Authorization: `Bearer ${currentSecret}`
      }
    });

    const pulledRevision = readCloudRevision(res.headers);

    if (res.status === 404) {
      cloudStatePushFingerprints.delete(currentSecret);
      // A confirmed empty cloud store is safe to use as the current base revision.
      if (pulledRevision !== null) {
        cloudPullGeneration += 1;
        setCloudRevision(pulledRevision);
      }
      reportResult?.(false);
      logTerminal('[KV Cloud]: State not found (404). Falling back to local storage.');
      return loadSavedState(state || {});
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errorMessage = typeof errData === 'object' && errData !== null
        ? (errData.error || errData.message || `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
      throw new Error(errorMessage);
    }

    const data = await res.json();
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid state payload from KV.');
    }

    let parsedState: any;
    let requiresEncryptionUpgrade = false;
    if (typeof data.encryptedPayload === 'string') {
      try {
        const decrypted = await decryptCloudPayload(data.encryptedPayload, currentSecret);
        requiresEncryptionUpgrade = decrypted.legacy;
        try {
          parsedState = JSON.parse(decrypted.plaintext);
        } catch (parseErr: any) {
          throw new Error(`Invalid JSON in decrypted state: ${parseErr.message}`);
        }
      } catch (decryptErr: any) {
        console.error('[Sync]: Cloud payload authentication/decryption failed.');
        throw new Error(`Failed to decrypt cloud state: ${decryptErr instanceof Error ? decryptErr.message : 'invalid ciphertext'}`);
      }
    } else {
      parsedState = data;
      requiresEncryptionUpgrade = true;
    }

    if (!parsedState || typeof parsedState !== 'object') {
      throw new Error('Invalid state payload from KV.');
    }

    if ('marginBalance' in parsedState) {
      delete parsedState.marginBalance;
    }

    if (!parsedState.lastRolloverTimestamp) {
      parsedState.lastRolloverTimestamp = Date.now();
    }

    // Migrate legacy history out of the main cloud snapshot. Prefer whichever
    // source has data; the dedicated record is written before the main snapshot
    // is compacted, so a failed history write cannot silently discard records.
    const localHistory = loadSavedHistory();
    const legacyCloudExecutions = Array.isArray(parsedState.brokerExecutedTrades) ? parsedState.brokerExecutedTrades : [];
    const localExecutionsById = new Map<string, any>(localHistory.brokerExecutedTrades
      .filter((trade: any) => trade?.id != null && String(trade.id) !== '')
      .map((trade: any) => [String(trade.id), trade] as [string, any]));
    // Legacy portfolio snapshots may predate fee allocation. Keep the cloud's
    // execution fields but restore locally calculated fee metadata by stable ID,
    // so opening Balance cannot migrate an older snapshot over allocated fees.
    const migratedExecutions = legacyCloudExecutions.map((trade: any) => {
      const local = trade?.id == null ? undefined : localExecutionsById.get(String(trade.id));
      if (!local) return trade;
      const preserved = { ...trade };
      for (const field of ['marginFeeAllocations', 'marginFee', 'feesAndCommissions', 'netProfit']) {
        if (local[field] !== undefined && local[field] !== null) preserved[field] = local[field];
      }
      return preserved;
    });
    const legacyHistory = {
      brokerExecutedTrades: migratedExecutions.length ? migratedExecutions : localHistory.brokerExecutedTrades,
      cashflows: localHistory.cashflows.length
        ? localHistory.cashflows
        : (Array.isArray(parsedState.cashflows) ? parsedState.cashflows : [])
    };
    const hasHistory = legacyHistory.brokerExecutedTrades.length > 0 || legacyHistory.cashflows.length > 0;
    let historyMigrationComplete = false;
    try { historyMigrationComplete = localStorage.getItem(CLOSED_HISTORY_MIGRATION_KEY) === '1'; } catch { /* migrate safely when storage is unavailable */ }
    if (hasHistory && !historyMigrationComplete) {
      // A dedicated history record may already have newer data. Never overwrite
      // it with the legacy copy embedded in an older portfolio snapshot. Only
      // migrate legacy rows when the dedicated record does not exist yet.
      const historySnapshot = await pullCloudHistorySnapshot(currentSecret);
      if (!historySnapshot.history && (legacyHistory.brokerExecutedTrades.length || legacyHistory.cashflows.length)) {
        // Guest sessions are read-only. Do not attempt the legacy-history POST:
        // a 403 here would abort the portfolio pull before the guest UI is updated.
        if (handlers.allowCloudWrites !== false) {
          // Reuse the 404's revision (normally 0) for the migration POST instead of
          // issuing a second GET solely to discover the same ETag.
          await pushCloudHistory(legacyHistory, currentSecret, historySnapshot.revision);
        }
      } else if (historySnapshot.history && handlers.allowCloudWrites !== false) {
        try { localStorage.setItem(CLOSED_HISTORY_MIGRATION_KEY, '1'); } catch { /* migration can be rechecked next session */ }
      }
    }
    delete parsedState.brokerExecutedTrades;
    delete parsedState.cashflows;
    const mergedLocalData = hasHistory;

    const wasUpdated = processRollovers(parsedState);
    if (!saveState(parsedState)) {
      throw new Error('Cloud state was downloaded but could not be saved to this device. Check browser storage availability and free space, then retry.');
    }

    cloudStatePushFingerprints.delete(currentSecret);
    // Only trust the cloud revision after its payload was decrypted, validated,
    // and persisted locally. A failed pull must not authorize a later overwrite.
    if (pulledRevision !== null) {
      cloudPullGeneration += 1;
      setCloudRevision(pulledRevision);
    }

    if (handlers.allowCloudWrites !== false && (wasUpdated || requiresEncryptionUpgrade || mergedLocalData)) {
      pushCloudState(parsedState, {
        ...handlers,
        secret: currentSecret,
        showToast: () => { }
      }).catch((err) => {
        console.warn(wasUpdated ? 'Background rollover sync failed:' : 'Background cloud encryption upgrade failed:', err);
      });
    }

    if (typeof pullCloudAndRewriteLocal === 'function') {
      pullCloudAndRewriteLocal(parsedState);
    }

    reportResult?.(true);
    return parsedState;
  } catch (err: any) {
    reportResult?.(false);
    console.error('Failed to pull KV cloud state:', err);
    showToast(`Cloud pull failed: ${err.message}`, 'error');
    logTerminal(`[KV Cloud Error]: ${err.message}. Retaining local state.`);
    return loadSavedState(state || {});
  }
}

/**
 * Closed-history data uses its own encrypted Durable Object record so normal
 * portfolio sync never transfers the large historical arrays.
 */
const CLOSED_HISTORY_MIGRATION_KEY = 'closed_history_cloud_migrated_v1';

// History has an independent Durable Object revision from portfolio state. Share
// concurrent reads and serialize writes, coalescing structurally identical snapshots.
type CloudHistory = { brokerExecutedTrades: any[]; cashflows: any[] };
type CloudHistorySnapshot = { history: CloudHistory | null; revision: number };
let lastSyncedHistoryFingerprint: string | undefined;
let cloudHistoryPushQueue: Promise<void> = Promise.resolve();
let cloudHistoryPulls = new Map<string, Promise<CloudHistorySnapshot>>();
const cloudHistorySnapshotCache = new Map<string, CloudHistorySnapshot>();

function rememberCloudHistorySnapshot(secret: string, snapshot: CloudHistorySnapshot): void {
  const current = cloudHistorySnapshotCache.get(secret);
  if (!current || snapshot.revision >= current.revision) cloudHistorySnapshotCache.set(secret, snapshot);
}

function enqueueCloudHistoryWrite(
  history: { brokerExecutedTrades?: any[]; cashflows?: any[] },
  secret: string,
  knownRevision: number | undefined,
  force: boolean
): Promise<boolean> {
  const operation = cloudHistoryPushQueue.then(() =>
    performPushCloudHistory(history, secret, knownRevision, force)
  );
  cloudHistoryPushQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function pushCloudHistory(
  history: { brokerExecutedTrades?: any[]; cashflows?: any[] },
  secret = getActiveGatewaySecret(),
  knownRevision?: number
): Promise<boolean> {
  return enqueueCloudHistoryWrite(history, secret, knownRevision, false);
}

/**
 * Persist an authoritative empty history record for a full portfolio reset.
 * The forced write bypasses the ordinary no-change fingerprint so a previous
 * empty snapshot cannot hide cloud history added by another device later.
 */
export function clearCloudHistory(secret = getActiveGatewaySecret()): Promise<boolean> {
  return enqueueCloudHistoryWrite({
    brokerExecutedTrades: [],
    cashflows: []
  }, secret, undefined, true);
}

async function performPushCloudHistory(
  history: { brokerExecutedTrades?: any[]; cashflows?: any[] },
  secret: string,
  knownRevision: number | undefined,
  force: boolean
): Promise<boolean> {
  const brokerExecutedTrades = Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [];
  const cashflows = Array.isArray(history.cashflows) ? history.cashflows : [];
  if (!secret || (!force && !brokerExecutedTrades.length && !cashflows.length)) return false;
  const plaintext = JSON.stringify({ brokerExecutedTrades, cashflows });
  const fingerprint = JSON.stringify([secret, plaintext]);
  // Compare serialized content, not object identity: stores often rebuild arrays
  // during render/recalculation even when no history record has actually changed.
  if (!force && fingerprint === lastSyncedHistoryFingerprint) return false;

  let revision = knownRevision;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
    const url = new URL('/api/history', WORKER_PROXY_URL).toString();
    const current = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-App-Auth': secret, Authorization: `Bearer ${secret}` } });
    revision = readCloudRevision(current.headers) ?? 0;
    if (!current.ok && current.status !== 404) throw new Error(`Closed history revision check failed (HTTP ${current.status}).`);
  }
  const encryptedPayload = await encryptCloudPayload(plaintext, secret);
  const res = await fetch(new URL('/api/history', WORKER_PROXY_URL).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Auth': secret, Authorization: `Bearer ${secret}`, 'If-Match': `"${revision}"` },
    body: JSON.stringify({ encryptedPayload })
  });
  if (!res.ok) throw new Error(`Closed history sync failed (HTTP ${res.status}).`);
  const savedRevision = readCloudRevision(res.headers) ?? (revision as number) + 1;
  rememberCloudHistorySnapshot(secret, {
    history: { brokerExecutedTrades, cashflows },
    revision: savedRevision
  });
  lastSyncedHistoryFingerprint = fingerprint;
  try { localStorage.setItem(CLOSED_HISTORY_MIGRATION_KEY, '1'); } catch { /* session cache remains valid */ }
  return true;
}

export async function pullCloudHistory(secret = getActiveGatewaySecret()): Promise<CloudHistory | null> {
  if (!secret) return null;
  const snapshot = await pullCloudHistorySnapshot(secret);
  if (snapshot.history) return snapshot.history;

  // If this 404 raced a legacy-history migration, wait for its queued write.
  // Return the saved snapshot from memory instead of re-reading or posting the
  // same local rows back to the record that was just created.
  await cloudHistoryPushQueue;
  const latest = cloudHistorySnapshotCache.get(secret);
  return latest && latest.revision > snapshot.revision ? latest.history : snapshot.history;
}

function pullCloudHistorySnapshot(secret: string): Promise<CloudHistorySnapshot> {
  const existing = cloudHistoryPulls.get(secret);
  if (existing) return existing;
  const request = performPullCloudHistory(secret).then(snapshot => {
    rememberCloudHistorySnapshot(secret, snapshot);
    return snapshot;
  });
  cloudHistoryPulls.set(secret, request);
  void request.finally(() => {
    if (cloudHistoryPulls.get(secret) === request) cloudHistoryPulls.delete(secret);
  }).catch(() => {
    // The caller handles the original rejection; don't create an unhandled cleanup rejection.
  });
  return request;
}

async function performPullCloudHistory(secret: string): Promise<CloudHistorySnapshot> {
  const res = await fetch(new URL('/api/history', WORKER_PROXY_URL).toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'X-App-Auth': secret, Authorization: `Bearer ${secret}` }
  });
  const revision = readCloudRevision(res.headers) ?? 0;
  if (res.status === 404) return { history: null, revision };
  if (!res.ok) throw new Error(`Closed history load failed (HTTP ${res.status}).`);
  const envelope = await res.json();
  if (typeof envelope?.encryptedPayload !== 'string') throw new Error('Invalid closed history payload.');
  const decrypted = await decryptCloudPayload(envelope.encryptedPayload, secret);
  const parsed = JSON.parse(decrypted.plaintext);
  return {
    history: {
      brokerExecutedTrades: Array.isArray(parsed.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
      cashflows: Array.isArray(parsed.cashflows) ? parsed.cashflows : []
    },
    revision
  };
}

export function pushCloudState(state?: any, options: SyncOptions = {}): Promise<boolean> {
  // Bind a queued snapshot to the revision current when the caller submitted it.
  // If another queued operation or a concurrent pull advances the revision before
  // this write runs, the stale snapshot must conflict rather than inherit that newer
  // revision and overwrite newer cloud state.
  const submittedRevision = cloudRevision;
  const submittedPullGeneration = cloudPullGeneration;
  const operation = cloudPushQueue.then(() => {
    // Let a queued write follow a preceding queued write from this same tab, but
    // never let it inherit a revision learned from a concurrent pull after its
    // snapshot was submitted.
    const expectedRevision = cloudPullGeneration === submittedPullGeneration
      ? cloudRevision
      : submittedRevision;
    return performPushCloudState(state, options, expectedRevision);
  });
  cloudPushQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function performPushCloudState(
  state: any = undefined,
  options: SyncOptions = {},
  expectedRevision: number
): Promise<boolean> {
  const handlers: SyncOptions = typeof options === 'function' ? {} : options;
  const {
    getState,
    showToast = (msg: string, type: string) => console.log(`[${type}] ${msg}`)
  } = handlers;

  const currentState = state || (typeof getState === 'function' ? getState() : {});
  const currentSecret = handlers.secret || getActiveGatewaySecret();

  if (!currentSecret) {
    showToast('Gateway Secret required to access cloud state.', 'error');
    return false;
  }

  try {
    // Closed history has its own record and is synchronized only by its data
    // owner when source history or calculated fee metadata actually changes.
    // Portfolio UI/state writes must never implicitly trigger history GET/POST pairs.
    const stateToEncrypt = { ...currentState };
    delete stateToEncrypt.gatewaySecret;
    delete stateToEncrypt.marginBalance;
    delete stateToEncrypt.brokerExecutedTrades;
    delete stateToEncrypt.cashflows;
    // Broker API rows may contain a large duplicated raw payload. Cloud sync
    // only needs normalized execution fields and fee-allocation metadata.
    // A previous build may have persisted full TradeNet rows (including their
    // duplicated raw API payload). Keep only normalized fields required for
    // closed-history display and financing-fee reconciliation before cloud sync.
    if (Array.isArray(stateToEncrypt.brokerExecutedTrades)) {
      stateToEncrypt.brokerExecutedTrades = stateToEncrypt.brokerExecutedTrades.map((trade: any) => ({
        id: trade?.id,
        ticker: trade?.ticker,
        side: trade?.side,
        quantity: trade?.quantity,
        price: trade?.price,
        currency: trade?.currency,
        executedAt: trade?.executedAt,
        tradeValue: trade?.tradeValue,
        profit: trade?.profit,
        marginFee: trade?.marginFee,
        commission: trade?.commission,
        commissionCurrency: trade?.commissionCurrency,
        marginFeeAllocations: trade?.marginFeeAllocations,
        feesAndCommissions: trade?.feesAndCommissions,
        netProfit: trade?.netProfit
      }));
    }
    // Persist closed trades as compact canonical records. Older builds could
    // carry arbitrary broker/raw fields or duplicate the same records in
    // closedHistory, inflating every cloud sync even when history was unchanged.
    if (Array.isArray(stateToEncrypt.closedTrades)) {
      stateToEncrypt.closedTrades = stateToEncrypt.closedTrades.map((trade: any) => ({
        id: trade?.id,
        ticker: trade?.ticker,
        shares: trade?.shares,
        avgBuyPrice: trade?.avgBuyPrice,
        entryPrice: trade?.entryPrice,
        sellPrice: trade?.sellPrice,
        exitPrice: trade?.exitPrice,
        buyDate: trade?.buyDate,
        purchaseDate: trade?.purchaseDate,
        sellDate: trade?.sellDate,
        exitDate: trade?.exitDate,
        date: trade?.date,
        closedAt: trade?.closedAt,
        grossProfit: trade?.grossProfit,
        commissions: trade?.commissions,
        feesAndCommissions: trade?.feesAndCommissions,
        totalCommissions: trade?.totalCommissions,
        marginInterest: trade?.marginInterest,
        marginFee: trade?.marginFee,
        marginFeeAllocations: trade?.marginFeeAllocations,
        netProfit: trade?.netProfit,
        netRealizedGain: trade?.netRealizedGain,
        holdingDays: trade?.holdingDays
      }));
    }
    delete stateToEncrypt.closedHistory;
    const fingerprintState = { ...stateToEncrypt };
    delete fingerprintState.lastUpdated;
    const stateFingerprint = JSON.stringify(fingerprintState);
    if (cloudStatePushFingerprints.get(currentSecret) === stateFingerprint) {
      handlers.onStatusChange?.('synced');
      return true;
    }

    const serializedState = JSON.stringify(stateToEncrypt);
    const serializedBytes = new TextEncoder().encode(serializedState).byteLength;
    if (serializedBytes > 3500 * 1024) {
      throw new Error(`Cloud state is still too large after compacting (${(serializedBytes / 1024 / 1024).toFixed(2)} MB). Check large state fields before syncing.`);
    }
    const ciphertext = await encryptCloudPayload(serializedState, currentSecret);
    const payload = { encryptedPayload: ciphertext };

    const url = new URL('/api/state', WORKER_PROXY_URL);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': currentSecret,
        Authorization: `Bearer ${currentSecret}`,
        'If-Match': `"${expectedRevision}"`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      const errorMessage = typeof errData === 'object' && errData !== null
        ? (errData.error || errData.message || `HTTP ${res.status}`)
        : `HTTP ${res.status}`;
      throw new Error(errorMessage);
    }

    const savedRevision = readCloudRevision(res.headers);
    if (savedRevision !== null) setCloudRevision(savedRevision);
    cloudStatePushFingerprints.set(currentSecret, stateFingerprint);

    handlers.onStatusChange?.('synced');
    return true;
  } catch (err: any) {
    console.error('Failed to push to KV cloud:', err);
    handlers.onStatusChange?.('error');
    showToast(`Cloud push failed: ${err.message}`, 'error');
    return false;
  }
}

export async function syncCloudState(mode = 'push', options: SyncOptions = {}): Promise<boolean> {
  const handlers = typeof options === 'function' ? { pullCloudAndRewriteLocal: options } : options;
  if (mode === 'push') {
    const currentState = (handlers as any).state || (typeof (handlers as any).getState === 'function' ? (handlers as any).getState() : {});
    return pushCloudState(currentState, handlers);
  }
  if (mode === 'pull') {
    let succeeded = false;
    await pullCloudState(handlers, (success) => {
      succeeded = success;
    });
    return succeeded;
  }
  return false;
}


/** Read-only connectivity test for Freedom Broker Armenia TradeNet. */
export async function testFreedomTradeNetConnection(): Promise<unknown> {
  return proxyFetch('freedom-test');
}

/** Fetch raw read-only TradeNet positions so the actual broker schema can be verified. */
export async function fetchFreedomTradeNetPositions(): Promise<unknown> {
  return proxyFetch('freedom-positions', undefined, { cache: 'no-store' });
}

/** Fetch the complete read-only TradeNet execution history required for FIFO matching. */
export async function fetchFreedomTradeNetTrades(): Promise<unknown> {
  return proxyFetch('freedom-trades', undefined, { cache: 'no-store' });
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

/** Cache the full broker cashflow snapshot briefly to avoid repeat reads on quick Trades navigation. */
const FREEDOM_CASHFLOW_CACHE_TTL_MS = 5 * 60 * 1000;
let freedomCashflowCache: { secret: string; expiresAt: number; data: unknown } | null = null;
let freedomCashflowRequest: { secret: string; promise: Promise<unknown> } | null = null;

export async function fetchFreedomCashflows(): Promise<unknown> {
  const secret = getActiveGatewaySecret().trim();
  if (freedomCashflowCache && freedomCashflowCache.secret === secret && freedomCashflowCache.expiresAt > Date.now()) {
    recordApiMetric('cache_hit', { cache: 'freedom_cashflows' });
    return freedomCashflowCache.data;
  }
  if (freedomCashflowRequest?.secret === secret) {
    recordApiMetric('inflight_dedup', { operation: 'freedom_cashflows' });
    return freedomCashflowRequest.promise;
  }

  const request: Promise<unknown> = proxyFetch('freedom-cashflows', {}, { cache: 'no-store' })
    .then((data: unknown) => {
      freedomCashflowCache = { secret, expiresAt: Date.now() + FREEDOM_CASHFLOW_CACHE_TTL_MS, data };
      return data;
    })
    .catch((error) => {
      if (error instanceof Error) throw error;
      throw new Error('Failed to fetch Freedom Broker cashflows due to a network error.');
    })
    .finally(() => {
      if (freedomCashflowRequest?.promise === request) freedomCashflowRequest = null;
    });
  freedomCashflowRequest = { secret, promise: request };
  return request;
}

/** Clear the in-memory snapshot between isolated tests or account changes. */
export function clearFreedomCashflowCache(): void {
  freedomCashflowCache = null;
  freedomCashflowRequest = null;
}

export interface FreedomExecutedTrade {
  id: string;
  ticker: string;
  side: string;
  quantity: number | null;
  price: number | null;
  currency: string;
  executedAt: string | null;
  tradeValue: number | null;
  profit: number | null;
  /** Margin financing fee for this specific execution/stock, when supplied by a source. */
  marginFee: number | null;
  commission: number | null;
  commissionCurrency: string;
  raw: Record<string, unknown>;
}

/** Normalize common TradeNet history field aliases without fabricating missing values. */
export function normalizeFreedomTrades(response: unknown): FreedomExecutedTrade[] {
  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };
  const responseRecord = asRecord(response);
  const responseData = responseRecord?.data;
  const dataRecord = asRecord(responseData);
  const root = dataRecord?.result ?? responseData ?? responseRecord?.result ?? response;
  const rootRecord = asRecord(root);
  const tradesValue = rootRecord?.trades;
  const tradesRecord = asRecord(tradesValue);
  // Actual Freedom wrapper shape from example.json: data.trades.trade[]
  const rows: unknown[] = Array.isArray(root) ? root
    : Array.isArray(tradesRecord?.trade) ? tradesRecord.trade
      : Array.isArray(tradesValue) ? tradesValue
        : Array.isArray(rootRecord?.items) ? rootRecord.items
          : Array.isArray(rootRecord?.history) ? rootRecord.history
            : Array.isArray(rootRecord?.data) ? rootRecord.data
              : [];
  const numberOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // A broker row can include placeholder aliases (for example q=0 alongside
  // quantity=5). Prefer a real positive magnitude instead of letting the first
  // non-null placeholder erase an otherwise valid execution.
  const positiveMagnitudeOrNull = (...values: unknown[]): number | null => {
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed !== 0) return Math.abs(parsed);
    }
    return null;
  };
  const normalizedSide = (...values: unknown[]): 'BUY' | 'SELL' | null => {
    for (const value of values) {
      const side = String(value ?? '').trim().toLowerCase();
      if (side === '1' || ['b', 'buy', 'bought', 'purchase'].includes(side)) return 'BUY';
      if (side === '2' || ['s', 'sell', 'sold', 'sale'].includes(side)) return 'SELL';
    }
    return null;
  };
  const fallbackOccurrences = new Map<string, number>();
  const stableFallbackId = (row: Record<string, unknown>): string => {
    const fingerprint = JSON.stringify([
      row.order_id ?? row.orderId ?? '',
      row.instr_nm ?? row.i ?? row.ticker ?? row.symbol ?? row.instr ?? '',
      row.oper ?? row.operation ?? row.side ?? row.buy_sell ?? row.type ?? '',
      row.date ?? row.time ?? row.datetime ?? row.exec_time ?? '',
      row.q ?? row.quantity ?? row.qty ?? '',
      row.p ?? row.price ?? row.exec_price ?? '',
      row.v ?? row.summ ?? row.value ?? '',
      row.profit ?? row.pnl ?? ''
    ]);
    let hash = 2166136261;
    for (let index = 0; index < fingerprint.length; index += 1) {
      hash ^= fingerprint.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const key = (hash >>> 0).toString(36);
    const occurrence = fallbackOccurrences.get(key) || 0;
    fallbackOccurrences.set(key, occurrence + 1);
    return `fallback-${key}-${occurrence}`;
  };
  return rows.map((value): FreedomExecutedTrade => {
    const row = asRecord(value) ?? {};
    const executedAt = row.date ?? row.time ?? row.datetime ?? row.exec_time ?? null;
    return {
      id: String(row.id ?? row.trade_id ?? row.tradeId ?? stableFallbackId(row)),
      ticker: String(row.instr_nm ?? row.i ?? row.ticker ?? row.symbol ?? row.instr ?? ''),
      // Ignore unrecognized operation placeholders and continue to side/type aliases.
      side: normalizedSide(row.operation, row.side, row.buy_sell, row.type) || 'Unknown',
      quantity: positiveMagnitudeOrNull(row.q, row.quantity, row.qty),
      price: positiveMagnitudeOrNull(row.p, row.price, row.exec_price),
      currency: String(row.curr_c ?? row.curr ?? row.currency ?? row.base_currency ?? ''),
      executedAt: executedAt === null || executedAt === undefined ? null : String(executedAt),
      tradeValue: numberOrNull(row.v ?? row.summ ?? row.value),
      profit: numberOrNull(row.profit ?? row.pnl),
      marginFee: numberOrNull(row.margin_fee ?? row.marginFee ?? row.margin_interest ?? row.marginInterest ?? row.fee_margin ?? row.feeMargin ?? row.margin_commission ?? row.margin_commiss),
      commission: numberOrNull(row.commission ?? row.commiss ?? row.commissions ?? row.fee ?? row.commiss_exchange),
      commissionCurrency: String(row.commission_currency ?? row.curr_c ?? row.currency ?? ''),
      raw: row
    };
  });
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
const cloudStatePushFingerprints = new Map<string, string>();
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
  cloudStatePushFingerprints.clear();
  clearGuestPortfolioPublicationCache();
  clearFreedomCashflowCache();
  resetMarketRequestGate();
  validatedCloudResponse = null;
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
