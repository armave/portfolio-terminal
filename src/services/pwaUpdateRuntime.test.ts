import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPwaUpdateRuntime,
  PWA_UPDATE_CHECK_INTERVAL_MS
} from './pwaUpdateRuntime';

afterEach(() => {
  vi.useRealTimers();
});

describe('PWA update runtime', () => {
  it('checks immediately and then repeats every 30 minutes', async () => {
    vi.useFakeTimers();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);
    const runtime = createPwaUpdateRuntime();

    expect(runtime.canCheckNow()).toBe(false);
    runtime.start(checkForUpdate);
    await vi.waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
    expect(runtime.getState().status).toBe('up_to_date');
    expect(runtime.canCheckNow()).toBe(true);

    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS - 1);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(runtime.getState().status).toBe('up_to_date');

    runtime.dispose();
  });

  it('does not overlap checks or poll while the document is hidden', async () => {
    vi.useFakeTimers();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);
    const runtime = createPwaUpdateRuntime();
    runtime.start(checkForUpdate);

    await vi.waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: vi.fn(), removeEventListener: vi.fn() });
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    runtime.dispose();
  });

  it('records update availability and keeps it waiting after an in-flight check resolves', async () => {
    let resolveCheck: (() => void) | undefined;
    const checkForUpdate = vi.fn(() => new Promise<void>((resolve) => { resolveCheck = resolve; }));
    const runtime = createPwaUpdateRuntime();

    runtime.start(checkForUpdate);
    runtime.markUpdateAvailable();
    expect(runtime.canCheckNow()).toBe(false);
    resolveCheck?.();
    await Promise.resolve();

    expect(runtime.getState().status).toBe('update_waiting');
    runtime.dispose();
  });

  it('records failed checks and permits an explicit retry', async () => {
    const checkForUpdate = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const runtime = createPwaUpdateRuntime();

    runtime.start(checkForUpdate);
    await vi.waitFor(() => expect(runtime.getState().status).toBe('error'));
    expect(runtime.getState().lastCheckedAt).not.toBeNull();

    await runtime.checkNow();
    expect(runtime.getState().status).toBe('up_to_date');
    expect(runtime.canCheckNow()).toBe(true);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('does not activate a waiting update or repeat checks until the next app startup', async () => {
    vi.useFakeTimers();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);
    const runtime = createPwaUpdateRuntime();

    runtime.start(checkForUpdate);
    await vi.waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
    runtime.markUpdateAvailable();
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    await runtime.checkNow();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(runtime.getState().status).toBe('update_waiting');
    runtime.dispose();
  });
});


  it('does not offer retry when service-worker registration never succeeded', () => {
    const runtime = createPwaUpdateRuntime();
    runtime.markError();

    expect(runtime.getState().status).toBe('error');
    expect(runtime.canCheckNow()).toBe(false);
    runtime.dispose();
  });
