import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import {
  pullCloudState,
  pushCloudState,
  pushCloudHistory,
  pullCloudHistory,
  syncCloudState,
  proxyFetch,
  getCurrentUser,
  listUsers,
  createUser,
  getGuestPortfolioSnapshot,
  publishGuestPortfolioSnapshot,
  clearApiRequestCaches,
  fetchFallbackQuote,
  normalizeYahooBatchResults,
  validateGatewaySecret,
  fetchYahooDeepStockData,
  fetchYahooQuoteData,
  fetchMarketNews,
  fetchStocktwitsStream,
  rememberYahooDeepStockData,
  clearYahooDeepStockDataCache
} from './api';
import * as storage from './storage';

// Most API tests exercise successful proxy requests; give them a deterministic
// credential. Tests for missing credentials explicitly override this value.
beforeEach(() => {
  clearApiRequestCaches();
  storage.setGatewaySecret('test-gateway-secret');
});
afterEach(() => {
  clearApiRequestCaches();
  storage.setGatewaySecret('');
});

async function encryptV2Fixture(value: unknown, secret: string): Promise<string> {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await globalThis.crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    new TextEncoder().encode(JSON.stringify(value))
  );
  const toBase64 = (bytes: Uint8Array) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  return `aesgcm:v2:${toBase64(nonce)}:${toBase64(new Uint8Array(ciphertext))}`;
}



