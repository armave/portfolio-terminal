import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CryptoJS from 'crypto-js';
import {
  pullCloudState,
  pushCloudState,
  syncCloudState,
  proxyFetch,
  fetchFallbackQuote,
  normalizeYahooBatchResults,
  validateGatewaySecret,
  fetchYahooDeepStockData,
  fetchMarketNews,
  fetchStocktwitsStream,
  rememberYahooDeepStockData,
  clearYahooDeepStockDataCache
} from './api';
import * as storage from './storage';

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
    expect(payload.encryptedPayload).toMatch(/^aesgcm:v2:[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/);
    expect(payload.encryptedPayload).not.toContain('cloud-encryption-secret');
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
    const encryptedPayload = CryptoJS.AES.encrypt(JSON.stringify({
      activeView: 'CLOUD',
      balance: 200,
      lastRolloverTimestamp: Date.now()
    }), secret).toString();
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
    await Promise.resolve();
    await Promise.resolve();

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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => [{ headline: 'First result' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/json' }),
        json: async () => [{ headline: 'Fresh result' }]
      });
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

  it('uses the authenticated cloud payload for the initial pull without a second GET', async () => {
    const secret = 'validated-once-secret';
    const encryptedPayload = CryptoJS.AES.encrypt(JSON.stringify({
      activeView: 'AAPL',
      balance: 0,
      lastRolloverTimestamp: Date.now()
    }), secret).toString();
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ encryptedPayload }),
      { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"5"' } }
    ));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
