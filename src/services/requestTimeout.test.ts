import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAndConsumeWithTimeout } from './requestTimeout';

describe('REST request timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts a request that does not return headers before its deadline', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })
    ) as unknown as typeof fetch;
    const request = fetchAndConsumeWithTimeout(fetchImpl, 'https://worker.example/api', {}, async (response) => response.text(), 25);
    const rejected = expect(request).rejects.toThrow('Request timed out after 0.025 seconds.');

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('keeps the timeout active while consuming the response body', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('ok')) as unknown as typeof fetch;
    const request = fetchAndConsumeWithTimeout(
      fetchImpl,
      'https://worker.example/api',
      {},
      () => new Promise<string>(() => {}),
      25
    );
    const rejected = expect(request).rejects.toThrow('Request timed out after 0.025 seconds.');

    await vi.advanceTimersByTimeAsync(25);
    await rejected;
  });

  it('preserves caller cancellation instead of reporting it as a timeout', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      })
    ) as unknown as typeof fetch;
    const request = fetchAndConsumeWithTimeout(
      fetchImpl,
      'https://worker.example/api',
      { signal: controller.signal },
      async (response) => response.text(),
      10_000
    );

    controller.abort(new Error('Caller cancelled.'));
    await expect(request).rejects.toThrow('Caller cancelled.');
  });

  it('does not start a request when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Already cancelled.'));
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(fetchAndConsumeWithTimeout(
      fetchImpl,
      'https://worker.example/api',
      { signal: controller.signal },
      async (response) => response.text()
    )).rejects.toThrow('Already cancelled.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
