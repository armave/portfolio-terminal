import { describe, expect, it, vi } from 'vitest';
import { createCloudStateSyncRuntime } from './cloudStateSyncRuntime';
import { getCloudSyncDiagnostics } from './cloudSyncDiagnostics';

describe('cloud state compact serialization', () => {
  it('preserves the immutable source sale-event link when compacting closed trades', async () => {
    let encryptedPlaintext = '';
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async (plaintext) => {
        encryptedPlaintext = plaintext;
        return 'aesgcm:v2:test-ciphertext:test-nonce';
      },
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: () => 2,
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(1)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => new Response(
        JSON.stringify({ success: true, revision: 2 }),
        { status: 200, headers: { ETag: '"2"' } }
      )
    });

    const result = await runtime.pushCloudState({
      gatewaySecret: 'must-not-sync',
      brokerExecutedTrades: [{ id: 'history-trade-1', raw: { providerPayload: 'history-only' } }],
      cashflows: [{ id: 'history-cashflow-1', amount: 50 }],
      closedHistory: [{ id: 'duplicate-history-row' }],
      closedTrades: [{
        id: 'closed-1',
        transactionEventId: 'sale-event-42',
        ticker: 'AAPL',
        shares: 2,
        avgBuyPrice: 100,
        sellPrice: 120,
        grossProfit: 40,
        commissions: 1.2,
        netProfit: 38.8,
        raw: { providerPayload: 'must-not-sync' }
      }]
    }, { secret: 'test-secret' });

    expect(result).toBe(true);
    const serialized = JSON.parse(encryptedPlaintext);
    expect(serialized.closedTrades).toHaveLength(1);
    expect(serialized.closedTrades[0]).toMatchObject({
      id: 'closed-1',
      transactionEventId: 'sale-event-42',
      ticker: 'AAPL',
      shares: 2,
      avgBuyPrice: 100,
      sellPrice: 120,
      commissions: 1.2,
      grossProfit: 40,
      netProfit: 38.8
    });
    expect(serialized).not.toHaveProperty('gatewaySecret');
    expect(serialized).not.toHaveProperty('brokerExecutedTrades');
    expect(serialized).not.toHaveProperty('cashflows');
    expect(serialized).not.toHaveProperty('closedHistory');
    expect(serialized.closedTrades[0]).not.toHaveProperty('raw');
  });

  it('allows a compacted snapshot larger than the former 3.5 MB client limit', async () => {
    let encryptedPlaintext = '';
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async (plaintext) => {
        encryptedPlaintext = plaintext;
        return 'aesgcm:v2:test-ciphertext:test-nonce';
      },
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: () => 2,
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(1)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => new Response(
        JSON.stringify({ success: true, revision: 2 }),
        { status: 200, headers: { ETag: '\"2\"' } }
      )
    });

    const largeLegacyField = 'x'.repeat(3_600 * 1024);
    const result = await runtime.pushCloudState({
      activeView: 'GOOGL',
      largeLegacyField
    }, { secret: 'test-secret' });

    expect(result).toBe(true);
    expect(encryptedPlaintext).toContain(largeLegacyField);
  });
});


describe('cloud state sync options', () => {
  it('prefers an explicit state and falls back to the latest state getter', async () => {
    const encryptedStates: string[] = [];
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'active-secret',
      encryptCloudPayload: async (plaintext) => {
        encryptedStates.push(plaintext);
        return 'aesgcm:v2:test-ciphertext:test-nonce';
      },
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: () => 2,
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(1)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => new Response(
        JSON.stringify({ success: true, revision: 2 }),
        { status: 200, headers: { ETag: '"2"' } }
      )
    });

    let getterCalls = 0;
    const explicitState = { activeView: 'AAPL', balance: 100 };
    const explicitResult = await runtime.syncCloudState('push', {
      state: explicitState,
      getState: () => {
        getterCalls += 1;
        return { activeView: 'SHOULD_NOT_BE_USED', balance: 999 };
      },
      secret: 'explicit-state-secret'
    });

    expect(explicitResult).toBe(true);
    expect(getterCalls).toBe(0);
    expect(JSON.parse(encryptedStates[0])).toMatchObject(explicitState);

    const getterState = { activeView: 'MSFT', balance: -200 };
    const getterResult = await runtime.syncCloudState('push', {
      getState: () => {
        getterCalls += 1;
        return getterState;
      },
      secret: 'getter-state-secret'
    });

    expect(getterResult).toBe(true);
    expect(getterCalls).toBe(1);
    expect(JSON.parse(encryptedStates[1])).toMatchObject(getterState);
  });
});


