import type { BrokerAssumptions } from '../types/portfolio';
import {
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  isSupportedQuoteRefreshInterval,
  normalizeQuoteRefreshInterval
} from './portfolioAutoRefresh';

const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_CLOSED_HISTORY = 'portfolio_closed_history_v1';
const HISTORY_DATABASE_NAME = 'portfolio-terminal-history-cache';
const HISTORY_DATABASE_VERSION = 1;
const HISTORY_OBJECT_STORE = 'history';
const HISTORY_RECORD_KEY = 'closed-history-v1';
const MAX_LOCAL_HISTORY_FALLBACK_CHARS = 512 * 1024;
const STORAGE_KEY_TRADE_HISTORY_BASELINE = 'portfolio_tradenet_trade_history_baseline_v1';
const STORAGE_KEY_CASHFLOW_HISTORY_BASELINE = 'portfolio_tradenet_cashflow_history_baseline_v1';
let lastPersistedHistory: ClosedHistorySnapshot | null = null;
let cachedHistory: ClosedHistorySnapshot | null = null;
let queuedHistorySnapshot: ClosedHistorySnapshot | null = null;
let historyWriteQueue: Promise<boolean> = Promise.resolve(true);
let historyStorageInitialized = false;
let historyStorageInitialization: Promise<void> | null = null;

const STORAGE_KEY_LEGACY_STATE = 'portfolio_state';
const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_GW_AUTH_ENCRYPTED = 'gateway_secret_encrypted_v1';
const GW_KEY_DB = 'portfolio-terminal-secure-storage';
const GW_KEY_STORE = 'keys';
const GW_KEY_ID = 'gateway-secret-aes-key';
let pendingSecretPersistence: Promise<boolean> = Promise.resolve(true);
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';
const STORAGE_KEY_GUEST_REFRESH_INTERVAL = 'quote_refresh_interval_guest_v1';

let inMemoryGatewaySecret = '';

export interface ClosedHistorySnapshot {
  brokerExecutedTrades: unknown[];
  cashflows: unknown[];
}

export interface PortfolioSnapshotOptions {
  /** Keep the device-local desk preference consistent with the committed snapshot. */
  deviceActiveView?: string;
  /** Keep the separately-preferred broker settings record consistent with the portfolio snapshot. */
  brokerRules?: BrokerAssumptions;
}

/** Returns browser storage only when it is available to the current runtime. */
function getBrowserStorage(): Storage | null {
  return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
}


function normalizeHistorySnapshot(value: unknown): ClosedHistorySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.brokerExecutedTrades) && !Array.isArray(candidate.cashflows)) return null;
  return {
    brokerExecutedTrades: Array.isArray(candidate.brokerExecutedTrades) ? candidate.brokerExecutedTrades : [],
    cashflows: Array.isArray(candidate.cashflows) ? candidate.cashflows : []
  };
}

function readLegacySavedHistorySnapshot(): ClosedHistorySnapshot | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY_CLOSED_HISTORY);
  } catch (error) {
    console.warn('Failed to read legacy closed history from localStorage:', error);
  }
  if (raw) {
    try {
      const history = normalizeHistorySnapshot(JSON.parse(raw));
      if (history) return history;
      throw new Error('Saved closed history must contain history arrays.');
    } catch (error) {
      // Keep a damaged sidecar intact. The embedded legacy snapshot may still
      // recover its rows, and the migration must not destroy the damaged copy.
      console.warn('Failed to parse saved closed history:', error);
    }
  }

  for (const key of [STORAGE_KEY_STATE, STORAGE_KEY_LEGACY_STATE]) {
    try {
      const legacyRaw = storage.getItem(key);
      if (!legacyRaw) continue;
      const legacy = JSON.parse(legacyRaw);
      const history = normalizeHistorySnapshot(legacy);
      if (history) return history;
    } catch {
      // Continue to the next legacy snapshot if one is malformed.
    }
  }
  return null;
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(HISTORY_DATABASE_NAME, HISTORY_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HISTORY_OBJECT_STORE)) {
        request.result.createObjectStore(HISTORY_OBJECT_STORE);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error('Could not open closed-history storage'));
    request.onblocked = () => reject(new Error('Closed-history storage upgrade is blocked by another tab'));
  });
}

