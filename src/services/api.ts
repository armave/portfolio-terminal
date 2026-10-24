import CryptoJS from 'crypto-js';
import { processRollovers } from '../domain/portfolio';
import { getGatewaySecret, loadSavedState, saveState } from './storage';
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

export function setSecretGetter(_getter: () => string): void { }

function getActiveGatewaySecret(): string {
  // Credentials are managed only by the dedicated secret store/input. Portfolio
  // state may come from an imported backup or cloud payload and is never trusted.
  const stored = getGatewaySecret();
  if (stored) return stored;
  if (typeof document !== 'undefined') {
    const input =
      (document.getElementById('headerGatewaySecretInput') as HTMLInputElement | null) ||
      (document.getElementById('gatewaySecretInput') as HTMLInputElement | null);
    if (input?.value?.trim()) return input.value.trim();
  }
  return '';
}

export interface ProxyFetchOptions extends RequestInit {
  secret?: string;
  state?: Record<string, any> | PortfolioState;
}

export async function proxyFetch(
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

  const authSecret = fetchOptions.secret || getActiveGatewaySecret();

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
  yahooDeepDataCache.set(symbol, {
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
  if (existing) return existing;

  const request = proxyFetch('', { symbol }, { method: 'POST' })
    .then((data) => {
      if (data && typeof data === 'object' && !data.error) {
        rememberYahooDeepStockData(data);
      }
      return data;
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
      stocktwitsCache.set(symbol, { expiresAt: Date.now() + STOCKTWITS_CACHE_TTL_MS, data: stream });
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

  const request = proxyFetch('news', { symbol })
    .then((data) => {
      const news = Array.isArray(data) ? data : [];
      marketNewsCache.set(symbol, {
        expiresAt: Date.now() + MARKET_NEWS_CACHE_TTL_MS,
        data: news
      });
      return news;
    })
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

    if (wasUpdated || requiresEncryptionUpgrade) {
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
    console.log('[Sync]: Cloud state ingested and UI re-rendered successfully', parsedState);
    // showToast('KV cloud state pulled.', 'success');
    // logTerminal('[KV Cloud]: Synced successfully.');
    return parsedState;
  } catch (err: any) {
    reportResult?.(false);
    console.error('Failed to pull KV cloud state:', err);
    showToast(`Cloud pull failed: ${err.message}`, 'error');
    logTerminal(`[KV Cloud Error]: ${err.message}. Retaining local state.`);
    return loadSavedState(state || {});
  }
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
    // Sanitize a shallow copy so syncing never deletes fields from live app state.
    const stateToEncrypt = { ...currentState };
    delete stateToEncrypt.gatewaySecret;
    delete stateToEncrypt.marginBalance;
    const ciphertext = await encryptCloudPayload(JSON.stringify(stateToEncrypt), currentSecret);
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

    const syncEl = typeof document !== 'undefined' ? document.getElementById('cloudSyncStatus') : null;
    if (syncEl) {
      syncEl.textContent = `Synced: ${new Date().toLocaleTimeString()}`;
      syncEl.className = 'text-[10px] text-emerald-400 font-mono';
    }
    return true;
  } catch (err: any) {
    console.error('Failed to push to KV cloud:', err);
    const syncEl = typeof document !== 'undefined' ? document.getElementById('cloudSyncStatus') : null;
    if (syncEl) {
      syncEl.textContent = 'Sync failed';
      syncEl.className = 'text-[10px] text-rose-400 font-mono';
    }
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