describe('authenticated read request deduplication', () => {
  it('reuses the user returned by initial session validation', async () => {
    const user = { id: 'admin-1', name: 'Admin', role: 'admin', createdAt: '2026-01-01T00:00:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    storage.setGatewaySecret('validated-session-secret');
    await expect(validateGatewaySecret('validated-session-secret')).resolves.toBe(true);
    await expect(getCurrentUser()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses the user directory briefly and invalidates it after a user mutation', async () => {
    let version = 1;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({
          user: { id: 'guest-2', name: 'Guest 2', role: 'guest', createdAt: '2026-01-02T00:00:00.000Z' }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        users: [{ id: 'guest-' + version, name: 'Guest ' + version, role: 'guest', createdAt: '2026-01-01T00:00:00.000Z' }]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(listUsers()).resolves.toHaveLength(1);
    await expect(listUsers()).resolves.toEqual(await listUsers());
    expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit)?.method !== 'POST')).toHaveLength(1);

    await createUser({ name: 'Guest 2', password: 'test-password', role: 'guest' });
    version = 2;
    await expect(listUsers()).resolves.toMatchObject([{ id: 'guest-2' }]);
    expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit)?.method === 'POST')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) => (call[1] as RequestInit)?.method !== 'POST')).toHaveLength(2);
  });

  it('coalesces simultaneous guest projection reads without caching later reads', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const first = getGuestPortfolioSnapshot();
    const second = getGuestPortfolioSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(new Response(JSON.stringify({ snapshot: { updatedAt: 10, tranches: [] } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { updatedAt: 10, tranches: [] }, { updatedAt: 10, tranches: [] }
    ]);
    await getGuestPortfolioSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('proxy request coalescing', () => {
  it('shares identical concurrent market-data requests', async () => {
    let resolveFetch!: (value: any) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const first = proxyFetch('news', { symbol: 'AAPL' });
    const second = proxyFetch('news', { symbol: 'AAPL' });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ articles: [] })
    });
    await expect(Promise.all([first, second])).resolves.toEqual([{ articles: [] }, { articles: [] }]);
  });

  it('does not coalesce requests with different symbols', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true })
    });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      proxyFetch('news', { symbol: 'AAPL' }),
      proxyFetch('news', { symbol: 'MSFT' })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('cloud state sync', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never trusts a Gateway Secret embedded in portfolio state', async () => {
    storage.setGatewaySecret('trusted-stored-secret');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers()
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

  it('reports cloud sync status through a callback without transport-layer DOM access', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ ETag: '"1"' })
    });
    const onStatusChange = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await pushCloudState(
      { activeView: 'AAPL', balance: 100 },
      { secret: 'cloud-encryption-secret', showToast: vi.fn(), onStatusChange }
    );

    expect(result).toBe(true);
    expect(onStatusChange).toHaveBeenCalledWith('synced');
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
    expect(fetchMock.mock.calls[0][1].headers['If-Match']).toMatch(/^"\d+"$/);

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.encryptedPayload).toMatch(/^aesgcm:v2:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    expect(payload.encryptedPayload).not.toContain('cloud-encryption-secret');
  });
  it('imports shared portfolio state for read-only guests without posting legacy cloud history', async () => {
    const secret = 'guest-read-only-history-migration-secret';
    const encryptedPayload = await encryptV2Fixture({
      activeView: 'AAPL',
      balance: 1250,
      brokerExecutedTrades: [{ id: 'legacy-trade-1' }],
      cashflows: [{ id: 'legacy-cashflow-1' }],
      lastRolloverTimestamp: Date.now()
    }, secret);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(_input);
      if (url.endsWith('/api/state')) {
        return new Response(JSON.stringify({ encryptedPayload }), {
          status: 200, headers: { 'Content-Type': 'application/json', ETag: '"8"' }
        });
      }
      if (url.endsWith('/api/history')) {
        return new Response(JSON.stringify({ error: 'Portfolio state not found.' }), {
          status: 404, headers: { 'Content-Type': 'application/json', ETag: '"0"' }
        });
      }
      throw new Error('Unexpected request: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);
    const rewriteLocal = vi.fn();
    const reportResult = vi.fn();
    vi.spyOn(storage, 'saveState').mockReturnValue(true);

    const result = await pullCloudState({
      state: { activeView: 'LOCAL', balance: 0 },
      secret,
      allowCloudWrites: false,
      pullCloudAndRewriteLocal: rewriteLocal,
      showToast: vi.fn(),
      logTerminal: vi.fn()
    }, reportResult);

    expect(result.activeView).toBe('AAPL');
    expect(rewriteLocal).toHaveBeenCalledWith(expect.objectContaining({ activeView: 'AAPL' }));
    expect(reportResult).toHaveBeenCalledWith(true);
    expect(fetchMock.mock.calls.map(call => (call[1] as RequestInit)?.method || 'GET')).toEqual(['GET', 'GET']);
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

  it('serializes concurrent pushes and uses the revision returned by the prior push', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"42"' }),
        json: async () => ({})
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"43"' }),
        json: async () => ({})
      });
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      pushCloudState({ activeView: 'AAPL', balance: 100 }, {
        secret: 'cloud-encryption-secret',
        showToast: vi.fn()
      }),
      pushCloudState({ activeView: 'MSFT', balance: 200 }, {
        secret: 'cloud-encryption-secret',
        showToast: vi.fn()
      })
    ]);

    expect(results).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(secondHeaders['If-Match']).toBe('"42"');
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



