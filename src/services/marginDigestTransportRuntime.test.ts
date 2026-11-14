import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMarginDigestTransportRuntime,
  type SyncedMarginDigest
} from './marginDigestTransportRuntime';

const WORKER_PROXY_URL = 'https://worker.example.test';
const SECRET = 'session-secret';
const digest: SyncedMarginDigest = {
  key: 'position:AAPL',
  title: 'AAPL Position Review',
  scope: 'position',
  ticker: 'AAPL',
  analysis: 'Saved analysis',
  articles: [],
  syncedAt: '2026-11-14T10:00:00.000Z'
};

function createRuntime(fetchImpl: typeof fetch, timeoutMs = 15_000) {
  const getActiveGatewaySecret = vi.fn(() => SECRET);
  const encryptCloudPayload = vi.fn(async () => 'encrypted-payload');
  const decryptCloudPayload = vi.fn(async () => ({
    plaintext: JSON.stringify(digest),
    legacy: false
  }));
  const runtime = createMarginDigestTransportRuntime({
    workerProxyUrl: WORKER_PROXY_URL,
    getActiveGatewaySecret,
    encryptCloudPayload,
    decryptCloudPayload,
    fetchImpl,
    timeoutMs
  });
  return { runtime, getActiveGatewaySecret, encryptCloudPayload, decryptCloudPayload };
}

function getCall(fetchImpl: typeof fetch, index = 0): [RequestInfo | URL, RequestInit | undefined] {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[index] as [RequestInfo | URL, RequestInit | undefined];
}

describe('Margin Intelligence digest transport', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('loads and decrypts an encrypted digest while preserving its revision', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      key: digest.key,
      encryptedPayload: 'aesgcm:v2:payload'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"4"' }
    })) as unknown as typeof fetch;
    const { runtime, decryptCloudPayload } = createRuntime(fetchImpl);

    await expect(runtime.loadSyncedMarginDigest(digest.key)).resolves.toEqual({
      digest,
      revision: 4,
      migrationStatus: 'not-required'
    });
    expect(decryptCloudPayload).toHaveBeenCalledWith('aesgcm:v2:payload', SECRET);
    const [input, init] = getCall(fetchImpl);
    const url = new URL(String(input));
    expect(url.pathname).toBe('/api/margin-digest');
    expect(url.searchParams.get('key')).toBe(digest.key);
    expect(init).toMatchObject({
      cache: 'no-store',
      headers: { 'X-App-Auth': SECRET, Authorization: `Bearer ${SECRET}` }
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rewrites a legacy plaintext digest with the revision guard but keeps it readable', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(digest), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"3"' }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 4 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: '"4"' }
      })) as unknown as typeof fetch;
    const { runtime, encryptCloudPayload } = createRuntime(fetchImpl);

    await expect(runtime.loadSyncedMarginDigest(digest.key)).resolves.toEqual({
      digest,
      revision: 4,
      migrationStatus: 'migrated'
    });
    expect(encryptCloudPayload).toHaveBeenCalledOnce();
    const [, saveInit] = getCall(fetchImpl, 1);
    expect(saveInit?.headers).toMatchObject({ 'If-Match': '"3"' });
    expect(JSON.parse(String(saveInit?.body))).toEqual({
      key: digest.key,
      encryptedPayload: 'encrypted-payload'
    });
  });

  it('saves only the lookup key and encrypted digest with the expected revision', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 5 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"5"' }
    })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);

    await expect(runtime.saveSyncedMarginDigest(digest, 4)).resolves.toBe(5);
    const [input, init] = getCall(fetchImpl);
    expect(new URL(String(input)).pathname).toBe('/api/margin-digest');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-App-Auth': SECRET,
      Authorization: `Bearer ${SECRET}`,
      'If-Match': '"4"'
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      key: digest.key,
      encryptedPayload: 'encrypted-payload'
    });
    expect(String(init?.body)).not.toContain(digest.analysis);
  });

  it('validates migration inventory and submits bounded resumable batches', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        totalRecords: 2,
        plaintextRecords: 1,
        encryptedV2Records: 1,
        legacyEncryptedRecords: 0,
        unreadableRecords: 0,
        scannedAt: '2026-11-14T10:00:00.000Z',
        migrationReady: false
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        scanned: 2,
        migrated: 1,
        alreadyEncrypted: 1,
        unreadable: 0,
        conflicts: 0,
        nextCursor: null,
        done: true
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);

    await expect(runtime.fetchMarginDigestMigrationInventory()).resolves.toMatchObject({
      totalRecords: 2,
      plaintextRecords: 1,
      migrationReady: false
    });
    await expect(runtime.migrateMarginDigestBatch({
      cursor: 'marginDigestRecord:page-1',
      limit: 2
    })).resolves.toMatchObject({ scanned: 2, migrated: 1, done: true });
    const [batchInput, batchInit] = getCall(fetchImpl, 1);
    expect(new URL(String(batchInput)).pathname).toBe('/api/margin-digest-migration');
    expect(batchInit?.method).toBe('POST');
    expect(JSON.parse(String(batchInit?.body))).toEqual({
      limit: 2,
      cursor: 'marginDigestRecord:page-1'
    });
  });

  it('rejects malformed inventory and batch settings before making requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('null', {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl);

    await expect(runtime.fetchMarginDigestMigrationInventory()).rejects.toThrow('inventory response was invalid');
    expect(fetchImpl).toHaveBeenCalledOnce();
    await expect(runtime.migrateMarginDigestBatch({ limit: 51 })).rejects.toThrow('batch settings are invalid');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('aborts a stalled digest read at its deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })
    ) as unknown as typeof fetch;
    const { runtime } = createRuntime(fetchImpl, 25);

    const request = runtime.loadSyncedMarginDigest(digest.key);
    const rejected = expect(request).rejects.toThrow('Request timed out after 0.025 seconds.');
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    const [, init] = getCall(fetchImpl);
    expect(init?.signal?.aborted).toBe(true);
  });
});
