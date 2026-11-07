/**
 * Bounded retry helper for optimistic-revision cloud writes.
 *
 * The caller creates one idempotency key and passes an immutable request body.
 * Only ambiguous network failures and transient server errors are retried once.
 */
export function createCloudWriteIdempotencyKey(): string {
  return `cloud:${globalThis.crypto.randomUUID()}`;
}

export async function fetchIdempotentCloudWrite(
  fetcher: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  isCurrentSession: () => boolean
): Promise<Response> {
  let firstResponse: Response | undefined;
  try {
    firstResponse = await fetcher(input, init);
    if (firstResponse.status < 500 || !isCurrentSession()) return firstResponse;
  } catch (error) {
    if (!isCurrentSession()) throw error;
  }
  if (!isCurrentSession()) throw new Error('Cloud account session changed before the write retry.');
  return fetcher(input, init);
}