describe('versioned cloud encryption', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects modified AES-GCM ciphertext without persisting it', async () => {
    const secret = 'cloud-encryption-secret';
    const validPayload = {
      encryptedPayload: 'aesgcm:v2:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA=='
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"44"' }),
      json: async () => validPayload
    });
    vi.stubGlobal('fetch', fetchMock);
    const saveSpy = vi.spyOn(storage, 'saveState').mockReturnValue(true);
    const reportResult = vi.fn();
    const showToast = vi.fn();

    await pullCloudState({
      state: { activeView: 'LOCAL', balance: 1000 },
      secret,
      showToast,
      logTerminal: vi.fn()
    }, reportResult);

    expect(saveSpy).not.toHaveBeenCalled();
    expect(reportResult).toHaveBeenCalledWith(false);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Failed to decrypt cloud state'), 'error');
  });

  it('reads legacy CryptoJS ciphertext and schedules a versioned encryption upgrade', async () => {
    const secret = 'cloud-encryption-secret';
    const legacyPayload = CryptoJS.AES.encrypt(JSON.stringify({
      activeView: 'AAPL',
      balance: 1250,
      lastRolloverTimestamp: Date.now()
    }), secret).toString();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"70"' }),
        json: async () => ({ encryptedPayload: legacyPayload })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"71"' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"72"' })
      });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(storage, 'saveState').mockReturnValue(true);

    const result = await pullCloudState({
      state: { activeView: 'LOCAL', balance: 0 },
      secret,
      showToast: vi.fn(),
      logTerminal: vi.fn()
    });

    expect(result.activeView).toBe('AAPL');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const upgrade = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(upgrade.encryptedPayload).toMatch(/^aesgcm:v2:/);
    // Drain the background migration write before another test replaces global fetch.
    await expect(pushCloudState({ activeView: 'AAPL', balance: 1250 }, {
      secret,
      showToast: vi.fn()
    })).resolves.toBe(true);
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

  it('validates a guest session without requesting the shared portfolio endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);
    await expect((await import('./api')).validateGatewaySecret('valid-secret')).resolves.toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/auth/me');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('/api/state');
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

describe('guest portfolio projection API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads only the authenticated guest projection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      snapshot: { updatedAt: 100, tranches: [{
        id: 'AAPL:buy-1', ticker: 'AAPL', name: 'Apple', quantity: 2,
        averagePrice: 100, marketPrice: 120, marketValue: 240, purchasedAt: 50
      }] },
      revision: 3
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { getGuestPortfolioSnapshot } = await import('./api');
    const snapshot = await getGuestPortfolioSnapshot();
    expect(snapshot.tranches).toHaveLength(1);
    expect(snapshot.tranches[0]).toMatchObject({ ticker: 'AAPL', quantity: 2 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/guest-portfolio');
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: 'Bearer test-gateway-secret',
      'X-App-Auth': 'test-gateway-secret'
    });
  });

  it('publishes a guest-only projection using the authenticated administrator session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, revision: 4 }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const snapshot = {
      updatedAt: 200,
      tranches: [{
        id: 'MSFT:buy-2', ticker: 'MSFT', name: 'Microsoft', quantity: 1.5,
        averagePrice: 300, marketPrice: 320, marketValue: 480, purchasedAt: 60
      } as any]
    };
    await publishGuestPortfolioSnapshot('guest-1', snapshot);
    await publishGuestPortfolioSnapshot('guest-1', { ...snapshot, updatedAt: 300 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/guest-portfolio');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({
      guestId: 'guest-1',
      snapshot: { tranches: [expect.objectContaining({ ticker: 'MSFT', quantity: 1.5 })] }
    });
    await publishGuestPortfolioSnapshot('guest-1', {
      ...snapshot, updatedAt: 400,
      tranches: [{ ...snapshot.tranches[0], marketPrice: 321, marketValue: 481.5 }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
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


describe('cloud pull revision safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not trust a cloud revision when its payload cannot be decrypted', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"99"' }),
        json: async () => ({ encryptedPayload: 'invalid-ciphertext' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"100"' })
      });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await pullCloudState({
      state: { activeView: 'LOCAL', balance: 1000 },
      secret: 'cloud-encryption-secret',
      showToast: vi.fn(),
      logTerminal: vi.fn()
    });

    await pushCloudState({ activeView: 'LOCAL', balance: 1000 }, {
      secret: 'cloud-encryption-secret',
      showToast: vi.fn()
    });

    const pushRequest = fetchMock.mock.calls[1][1] as RequestInit;
    expect((pushRequest.headers as Record<string, string>)['If-Match']).not.toBe('"99"');
  });
});


