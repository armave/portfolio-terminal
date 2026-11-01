import type { BrokerAssumptions } from '../types/portfolio';

const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_CLOSED_HISTORY = 'portfolio_closed_history_v1';
let lastPersistedHistory: ClosedHistorySnapshot | null = null;

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
}

/** Returns browser storage only when it is available to the current runtime. */
function getBrowserStorage(): Storage | null {
  return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
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
  history: ClosedHistorySnapshot | null,
  options: PortfolioSnapshotOptions = {}
): PortfolioSnapshotPersistResult {
  const storage = getBrowserStorage();
  if (!storage) return { success: false, stateChanged: false, savedAt: null };

  const savedAt = Date.now();
  let persistedStateJson: string;
  let historyJson: string | null = null;
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
    if (history) {
      historyJson = JSON.stringify({
        brokerExecutedTrades: history.brokerExecutedTrades,
        cashflows: history.cashflows
      });
    }
  } catch (err) {
    console.error('Failed to serialize portfolio snapshot:', err);
    return { success: false, stateChanged: false, savedAt: null };
  }

  const writes: Array<{ key: string; value: string }> = [
    { key: STORAGE_KEY_STATE, value: persistedStateJson }
  ];
  if (historyJson !== null) {
    writes.push({ key: STORAGE_KEY_CLOSED_HISTORY, value: historyJson });
  }
  if (typeof options.deviceActiveView === 'string') {
    writes.push({ key: 'portfolio_active_view', value: options.deviceActiveView });
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
    // localStorage has no multi-key transaction. Restore all attempted keys in
    // reverse order so a failed history/preference write cannot leave the new
    // portfolio state looking like a fully committed snapshot.
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
  if (history) lastPersistedHistory = history;
  return { success: true, stateChanged, savedAt };
}

/**
 * Persists the portfolio and its closed-history snapshot together. This is
 * used for destructive operations such as a full reset where empty history is
 * meaningful and must not be treated as an ordinary no-op.
 */
export function savePortfolioSnapshot<TState extends object>(
  state: TState,
  history: ClosedHistorySnapshot,
  options: PortfolioSnapshotOptions = {}
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state) ||
      !history || !Array.isArray(history.brokerExecutedTrades) ||
      !Array.isArray(history.cashflows)) {
    return false;
  }
  return persistPortfolioSnapshot(state as Record<string, any>, history, options).success;
}

/**
 * Persists application state to localStorage and updates `state.lastUpdated`.
 * Changed non-empty history is committed before the method reports success;
 * a failed sidecar write rolls back the accompanying portfolio-state write.
 */
export function saveState<TState extends object>(
  state?: TState | null,
  onPushToGist?: (forcePrompt?: boolean) => void
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
  );

  const result = persistPortfolioSnapshot(
    mutableState,
    historyChanged ? { brokerExecutedTrades, cashflows } : null
  );
  if (!result.success) return false;

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

/** Load large closed-history collections only when the history section needs them. */
/** Persist closed-history source rows and calculated fee metadata independently of portfolio state. */
export function saveSavedHistory(history: { brokerExecutedTrades?: unknown[]; cashflows?: unknown[] }): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;
  const snapshot = {
    brokerExecutedTrades: Array.isArray(history.brokerExecutedTrades) ? history.brokerExecutedTrades : [],
    cashflows: Array.isArray(history.cashflows) ? history.cashflows : []
  };
  try {
    storage.setItem(STORAGE_KEY_CLOSED_HISTORY, JSON.stringify(snapshot));
    lastPersistedHistory = snapshot;
    return true;
  } catch (err) {
    console.error('Failed to save closed history:', err);
    return false;
  }
}

export function loadSavedHistory(): ClosedHistorySnapshot {
  const storage = getBrowserStorage();
  if (!storage) return { brokerExecutedTrades: [], cashflows: [] };

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY_CLOSED_HISTORY);
  } catch (err) {
    console.warn('Failed to read saved closed history:', err);
    return { brokerExecutedTrades: [], cashflows: [] };
  }

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Saved closed history must be an object.');
      }
      const history = {
        brokerExecutedTrades: Array.isArray(parsed.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
        cashflows: Array.isArray(parsed.cashflows) ? parsed.cashflows : []
      };
      lastPersistedHistory = history;
      return history;
    } catch (err) {
      // Keep the damaged record intact. A legacy snapshot may still provide a
      // recoverable copy, and overwriting this entry would destroy evidence.
      console.warn('Failed to parse saved closed history:', err);
    }
  }

  // Recover older snapshots that stored history inline. Persist the migration
  // only when the separate record is absent; never overwrite a damaged record.
  for (const key of [STORAGE_KEY_STATE, STORAGE_KEY_LEGACY_STATE]) {
    try {
      const legacyRaw = storage.getItem(key);
      if (!legacyRaw) continue;
      const legacy = JSON.parse(legacyRaw);
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy) &&
          (Array.isArray(legacy.brokerExecutedTrades) || Array.isArray(legacy.cashflows))) {
        const migrated = {
          brokerExecutedTrades: Array.isArray(legacy.brokerExecutedTrades) ? legacy.brokerExecutedTrades : [],
          cashflows: Array.isArray(legacy.cashflows) ? legacy.cashflows : []
        };
        if (!raw) {
          try {
            storage.setItem(STORAGE_KEY_CLOSED_HISTORY, JSON.stringify(migrated));
          } catch (err) {
            console.warn('Could not persist recovered closed history:', err);
          }
        }
        lastPersistedHistory = migrated;
        return migrated;
      }
    } catch {
      // Continue to the next legacy snapshot if one is malformed.
    }
  }

  return { brokerExecutedTrades: [], cashflows: [] };
}

/**
 * Loads broker rules with fallback on corrupted JSON or missing data.
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
 * Saves broker rules configuration to localStorage.
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
  fallback = 60000,
  scope: QuoteRefreshIntervalScope = 'admin'
): number {
  const storage = getBrowserStorage();
  if (!storage) return fallback;
  try {
    const key = scope === 'guest' ? STORAGE_KEY_GUEST_REFRESH_INTERVAL : STORAGE_KEY_REFRESH_INTERVAL;
    const raw = storage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
  } catch {
    return fallback;
  }
}

/** Saves a quote refresh preference separately for admins and guests. */
export function saveQuoteRefreshInterval(
  interval: number,
  scope: QuoteRefreshIntervalScope = 'admin'
): void {
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
