const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_CLOSED_HISTORY = 'portfolio_closed_history_v1';
let lastPersistedHistory: { brokerExecutedTrades: any[]; cashflows: any[] } | null = null;
const STORAGE_KEY_LEGACY_STATE = 'portfolio_state';
const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_GW_AUTH_ENCRYPTED = 'gateway_secret_encrypted_v1';
const GW_KEY_DB = 'portfolio-terminal-secure-storage';
const GW_KEY_STORE = 'keys';
const GW_KEY_ID = 'gateway-secret-aes-key';
let pendingSecretPersistence: Promise<boolean> = Promise.resolve(true);
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';

let inMemoryGatewaySecret = '';

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

/**
 * Persists application state to localStorage and updates `state.lastUpdated`.
 */
export function saveState(
  state?: Record<string, any> | null,
  onPushToGist?: (forcePrompt?: boolean) => void
): boolean {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return false;
  }
  const storage = getBrowserStorage();
  if (!storage) return false;

  // Keep large history in a separate localStorage entry. Avoid serializing it
  // during unrelated quote/portfolio updates.
  const brokerExecutedTrades = Array.isArray(state.brokerExecutedTrades) ? state.brokerExecutedTrades : [];
  const cashflows = Array.isArray(state.cashflows) ? state.cashflows : [];
  if (brokerExecutedTrades.length || cashflows.length) {
    if (!lastPersistedHistory ||
        lastPersistedHistory.brokerExecutedTrades !== brokerExecutedTrades ||
        lastPersistedHistory.cashflows !== cashflows) {
      try {
        storage.setItem(STORAGE_KEY_CLOSED_HISTORY, JSON.stringify({ brokerExecutedTrades, cashflows }));
        lastPersistedHistory = { brokerExecutedTrades, cashflows };
      } catch (err) {
        console.error('Failed to save closed history:', err);
      }
    }
  }

  let stateChanged = true;
  try {
    const previousRaw = storage.getItem(STORAGE_KEY_STATE);
    let previousComparable = '';
    if (previousRaw) {
      try {
        const previous = JSON.parse(previousRaw);
        delete previous.lastUpdated;
        delete previous.gatewaySecret;
        previousComparable = JSON.stringify(previous);
      } catch {
        // Corrupt/legacy storage should be repaired and synced by this save.
      }
    }

    state.lastUpdated = Date.now();
    const persistedState = { ...state };
    delete persistedState.gatewaySecret;
    delete persistedState.brokerExecutedTrades;
    delete persistedState.cashflows;
    const nextComparable = JSON.stringify(persistedState, (key, value) =>
      key === 'lastUpdated' ? undefined : value
    );
    stateChanged = previousComparable !== nextComparable;
    storage.setItem(STORAGE_KEY_STATE, JSON.stringify(persistedState));
  } catch (err) {
    console.error('Failed to save state:', err);
    return false;
  }

  // Opening a section or re-saving an identical state must not trigger a full
  // cloud write. Sync only when persisted portfolio data actually changed.
  if (stateChanged && typeof onPushToGist === 'function') {
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
export function loadSavedHistory(): { brokerExecutedTrades: any[]; cashflows: any[] } {
  const storage = getBrowserStorage();
  if (!storage) return { brokerExecutedTrades: [], cashflows: [] };
  try {
    let raw = storage.getItem(STORAGE_KEY_CLOSED_HISTORY);
    // One-time migration from older snapshots that stored history inline.
    if (!raw) {
      for (const key of [STORAGE_KEY_STATE, STORAGE_KEY_LEGACY_STATE]) {
        try {
          const legacyRaw = storage.getItem(key);
          if (!legacyRaw) continue;
          const legacy = JSON.parse(legacyRaw);
          if (Array.isArray(legacy?.brokerExecutedTrades) || Array.isArray(legacy?.cashflows)) {
            const migrated = {
              brokerExecutedTrades: Array.isArray(legacy.brokerExecutedTrades) ? legacy.brokerExecutedTrades : [],
              cashflows: Array.isArray(legacy.cashflows) ? legacy.cashflows : []
            };
            raw = JSON.stringify(migrated);
            storage.setItem(STORAGE_KEY_CLOSED_HISTORY, raw);
            break;
          }
        } catch {
          // Continue to the next legacy snapshot if one is malformed.
        }
      }
    }
    if (!raw) return { brokerExecutedTrades: [], cashflows: [] };
    const parsed = JSON.parse(raw);
    const history = {
      brokerExecutedTrades: Array.isArray(parsed?.brokerExecutedTrades) ? parsed.brokerExecutedTrades : [],
      cashflows: Array.isArray(parsed?.cashflows) ? parsed.cashflows : []
    };
    lastPersistedHistory = history;
    return history;
  } catch (err) {
    console.warn('Failed to parse saved closed history:', err);
    return { brokerExecutedTrades: [], cashflows: [] };
  }
}

/**
 * Loads broker rules with fallback on corrupted JSON or missing data.
 */
export function loadBrokerRules<T = unknown>(defaultRules: T): T {
  const storage = getBrowserStorage();
  if (!storage) return defaultRules;
  try {
    const raw = storage.getItem(STORAGE_KEY_RULES);
    if (!raw) return defaultRules;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : defaultRules;
  } catch (err) {
    console.warn('Failed to parse saved broker rules:', err);
    return defaultRules;
  }
}

/**
 * Saves broker rules configuration to localStorage.
 */
export function saveBrokerRules(rules: unknown): void {
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

/**
 * Gets quote refresh interval with fallback.
 */
export function getQuoteRefreshInterval(fallback = 60000): number {
  const storage = getBrowserStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(STORAGE_KEY_REFRESH_INTERVAL);
    if (raw === null || raw === undefined) return fallback;
    const num = Number(raw);
    return Number.isFinite(num) ? num : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Saves quote refresh interval in milliseconds.
 */
export function saveQuoteRefreshInterval(interval: number): void {
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY_REFRESH_INTERVAL, String(interval));
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