describe('bounded cloud startup requests', () => {
  it('falls back to the supplied local workspace when a cloud pull never returns headers', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        })
      ) as unknown as typeof fetch;
      const runtime = createCloudStateSyncRuntime({
        workerProxyUrl: 'https://portfolio.example.test',
        getActiveGatewaySecret: () => 'test-secret',
        encryptCloudPayload: async () => 'aesgcm:v2:test-ciphertext:nonce',
        decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
        readCloudRevision: () => null,
        revisionCoordinator: {
          recordPulledRevision: () => {},
          setRevision: () => {},
          enqueueWrite: (operation) => operation(0)
        },
        processRollovers: () => false,
        loadSavedState: (fallback) => fallback,
        loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
        saveState: () => true,
        normalizeFreedomTrades: () => [],
        fetchImpl,
        requestTimeoutMs: 25
      });
      const statuses: string[] = [];
      const localState = { balance: 321, activeView: 'BALANCE' };
      const pull = runtime.pullCloudState({
        secret: 'test-secret',
        state: localState,
        showToast: () => {},
        logAppMessage: () => {},
        onStatusChange: (status) => statuses.push(status)
      });
      const result = expect(pull).resolves.toMatchObject(localState);

      await vi.advanceTimersByTimeAsync(25);
      await result;

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].signal.aborted).toBe(true);
      expect(statuses).toEqual(['error']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bypasses browser HTTP caches for state and closed-history reads', async () => {
    const requests: Array<{ path: string; cache: RequestCache | undefined }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ path: new URL(url).pathname, cache: init?.cache });
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ETag: '"0"' }
      });
    }) as unknown as typeof fetch;
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'aesgcm:v2:test-ciphertext:nonce',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(0)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl
    });

    await runtime.pullCloudState({
      secret: 'test-secret',
      state: {},
      showToast: () => {},
      logAppMessage: () => {}
    });
    await runtime.pullCloudHistory('test-secret');

    expect(requests).toEqual([
      { path: '/api/state', cache: 'no-store' },
      { path: '/api/history', cache: 'no-store' }
    ]);
  });

  it('accepts an empty cloud record as a confirmed baseline for first-time sync', async () => {
    const statuses: string[] = [];
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'aesgcm:v2:test-ciphertext:nonce',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(0)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ETag: '"0"' }
      })
    });

    await expect(runtime.syncCloudState('pull', {
      secret: 'test-secret',
      state: { balance: 400 },
      showToast: () => {},
      logAppMessage: () => {},
      onStatusChange: (status) => statuses.push(status)
    })).resolves.toBe(true);
    expect(statuses).toEqual(['synced']);
  });

  it('applies the same deadline to response-body consumption', async () => {
    vi.useFakeTimers();
    try {
      const response = {
        ok: true,
        status: 200,
        headers: new Headers({ ETag: '"1"' }),
        json: () => new Promise<unknown>(() => {})
      } as Response;
      const fetchImpl = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
      const runtime = createCloudStateSyncRuntime({
        workerProxyUrl: 'https://portfolio.example.test',
        getActiveGatewaySecret: () => 'test-secret',
        encryptCloudPayload: async () => 'aesgcm:v2:test-ciphertext:nonce',
        decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
        readCloudRevision: () => null,
        revisionCoordinator: {
          recordPulledRevision: () => {},
          setRevision: () => {},
          enqueueWrite: (operation) => operation(0)
        },
        processRollovers: () => false,
        loadSavedState: (fallback) => fallback,
        loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
        saveState: () => true,
        normalizeFreedomTrades: () => [],
        fetchImpl,
        requestTimeoutMs: 25
      });
      const localState = { balance: 654, activeView: 'AAPL' };
      const pull = runtime.pullCloudState({
        secret: 'test-secret',
        state: localState,
        showToast: () => {},
        logAppMessage: () => {}
      });
      const result = expect(pull).resolves.toMatchObject(localState);

      await vi.advanceTimersByTimeAsync(25);
      await result;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startup cloud pull local-edit protection', () => {
  const response = (status: number, payload: unknown, revision: number) => new Response(
    JSON.stringify(payload),
    {
      status,
      headers: { 'Content-Type': 'application/json', ETag: `"${revision}"` }
    }
  );

  function createRuntime(remote: Record<string, unknown>) {
    const base = {
      positions: { AAPL: { ticker: 'AAPL', shares: 10 } },
      balance: 500,
      activeView: 'AAPL',
      selectedTicker: 'AAPL',
      lastRolloverTimestamp: 100,
      lastUpdated: 100
    };
    let resolveFetch!: (value: Response) => void;
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
    const fetchResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const saved: Record<string, unknown>[] = [];
    const applied: Record<string, unknown>[] = [];
    const statuses: string[] = [];
    let preservedLocalChanges = 0;
    let revision = 0;
    let latestLocal: Record<string, unknown> = base;
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async (plaintext) => `aesgcm:v2:${encodeURIComponent(plaintext)}:nonce`,
      decryptCloudPayload: async (payload) => ({
        plaintext: decodeURIComponent(payload.slice('aesgcm:v2:'.length, -':nonce'.length)),
        legacy: false
      }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        recordPulledRevision: (next) => { revision = next; },
        setRevision: (next) => { revision = next; },
        enqueueWrite: (operation) => operation(revision)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: (value) => { saved.push(structuredClone(value)); return true; },
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => {
        markFetchStarted();
        return await fetchResponse;
      }
    });
    const options = {
      secret: 'test-secret',
      state: base,
      getState: () => latestLocal,
      protectLocalEditsDuringPull: true,
      pullCloudAndRewriteLocal: (value: Record<string, unknown>) => {
        saved.push(structuredClone(value));
        applied.push(value);
      },
      onLocalChangesPreserved: () => { preservedLocalChanges += 1; },
      onStatusChange: (status: 'synced' | 'error' | 'conflict') => statuses.push(status),
      showToast: () => {},
      logAppMessage: () => {}
    };
    return {
      runtime, base, options, saved, applied, statuses, fetchStarted,
      resolveFetch, setLocal: (value: Record<string, unknown>) => { latestLocal = value; },
      getPreservedLocalChanges: () => preservedLocalChanges,
      getRevision: () => revision,
      remote
    };
  }

  it('preserves financial edits made locally while the initial cloud pull is pending', async () => {
    const remote = {
      positions: { AAPL: { ticker: 'AAPL', shares: 10 } },
      balance: 500,
      activeView: 'MSFT',
      selectedTicker: 'MSFT',
      lastRolloverTimestamp: 100,
      lastUpdated: 200
    };
    const fixture = createRuntime(remote);
    const pull = fixture.runtime.pullCloudState(fixture.options);
    await fixture.fetchStarted;

    fixture.setLocal({
      ...fixture.base,
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      lastUpdated: 250
    });
    fixture.resolveFetch(response(200, {
      encryptedPayload: `aesgcm:v2:${encodeURIComponent(JSON.stringify(remote))}:nonce`
    }, 2));

    const result = await pull;

    expect(result).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      activeView: 'MSFT',
      selectedTicker: 'MSFT'
    });
    expect(fixture.saved[0]).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300
    });
    expect(fixture.applied[0]).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      activeView: 'MSFT'
    });
    expect(fixture.getPreservedLocalChanges()).toBe(1);
    expect(fixture.statuses).toEqual(['synced']);
    expect(fixture.getRevision()).toBe(2);
  });

  it('keeps the local portfolio and raises a conflict for overlapping local and remote financial edits', async () => {
    const remote = {
      positions: { AAPL: { ticker: 'AAPL', shares: 8 } },
      balance: 600,
      activeView: 'MSFT',
      selectedTicker: 'MSFT',
      lastUpdated: 200
    };
    const fixture = createRuntime(remote);
    const pull = fixture.runtime.pullCloudState(fixture.options);
    await fixture.fetchStarted;

    fixture.setLocal({
      ...fixture.base,
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      lastUpdated: 250
    });
    fixture.resolveFetch(response(200, {
      encryptedPayload: `aesgcm:v2:${encodeURIComponent(JSON.stringify(remote))}:nonce`
    }, 2));

    const result = await pull;

    expect(result).toMatchObject(fixture.base);
    expect(fixture.saved).toHaveLength(0);
    expect(fixture.applied).toHaveLength(0);
    expect(fixture.getPreservedLocalChanges()).toBe(0);
    expect(fixture.statuses).toEqual(['conflict']);
    expect(fixture.getRevision()).toBe(0);
  });
});

