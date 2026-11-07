import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCloudWriteIdempotencyKey } from './cloudWriteRetry';

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
