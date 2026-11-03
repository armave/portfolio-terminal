export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export async function fetchAndConsumeWithTimeout<T>(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  consumeResponse: (response: Response) => Promise<T>,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Request timeout must be a positive finite number.');
  }

  const controller = new AbortController();
  const externalSignal = init.signal;
  let timeoutError: Error | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  let rejectAbort!: (reason?: unknown) => void;
  const abortRequest = () => {
    rejectAbort(timeoutError || controller.signal.reason || new Error('Request aborted.'));
  };

  if (externalSignal?.aborted) {
    throw externalSignal.reason || new Error('Request aborted.');
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  }

  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
    if (controller.signal.aborted) {
      abortRequest();
    } else {
      controller.signal.addEventListener('abort', abortRequest, { once: true });
    }
  });

  timeoutId = setTimeout(() => {
    timeoutError = new Error(`Request timed out after ${timeoutMs / 1000} seconds.`);
    controller.abort(timeoutError);
  }, timeoutMs);

  try {
    const request = fetchImpl(input, { ...init, signal: controller.signal })
      .then(consumeResponse);
    return await Promise.race([request, abortPromise]);
  } catch (error) {
    if (timeoutError) throw timeoutError;
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', abortFromExternal);
    controller.signal.removeEventListener('abort', abortRequest);
  }
}