describe('queued writes during concurrent cloud pulls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not adopt a revision learned from a pull after a queued snapshot was submitted', async () => {
    let resolveFirstPush!: (response: any) => void;
    const firstPushResponse = new Promise((resolve) => {
      resolveFirstPush = resolve;
    });
    const secret = 'cloud-encryption-secret';
    const encryptedPayload = await encryptV2Fixture({
      activeView: 'CLOUD',
      balance: 200,
      lastRolloverTimestamp: Date.now()
    }, secret);
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstPushResponse)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"99"' }),
        json: async () => ({ encryptedPayload })
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: new Headers({ ETag: '"99"' }),
        json: async () => ({ error: 'Cloud portfolio changed since this device last synced.' })
      });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const first = pushCloudState({ activeView: 'FIRST', balance: 1 }, {
      secret, showToast: vi.fn()
    });
    const second = pushCloudState({ activeView: 'STALE_QUEUED', balance: 2 }, {
      secret, showToast: vi.fn()
    });
    // AES-GCM encryption is asynchronous; wait until the first write has actually started.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await pullCloudState({
      state: { activeView: 'LOCAL', balance: 0 },
      secret,
      showToast: vi.fn(),
      logTerminal: vi.fn()
    });

    resolveFirstPush({
      ok: true,
      status: 200,
      headers: new Headers({ ETag: '"100"' }),
      json: async () => ({ success: true })
    });
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);

    const firstHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[2][1].headers as Record<string, string>;
    expect(secondHeaders['If-Match']).toBe(firstHeaders['If-Match']);
    expect(secondHeaders['If-Match']).not.toBe('"99"');
  });
});

describe('proxyFetch gateway authentication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rejects empty credentials before making a network request', async () => {
    vi.spyOn(storage, 'getGatewaySecret').mockReturnValue('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(proxyFetch('freedom-trades')).rejects.toThrow('Gateway Secret is not available');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses an explicit secret and attaches both gateway authentication headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(proxyFetch('freedom-trades', {}, { secret: 'test-gateway-secret' })).resolves.toEqual({});
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(request.headers).toMatchObject({
      'X-App-Auth': 'test-gateway-secret',
      Authorization: 'Bearer test-gateway-secret'
    });
  });
});

describe('Yahoo deep-data request deduplication', () => {
  afterEach(() => {
    clearYahooDeepStockDataCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shares an in-flight request and caches the result by normalized ticker', async () => {
    clearYahooDeepStockDataCache();
    let resolveResponse!: (value: any) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal('fetch', fetchMock);

    const first = fetchYahooDeepStockData('aapl');
    const second = fetchYahooDeepStockData(' AAPL ');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const payload = { symbol: 'AAPL', analystTargets: { median: 200 }, valuation: { peForward: 20 } };
    resolveResponse({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => payload
    });

    await expect(Promise.all([first, second])).resolves.toEqual([payload, payload]);
    await expect(fetchYahooDeepStockData('AAPL')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses successful batch data and supports an explicit forced refresh', async () => {
    clearYahooDeepStockDataCache();
    const cached = { symbol: 'MSFT', analystTargets: { median: 450 } };
    rememberYahooDeepStockData(cached);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ ...cached, analystTargets: { median: 460 } })
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchYahooDeepStockData('MSFT')).resolves.toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(fetchYahooDeepStockData('MSFT', true)).resolves.toEqual({
      ...cached,
      analystTargets: { median: 460 }
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest deep-data cache entry after the cache reaches its bound', async () => {
    clearYahooDeepStockDataCache();
    for (let index = 0; index <= 500; index += 1) {
      rememberYahooDeepStockData({ symbol: `CACHE${String(index).padStart(3, '0')}`, marker: index });
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ symbol: 'CACHE000', marker: 'refetched' })
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchYahooDeepStockData('CACHE000')).resolves.toEqual({
      symbol: 'CACHE000',
      marker: 'refetched'
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache failed ticker payloads', async () => {
    clearYahooDeepStockDataCache();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ symbol: 'BAD', error: 'Yahoo unavailable' })
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchYahooDeepStockData('BAD');
    await fetchYahooDeepStockData('BAD');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});