async function readHistoryRecordFromIndexedDB(): Promise<ClosedHistorySnapshot | null> {
  const db = await openHistoryDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readonly');
      const request = transaction.objectStore(HISTORY_OBJECT_STORE).get(HISTORY_RECORD_KEY);
      let snapshot: ClosedHistorySnapshot | null = null;
      request.onsuccess = () => {
        snapshot = normalizeHistorySnapshot(request.result);
      };
      request.onerror = () => reject(request.error || new Error('Could not read closed-history storage'));
      transaction.oncomplete = () => resolve(snapshot);
      transaction.onerror = () => reject(transaction.error || new Error('Closed-history read transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Closed-history read transaction was aborted'));
    });
  } finally {
    db.close();
  }
}

async function writeHistoryRecordToIndexedDB(history: ClosedHistorySnapshot): Promise<void> {
  const db = await openHistoryDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readwrite');
      transaction.objectStore(HISTORY_OBJECT_STORE).put(history, HISTORY_RECORD_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Closed-history write transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Closed-history write transaction was aborted'));
    });
  } finally {
    db.close();
  }
}

async function writeLegacyHistoryFallback(history: ClosedHistorySnapshot): Promise<boolean> {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    const serialized = JSON.stringify(history);
    if (serialized.length > MAX_LOCAL_HISTORY_FALLBACK_CHARS) {
      throw new Error('Closed history is too large for the legacy localStorage fallback; IndexedDB is required.');
    }
    storage.setItem(STORAGE_KEY_CLOSED_HISTORY, serialized);
    return true;
  } catch (error) {
    console.warn('Closed history could not be written to the legacy localStorage fallback:', error);
    return false;
  }
}

function removeLegacyHistorySidecar(): void {
  try {
    getBrowserStorage()?.removeItem(STORAGE_KEY_CLOSED_HISTORY);
  } catch (error) {
    console.warn('Could not remove the migrated localStorage history copy:', error);
  }
}

/**
 * Hydrate the synchronous history cache before mounting history consumers.
 * Existing localStorage history is migrated to IndexedDB and removed only
 * after the IndexedDB transaction has completed successfully.
 */
export function initializeSavedHistoryStorage(): Promise<void> {
  if (historyStorageInitialized) return Promise.resolve();
  if (historyStorageInitialization) return historyStorageInitialization;

  historyStorageInitialization = (async () => {
    const legacyHistory = readLegacySavedHistorySnapshot();
    try {
      const indexedHistory = await readHistoryRecordFromIndexedDB();
      const history = indexedHistory ?? legacyHistory ?? { brokerExecutedTrades: [], cashflows: [] };
      if (!indexedHistory) await writeHistoryRecordToIndexedDB(history);
      cachedHistory = history;
      lastPersistedHistory = history;
      if (legacyHistory) removeLegacyHistorySidecar();
    } catch (error) {
      // Keep the legacy copy readable when IndexedDB is unavailable or blocked.
      // Small histories can still use the bounded fallback; large ones remain
      // available from cloud history and in-memory portfolio state.
      cachedHistory = legacyHistory ?? { brokerExecutedTrades: [], cashflows: [] };
      lastPersistedHistory = null;
      console.warn('IndexedDB closed-history storage is unavailable; using the legacy cache when possible:', error);
    }
    historyStorageInitialized = true;
  })().finally(() => {
    historyStorageInitialization = null;
  });

  return historyStorageInitialization;
}

async function persistSavedHistorySnapshot(history: ClosedHistorySnapshot): Promise<boolean> {
  await initializeSavedHistoryStorage();
  const snapshot: ClosedHistorySnapshot = {
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  };
  cachedHistory = snapshot;
  if (
    lastPersistedHistory &&
    lastPersistedHistory.brokerExecutedTrades === snapshot.brokerExecutedTrades &&
    lastPersistedHistory.cashflows === snapshot.cashflows
  ) return true;
  if (
    queuedHistorySnapshot &&
    queuedHistorySnapshot.brokerExecutedTrades === snapshot.brokerExecutedTrades &&
    queuedHistorySnapshot.cashflows === snapshot.cashflows
  ) return await historyWriteQueue;

  queuedHistorySnapshot = snapshot;
  const nextWrite = historyWriteQueue.catch(() => false).then(async () => {
    try {
      await writeHistoryRecordToIndexedDB(snapshot);
      removeLegacyHistorySidecar();
      return true;
    } catch (indexedDbError) {
      console.warn('Could not persist closed history in IndexedDB; trying the bounded legacy fallback:', indexedDbError);
      return await writeLegacyHistoryFallback(snapshot);
    }
  });
  historyWriteQueue = nextWrite;
  const saved = await nextWrite;
  if (saved) {
    lastPersistedHistory = snapshot;
  }
  if (queuedHistorySnapshot === snapshot) queuedHistorySnapshot = null;
  return saved;
}