describe('background cloud conflict reconciliation', () => {
  const response = (status: number, payload: unknown, revision?: number) => new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...(revision === undefined ? {} : { ETag: `"${revision}"` })
      }
    }
  );

  function createRuntime(remoteAfterConflict: Record<string, unknown>, remoteStatus = 200) {
    let revision = 0;
    let postCount = 0;
    let getCount = 0;
    const posted: Record<string, unknown>[] = [];
    const base = {
      positions: { AAPL: { ticker: 'AAPL', shares: 10 } },
      balance: 500,
      activeView: 'AAPL',
      selectedTicker: 'AAPL',
      lastRolloverTimestamp: 100,
      lastUpdated: 100
    };
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async (plaintext) => `aesgcm:v2:${encodeURIComponent(plaintext)}:nonce`,
      decryptCloudPayload: async (payload) => ({
        plaintext: payload.startsWith('aesgcm:v2:')
          ? decodeURIComponent(payload.slice('aesgcm:v2:'.length, -':nonce'.length))
          : payload,
        legacy: false
      }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        recordPulledRevision: (next) => { revision = next; },
        setRevision: (next) => { revision = next; },
        enqueueWrite: (operation) => operation(revision)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async (_input, init) => {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'GET') {
          getCount += 1;
          if (getCount === 1) {
            return response(200, { encryptedPayload: `aesgcm:v2:${encodeURIComponent(JSON.stringify(base))}:nonce` }, 1);
          }
          return remoteStatus === 404
            ? response(404, { error: 'Workspace was reset.' }, 2)
            : response(200, {
              encryptedPayload: `aesgcm:v2:${encodeURIComponent(JSON.stringify(remoteAfterConflict))}:nonce`
            }, 2);
        }
        postCount += 1;
        const body = JSON.parse(String(init?.body || '{}'));
        const encrypted = String(body.encryptedPayload || '');
        const encoded = encrypted.slice('aesgcm:v2:'.length, -':nonce'.length);
        posted.push(JSON.parse(decodeURIComponent(encoded)));
        return postCount === 1
          ? response(409, { error: 'Stale revision.' }, 1)
          : response(200, { success: true }, 3);
      }
    });
    return {
      runtime,
      base,
      posted,
      counts: () => ({ getCount, postCount, revision })
    };
  }

  it('auto-reconciles local financial edits with remote navigation changes in the background', async () => {
    let applied: Record<string, unknown> | undefined;
    const remote = {
      positions: { AAPL: { ticker: 'AAPL', shares: 10 } },
      balance: 500,
      activeView: 'MSFT',
      selectedTicker: 'MSFT',
      lastRolloverTimestamp: 100,
      lastUpdated: 200
    };
    const { runtime, base, posted, counts } = createRuntime(remote);
    const statuses: string[] = [];
    const options = {
      secret: 'test-secret',
      getState: () => ({
        ...base,
        positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
        balance: 300,
        lastUpdated: 250
      }) as unknown as NonNullable<Parameters<typeof runtime.pushCloudState>[0]>,
      applyAutoReconciledState: (state: Record<string, unknown>) => {
        applied = state;
        return true;
      },
      showToast: () => {},
      logAppMessage: () => {},
      onStatusChange: (status: 'synced' | 'error' | 'conflict') => statuses.push(status)
    };

    await runtime.pullCloudState(options);
    statuses.length = 0;
    const result = await runtime.pushCloudState(options.getState(), options);

    expect(result).toBe(true);
    expect(statuses).toEqual(['synced']);
    expect(applied).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      activeView: 'MSFT',
      selectedTicker: 'MSFT',
      lastUpdated: 250
    });
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({
      positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
      balance: 300,
      activeView: 'MSFT',
      selectedTicker: 'MSFT'
    });
    expect(counts()).toEqual({ getCount: 2, postCount: 2, revision: 3 });
    expect(getCloudSyncDiagnostics()[0]).toMatchObject({
      operation: 'reconcile', outcome: 'success', reason: 'auto-reconciled',
      expectedRevision: 1, observedRevision: 2
    });
  });

  it('accepts a newer remote-only financial snapshot without posting it again', async () => {
    let applied: Record<string, unknown> | undefined;
    const remote = {
      positions: { AAPL: { ticker: 'AAPL', shares: 8 } },
      balance: 600,
      activeView: 'AAPL',
      selectedTicker: 'AAPL',
      lastRolloverTimestamp: 100,
      lastUpdated: 200
    };
    const { runtime, base, posted, counts } = createRuntime(remote);
    const options = {
      secret: 'test-secret',
      getState: () => base as unknown as NonNullable<Parameters<typeof runtime.pushCloudState>[0]>,
      applyAutoReconciledState: (state: Record<string, unknown>) => {
        applied = state;
        return true;
      },
      showToast: () => {},
      logAppMessage: () => {}
    };

    await runtime.pullCloudState(options);
    expect(await runtime.pushCloudState(options.getState(), options)).toBe(true);
    expect(applied).toMatchObject({ positions: { AAPL: { ticker: 'AAPL', shares: 8 } }, balance: 600 });
    expect(posted).toHaveLength(1);
    expect(counts()).toMatchObject({ getCount: 2, postCount: 1, revision: 2 });
    expect(getCloudSyncDiagnostics()[0]).toMatchObject({
      operation: 'reconcile', outcome: 'success', reason: 'auto-reconciled',
      expectedRevision: 1, observedRevision: 2
    });
  });

  it('keeps a conflict blocked when both devices changed protected financial state differently', async () => {
    let applied = false;
    const remote = {
      positions: { AAPL: { ticker: 'AAPL', shares: 10 } },
      balance: 450,
      activeView: 'MSFT',
      selectedTicker: 'AAPL',
      lastRolloverTimestamp: 100,
      lastUpdated: 200
    };
    const { runtime, base, posted, counts } = createRuntime(remote);
    const statuses: string[] = [];
    const options = {
      secret: 'test-secret',
      getState: () => ({
        ...base,
        positions: { AAPL: { ticker: 'AAPL', shares: 12 } },
        balance: 300,
        lastUpdated: 250
      }) as unknown as NonNullable<Parameters<typeof runtime.pushCloudState>[0]>,
      applyAutoReconciledState: () => { applied = true; return true; },
      showToast: () => {},
      logAppMessage: () => {},
      onStatusChange: (status: 'synced' | 'error' | 'conflict') => statuses.push(status)
    };

    await runtime.pullCloudState(options);
    statuses.length = 0;
    expect(await runtime.pushCloudState(options.getState(), options)).toBe(false);
    expect(statuses).toEqual(['conflict']);
    expect(applied).toBe(false);
    expect(posted).toHaveLength(1);
    expect(counts()).toMatchObject({ getCount: 2, postCount: 1 });
    expect(await runtime.pushCloudState(options.getState(), options)).toBe(false);
    expect(posted).toHaveLength(1);
    expect(getCloudSyncDiagnostics()[0]).toMatchObject({
      operation: 'reconcile', outcome: 'conflict', reason: 'overlapping-edits',
      httpStatus: 200, expectedRevision: 1, observedRevision: 2
    });
  });

  it('leaves legacy embedded history to the normal migration flow', async () => {
    let applied = false;
    const remote = {
      positions: { AAPL: { ticker: 'AAPL', shares: 8 } },
      balance: 600,
      activeView: 'AAPL',
      selectedTicker: 'AAPL',
      brokerExecutedTrades: [{ id: 'legacy-trade-1', ticker: 'AAPL' }],
      lastRolloverTimestamp: 100,
      lastUpdated: 200
    };
    const { runtime, base, posted, counts } = createRuntime(remote);
    const options = {
      secret: 'test-secret',
      getState: () => base as unknown as NonNullable<Parameters<typeof runtime.pushCloudState>[0]>,
      applyAutoReconciledState: () => { applied = true; return true; },
      showToast: () => {},
      logAppMessage: () => {}
    };

    await runtime.pullCloudState(options);
    expect(await runtime.pushCloudState(options.getState(), options)).toBe(false);
    expect(applied).toBe(false);
    expect(posted).toHaveLength(1);
    expect(counts()).toMatchObject({ getCount: 2, postCount: 1 });
    expect(getCloudSyncDiagnostics()[0]).toMatchObject({
      operation: 'reconcile', outcome: 'conflict', reason: 'legacy-history-requires-migration'
    });
  });

  it('does not auto-adopt a missing cloud record over a previously populated base', async () => {
    let applied = false;
    const { runtime, base, posted, counts } = createRuntime({}, 404);
    const options = {
      secret: 'test-secret',
      getState: () => base as unknown as NonNullable<Parameters<typeof runtime.pushCloudState>[0]>,
      applyAutoReconciledState: () => { applied = true; return true; },
      showToast: () => {},
      logAppMessage: () => {}
    };

    await runtime.pullCloudState(options);
    expect(await runtime.pushCloudState(options.getState(), options)).toBe(false);
    expect(applied).toBe(false);
    expect(posted).toHaveLength(1);
    expect(counts()).toMatchObject({ getCount: 2, postCount: 1 });
    expect(getCloudSyncDiagnostics()[0]).toMatchObject({
      operation: 'reconcile', outcome: 'conflict', reason: 'remote-record-missing', httpStatus: 404
    });
  });

  it('does not attempt background reconciliation without an accepted base snapshot', async () => {
    let requests = 0;
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'encrypted:local',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: () => 1,
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(0)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => {
        requests += 1;
        return response(409, { error: 'Stale revision.' }, 1);
      }
    });

    expect(await runtime.pushCloudState({ activeView: 'AAPL' }, {
      secret: 'test-secret',
      applyAutoReconciledState: () => true,
      showToast: () => {},
      logAppMessage: () => {}
    })).toBe(false);
    expect(requests).toBe(1);
    expect(getCloudSyncDiagnostics()[0]).toMatchObject({
      operation: 'reconcile', outcome: 'conflict', reason: 'no-accepted-baseline'
    });
  });
});