describe('market news request deduplication', () => {
  afterEach(() => {
    clearYahooDeepStockDataCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('caches news by ticker and refreshes only when explicitly requested', async () => {
    clearYahooDeepStockDataCache();
    let newsRequestCount = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => [{ headline: newsRequestCount++ === 0 ? 'First result' : 'Fresh result' }]
    } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMarketNews('aapl')).resolves.toEqual([{ headline: 'First result' }]);
    await expect(fetchMarketNews(' AAPL ')).resolves.toEqual([{ headline: 'First result' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(fetchMarketNews('AAPL', true)).resolves.toEqual([{ headline: 'Fresh result' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});


describe('Stocktwits stream cache and refresh', () => {
  afterEach(() => {
    clearYahooDeepStockDataCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('caches normalized symbols and supports a forced refresh', async () => {
    clearYahooDeepStockDataCache();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ messages: [{ id: 1, body: 'First stream' }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => ({ messages: [{ id: 2, body: 'Fresh stream' }] })
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchStocktwitsStream('aapl')).resolves.toMatchObject({
      symbol: 'AAPL',
      messages: [{ id: 1, body: 'First stream' }]
    });
    await expect(fetchStocktwitsStream(' AAPL ')).resolves.toMatchObject({
      symbol: 'AAPL',
      messages: [{ id: 1, body: 'First stream' }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(fetchStocktwitsStream('AAPL', true)).resolves.toMatchObject({
      symbol: 'AAPL',
      messages: [{ id: 2, body: 'Fresh stream' }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});


describe('Gateway validation response reuse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('validates the session separately before an administrator pulls the shared workspace', async () => {
    const secret = 'validated-once-secret';
    const encryptedPayload = await encryptV2Fixture({
      activeView: 'AAPL',
      balance: 0,
      lastRolloverTimestamp: Date.now()
    }, secret);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/auth/me') {
        return new Response(JSON.stringify({ user: { id: 'admin-1', role: 'admin' } }), {
          status: 200, headers: { 'Content-Type': 'application/json' }
        });
      }
      if (pathname === '/api/state') {
        return new Response(JSON.stringify({ encryptedPayload }), {
          status: 200, headers: { 'Content-Type': 'application/json', ETag: '"5"' }
        });
      }
      throw new Error('Unexpected request: ' + pathname);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(storage, 'saveState').mockReturnValue(true);

    await expect(validateGatewaySecret(secret)).resolves.toBe(true);
    const reportResult = vi.fn();
    await pullCloudState({
      state: { activeView: 'LOCAL', balance: 100 },
      secret,
      showToast: vi.fn(),
      logTerminal: vi.fn()
    }, reportResult);

    expect(reportResult).toHaveBeenCalledWith(true);
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      '/api/auth/me', '/api/state'
    ]);
  });
});


describe('fallback provider quote normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('normalizes Finnhub quotes and preserves supplied change values', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ c: 105, pc: 100, d: 5, dp: 5 })
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchFallbackQuote('aapl', 'finnhub')).resolves.toEqual({
      symbol: 'AAPL',
      price: 105,
      previousClose: 100,
      change: 5,
      changePercent: 5,
      sourceName: 'Finnhub'
    });
    expect(fetchMock.mock.calls[0][0]).toContain('action=provider-quote');
    expect(fetchMock.mock.calls[0][0]).toContain('provider=finnhub');
  });

  it('normalizes Twelve Data quotes and derives missing change values', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ close: '210', previous_close: '200' })
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchFallbackQuote('msft', 'twelvedata')).resolves.toEqual({
      symbol: 'MSFT',
      price: 210,
      previousClose: 200,
      change: 10,
      changePercent: 5,
      sourceName: 'Twelve Data'
    });
  });

  it('rejects a fallback response without a positive finite quote', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ c: 0, pc: 100 })
    }));

    await expect(fetchFallbackQuote('BAD', 'finnhub')).rejects.toThrow('no valid quote');
  });
});


