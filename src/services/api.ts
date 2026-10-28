import CryptoJS from 'crypto-js';
import { processRollovers } from '../domain/portfolio';
import { getGatewaySecret, loadSavedHistory, loadSavedState, saveState } from './storage';
import { PortfolioState } from '../types/portfolio';

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
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCloudEncryptionKey(secret);
  const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, new TextEncoder().encode(plaintext));
  return CLOUD_CIPHERTEXT_V2_PREFIX + bytesToBase64(nonce) + ':' + bytesToBase64(new Uint8Array(ciphertext));
}

async function decryptCloudPayload(payload: string, secret: string): Promise<{ plaintext: string; legacy: boolean }> {
  if (!payload.startsWith(CLOUD_CIPHERTEXT_V2_PREFIX)) {
    const bytes = CryptoJS.AES.decrypt(payload, secret);
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
  const key = await deriveCloudEncryptionKey(secret);
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
  const canCoalesce = fetchOptions.cache !== 'no-store' && COALESCED_READ_ACTIONS.has(action) &&
    (method === 'GET' || (action === '' && method === 'POST')) &&
    !fetchOptions.body && !fetchOptions.state;
  if (!canCoalesce) return performProxyFetch(action, queryParams, fetchOptions);

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

  const request = performProxyFetch(action, queryParams, fetchOptions);
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
const yahooQuoteCache = new Map<string, { expiresAt: number; data: any }>();
const yahooQuoteRequests = new Map<string, Promise<any>>();
const yahooQuoteQueue = new Map<string, { request: Promise<any>; resolvers: Array<(value: any) => void>; rejecters: Array<(error: unknown) => void> }>();
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
    const bySymbol = new Map<string, any>();
    results.forEach((item: any, index: number) => {
      const symbol = normalizeYahooSymbol(item?.symbol || symbols[index]);
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
export async function fetchYahooQuoteData(ticker: string, force = false): Promise<any> {
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

  let resolveRequest!: (value: any) => void;
  let rejectRequest!: (error: unknown) => void;
  const request = new Promise<any>((resolve, reject) => {
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

export async function fetchYahooStockData(ticker: string): Promise<any> {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    const data = await proxyFetch('', { symbol: cleanTicker });
    if (Array.isArray(data)) data.forEach(rememberYahooDeepStockData);
    else rememberYahooDeepStockData(data);
    return data;
  } catch (err: any) {
    console.warn(`[Yahoo Data Error for ${cleanTicker}]:`, err?.message || err);
    return null;
  }
}

/**
 * Preserve per-symbol fallback handling when a Yahoo batch request fails
 * before returning individual quote results.
 */
export function normalizeYahooBatchResults(responseData: any, tickers: string[]): any[] {
  if (Array.isArray(responseData)) return responseData;
  if (responseData && typeof responseData === 'object') return [responseData];
  return tickers.map(symbol => ({ symbol, error: 'Yahoo batch request failed' }));
}

export type FallbackQuoteProvider = 'finnhub' | 'twelvedata';

export interface NormalizedFallbackQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sourceName: 'Finnhub' | 'Twelve Data';
}

/** Fetch and normalize a single quote from a configured fallback provider. */
export async function fetchFallbackQuote(
  ticker: string,
  provider: FallbackQuoteProvider
): Promise<NormalizedFallbackQuote> {
  const symbol = normalizeYahooSymbol(ticker);
  if (!symbol) throw new Error('A ticker symbol is required for fallback quotes.');

  const data = await proxyFetch('provider-quote', { symbol, provider });
  const currentValue = provider === 'finnhub' ? data?.c : data?.close;
  const previousValue = provider === 'finnhub' ? data?.pc : data?.previous_close;
  const changeValue = provider === 'finnhub' ? data?.d : data?.change;
  const percentValue = provider === 'finnhub' ? data?.dp : data?.percent_change;
  const price = Number(currentValue);
  const previous = previousValue === null || previousValue === undefined || previousValue === ''
    ? NaN
    : Number(previousValue);
  const suppliedChange = changeValue === null || changeValue === undefined || changeValue === ''
    ? NaN
    : Number(changeValue);
  const suppliedPercent = percentValue === null || percentValue === undefined || percentValue === ''
    ? NaN
    : Number(percentValue);
  const hasPrevious = Number.isFinite(previous) && previous > 0;
  const change = Number.isFinite(suppliedChange)
    ? suppliedChange
    : hasPrevious ? price - previous : null;
  const changePercent = Number.isFinite(suppliedPercent)
    ? suppliedPercent
    : hasPrevious && change !== null ? (change / previous) * 100 : null;

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'} returned no valid quote for ${symbol}.`);
  }

  return {
    symbol,
    price,
    previousClose: hasPrevious ? previous : null,
    change,
    changePercent,
    sourceName: provider === 'finnhub' ? 'Finnhub' : 'Twelve Data'
  };
}

const YAHOO_DEEP_DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const yahooDeepDataCache = new Map<string, { expiresAt: number; data: any }>();
const yahooDeepDataRequests = new Map<string, Promise<any>>();

function normalizeYahooSymbol(symbol: unknown): string {
  return typeof symbol === 'string' ? symbol.trim().toUpperCase() : '';
}

/** Seed the shared deep-data cache with a successful item from a batch quote response. */
export function rememberYahooDeepStockData(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rememberYahooDeepStockData);
    return;
  }
  const data = value && typeof value === 'object' ? value as Record<string, any> : null;
  const symbol = normalizeYahooSymbol(data?.symbol);
  if (!data || !symbol || data.error) return;
  setBoundedCache(yahooDeepDataCache, symbol, {
    expiresAt: Date.now() + YAHOO_DEEP_DATA_CACHE_TTL_MS,
    data
  });
}

/**
 * Fetches the full Yahoo payload once per ticker and shares it between board
 * analyst targets and all Market Insights tabs. Explicit refreshes bypass cache.
 */
export async function fetchYahooDeepStockData(ticker: string, force = false): Promise<any> {
  const symbol = normalizeYahooSymbol(ticker);
  if (!symbol) return null;

  if (!force) {
    const cached = yahooDeepDataCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (cached) yahooDeepDataCache.delete(symbol);
  }

  const existing = yahooDeepDataRequests.get(symbol);
  if (!force && existing) return existing;

  const startedAt = Date.now();
  const request = proxyFetch('', { symbol }, { method: 'POST', ...(force ? { cache: 'no-store' as RequestCache } : {}) })
    .then((data) => {
      const durationMs = Date.now() - startedAt;
      if (data?.error) {
        recordApiMetric('provider_failure', { provider: 'yahoo', operation: 'deep_data', durationMs });
      } else {
        recordApiMetric('provider_request', { provider: 'yahoo', operation: 'deep_data', durationMs, success: true });
      }
      if (yahooDeepDataRequests.get(symbol) === request && data && typeof data === 'object' && !data.error) {
        // A superseded request must not overwrite a newer forced refresh in cache.
        rememberYahooDeepStockData(data);
      }
      return data;
    }, (error) => {
      recordApiMetric('provider_failure', { provider: 'yahoo', operation: 'deep_data', durationMs: Date.now() - startedAt });
      throw error;
    })
    .finally(() => {
      if (yahooDeepDataRequests.get(symbol) === request) {
        yahooDeepDataRequests.delete(symbol);
      }
    });
  yahooDeepDataRequests.set(symbol, request);
  return request;
}

/** Clears shared deep-data cache state, primarily for isolated tests. */
export function clearYahooDeepStockDataCache(): void {
  yahooDeepDataCache.clear();
  yahooDeepDataRequests.clear();
  yahooQuoteCache.clear();
  yahooQuoteRequests.clear();
  yahooQuoteQueue.clear();
  yahooQuoteFlushScheduled = false;
  marketNewsCache.clear();
  marketNewsRequests.clear();
  stocktwitsCache.clear();
  stocktwitsRequests.clear();
  validatedCloudResponse = null;
}

const MARKET_NEWS_CACHE_TTL_MS = 5 * 60 * 1000;
const marketNewsCache = new Map<string, { expiresAt: number; data: any[] }>();
const marketNewsRequests = new Map<string, Promise<any[]>>();
const STOCKTWITS_CACHE_TTL_MS = 2 * 60 * 1000;
const stocktwitsCache = new Map<string, { expiresAt: number; data: StocktwitsStream }>();
const stocktwitsRequests = new Map<string, Promise<StocktwitsStream>>();

export interface StocktwitsMessage {
  id: number | string;
  body: string;
  created_at: string;
  user?: { username?: string; name?: string };
  sentiment?: { basic?: 'Bullish' | 'Bearish' | null } | null;
  likes?: { total?: number };
  entities?: { sentiment?: { basic?: string | null } | null };
}

export interface StocktwitsStream {
  symbol: string;
  messages: StocktwitsMessage[];
  streamUrl: string;
}

export async function fetchStocktwitsStream(ticker: string, force = false): Promise<StocktwitsStream> {
  const symbol = normalizeYahooSymbol(ticker);
  if (!symbol) return { symbol: '', messages: [], streamUrl: '' };

  if (!force) {
    const cached = stocktwitsCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (cached) stocktwitsCache.delete(symbol);
  }

  const existing = stocktwitsRequests.get(symbol);
  if (existing) return existing;

  const request = proxyFetch('stocktwits', { symbol })
    .then((data) => {
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      const stream: StocktwitsStream = {
        symbol,
        messages,
        streamUrl: typeof data?.streamUrl === 'string'
          ? data.streamUrl
          : `https://stocktwits.com/symbol/${encodeURIComponent(symbol)}`
      };
      setBoundedCache(stocktwitsCache, symbol, { expiresAt: Date.now() + STOCKTWITS_CACHE_TTL_MS, data: stream });
      return stream;
    })
    .finally(() => {
      if (stocktwitsRequests.get(symbol) === request) stocktwitsRequests.delete(symbol);
    });
  stocktwitsRequests.set(symbol, request);
  return request;
}

export async function fetchMarketNews(ticker: string, force = false): Promise<any[]> {
  const symbol = normalizeYahooSymbol(ticker);
  if (!symbol) return [];

  if (!force) {
    const cached = marketNewsCache.get(symbol);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    if (cached) marketNewsCache.delete(symbol);
  }

  const existing = marketNewsRequests.get(symbol);
  if (existing) return existing;

  const request = (async () => {
    // Freedom/TradeNet getNews is unavailable on the current broker endpoint.
    // Do not call it; use the existing market-news provider directly.
    try {
      const data = await proxyFetch('news', { symbol });
      const news = Array.isArray(data) ? data : [];
      setBoundedCache(marketNewsCache, symbol, { expiresAt: Date.now() + MARKET_NEWS_CACHE_TTL_MS, data: news });
      return news;
    } catch (error) {
      console.warn(`[Market News Error for ${symbol}]:`, error instanceof Error ? error.message : error);
      return [];
    }
  })()
    .finally(() => {
      if (marketNewsRequests.get(symbol) === request) marketNewsRequests.delete(symbol);
    });
  marketNewsRequests.set(symbol, request);
  return request;
}

export interface SyncOptions {
  state?: any;
  secret?: string;
  pullCloudAndRewriteLocal?: (state: any) => void;
  getState?: () => any;
  showToast?: (msg: string, type: string) => void;
  logTerminal?: (msg: string) => void;
  onStatusChange?: (status: 'synced' | 'error') => void;
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
    const url = new URL('/api/state', WORKER_PROXY_URL);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Auth': cleanSecret,
        Authorization: `Bearer ${cleanSecret}`
      }
    });

    // The validation GET already contains the cloud payload. Keep its body
    // briefly so startup can use it as the initial pull instead of downloading
    // the same encrypted portfolio a second time.
    if (response.ok || response.status === 404) {
      // Real Fetch responses are readable; keep compatibility with minimal
      // response mocks used by callers/tests that only expose status and ok.
      if (typeof response.text === 'function') {
        validatedCloudResponse = {
          secret: cleanSecret,
          checkedAt: Date.now(),
          status: response.status,
          etag: response.headers?.get('ETag') ?? null,
          contentType: response.headers?.get('Content-Type') ?? null,
          body: await response.text()
        };
      } else {
        validatedCloudResponse = null;
      }
      return true;
    }
    validatedCloudResponse = null;
    return false;
  } catch (error) {
    validatedCloudResponse = null;
    console.warn('Gateway Secret validation failed:', error);
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
    const legacyHistory = {
      brokerExecutedTrades: Array.isArray(parsedState.brokerExecutedTrades) && parsedState.brokerExecutedTrades.length
        ? parsedState.brokerExecutedTrades : localHistory.brokerExecutedTrades,
      cashflows: Array.isArray(parsedState.cashflows) && parsedState.cashflows.length
        ? parsedState.cashflows : localHistory.cashflows
    };
    const hasHistory = legacyHistory.brokerExecutedTrades.length > 0 || legacyHistory.cashflows.length > 0;
    const hasLegacyCloudHistory =
      (Array.isArray(parsedState.brokerExecutedTrades) && parsedState.brokerExecutedTrades.length > 0) ||
      (Array.isArray(parsedState.cashflows) && parsedState.cashflows.length > 0);
    let historyMigrationComplete = false;
    try { historyMigrationComplete = localStorage.getItem(CLOSED_HISTORY_MIGRATION_KEY) === '1'; } catch { /* migrate safely when storage is unavailable */ }
    if (hasHistory && (hasLegacyCloudHistory || !historyMigrationComplete)) {
      await pushCloudHistory(legacyHistory, currentSecret);
    }
    delete parsedState.brokerExecutedTrades;
    delete parsedState.cashflows;
    const mergedLocalData = hasHistory;

    const wasUpdated = processRollovers(parsedState);
    if (!saveState(parsedState)) {
      throw new Error('Cloud state was downloaded but could not be saved to this device. Check browser storage availability and free space, then retry.');
    }

    // Only trust the cloud revision after its payload was decrypted, validated,
    // and persisted locally. A failed pull must not authorize a later overwrite.
    if (pulledRevision !== null) {
      cloudPullGeneration += 1;
      setCloudRevision(pulledRevision);
    }

    if (wasUpdated || requiresEncryptionUpgrade || mergedLocalData) {
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
let lastSyncedBrokerTrades: any[] | undefined;
let lastSyncedCashflows: any[] | undefined;
const CLOSED_HISTORY_MIGRATION_KEY = 'closed_history_cloud_migrated_v1';

export async function pushCloudHistory(history: { brokerExecutedTrades?: any[]; cashflows?: any[] }, secret = getActiveGatewaySecret()): Promise<boolean> {
  const brokerExecutedTrades = Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [];
  const cashflows = Array.isArray(history.cashflows) ? history.cashflows : [];
  if (!secret || (!brokerExecutedTrades.length && !cashflows.length)) return false;
  if (brokerExecutedTrades === lastSyncedBrokerTrades && cashflows === lastSyncedCashflows) return false;
  const url = new URL('/api/history', WORKER_PROXY_URL).toString();
  const current = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json', 'X-App-Auth': secret, Authorization: `Bearer ${secret}` } });
  const revision = readCloudRevision(current.headers) ?? 0;
  if (!current.ok && current.status !== 404) throw new Error(`Closed history revision check failed (HTTP ${current.status}).`);
  const plaintext = JSON.stringify({ brokerExecutedTrades, cashflows });
  const encryptedPayload = await encryptCloudPayload(plaintext, secret);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-App-Auth': secret, Authorization: `Bearer ${secret}`, 'If-Match': `"${revision}"` },
    body: JSON.stringify({ encryptedPayload })
  });
  if (!res.ok) throw new Error(`Closed history sync failed (HTTP ${res.status}).`);
  lastSyncedBrokerTrades = brokerExecutedTrades;
  lastSyncedCashflows = cashflows;
  try { localStorage.setItem(CLOSED_HISTORY_MIGRATION_KEY, '1'); } catch { /* session cache remains valid */ }
  return true;
}