describe('cloud revision conflict recovery', () => {
  const response = (status: number, payload: unknown, revision?: number) => new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...(revision === undefined ? {} : { ETag: `"${revision}"` })
      }
    }
  );

  it('blocks stale retries until a successful cloud pull is accepted locally', async () => {
    let postCount = 0;
    let getCount = 0;
    const statuses: string[] = [];
    const response = (status: number, payload: unknown, revision?: number) => new Response(
      JSON.stringify(payload),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
          ...(revision === undefined ? {} : { ETag: `"${revision}"` })
        }
      }
    );
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'aesgcm:v2:test-ciphertext:test-nonce',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        recordPulledRevision: () => {},
        setRevision: () => {},
        enqueueWrite: (operation) => operation(0)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => true,
      normalizeFreedomTrades: () => [],
      fetchImpl: async (_input, init) => {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'GET') {
          getCount += 1;
          return getCount === 1
            ? response(503, { error: 'Temporary pull failure.' })
            : response(404, { error: 'No cloud workspace has been saved yet.' }, 0);
        }
        postCount += 1;
        return postCount === 1
          ? response(409, { error: 'Cloud portfolio changed since this device last synced.' }, 1)
          : response(200, { success: true, revision: 2 }, 2);
      }
    });
    const options = {
      secret: 'test-secret',
      showToast: () => {},
      logAppMessage: () => {},
      onStatusChange: (status: 'synced' | 'error' | 'conflict') => statuses.push(status)
    };

    expect(await runtime.pushCloudState({ activeView: 'AAPL' }, options)).toBe(false);
    expect(statuses.at(-1)).toBe('conflict');
    expect(postCount).toBe(1);

    expect(await runtime.pushCloudState({ activeView: 'MSFT' }, options)).toBe(false);
    expect(postCount).toBe(1);
    expect(statuses.at(-1)).toBe('conflict');

    await runtime.pullCloudState(options);
    expect(statuses.at(-1)).toBe('conflict');
    expect(await runtime.pushCloudState({ activeView: 'NVDA' }, options)).toBe(false);
    expect(postCount).toBe(1);

    // An authorized empty-cloud response is also a confirmed base revision.
    await runtime.pullCloudState(options);
    expect(statuses.at(-1)).toBe('synced');
    expect(getCount).toBe(2);
    expect(await runtime.pushCloudState({ activeView: 'NVDA' }, options)).toBe(true);
    expect(postCount).toBe(2);
    expect(statuses.at(-1)).toBe('synced');
  });

  it('keeps the conflict latched when the local store rejects a pulled snapshot', async () => {
    let revision = 0;
    let postCount = 0;
    let getCount = 0;
    let saveCount = 0;
    const statuses: string[] = [];
    const localState = { positions: { AAPL: { ticker: 'AAPL', shares: 10 } }, balance: 500 };
    const remoteState = { positions: { AAPL: { ticker: 'AAPL', shares: 8 } }, balance: 600 };
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'encrypted-local',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        getRevision: () => revision,
        recordPulledRevision: (next) => { revision = next; },
        setRevision: (next) => { revision = next; },
        enqueueWrite: (operation) => operation(revision)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => { saveCount += 1; return true; },
      normalizeFreedomTrades: () => [],
      fetchImpl: async (_input, init) => {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'GET') {
          getCount += 1;
          return response(200, { encryptedPayload: JSON.stringify(remoteState) }, 2);
        }
        postCount += 1;
        return response(409, { error: 'Stale revision.' }, 1);
      }
    });
    const options = {
      secret: 'test-secret',
      state: localState,
      getState: () => localState,
      pullCloudAndRewriteLocal: () => { throw new Error('The transaction journal conflicts with this device.'); },
      showToast: () => {},
      logAppMessage: () => {},
      onStatusChange: (status: 'synced' | 'error' | 'conflict') => statuses.push(status)
    };

    expect(await runtime.pushCloudState(localState, options)).toBe(false);
    expect(statuses.at(-1)).toBe('conflict');
    expect(postCount).toBe(1);

    await runtime.pullCloudState(options);
    expect(statuses.at(-1)).toBe('conflict');
    expect(saveCount).toBe(0);
    expect(revision).toBe(0);

    expect(await runtime.pushCloudState({ ...localState, activeView: 'NVDA' }, options)).toBe(false);
    expect(postCount).toBe(1);
  });

  it('keeps a populated cloud baseline blocked when a later pull returns 404', async () => {
    let revision = 0;
    let getCount = 0;
    let postCount = 0;
    let saveCount = 0;
    const statuses: string[] = [];
    const cloudState = { positions: { AAPL: { ticker: 'AAPL', shares: 10 } }, balance: 500 };
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'encrypted-local',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        getRevision: () => revision,
        recordPulledRevision: (next) => { revision = next; },
        setRevision: (next) => { revision = next; },
        enqueueWrite: (operation) => operation(revision)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => { saveCount += 1; return true; },
      normalizeFreedomTrades: () => [],
      fetchImpl: async (_input, init) => {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method === 'GET') {
          getCount += 1;
          return getCount === 1
            ? response(200, { encryptedPayload: JSON.stringify(cloudState) }, 1)
            : response(404, { error: 'Cloud state was removed.' }, 2);
        }
        postCount += 1;
        return response(200, { success: true }, 3);
      }
    });
    const options = {
      secret: 'test-secret',
      state: cloudState,
      showToast: () => {},
      logAppMessage: () => {},
      onStatusChange: (status: 'synced' | 'error' | 'conflict') => statuses.push(status)
    };

    await runtime.pullCloudState(options);
    expect(statuses.at(-1)).toBe('synced');
    expect(revision).toBe(1);
    expect(saveCount).toBe(1);

    await runtime.pullCloudState(options);
    expect(statuses.at(-1)).toBe('conflict');
    expect(revision).toBe(1);
    expect(saveCount).toBe(1);
    expect(await runtime.pushCloudState(cloudState, options)).toBe(false);
    expect(postCount).toBe(0);
  });

  it('forwards confirmed replacement intent to the local commit callback', async () => {
    let revision = 0;
    let saveCount = 0;
    let replacementRequested: boolean | undefined;
    const cloudState = { positions: {}, balance: 250 };
    const runtime = createCloudStateSyncRuntime({
      workerProxyUrl: 'https://portfolio.example.test',
      getActiveGatewaySecret: () => 'test-secret',
      encryptCloudPayload: async () => 'encrypted-local',
      decryptCloudPayload: async (payload) => ({ plaintext: payload, legacy: false }),
      readCloudRevision: (headers) => {
        const etag = headers?.get('ETag');
        return etag ? Number(etag.replaceAll('"', '')) : null;
      },
      revisionCoordinator: {
        getRevision: () => revision,
        recordPulledRevision: (next) => { revision = next; },
        setRevision: (next) => { revision = next; },
        enqueueWrite: (operation) => operation(revision)
      },
      processRollovers: () => false,
      loadSavedState: (fallback) => fallback,
      loadSavedHistory: () => ({ brokerExecutedTrades: [], cashflows: [] }),
      saveState: () => { saveCount += 1; return true; },
      normalizeFreedomTrades: () => [],
      fetchImpl: async () => response(200, { encryptedPayload: JSON.stringify(cloudState) }, 7)
    });

    await runtime.pullCloudState({
      secret: 'test-secret',
      replaceLocalState: true,
      pullCloudAndRewriteLocal: (_state, replace) => { replacementRequested = replace; },
      showToast: () => {},
      logAppMessage: () => {}
    });

    expect(replacementRequested).toBe(true);
    expect(saveCount).toBe(0);
    expect(revision).toBe(7);
  });
});
