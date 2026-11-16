const STORAGE_KEY_GW_AUTH = '_gw_auth';
const STORAGE_KEY_GW_AUTH_ENCRYPTED = 'gateway_secret_encrypted_v1';
const GW_KEY_DB = 'portfolio-terminal-secure-storage';
const GW_KEY_STORE = 'keys';
const GW_KEY_ID = 'gateway-secret-aes-key';
const INDEXED_DB_OPERATION_TIMEOUT_MS = 2_000;

let pendingSecretPersistence: Promise<boolean> = Promise.resolve(true);
let inMemoryGatewaySecret = '';

function getBrowserStorage(): Storage | null {
  return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
}

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
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Opening secure device-key storage timed out.'));
    }, INDEXED_DB_OPERATION_TIMEOUT_MS);
    const rejectRequest = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(GW_KEY_STORE)) {
        request.result.createObjectStore(GW_KEY_STORE);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => rejectRequest(request.error || new Error('Could not open secure key storage'));
    request.onblocked = () => rejectRequest(new Error('Secure device-key storage upgrade is blocked by another tab.'));
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase, createIfMissing = true): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
    const transaction = db.transaction(GW_KEY_STORE, 'readonly');
    const request = transaction.objectStore(GW_KEY_STORE).get(GW_KEY_ID);
    let key: CryptoKey | undefined;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Reading the secure device key timed out.'));
      try {
        transaction.abort();
      } catch {
        // The transaction may already be inactive.
      }
    }, INDEXED_DB_OPERATION_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(key);
    };

    request.onsuccess = () => { key = request.result as CryptoKey | undefined; };
    request.onerror = () => finish(request.error || new Error('Could not read the secure device key'));
    transaction.oncomplete = () => finish();
    transaction.onerror = () => finish(transaction.error || new Error('Secure device-key read failed'));
    transaction.onabort = () => finish(transaction.error || new Error('Secure device-key read was aborted'));
  });
  if (existing) return existing;
  // A restore must not mint a replacement key: doing so would guarantee that
  // existing ciphertext cannot decrypt and could destroy a recoverable device key.
  if (!createIfMissing) throw new Error('The existing device encryption key is unavailable.');
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto is unavailable');

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(GW_KEY_STORE, 'readwrite');
    tx.objectStore(GW_KEY_STORE).put(key, GW_KEY_ID);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Writing the secure device key timed out.'));
      try {
        tx.abort();
      } catch {
        // The transaction may already be inactive.
      }
    }, INDEXED_DB_OPERATION_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    tx.oncomplete = () => finish();
    tx.onerror = () => finish(tx.error || new Error('Secure key storage transaction failed'));
    tx.onabort = () => finish(tx.error || new Error('Secure key storage transaction aborted'));
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
    // Preserve the original ciphertext for inspection/recovery. A newly entered
    // credential will replace it after secure device storage is available.
    console.warn('Encrypted Gateway Secret payload is invalid; preserving the device copy:', err);
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
    key = await getOrCreateDeviceKey(db, false);
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
    // A missing/replaced IndexedDB key can be temporary or recoverable in a
    // restored browser profile. Preserve ciphertext instead of destroying the
    // only remaining device copy; the normal sign-in flow remains available.
    console.warn('Could not decrypt encrypted Gateway Secret; preserving ciphertext for a later retry:', err);
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

interface SaveApiKeysOptions {
  secret?: string;
  showToast?: (message: string, type?: string) => void;
  logAppMessage?: (message: string) => void;
  [key: string]: unknown;
}

/**
 * Validates, saves, and confirms Gateway credentials.
 */
export async function saveApiKeys(options: SaveApiKeysOptions): Promise<boolean> {
  const { secret, showToast, logAppMessage } = options || {};
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
    if (typeof logAppMessage === 'function') logAppMessage(message);
    if (typeof showToast === 'function') showToast(message, 'error');
    return false;
  }

  if (typeof logAppMessage === 'function') {
    logAppMessage('Gateway Secret saved. Remote access has not been verified yet.');
  }
  if (typeof showToast === 'function') {
    showToast('Gateway Secret saved. Remote access has not been verified yet.', 'success');
  }
  return true;
}

