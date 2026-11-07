/**
 * Bounded retry helper for optimistic-revision cloud writes.
 *
 * Creates one request key and retries ambiguous network/5xx failures once.
 */
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
      'Idempotency-Key': `cloud:${globalThis.crypto.randomUUID()}`
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