describe('Yahoo batch result normalization', () => {
  it('keeps individual Yahoo results unchanged', () => {
    const results = [{ symbol: 'AAPL', price: { current: 100 } }, { symbol: 'MSFT', error: 'unavailable' }];
    expect(normalizeYahooBatchResults(results, ['AAPL', 'MSFT'])).toBe(results);
  });

  it('creates per-symbol fallback entries when the Yahoo batch request fails', () => {
    expect(normalizeYahooBatchResults(null, ['AAPL', 'MSFT'])).toEqual([
      { symbol: 'AAPL', error: 'Yahoo batch request failed' },
      { symbol: 'MSFT', error: 'Yahoo batch request failed' }
    ]);
  });

  it('wraps a single-symbol result in an array', () => {
    const result = { symbol: 'AAPL', price: { current: 100 } };
    expect(normalizeYahooBatchResults(result, ['AAPL'])).toEqual([result]);
  });
});


describe('lightweight Yahoo quote batching', () => {
  beforeEach(() => {
    clearYahooDeepStockDataCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('batches distinct symbols requested in the same turn and caches successful quotes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => [
        { symbol: 'AAPL', price: { current: 210 } },
        { symbol: 'MSFT', price: { current: 420 } }
      ]
    });
    vi.stubGlobal('fetch', fetchMock);

    const [aapl, msft] = await Promise.all([
      fetchYahooQuoteData('aapl'),
      fetchYahooQuoteData('MSFT')
    ]);

    expect(aapl.price.current).toBe(210);
    expect(msft.price.current).toBe(420);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('symbol')).toBe('AAPL,MSFT');

    const cached = await fetchYahooQuoteData('AAPL');
    expect(cached.price.current).toBe(210);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('Yahoo deep-data forced refresh', () => {
  beforeEach(() => clearYahooDeepStockDataCache());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('bypasses cached data when force is true', async () => {
    const makeResponse = (price: number) => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ symbol: 'AAPL', price: { current: price } })
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeResponse(210))
      .mockResolvedValueOnce(makeResponse(212));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchYahooDeepStockData('AAPL');
    const cached = await fetchYahooDeepStockData('AAPL');
    const refreshed = await fetchYahooDeepStockData('AAPL', true);

    expect(first.price.current).toBe(210);
    expect(cached.price.current).toBe(210);
    expect(refreshed.price.current).toBe(212);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not join an in-flight request on force or let the older response overwrite the cache', async () => {
    const makeResponse = (price: number) => ({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ symbol: 'AAPL', price: { current: price } })
    });
    const resolvers: Array<(value: any) => void> = [];
    const fetchMock = vi.fn(() => new Promise<any>(resolve => { resolvers.push(resolve); }));
    vi.stubGlobal('fetch', fetchMock);

    const olderRequest = fetchYahooDeepStockData('AAPL');
    const forcedRequest = fetchYahooDeepStockData('AAPL', true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolvers[1](makeResponse(212));
    expect((await forcedRequest).price.current).toBe(212);
    resolvers[0](makeResponse(210));
    expect((await olderRequest).price.current).toBe(210);

    const cached = await fetchYahooDeepStockData('AAPL');
    expect(cached.price.current).toBe(212);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});


describe('closed-history cloud write serialization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('serializes concurrent history pushes so each reads the revision after the previous write', async () => {
    let revision = 4;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const expectedRevision = Number(String((init.headers as Record<string, string>)['If-Match']).replaceAll('"', ''));
        if (expectedRevision !== revision) {
          return new Response(JSON.stringify({ conflict: true, currentRevision: revision }), {
            status: 409,
            headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` }
          });
        }
        revision += 1;
        return new Response(JSON.stringify({ success: true, revision }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` }
        });
      }
      return new Response(JSON.stringify({ encryptedPayload: 'existing-history' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = pushCloudHistory({
      brokerExecutedTrades: [{ id: 'trade-1' }],
      cashflows: [{ id: 'fee-1' }]
    }, 'history-secret');
    const second = pushCloudHistory({
      brokerExecutedTrades: [{ id: 'trade-2' }],
      cashflows: [{ id: 'fee-2' }]
    }, 'history-secret');

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    const historyCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/history'));
    expect(historyCalls).toHaveLength(4);
    expect(historyCalls.map((call) => (call[1] as RequestInit).method)).toEqual([
      'GET', 'POST', 'GET', 'POST'
    ]);
    expect((historyCalls[1][1] as RequestInit).headers).toMatchObject({ 'If-Match': '"4"' });
    expect((historyCalls[3][1] as RequestInit).headers).toMatchObject({ 'If-Match': '"5"' });
  });
});