/** A warm cache is eligible for date-bounded requests only after a full baseline has been persisted. */
function historyBaselineKey(key: string, accountId: string): string {
  return key + ':' + encodeURIComponent(String(accountId || ''));
}

export function hasFreedomTradeHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    return getBrowserStorage()?.getItem(historyBaselineKey(STORAGE_KEY_TRADE_HISTORY_BASELINE, accountId)) === '1';
  } catch {
    return false;
  }
}

export function markFreedomTradeHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(historyBaselineKey(STORAGE_KEY_TRADE_HISTORY_BASELINE, accountId), '1');
    return true;
  } catch {
    return false;
  }
}

export function hasFreedomCashflowHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    return getBrowserStorage()?.getItem(historyBaselineKey(STORAGE_KEY_CASHFLOW_HISTORY_BASELINE, accountId)) === '1';
  } catch {
    return false;
  }
}

export function markFreedomCashflowHistoryBaseline(accountId: string): boolean {
  if (!accountId) return false;
  try {
    const storage = getBrowserStorage();
    if (!storage) return false;
    storage.setItem(historyBaselineKey(STORAGE_KEY_CASHFLOW_HISTORY_BASELINE, accountId), '1');
    return true;
  } catch {
    return false;
  }
}

/** Removes related legacy keys together so credential cleanup follows one path. */
function removeStoredKeys(storage: Storage, keys: string[]): void {
  keys.forEach((key) => storage.removeItem(key));
}

/**
 * Reversible client-side secret encoding is disabled.
 */
export function obfuscateSecret(_plain: string): string {
  return '';
}

/**
 * Decoding legacy client-side secret encodings is disabled.
 */
export function deobfuscateSecret(_encoded: string): string {
  return '';
}

/**
 * In-memory gateway secret getter.
 */
export function getGatewaySecret(): string {
  return inMemoryGatewaySecret;
}

/**
 * In-memory gateway secret setter.
 */
export function setGatewaySecret(secret: string): void {
  inMemoryGatewaySecret = secret ? String(secret) : '';
}

/**
 * Returns true if the in-memory gateway secret is non-empty.
 */
export function areHeaderCredentialsConfigured(): boolean {
  return Boolean(inMemoryGatewaySecret && inMemoryGatewaySecret.trim().length > 0);
}

function openSecureKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(GW_KEY_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GW_KEY_STORE)) {
        request.result.createObjectStore(GW_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open secure key storage'));
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const request = db.transaction(GW_KEY_STORE, 'readonly').objectStore(GW_KEY_STORE).get(GW_KEY_ID);
    request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
    request.onerror = () => reject(request.error);
  });
  if (existing) return existing;
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GW_KEY_STORE, 'readwrite');
    tx.objectStore(GW_KEY_STORE).put(key, GW_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Secure key storage transaction aborted'));
  });
  return key;
}

async function persistEncryptedGatewaySecret(secret: string): Promise<void> {
  const storage = getBrowserStorage();
  if (!storage) throw new Error('Local storage is unavailable');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  if (!secret) {
    storage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED);
    return;
  }
  const db = await openSecureKeyDatabase();
  try {
    const key = await getOrCreateDeviceKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
    const payload = JSON.stringify({
      version: 1,
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    });
    storage.setItem(STORAGE_KEY_GW_AUTH_ENCRYPTED, payload);
  } finally {
    db.close();
  }
}

/**
 * Keeps the secret in memory and persists it encrypted with a non-extractable
 * device key held in IndexedDB. This avoids plaintext credentials in localStorage
 * while allowing the same browser profile to restore the secret after refresh.
 */