export async function pullCloudHistory(secret = getActiveGatewaySecret()): Promise<{ brokerExecutedTrades: any[]; cashflows: any[] } | null> {
  if (!secret) return null;
  const res = await fetch(new URL('/api/history', WORKER_PROXY_URL).toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'X-App-Auth': secret, Authorization: `Bearer ${secret}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Closed history load failed (HTTP ${res.status}).`);
  const envelope = await res.json();
  if (typeof envelope?.encryptedPayload !== 'string') throw new Error('Invalid closed history payload.');
  const decrypted = await decryptCloudPayload(envelope.encryptedPayload, secret);
  const parsed = JSON.parse(decrypted.plaintext);
  return {
    brokerExecutedTrades: Array.isArray(parsed.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
    cashflows: Array.isArray(parsed.cashflows) ? parsed.cashflows : []
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
    // Keep the bulky history out of the startup-critical portfolio payload.
    // Sync it independently, then encrypt only the compact main-state snapshot.
    const stateToEncrypt = { ...currentState };
    delete stateToEncrypt.gatewaySecret;
    delete stateToEncrypt.marginBalance;
    if ((Array.isArray(stateToEncrypt.brokerExecutedTrades) && stateToEncrypt.brokerExecutedTrades.length) ||
      (Array.isArray(stateToEncrypt.cashflows) && stateToEncrypt.cashflows.length)) {
      await pushCloudHistory({
        brokerExecutedTrades: stateToEncrypt.brokerExecutedTrades,
        cashflows: stateToEncrypt.cashflows
      }, currentSecret);
    }
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
export async function testFreedomTradeNetConnection(): Promise<any> {
  return proxyFetch('freedom-test');
}

/** Fetch raw read-only TradeNet positions so the actual broker schema can be verified. */
export async function fetchFreedomTradeNetPositions(): Promise<any> {
  return proxyFetch('freedom-positions');
}

/** Fetch a bounded, read-only page of executed TradeNet trades. */
export async function fetchFreedomTradeNetTrades(): Promise<any> {
  return proxyFetch('freedom-trades');
}

/** Fetch current active TradeNet orders without reusing a cached response. */
export async function fetchFreedomTradeNetActiveOrders(): Promise<any> {
  return proxyFetch('freedom-orders', { active_only: 1 }, { cache: 'no-store' });
}

export interface FreedomActiveOrder {
  id: string;
  ticker: string;
  operation: number | null;
  orderType: number | null;
  limitPrice: number | null;
  remainingQuantity: number | null;
  status: string;
  raw: Record<string, any>;
}

/** Normalize current-order aliases; keep the raw row so unknown broker fields remain inspectable. */
export function normalizeFreedomActiveOrders(response: any): FreedomActiveOrder[] {
  const root = response?.data?.result ?? response?.data ?? response?.result ?? response;
  const rows = Array.isArray(root) ? root
    : Array.isArray(root?.orders?.order) ? root.orders.order
      : Array.isArray(root?.orders) ? root.orders
        : Array.isArray(root?.items) ? root.items
          : Array.isArray(root?.data) ? root.data
            : [];
  const numberOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return rows.map((row: any, index: number) => ({
    id: String(row?.order_id ?? row?.id ?? row?.orderId ?? index),
    ticker: String(row?.instr_nm ?? row?.i ?? row?.ticker ?? row?.symbol ?? row?.instr ?? '').trim().toUpperCase(),
    operation: numberOrNull(row?.oper ?? row?.operation),
    orderType: numberOrNull(row?.type ?? row?.order_type ?? row?.orderType),
    limitPrice: numberOrNull(row?.p ?? row?.price ?? row?.limit_price ?? row?.limitPrice),
    remainingQuantity: numberOrNull(row?.leaves_qty ?? row?.remaining_qty ?? row?.remainingQuantity ?? row?.q ?? row?.quantity),
    status: String(row?.stat ?? row?.status ?? ''),
    raw: row && typeof row === 'object' ? row : {}
  }));
}

/** Fetch the raw read-only Freedom Broker cashflows response for temporary integration testing. */

export async function fetchFreedomCashflows(): Promise<any> {
  try {
    return await proxyFetch('freedom-cashflows', {}, { cache: 'no-store' });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Failed to fetch Freedom Broker cashflows due to a network error.');
  }
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
export function normalizeFreedomTrades(response: any): FreedomExecutedTrade[] {
  const root = response?.data?.result ?? response?.data ?? response?.result ?? response;
  // Actual Freedom wrapper shape from example.json: data.trades.trade[]
  const rows = Array.isArray(root) ? root
    : Array.isArray(root?.trades?.trade) ? root.trades.trade
      : Array.isArray(root?.trades) ? root.trades
        : Array.isArray(root?.items) ? root.items
          : Array.isArray(root?.history) ? root.history
            : Array.isArray(root?.data) ? root.data
              : [];
  const numberOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return rows.map((row: any, index: number) => ({
    id: String(row?.id ?? row?.trade_id ?? row?.tradeId ?? row?.order_id ?? index),
    ticker: String(row?.instr_nm ?? row?.i ?? row?.ticker ?? row?.symbol ?? row?.instr ?? ''),
    // TradeNet example uses type "1" for buy and "2" for sell.
    side: row?.operation != null ? String(row.operation)
      : row?.side != null ? String(row.side)
        : row?.buy_sell != null ? String(row.buy_sell)
          : String(row?.type) === '1' ? 'BUY'
            : String(row?.type) === '2' ? 'SELL'
              : 'Unknown',
    quantity: numberOrNull(row?.q ?? row?.quantity ?? row?.qty),
    price: numberOrNull(row?.p ?? row?.price ?? row?.exec_price),
    currency: String(row?.curr_c ?? row?.curr ?? row?.currency ?? row?.base_currency ?? ''),
    executedAt: row?.date ?? row?.time ?? row?.datetime ?? row?.exec_time ?? null,
    tradeValue: numberOrNull(row?.v ?? row?.summ ?? row?.value),
    profit: numberOrNull(row?.profit ?? row?.pnl),
    marginFee: numberOrNull(row?.margin_fee ?? row?.marginFee ?? row?.margin_interest ?? row?.marginInterest ?? row?.fee_margin ?? row?.feeMargin ?? row?.margin_commission ?? row?.margin_commiss),
    commission: numberOrNull(row?.commission ?? row?.commiss ?? row?.commissions ?? row?.fee ?? row?.commiss_exchange),
    commissionCurrency: String(row?.commission_currency ?? row?.curr_c ?? row?.currency ?? ''),
    raw: row && typeof row === 'object' ? row : {}
  }));
}

export interface FreedomCashBalance {
  currency: string;
  amount: number;
  forecastIn: number;
  forecastOut: number;
  t2In: number;
  t2Out: number;
}

export interface FreedomOpenPosition {
  ticker: string;
  name: string;
  quantity: number;
  currency: string;
  marketPrice: number | null;
  marketValue: number | null;
  averagePrice: number | null;
  profitClose: number | null;
  accountPositionId: number | null;
}

export interface FreedomPortfolioSnapshot {
  loaded: boolean;
  balances: FreedomCashBalance[];
  positions: FreedomOpenPosition[];
}

/** Normalize the documented fields without converting currencies or inventing missing values. */
export function normalizeFreedomPortfolio(response: any): FreedomPortfolioSnapshot {
  const ps = response?.data?.result?.ps;
  if (!ps || typeof ps !== 'object') throw new Error('TradeNet response is missing data.result.ps.');
  if (ps.loaded !== true) throw new Error('TradeNet USD account data is not loaded yet.');

  // This app is intentionally scoped to the active USD account. Do not mix
  // AED/RUR balances or non-USD positions into the USD portfolio.
  const usdRows = (rows: any[]) => rows.filter((item) =>
    String(item?.curr ?? item?.base_currency ?? '').toUpperCase() === 'USD'
  );
  const finiteOrNull = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const balances = Array.isArray(ps.acc) ? usdRows(ps.acc).map((item: any) => ({
    currency: 'USD',
    // TradeNet `s` matches the USD balance shown in the broker app; `currval` is a different value.
    amount: finiteOrNull(item?.s) ?? finiteOrNull(item?.currval) ?? 0,
    forecastIn: finiteOrNull(item?.forecast_in) ?? 0,
    forecastOut: finiteOrNull(item?.forecast_out) ?? 0,
    t2In: finiteOrNull(item?.t2_in) ?? 0,
    t2Out: finiteOrNull(item?.t2_out) ?? 0
  })) : [];
  const positions = Array.isArray(ps.pos) ? usdRows(ps.pos).map((item: any) => ({
    ticker: String(item?.i ?? item?.base_contract_code ?? ''),
    name: String(item?.name ?? item?.name2 ?? item?.i ?? 'Unknown instrument'),
    quantity: finiteOrNull(item?.q) ?? 0,
    currency: 'USD',
    marketPrice: finiteOrNull(item?.mkt_price),
    marketValue: finiteOrNull(item?.market_value),
    averagePrice: finiteOrNull(item?.bal_price_a),
    profitClose: finiteOrNull(item?.profit_close),
    accountPositionId: finiteOrNull(item?.acc_pos_id)
  })) : [];
  return { loaded: true, balances, positions };
}
