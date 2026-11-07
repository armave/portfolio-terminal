import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudWriteIdempotencyKey, fetchIdempotentCloudWrite } from './cloudWriteRetry';

describe('cloud write idempotency key generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses randomUUID when the runtime supports it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-request-id' });
    expect(createCloudWriteIdempotencyKey()).toBe('cloud:test-request-id');
  });

  it('uses Web Crypto random values when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(7);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    expect(createCloudWriteIdempotencyKey()).toBe('cloud:07070707070707070707070707070707');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('retains a last-resort fallback when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(createCloudWriteIdempotencyKey()).toBe('cloud:80808080808080808080808080808080');
  });
});

describe('cloud write retry behavior', () => {
  it('retries one transient 5xx with the exact same body, revision and idempotency key', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('temporary failure', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const init: RequestInit = {
      method: 'POST',
      headers: { 'If-Match': '"7"', 'Content-Type': 'application/json' },
      body: '{"encryptedPayload":"same"}'
    };

    const response = await fetchIdempotentCloudWrite(fetcher, '/api/state', init, () => true);

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = fetcher.mock.calls[0][1]!;
    const retry = fetcher.mock.calls[1][1]!;
    expect(retry.body).toBe(first.body);
    expect(retry.headers).toEqual(first.headers);
    expect(retry.headers).toMatchObject({
      'If-Match': '"7"',
      'Content-Type': 'application/json',
      'Idempotency-Key': expect.stringMatching(/^cloud:/)
    });
  });

  it('retries one ambiguous network rejection using the same request identity', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await fetchIdempotentCloudWrite(fetcher, '/api/history', {
      method: 'POST',
      body: '{"encryptedHistory":"same"}'
    }, () => true);

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]?.headers).toEqual(fetcher.mock.calls[0][1]?.headers);
  });

  it('does not retry client errors or stale authenticated sessions', async () => {
    const conflictFetcher = vi.fn().mockResolvedValue(new Response('conflict', { status: 409 }));
    const conflict = await fetchIdempotentCloudWrite(conflictFetcher, '/api/state', { method: 'POST' }, () => true);
    expect(conflict.status).toBe(409);
    expect(conflictFetcher).toHaveBeenCalledTimes(1);

    const staleFetcher = vi.fn().mockResolvedValue(new Response('temporary failure', { status: 503 }));
    const stale = await fetchIdempotentCloudWrite(staleFetcher, '/api/state', { method: 'POST' }, () => false);
    expect(stale.status).toBe(503);
    expect(staleFetcher).toHaveBeenCalledTimes(1);
  });

  it('does not retry after a network rejection if the account session changed', async () => {
    const error = new TypeError('connection reset');
    const fetcher = vi.fn().mockRejectedValue(error);
    await expect(fetchIdempotentCloudWrite(fetcher, '/api/state', { method: 'POST' }, () => false))
      .rejects.toBe(error);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
