export interface CloudStateSecurityDependencies {
  workerProxyUrl: string;
  getStoredGatewaySecret: () => string;
  fetchImpl?: typeof fetch;
}

export interface CloudStateSecurity {
  setSecretGetter: (getter: () => string) => void;
  clearCloudEncryptionSecretCache: () => void;
  getActiveGatewaySecret: () => string;
  encryptCloudPayload: (plaintext: string, sessionToken: string) => Promise<string>;
  decryptCloudPayload: (payload: string, sessionToken: string) => Promise<{ plaintext: string; legacy: boolean }>;
}

const CLOUD_CIPHERTEXT_V2_PREFIX = 'aesgcm:v2:';

/**
 * Owns cloud-state encryption, legacy CryptoJS compatibility, and the
 * administrator workspace-key cache. It deliberately does not own cloud
 * revision coordination or portfolio persistence.
 */
export function createCloudStateSecurity(
  dependencies: CloudStateSecurityDependencies
): CloudStateSecurity {
  const fetchImpl = dependencies.fetchImpl ?? ((input, init) => fetch(input, init));
  let activeSecretGetter: (() => string) | null = null;
  let cloudEncryptionSecretPromise: Promise<string> | null = null;

  const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };

  const base64ToBytes = (value: string): Uint8Array => {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  };

  const deriveCloudEncryptionKey = async (secret: string): Promise<CryptoKey> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Secure cloud encryption is unavailable in this browser.');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  };

  const resolveCloudEncryptionSecret = async (sessionToken: string): Promise<string> => {
    // Older installations derive the workspace key directly from the Gateway Secret.
    // Once the app installs a getter, the server-owned shared key is authoritative.
    if (!activeSecretGetter) return sessionToken;
    if (!cloudEncryptionSecretPromise) {
      cloudEncryptionSecretPromise = (async () => {
        const response = await fetchImpl(new URL('/api/auth/cloud-key', dependencies.workerProxyUrl), {
          method: 'GET',
          headers: {
            'X-App-Auth': sessionToken,
            Authorization: `Bearer ${sessionToken}`
          },
          cache: 'no-store'
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || typeof payload?.key !== 'string' || !payload.key) {
          throw new Error(payload?.error || 'Could not retrieve the shared cloud encryption key.');
        }
        return payload.key;
      })().catch((error) => {
        cloudEncryptionSecretPromise = null;
        throw error;
      });
    }
    return cloudEncryptionSecretPromise;
  };

  const getActiveGatewaySecret = (): string => {
    // Credentials are managed only by the dedicated secret store/input. Portfolio
    // state may come from an imported backup or cloud payload and is never trusted.
    const stored = dependencies.getStoredGatewaySecret();
    if (stored) return stored;
    try {
      const supplied = activeSecretGetter?.();
      return typeof supplied === 'string' ? supplied.trim() : '';
    } catch {
      return '';
    }
  };

  const encryptCloudPayload = async (plaintext: string, sessionToken: string): Promise<string> => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Secure cloud encryption is unavailable in this browser.');
    const encryptionSecret = await resolveCloudEncryptionSecret(sessionToken);
    const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveCloudEncryptionKey(encryptionSecret);
    const ciphertext = await subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      key,
      new TextEncoder().encode(plaintext)
    );
    return CLOUD_CIPHERTEXT_V2_PREFIX + bytesToBase64(nonce) + ':' + bytesToBase64(new Uint8Array(ciphertext));
  };

  const decryptCloudPayload = async (
    payload: string,
    sessionToken: string
  ): Promise<{ plaintext: string; legacy: boolean }> => {
    const encryptionSecret = await resolveCloudEncryptionSecret(sessionToken);
    if (!payload.startsWith(CLOUD_CIPHERTEXT_V2_PREFIX)) {
      const { default: CryptoJS } = await import('crypto-js');
      const bytes = CryptoJS.AES.decrypt(payload, encryptionSecret);
      const plaintext = bytes ? bytes.toString(CryptoJS.enc.Utf8) : '';
      if (!plaintext) throw new Error('Legacy decryption failed — verify the Gateway Secret.');
      return { plaintext, legacy: true };
    }

    const encoded = payload.slice(CLOUD_CIPHERTEXT_V2_PREFIX.length);
    const separator = encoded.indexOf(':');
    if (separator <= 0 || separator === encoded.length - 1) {
      throw new Error('Invalid AES-GCM cloud payload envelope.');
    }
    const nonce = base64ToBytes(encoded.slice(0, separator));
    const ciphertext = base64ToBytes(encoded.slice(separator + 1));
    if (nonce.byteLength !== 12 || ciphertext.byteLength < 16) {
      throw new Error('Invalid AES-GCM cloud payload envelope.');
    }
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Secure cloud decryption is unavailable in this browser.');
    const key = await deriveCloudEncryptionKey(encryptionSecret);
    // Copy to standalone ArrayBuffers to satisfy strict DOM BufferSource typing.
    const iv = nonce.slice().buffer as ArrayBuffer;
    const encryptedBytes = ciphertext.slice().buffer as ArrayBuffer;
    const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, encryptedBytes);
    return { plaintext: new TextDecoder().decode(plaintext), legacy: false };
  };

  return {
    setSecretGetter: (getter) => { activeSecretGetter = getter; },
    clearCloudEncryptionSecretCache: () => { cloudEncryptionSecretPromise = null; },
    getActiveGatewaySecret,
    encryptCloudPayload,
    decryptCloudPayload
  };
}