export function saveGatewaySecret(secret: string): void {
  const cleanSecret = typeof secret === 'string' ? secret.trim() : '';
  setGatewaySecret(cleanSecret);
  try {
    const storage = getBrowserStorage();
    if (storage) removeStoredKeys(storage, [STORAGE_KEY_GW_AUTH, 'gateway_secret']);
  } catch (err) {
    console.warn('Failed to purge persisted gateway credentials:', err);
  }
  pendingSecretPersistence = pendingSecretPersistence
    .catch(() => false)
    .then(() => persistEncryptedGatewaySecret(cleanSecret))
    .then(() => true)
    .catch((err) => {
      console.warn('Could not persist encrypted Gateway Secret; it will be requested again after refresh:', err);
      return false;
    });
}

/** Waits until the latest encrypted secret write has completed and reports persistence success. */
export async function persistGatewaySecret(): Promise<boolean> {
  return pendingSecretPersistence;
}

/**
 * Restores a saved device secret into memory. If decryption is unavailable or
 * fails, removes the unusable ciphertext and falls back to the normal auth modal.
 */
export async function restoreGatewaySecret(): Promise<string> {
  const storage = getBrowserStorage();
  if (!storage) return inMemoryGatewaySecret;

  try {
    removeStoredKeys(storage, [STORAGE_KEY_GW_AUTH, 'gateway_secret']);
  } catch (err) {
    console.warn('Could not clear legacy Gateway Secret entries:', err);
  }
  if (inMemoryGatewaySecret) return inMemoryGatewaySecret;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY_GW_AUTH_ENCRYPTED);
  } catch (err) {
    console.warn('Could not read encrypted Gateway Secret from device storage:', err);
    return '';
  }
  if (!raw) return '';

  let payload: { version?: number; iv?: number[]; data?: number[] };
  try {
    payload = JSON.parse(raw) as { version?: number; iv?: number[]; data?: number[] };
    if (payload.version !== 1 || !Array.isArray(payload.iv) || !Array.isArray(payload.data)) {
      throw new Error('Encrypted Gateway Secret payload is invalid');
    }
  } catch (err) {
    console.warn('Encrypted Gateway Secret payload is invalid; clearing it:', err);
    try { storage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED); } catch { /* storage unavailable */ }
    setGatewaySecret('');
    return '';
  }

  // Preserve ciphertext when required browser APIs are unavailable. This can be
  // temporary (e.g. a restricted browser context); deleting it would make the
  // user's device-bound secret unrecoverable when storage becomes available again.
  if (!globalThis.crypto?.subtle || typeof indexedDB === 'undefined') {
    console.warn('Secure browser storage is temporarily unavailable; preserving the encrypted Gateway Secret.');
    return '';
  }

  let db: IDBDatabase;
  try {
    db = await openSecureKeyDatabase();
  } catch (err) {
    console.warn('Could not open secure key storage; preserving the encrypted Gateway Secret:', err);
    return '';
  }

  let key: CryptoKey;
  try {
    key = await getOrCreateDeviceKey(db);
  } catch (err) {
    console.warn('Could not access the device encryption key; preserving the encrypted Gateway Secret:', err);
    db.close();
    return '';
  }

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
      key,
      new Uint8Array(payload.data)
    );
    const secret = new TextDecoder().decode(decrypted);
    setGatewaySecret(secret);
    return secret;
  } catch (err) {
    // Decryption failure means the payload is corrupt or the stored device key
    // no longer matches it. Keep the established fallback to re-enter the secret.
    console.warn('Could not decrypt encrypted Gateway Secret; clearing unusable ciphertext:', err);
    try { storage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED); } catch { /* storage unavailable */ }
    setGatewaySecret('');
    return '';
  } finally {
    db.close();
  }
}

/** Returns the currently available in-memory secret without performing I/O. */
export function loadGatewaySecret(): string {
  return inMemoryGatewaySecret;
}

export interface SaveApiKeysOptions {
  secret?: string;
  showToast?: (message: string, type?: string) => void;
  logTerminal?: (message: string) => void;
  [key: string]: unknown;
}

/**
 * Validates, saves, and confirms Gateway credentials.
 */
