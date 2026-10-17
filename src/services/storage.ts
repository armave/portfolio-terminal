const STORAGE_KEY_STATE = 'margin_portfolio_state_dynamic_v2';
const STORAGE_KEY_LEGACY_STATE = 'portfolio_state';
const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_RULES = 'tradernet_rules_v1';
const STORAGE_KEY_REFRESH_INTERVAL = 'quote_refresh_interval';
const SECRET_KEY_DB = 'portfolio-terminal-secure-storage';
const SECRET_KEY_STORE = 'keys';
const SECRET_KEY_ID = 'gateway-secret-key';
const SECRET_CIPHER_PREFIX = 'aesgcm:v1:';

let inMemoryGatewaySecret = '';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function openSecretKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('secure browser storage is unavailable.'));
      return;
    }
    const request = indexedDB.open(SECRET_KEY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SECRET_KEY_STORE)) db.createObjectStore(SECRET_KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open secure storage.'));
  });
}

async function getOrCreateSecretKey(): Promise<CryptoKey> {
  const db = await openSecretKeyDatabase();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = db.transaction(SECRET_KEY_STORE, 'readonly').objectStore(SECRET_KEY_STORE).get(SECRET_KEY_ID);
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
      request.onerror = () => reject(request.error);
    });
    if (existing) return existing;

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SECRET_KEY_STORE, 'readwrite');
      tx.objectStore(SECRET_KEY_STORE).put(key, SECRET_KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not persist secure key.'));
      tx.onabort = () => reject(tx.error ?? new Error('Secure key storage was aborted.'));
    });
    return key;
  } finally {
    db.close();
  }
}

async function encryptSecret(secret: string): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof btoa !== 'function') {
    throw new Error('This browser does not support encrypted secret storage. Use a secure HTTPS app URL.');
  }
  const key = await getOrCreateSecretKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(secret);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return SECRET_CIPHER_PREFIX + bytesToBase64(new Uint8Array([...iv, ...new Uint8Array(ciphertext)]));
}

async function decryptSecret(value: string): Promise<string> {
  if (!value.startsWith(SECRET_CIPHER_PREFIX)) return '';
  const packed = base64ToBytes(value.slice(SECRET_CIPHER_PREFIX.length));
  if (packed.length <= 12) return '';
  const key = await getOrCreateSecretKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: packed.slice(0, 12) },
    key,
    packed.slice(12)
  );
  return new TextDecoder().decode(plaintext);
}

export function obfuscateSecret(_plain: string): string {
  // Reversible encoding is intentionally not used for secret persistence.
  return '';
}

export function deobfuscateSecret(_encoded: string): string {
  return '';
}

export function getGatewaySecret(): string {
  return inMemoryGatewaySecret;
}

export function setGatewaySecret(secret: string): void {
  inMemoryGatewaySecret = secret ? String(secret) : '';
}

export function areHeaderCredentialsConfigured(): boolean {
  return Boolean(inMemoryGatewaySecret && inMemoryGatewaySecret.trim().length > 0);
}

/** Encrypts the submitted secret with AES-GCM and stores its non-extractable key in IndexedDB. */
export async function saveGatewaySecret(secret: string): Promise<void> {
  const trimmed = typeof secret === 'string' ? secret.trim() : '';
  setGatewaySecret(trimmed);
  try {
    if (!trimmed) {
      localStorage.removeItem(STORAGE_KEY_GW_AUTH);
      localStorage.removeItem('gateway_secret');
      return;
    }
    const encrypted = await encryptSecret(trimmed);
    localStorage.setItem(STORAGE_KEY_GW_AUTH, encrypted);
    localStorage.removeItem('gateway_secret');
  } catch (err) {
    setGatewaySecret('');
    throw new Error(err instanceof Error ? err.message : 'Could not securely save Gateway Secret.');
  }
}

/** Loads an encrypted secret automatically; plaintext and reversible legacy encodings are rejected. */
export async function loadGatewaySecret(): Promise<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_GW_AUTH);
    if (raw?.startsWith(SECRET_CIPHER_PREFIX)) {
      const recovered = await decryptSecret(raw);
      if (recovered) {
        setGatewaySecret(recovered.trim());
        return inMemoryGatewaySecret;
      }
    }
    // Remove insecure legacy values instead of silently continuing to store credentials in plaintext.
    localStorage.removeItem(STORAGE_KEY_GW_AUTH);
    localStorage.removeItem('gateway_secret');
  } catch (err) {
    console.warn('Could not load encrypted Gateway Secret:', err);
  }
  setGatewaySecret('');
  return '';
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
  try {
    await saveGatewaySecret(cleanSecret);
  } catch (err) {
    if (typeof showToast === 'function') showToast(err instanceof Error ? err.message : 'Could not securely save Gateway Secret.', 'error');
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
    const stateToPersist = { ...state };
    delete stateToPersist.gatewaySecret;
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(stateToPersist));
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
        ? (() => {
          const merged = { ...fallback, ...parsed };
          delete merged.gatewaySecret;
          return merged;
        })()
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