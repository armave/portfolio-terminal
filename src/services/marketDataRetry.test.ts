import { describe, expect, it, vi } from 'vitest';
import { isRetryableMarketDataError, retryMarketDataRequest } from './marketDataRetry';

describe('market-data retry policy', () => {
  it('retries transient network and server failures with bounded exponential delays', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }))
      .mockResolvedValue('ok');
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    await expect(retryMarketDataRequest(request, { attempts: 3, baseDelayMs: 100, maxDelayMs: 500, sleep }))
      .resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([100, 200]);
  });

  it('does not retry authentication, validation, or caller-aborted requests', async () => {
    const unauthorized = Object.assign(new Error('unauthorized'), { status: 401 });
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(isRetryableMarketDataError(unauthorized)).toBe(false);
    expect(isRetryableMarketDataError(aborted)).toBe(false);
    const request = vi.fn().mockRejectedValue(unauthorized);
    const sleep = vi.fn(async () => undefined);
    await expect(retryMarketDataRequest(request, { attempts: 3, sleep })).rejects.toBe(unauthorized);
    expect(request).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('bounds attempts and does not retry provider data-quality errors by default', async () => {
    const invalidQuote = new Error('Provider returned no valid quote.');
    expect(isRetryableMarketDataError(invalidQuote)).toBe(false);
    const request = vi.fn().mockRejectedValue(invalidQuote);
    await expect(retryMarketDataRequest(request, { attempts: 10 })).rejects.toBe(invalidQuote);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('falls back to safe retry bounds for non-finite numeric options', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('ok');
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    await expect(retryMarketDataRequest(request, {
      attempts: Number.NaN,
      baseDelayMs: Number.NaN,
      maxDelayMs: Number.POSITIVE_INFINITY,
      sleep
    })).resolves.toBe('ok');
    expect(request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('supports provider-specific retry classification', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('provider temporarily unavailable')).mockResolvedValue(42);
    await expect(retryMarketDataRequest(request, {
      attempts: 2,
      baseDelayMs: 0,
      shouldRetry: error => error instanceof Error && error.message.includes('temporarily unavailable'),
      sleep: async () => undefined
    })).resolves.toBe(42);
  });
});