export async function saveApiKeys(options: SaveApiKeysOptions): Promise<boolean> {
  const { secret, showToast, logTerminal } = options || {};
  if (!secret || !secret.trim()) {
    if (typeof showToast === 'function') {
      showToast('Please enter a valid Gateway Secret', 'error');
    }
    return false;
  }

  const cleanSecret = secret.trim();
  saveGatewaySecret(cleanSecret);
  const persisted = await persistGatewaySecret();

  if (!persisted) {
    const message = 'Gateway Secret is available for this session, but secure device storage failed. It may need to be entered again after refresh.';
    if (typeof logTerminal === 'function') logTerminal(message);
    if (typeof showToast === 'function') showToast(message, 'error');
    return false;
  }

  if (typeof logTerminal === 'function') {
    logTerminal('Gateway Secret saved. Remote access has not been verified yet.');
  }
  if (typeof showToast === 'function') {
    showToast('Gateway Secret saved. Remote access has not been verified yet.', 'success');
  }
  return true;
}

interface PortfolioSnapshotPersistResult {
  success: boolean;
  stateChanged: boolean;
  savedAt: number | null;
}

/**
 * Persists the portfolio state and any changed closed-history sidecar as one
 * best-effort local transaction. If a later key fails, already-written keys
 * are restored to their previous values before the call reports failure.
 */
