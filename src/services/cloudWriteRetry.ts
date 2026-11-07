/**
 * Bounded retry helper for optimistic-revision cloud writes.
 *
 * Creates one request key and retries ambiguous network/5xx failures once.
 */
export function createCloudWriteIdempotencyKey(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return `cloud:${cryptoApi.randomUUID()}`;
  }

  // Older secure-context runtimes expose Web Crypto without randomUUID.
  // Keep this identifier independent of authentication and never use payload data.
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    // Last-resort collision-resistant request identity for legacy runtimes.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return `cloud:${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export async function fetchIdempotentCloudWrite(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  isCurrentSession: () => boolean
): Promise<Response> {
  const requestInit: RequestInit = {
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      'Idempotency-Key': createCloudWriteIdempotencyKey()
    }
  };
  try {
    const firstResponse = await fetcher(input, requestInit);
    if (firstResponse.status < 500 || !isCurrentSession()) return firstResponse;
  } catch (error) {
    if (!isCurrentSession()) throw error;
  }
  if (!isCurrentSession()) throw new Error('Cloud account session changed before the write retry.');
  return fetcher(input, requestInit);
}