describe('closed-history request deduplication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips a second save when newly allocated arrays contain the same history', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ETag: '"2"'
        }
      });
      return new Response(JSON.stringify({ encryptedPayload: 'existing-history' }), {
        status: 200, headers: { 'Content-Type': 'application/json', ETag: '"1"' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = { brokerExecutedTrades: [{ id: 'same-trade' }], cashflows: [{ id: 'same-fee' }] };
    const second = { brokerExecutedTrades: [{ id: 'same-trade' }], cashflows: [{ id: 'same-fee' }] };

    await expect(pushCloudHistory(first, 'same-history-secret')).resolves.toBe(true);
    await expect(pushCloudHistory(second, 'same-history-secret')).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(['GET', 'POST']);
  });

  it('shares one in-flight cloud history read among concurrent callers', async () => {
    const secret = 'shared-history-read-secret';
    const encryptedPayload = await encryptV2Fixture({
      brokerExecutedTrades: [{ id: 'trade-1' }],
      cashflows: [{ id: 'fee-1' }]
    }, secret);
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const first = pullCloudHistory(secret);
    const second = pullCloudHistory(secret);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(new Response(JSON.stringify({ encryptedPayload }), {
      status: 200, headers: { 'Content-Type': 'application/json', ETag: '"7"' }
    }));

    await expect(Promise.all([first, second])).resolves.toEqual([
      { brokerExecutedTrades: [{ id: 'trade-1' }], cashflows: [{ id: 'fee-1' }] },
      { brokerExecutedTrades: [{ id: 'trade-1' }], cashflows: [{ id: 'fee-1' }] }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});


describe('closed-history migration revision reuse', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the revision from the migration GET instead of issuing a second GET before POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"1"' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(pushCloudHistory({
      brokerExecutedTrades: [{ id: 'migration-revision-reuse-trade-20261028' }],
      cashflows: [{ id: 'migration-revision-reuse-fee-20261028' }]
    }, 'migration-revision-reuse-secret-20261028', 0)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'If-Match': '"0"' });
  });
});




describe('cloud state write deduplication', () => {
  it('skips an unchanged snapshot when only lastUpdated differs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ETag: '"31"' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { 'Content-Type': 'application/json', ETag: '"32"' }
      }));
    vi.stubGlobal('fetch', fetchMock);
    const options = { secret: 'cloud-state-dedupe-secret', showToast: vi.fn() };
    const state = { activeView: 'BALANCE', balance: 100, lastUpdated: 100 };
    await expect(pushCloudState(state, options)).resolves.toBe(true);
    await expect(pushCloudState({ ...state, lastUpdated: 200 }, options)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(pushCloudState({ ...state, balance: 101, lastUpdated: 300 }, options)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('closed-history migration/read race', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the just-migrated record to a concurrent load that initially saw 404', async () => {
    const secret = 'migration-read-race-secret-20261028';
    let resolveInitialGet!: (response: Response) => void;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ success: true, revision: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: '"1"' }
        }));
      }
      return new Promise<Response>((resolve) => { resolveInitialGet = resolve; });
    });
    vi.stubGlobal('fetch', fetchMock);

    const concurrentRead = pullCloudHistory(secret);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const migrated = {
      brokerExecutedTrades: [{ id: 'migration-race-trade' }],
      cashflows: [{ id: 'migration-race-fee' }]
    };
    await expect(pushCloudHistory(migrated, secret, 0)).resolves.toBe(true);
    resolveInitialGet(new Response(JSON.stringify({ error: 'Portfolio state not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ETag: '"0"' }
    }));

    await expect(concurrentRead).resolves.toEqual(migrated);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(['GET', 'POST']);
  });
});