function persistPortfolioSnapshot(
  state: Record<string, any>,
  options: PortfolioSnapshotOptions = {}
): PortfolioSnapshotPersistResult {
  const storage = getBrowserStorage();
  if (!storage) return { success: false, stateChanged: false, savedAt: null };

  const savedAt = Date.now();
  let persistedStateJson: string;
  let brokerRulesJson: string | null = null;
  let nextComparable: string;
  try {
    const persistedState: Record<string, unknown> = { ...state, lastUpdated: savedAt };
    delete persistedState.gatewaySecret;
    delete persistedState.brokerExecutedTrades;
    delete persistedState.cashflows;
    persistedStateJson = JSON.stringify(persistedState);
    nextComparable = JSON.stringify(persistedState, (key, value) =>
      key === 'lastUpdated' ? undefined : value
    );
    if (options.brokerRules) {
      brokerRulesJson = JSON.stringify(options.brokerRules);
    }
  } catch (err) {
    console.error('Failed to serialize portfolio snapshot:', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  const writes: Array<{ key: string; value: string }> = [
    { key: STORAGE_KEY_STATE, value: persistedStateJson }
  ];
  if (typeof options.deviceActiveView === 'string') {
    writes.push({ key: 'portfolio_active_view', value: options.deviceActiveView });
  }
  if (brokerRulesJson !== null) {
    writes.push({ key: STORAGE_KEY_RULES, value: brokerRulesJson });
  }

  const previousValues = new Map<string, string | null>();
  try {
    for (const { key } of writes) {
      if (!previousValues.has(key)) previousValues.set(key, storage.getItem(key));
    }
  } catch (err) {
    console.error('Failed to inspect existing portfolio snapshot before saving:', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  let previousComparable = '';
  const previousRaw = previousValues.get(STORAGE_KEY_STATE);
  if (previousRaw) {
    try {
      const previous = JSON.parse(previousRaw);
      if (previous && typeof previous === 'object' && !Array.isArray(previous)) {
        const comparable = { ...previous };
        delete comparable.lastUpdated;
        delete comparable.gatewaySecret;
        previousComparable = JSON.stringify(comparable);
      }
    } catch {
      // Corrupt/legacy storage is repaired by this save and counts as a change.
    }
  }
  const stateChanged = previousComparable !== nextComparable;

  const attemptedKeys: string[] = [];
  try {
    for (const { key, value } of writes) {
      attemptedKeys.push(key);
      storage.setItem(key, value);
    }
  } catch (err) {
    // localStorage has no multi-key transaction. Restore all attempted compact
    // snapshot and preference keys if a later write fails.
    for (const key of attemptedKeys.reverse()) {
      try {
        const previous = previousValues.get(key) ?? null;
        if (previous === null) storage.removeItem(key);
        else storage.setItem(key, previous);
      } catch (rollbackError) {
        console.error(`Failed to restore local storage key "${key}" after an incomplete portfolio save:`, rollbackError);
      }
    }
    console.error('Failed to save portfolio snapshot; attempted local changes were rolled back:', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  state.lastUpdated = savedAt;
  return { success: true, stateChanged, savedAt };
}

/**
 * Persists large history in IndexedDB before committing the compact localStorage
 * snapshot. If the snapshot write fails, restore the prior history record.
 */
export async function savePortfolioSnapshot<TState extends object>(
  state: TState,
  history: ClosedHistorySnapshot,
  options: PortfolioSnapshotOptions = {}
): Promise<boolean> {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !history || !Array.isArray(history.brokerExecutedTrades) ||
      !Array.isArray(history.cashflows)) {
    return false;
  }
  await initializeSavedHistoryStorage();
  const previousHistory = loadSavedHistory();
  if (!(await persistSavedHistorySnapshot(history))) return false;

  const result = persistPortfolioSnapshot(state as Record<string, any>, options);
  if (!result.success) {
    const restored = await persistSavedHistorySnapshot(previousHistory);
    if (!restored) console.error('Failed to restore closed history after the portfolio snapshot could not be saved.');
    return false;
  }
  return true;
}

/**
 * Persists only the compact portfolio snapshot, leaving the separately cached
 * closed-history sidecar untouched. Use this when the complete history is
 * being durably checkpointed to its independent encrypted cloud-history store;
 * routine broker sync must not rewrite megabytes of local cache on every pass.
 */
export function savePortfolioStateSnapshot<TState extends object>(
  state: TState,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  return persistPortfolioSnapshot(state as Record<string, any>, options).success;
}

/**
 * Persists the compact portfolio snapshot synchronously to localStorage. Changed
 * history is queued separately in IndexedDB, so a large history write cannot
 * exhaust localStorage or roll back a valid portfolio-state commit.
 */
export function saveState<TState extends object>(
  state?: TState | null,
  onPushToGist?: (forcePrompt?: boolean) => void,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const mutableState = state as TState & Record<string, any>;

  const brokerExecutedTrades = Array.isArray(mutableState.brokerExecutedTrades) ? mutableState.brokerExecutedTrades : [];
  const cashflows = Array.isArray(mutableState.cashflows) ? mutableState.cashflows : [];
  const hasHistory = brokerExecutedTrades.length > 0 || cashflows.length > 0;
  const historyChanged = hasHistory && (
    !lastPersistedHistory ||
    lastPersistedHistory.brokerExecutedTrades !== brokerExecutedTrades ||
    lastPersistedHistory.cashflows !== cashflows
  ) && !(
    queuedHistorySnapshot &&
    queuedHistorySnapshot.brokerExecutedTrades === brokerExecutedTrades &&
    queuedHistorySnapshot.cashflows === cashflows
  );

  const result = persistPortfolioSnapshot(mutableState, options);
  if (!result.success) return false;

  if (historyChanged) {
    void persistSavedHistorySnapshot({ brokerExecutedTrades, cashflows }).then((saved) => {
      if (!saved) console.warn('Portfolio state was saved, but its local closed-history cache could not be updated. Cloud history remains separate.');
    }).catch((error) => {
      console.warn('Portfolio state was saved, but the local closed-history cache update failed:', error);
    });
  }

  if (result.stateChanged && typeof onPushToGist === 'function') {
    try {
      onPushToGist(false);
    } catch (err) {
      console.error('Failed to trigger Gist sync:', err);
    }
  }
  return true;
}
/**
 * Loads application state from localStorage, merging it with the supplied
 * fallback. This service is deliberately UI-agnostic: it never reads or mutates
 * DOM elements, so it can safely run before the application is mounted.
 */
export function loadSavedState<T extends Record<string, any>>(fallback: T): T {
  try {
    const storage = getBrowserStorage();
    if (!storage) return fallback;

    // Prefer the current schema, but do not let an empty or damaged current
    // entry hide a recoverable legacy snapshot.
    for (const key of [STORAGE_KEY_STATE, STORAGE_KEY_LEGACY_STATE]) {
      let raw: string | null;
      try {
        raw = storage.getItem(key);
      } catch (err) {
        console.warn('Storage unavailable; using in-memory portfolio state:', err);
        return fallback;
      }
      if (!raw || !raw.trim()) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        console.warn('Failed to parse saved state:', err);
        continue;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

      const persistedState = { ...(parsed as Record<string, unknown>) };
      // Credentials and independently persisted history are not part of the startup snapshot.
      delete persistedState.gatewaySecret;
      delete persistedState.brokerExecutedTrades;
      delete persistedState.cashflows;
      return { ...fallback, ...persistedState };
    }

    return fallback;
  } catch (err) {
    console.warn('Storage unavailable; using in-memory portfolio state:', err);
    return fallback;
  }
}

/** Persist closed-history rows in IndexedDB; use localStorage only for small legacy fallback data. */
export async function saveSavedHistory(history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] }): Promise<boolean> {
  return await persistSavedHistorySnapshot({
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  });
}

/** Synchronous cache accessor. The app hydrates this cache before mounting. */
export function loadSavedHistory(): ClosedHistorySnapshot {
  if (cachedHistory) return cachedHistory;
  const legacy = readLegacySavedHistorySnapshot();
  cachedHistory = legacy ?? { brokerExecutedTrades: [], cashflows: [] };
  lastPersistedHistory = legacy;
  return cachedHistory;
}

/** Wait until all queued local-history writes have settled. */
export async function flushSavedHistoryPersistence(): Promise<boolean> {
  return await historyWriteQueue;
}

/** Clear the IndexedDB history record and all legacy copies. */
export async function clearSavedHistoryPersistence(): Promise<void> {
  await historyWriteQueue.catch(() => false);
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openHistoryDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(HISTORY_OBJECT_STORE, 'readwrite');
          transaction.objectStore(HISTORY_OBJECT_STORE).delete(HISTORY_RECORD_KEY);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('Could not clear closed history'));
          transaction.onabort = () => reject(transaction.error || new Error('Closed-history clear was aborted'));
        });
      } finally {
        db.close();
      }
    } catch (error) {
      console.warn('Could not clear IndexedDB closed history:', error);
    }
  }
  try {
    getBrowserStorage()?.removeItem(STORAGE_KEY_CLOSED_HISTORY);
  } catch (error) {
    console.warn('Could not clear legacy closed history:', error);
  }
  cachedHistory = null;
  lastPersistedHistory = null;
  queuedHistorySnapshot = null;
  historyStorageInitialized = false;
  historyStorageInitialization = null;
  historyWriteQueue = Promise.resolve(true);
}

