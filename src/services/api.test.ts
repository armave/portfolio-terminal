import { afterEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import { pullCloudState, pushCloudState, syncCloudState, proxyFetch } from './api';
import * as storage from './storage';

describe('cloud state sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never trusts a Gateway Secret embedded in portfolio state', async () => {
    storage.setGatewaySecret('trusted-stored-secret');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ ETag: '"1"' })
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const result = await pushCloudState({
        activeView: 'AAPL',
        balance: 1250,
        gatewaySecret: 'untrusted-state-secret'
      }, { showToast: vi.fn() });

      expect(result).toBe(true);
      expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
        'X-App-Auth': 'trusted-stored-secret',
        Authorization: 'Bearer trusted-stored-secret'
      });
    } finally {
      storage.setGatewaySecret('');
    }
  });

  it('does not mutate the live state when excluding local-only fields from cloud backup', async () => {
    const state = {
      activeView: 'AAPL',
      balance: 1250,
      gatewaySecret: 'local-only-secret',
      marginBalance: 500
    };
    const originalState = { ...state };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushCloudState(state, {
      secret: 'cloud-encryption-secret',
      showToast: vi.fn()
    });

    expect(result).toBe(true);
    expect(state).toEqual(originalState);
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ 'If-Match': '"0"' });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    const decrypted = CryptoJS.AES.decrypt(
      payload.encryptedPayload,
      'cloud-encryption-secret'
    ).toString(CryptoJS.enc.Utf8);
    expect(JSON.parse(decrypted)).toEqual({
      activeView: 'AAPL',
      balance: 1250
    });
  });
  it('returns false when a failed cloud pull falls back to a truthy local state', async () => {
    const localState = { activeView: 'AAPL', balance: 1250 };
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await syncCloudState('pull', {
      state: localState,
      secret: 'cloud-encryption-secret',
      showToast: vi.fn(),
      logTerminal: vi.fn()
    });

    expect(result).toBe(false);
  });
});


describe('cloud revision conflict handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a conflict instead of silently overwriting a newer cloud state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: new Headers({ ETag: '"7"' }),
      json: async () => ({ error: 'Cloud portfolio changed since this device last synced.' })
    });
    vi.stubGlobal('fetch', fetchMock);
    const showToast = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await pushCloudState({ activeView: 'AAPL', balance: 1250 }, {
      secret: 'cloud-encryption-secret',
      showToast
    });

    expect(result).toBe(false);
    expect(showToast).toHaveBeenCalledWith(
      'Cloud push failed: Cloud portfolio changed since this device last synced.',
      'error'
    );
  });
});


describe('cloud pull persistence failures', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not report success or rewrite the UI when local persistence fails', async () => {
    const secret = 'cloud-encryption-secret';
    const encryptedPayload = CryptoJS.AES.encrypt(
      JSON.stringify({ activeView: 'AAPL', balance: 1250, lastRolloverTimestamp: Date.now() }),
      secret
    ).toString();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"4"' }),
      json: async () => ({ encryptedPayload })
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(storage, 'saveState').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rewriteLocal = vi.fn();
    const showToast = vi.fn();
    const reportResult = vi.fn();

    await pullCloudState({
      state: { activeView: 'MSFT', balance: 1000 },
      secret,
      pullCloudAndRewriteLocal: rewriteLocal,
      showToast,
      logTerminal: vi.fn()
    }, reportResult);

    expect(reportResult).toHaveBeenCalledWith(false);
    expect(rewriteLocal).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('could not be saved to this device'),
      'error'
    );
  });
});


describe('Gateway Secret validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts valid credentials when cloud state exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    await expect((await import('./api')).validateGatewaySecret('valid-secret')).resolves.toBe(true);
  });

  it('accepts valid credentials when no cloud portfolio exists yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect((await import('./api')).validateGatewaySecret('valid-secret')).resolves.toBe(true);
  });

  it('rejects invalid credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect((await import('./api')).validateGatewaySecret('wrong-secret')).resolves.toBe(false);
  });

  it('fails safely on server errors and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect((await import('./api')).validateGatewaySecret('valid-secret')).resolves.toBe(false);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect((await import('./api')).validateGatewaySecret('valid-secret')).resolves.toBe(false);
  });

  it('does not make a request for an empty secret', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect((await import('./api')).validateGatewaySecret('  ')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('proxy request authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not allow request-specific headers to override Gateway authentication', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ ok: true })
    });
    vi.stubGlobal('fetch', fetchMock);

    await proxyFetch('news', {}, {
      secret: 'trusted-secret',
      headers: {
        'X-App-Auth': 'attacker-controlled-secret',
        Authorization: 'Bearer attacker-controlled-secret',
        'X-Custom-Header': 'preserved'
      }
    });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-App-Auth']).toBe('trusted-secret');
    expect(headers.Authorization).toBe('Bearer trusted-secret');
    expect(headers['X-Custom-Header']).toBe('preserved');
  });
});
