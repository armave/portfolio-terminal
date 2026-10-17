const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
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
  if (typeof localStorage === 'undefined' || !localStorage) throw new Error('Local storage is unavailable');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
  if (!secret) {
    localStorage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED);
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
    localStorage.setItem(STORAGE_KEY_GW_AUTH_ENCRYPTED, payload);
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
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.removeItem(STORAGE_KEY_GW_AUTH);
      localStorage.removeItem('gateway_secret');
    }
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
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return inMemoryGatewaySecret;
    localStorage.removeItem(STORAGE_KEY_GW_AUTH);
    localStorage.removeItem('gateway_secret');
    if (inMemoryGatewaySecret) return inMemoryGatewaySecret;
    const raw = localStorage.getItem(STORAGE_KEY_GW_AUTH_ENCRYPTED);
    if (!raw) return '';
    if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');
    const payload = JSON.parse(raw) as { version?: number; iv?: number[]; data?: number[] };
    if (payload.version !== 1 || !Array.isArray(payload.iv) || !Array.isArray(payload.data)) {
      throw new Error('Encrypted Gateway Secret payload is invalid');
    }
    const db = await openSecureKeyDatabase();
    try {
      const key = await getOrCreateDeviceKey(db);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
        key,
        new Uint8Array(payload.data)
      );
      const secret = new TextDecoder().decode(decrypted);
      setGatewaySecret(secret);
      return secret;
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn('Could not restore encrypted Gateway Secret; asking for it again:', err);
    try { localStorage.removeItem(STORAGE_KEY_GW_AUTH_ENCRYPTED); } catch { /* storage unavailable */ }
    setGatewaySecret('');
    return '';
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

export const saveStateToStorage = saveState;

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
  if (typeof localStorage === 'undefined' || !localStorage) {
    return false;
  }

  try {
    state.lastUpdated = Date.now();
    const persistedState = { ...state };
    delete persistedState.gatewaySecret;
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(persistedState));
  } catch (err) {
    console.error('Failed to save state:', err);
    return false;
  }

  if (typeof onPushToGist === 'function') {
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
    if (typeof localStorage === 'undefined' || !localStorage) return fallback;

    const raw = localStorage.getItem(STORAGE_KEY_STATE)
      ?? localStorage.getItem(STORAGE_KEY_LEGACY_STATE);
    if (!raw || !raw.trim()) return fallback;

    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (() => { const persistedState = { ...parsed }; delete persistedState.gatewaySecret; return { ...fallback, ...persistedState }; })()
        : fallback;
    } catch (err) {
      console.warn('Failed to parse saved state:', err);
      return fallback;
    }
  } catch (err) {
    console.warn('Storage unavailable; using in-memory portfolio state:', err);
    return fallback;
  }
}

/**
 * Loads broker rules with fallback on corrupted JSON or missing data.
 */
export function loadBrokerRules<T = unknown>(defaultRules: T): T {
  if (typeof localStorage === 'undefined' || !localStorage) {
    return defaultRules;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RULES);
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
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY_RULES, JSON.stringify(rules));
  } catch (err) {
    console.error('Failed to save broker rules:', err);
  }
}

/**
 * Clears saved broker rules from localStorage.
 */
export function clearBrokerRules(): void {
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.removeItem(STORAGE_KEY_RULES);
  } catch (err) {
    console.error('Failed to clear broker rules:', err);
  }
}

/**
 * Gets quote refresh interval with fallback.
 */
export function getQuoteRefreshInterval(fallback = 60000): number {
  if (typeof localStorage === 'undefined' || !localStorage) {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REFRESH_INTERVAL);
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
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY_REFRESH_INTERVAL, String(interval));
  } catch (err) {
    console.error('Failed to save quote refresh interval:', err);
  }
}

/**
 * Purges active and legacy state payloads from localStorage.
 */
export function clearLocalData(): void {
  if (typeof localStorage === 'undefined' || !localStorage) return;
  try {
    localStorage.removeItem(STORAGE_KEY_LEGACY_STATE);
    localStorage.removeItem(STORAGE_KEY_STATE);
  } catch (err) {
    console.error('Failed to clear local data:', err);
  }
}