/**
 * Loads untrusted saved broker settings; missing or malformed JSON returns null.
 */
export function loadBrokerRules(): unknown {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY_RULES);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch (err) {
    console.warn('Failed to parse saved broker rules:', err);
    return null;
  }
}

/**
 * Saves normalized canonical broker assumptions to localStorage.
 */
export function saveBrokerRules(rules: BrokerAssumptions): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY_RULES, JSON.stringify(rules));
  } catch (err) {
    console.error('Failed to save broker rules:', err);
  }
}

/**
 * Clears saved broker rules from localStorage.
 */
export function clearBrokerRules(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY_RULES);
  } catch (err) {
    console.error('Failed to clear broker rules:', err);
  }
}

export type QuoteRefreshIntervalScope = 'admin' | 'guest';

/**
 * Gets the quote refresh interval for one account role. Guests have their own
 * preference so an administrator's saved polling interval cannot override the
 * guest's 15-second default on a shared browser.
 */
export function getQuoteRefreshInterval(
  fallback = DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  scope: QuoteRefreshIntervalScope = 'admin'
): number {
  const safeFallback = normalizeQuoteRefreshInterval(fallback, DEFAULT_ADMIN_REFRESH_INTERVAL_MS);
  const storage = getBrowserStorage();
  if (!storage) return safeFallback;
  try {
    const key = scope === 'guest' ? STORAGE_KEY_GUEST_REFRESH_INTERVAL : STORAGE_KEY_REFRESH_INTERVAL;
    const raw = storage.getItem(key);
    return raw === null || raw === undefined
      ? safeFallback
      : normalizeQuoteRefreshInterval(raw, safeFallback);
  } catch {
    return safeFallback;
  }
}

/** Saves a quote refresh preference separately for admins and guests. */
export function saveQuoteRefreshInterval(
  interval: number,
  scope: QuoteRefreshIntervalScope = 'admin'
): void {
  if (!isSupportedQuoteRefreshInterval(interval)) return;
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    const key = scope === 'guest' ? STORAGE_KEY_GUEST_REFRESH_INTERVAL : STORAGE_KEY_REFRESH_INTERVAL;
    storage.setItem(key, String(interval));
  } catch (err) {
    console.error('Failed to save quote refresh interval:', err);
  }
}

/**
 * Purges active and legacy state payloads from localStorage.
 */
export function clearLocalData(): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    removeStoredKeys(storage, [STORAGE_KEY_LEGACY_STATE, STORAGE_KEY_STATE]);
  } catch (err) {
    console.error('Failed to clear local data:', err);
  }
}
