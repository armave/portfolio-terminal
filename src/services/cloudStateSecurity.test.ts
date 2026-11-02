import CryptoJS from 'crypto-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudStateSecurity } from './cloudStateSecurity';

const WORKER_PROXY_URL = 'https://worker.example.test';

function createSecurity(fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch) {
  const getStoredGatewaySecret = vi.fn(() => '');
  const security = createCloudStateSecurity({
    workerProxyUrl: WORKER_PROXY_URL,
    getStoredGatewaySecret,
    fetchImpl
  });
  return { security, getStoredGatewaySecret };
}

describe('cloud state security runtime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('encrypts and decrypts AES-GCM payloads using the session token for legacy installations', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const { security } = createSecurity(fetchImpl);
    const plaintext = JSON.stringify({ balance: 1250, activeView: 'AAPL' });

    const payload = await security.encryptCloudPayload(plaintext, 'gateway-secret');
    expect(payload).toMatch(/^aesgcm:v2:/);
    await expect(security.decryptCloudPayload(payload, 'gateway-secret')).resolves.toEqual({
      plaintext,
      legacy: false
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the server-owned shared key and caches it until the session cache is cleared', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: 'shared-workspace-key' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const { security } = createSecurity(fetchImpl);
    security.setSecretGetter(() => 'stored-session-secret');

    const payload = await security.encryptCloudPayload('one', 'session-token');
    await expect(security.decryptCloudPayload(payload, 'session-token')).resolves.toEqual({
      plaintext: 'one',
      legacy: false
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('/api/auth/cloud-key', WORKER_PROXY_URL),
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-App-Auth': 'session-token',
          Authorization: 'Bearer session-token'
        },
        cache: 'no-store'
      })
    );

    security.clearCloudEncryptionSecretCache();
    await security.encryptCloudPayload('two', 'session-token');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries shared-key retrieval after a failed request', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporary failure' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ key: 'recovered-key' }), { status: 200 })) as unknown as typeof fetch;
    const { security } = createSecurity(fetchImpl);
    security.setSecretGetter(() => 'configured');

    await expect(security.encryptCloudPayload('value', 'session-token'))
      .rejects.toThrow('temporary failure');
    await expect(security.encryptCloudPayload('value', 'session-token')).resolves.toMatch(/^aesgcm:v2:/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retains compatibility with legacy CryptoJS cloud ciphertext', async () => {
    const { security } = createSecurity();
    const plaintext = JSON.stringify({ balance: 900, activeView: 'BALANCE' });
    const legacyPayload = CryptoJS.AES.encrypt(plaintext, 'legacy-session-secret').toString();

    await expect(security.decryptCloudPayload(legacyPayload, 'legacy-session-secret')).resolves.toEqual({
      plaintext,
      legacy: true
    });
  });

  it('rejects modified AES-GCM ciphertext and malformed envelopes', async () => {
    const { security } = createSecurity();
    const payload = await security.encryptCloudPayload('tamper-check', 'gateway-secret');
    const [, prefix, nonce, ciphertext] = payload.match(/^(aesgcm:v2:)([^:]+):(.+)$/) || [];
    expect(prefix).toBe('aesgcm:v2:');
    const altered = ciphertext.slice(0, -4) + (ciphertext.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    await expect(security.decryptCloudPayload(prefix + nonce + ':' + altered, 'gateway-secret')).rejects.toThrow();
    await expect(security.decryptCloudPayload('aesgcm:v2:bad-envelope', 'gateway-secret'))
      .rejects.toThrow('Invalid AES-GCM cloud payload envelope.');
  });

  it('prefers the dedicated credential store and safely falls back to the configured getter', () => {
    const { security, getStoredGatewaySecret } = createSecurity();
    security.setSecretGetter(() => 'fallback-secret');
    expect(security.getActiveGatewaySecret()).toBe('fallback-secret');

    getStoredGatewaySecret.mockReturnValue('stored-secret');
    expect(security.getActiveGatewaySecret()).toBe('stored-secret');

    getStoredGatewaySecret.mockReturnValue('');
    security.setSecretGetter(() => { throw new Error('getter unavailable'); });
    expect(security.getActiveGatewaySecret()).toBe('');
  });
});
