import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPwaUpdateRuntime,
  PWA_UPDATE_CHECK_INTERVAL_MS
} from './pwaUpdateRuntime';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PWA update runtime', () => {
  it('checks immediately and then repeats every 30 minutes', async () => {
    vi.useFakeTimers();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);
    const runtime = createPwaUpdateRuntime();

    expect(runtime.canCheckNow()).toBe(false);
    runtime.start(checkForUpdate);
    await Promise.resolve();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(runtime.getState().status).toBe('up_to_date');
    expect(runtime.canCheckNow()).toBe(true);

    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS - 1);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(runtime.getState().status).toBe('up_to_date');

    runtime.dispose();
  });

  it('does not overlap an in-flight check', async () => {
    let resolveCheck: (() => void) | undefined;
    const checkForUpdate = vi.fn(() => new Promise<void>((resolve) => { resolveCheck = resolve; }));
    const runtime = createPwaUpdateRuntime();

    runtime.start(checkForUpdate);
    await Promise.resolve();
    await runtime.checkNow();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(runtime.canCheckNow()).toBe(false);
    resolveCheck?.();
    await Promise.resolve();
    runtime.dispose();
  });

  it('skips interval checks while hidden and catches up when the tab becomes visible', async () => {
    vi.useFakeTimers();
    const listeners = new Set<() => void>();
    const fakeDocument = {
      visibilityState: 'visible',
      addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); }
    };
    vi.stubGlobal('document', fakeDocument);
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);
    const runtime = createPwaUpdateRuntime();

    runtime.start(checkForUpdate);
    await Promise.resolve();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    fakeDocument.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    fakeDocument.visibilityState = 'visible';
    listeners.forEach((listener) => listener());
    await Promise.resolve();
    expect(checkForUpdate).toHaveBeenCalledTimes(2);

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
    await Promise.resolve();
    expect(runtime.getState().status).toBe('error');
    expect(runtime.getState().lastCheckedAt).not.toBeNull();
    expect(runtime.canCheckNow()).toBe(true);

    await runtime.checkNow();
    expect(runtime.getState().status).toBe('up_to_date');
    expect(runtime.canCheckNow()).toBe(true);
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('does not repeat checks while an update is waiting for the next startup', async () => {
    vi.useFakeTimers();
    const checkForUpdate = vi.fn().mockResolvedValue(undefined);
    const runtime = createPwaUpdateRuntime();

    runtime.start(checkForUpdate);
    await Promise.resolve();
    runtime.markUpdateAvailable();
    await vi.advanceTimersByTimeAsync(PWA_UPDATE_CHECK_INTERVAL_MS);
    await runtime.checkNow();

    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(runtime.getState().status).toBe('update_waiting');
    runtime.dispose();
  });

  it('does not offer retry when service-worker registration never succeeded', () => {
    const runtime = createPwaUpdateRuntime();
    runtime.markError();

    expect(runtime.getState().status).toBe('error');
    expect(runtime.canCheckNow()).toBe(false);
    runtime.dispose();
  });
});
