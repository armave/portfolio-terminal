import { describe, expect, it, vi } from 'vitest';
import {
  createPwaConnectivityRuntime,
  type PwaConnectivityTarget
} from './pwaConnectivityRuntime';

function createTarget(initialOnline = true) {
  const listeners = new Map<string, Set<EventListener>>();
  const navigatorState = { onLine: initialOnline };
  const target = {
    navigator: navigatorState,
    addEventListener: (type: string, listener: EventListener) => {
      const handlers = listeners.get(type) ?? new Set<EventListener>();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }
  } as unknown as PwaConnectivityTarget;

  return {
    target,
    setOnline(online: boolean) {
      navigatorState.onLine = online;
      listeners.get(online ? 'online' : 'offline')?.forEach((listener) => listener(new Event(online ? 'online' : 'offline')));
    }
  };
}

describe('PWA connectivity runtime', () => {
  it('starts offline when the browser reports no network connection', () => {
    const fixture = createTarget(false);
    const checkService = vi.fn(async () => undefined);
    const runtime = createPwaConnectivityRuntime(fixture.target, checkService);

    expect(runtime.getState()).toBe('offline');
    expect(checkService).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('does not clear the reconnect banner until the application service responds', async () => {
    const fixture = createTarget(false);
    const checkService = vi.fn(async () => undefined);
    const runtime = createPwaConnectivityRuntime(fixture.target, checkService);

    fixture.setOnline(true);
    expect(runtime.getState()).toBe('reconnecting');
    await vi.waitFor(() => expect(runtime.getState()).toBe('online'));
    expect(checkService).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('shows service unavailability after a failed check and supports retry', async () => {
    const fixture = createTarget(false);
    const checkService = vi.fn()
      .mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(undefined);
    const runtime = createPwaConnectivityRuntime(fixture.target, checkService);

    fixture.setOnline(true);
    await vi.waitFor(() => expect(runtime.getState()).toBe('unavailable'));
    await runtime.retry();
    expect(runtime.getState()).toBe('online');
    expect(checkService).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it('ignores a late successful probe after the browser goes offline again', async () => {
    const fixture = createTarget(false);
    let resolveProbe: (() => void) | undefined;
    const checkService = vi.fn(() => new Promise<void>((resolve) => { resolveProbe = resolve; }));
    const runtime = createPwaConnectivityRuntime(fixture.target, checkService);

    fixture.setOnline(true);
    expect(runtime.getState()).toBe('reconnecting');
    fixture.setOnline(false);
    resolveProbe?.();
    await Promise.resolve();

    expect(runtime.getState()).toBe('offline');
    runtime.dispose();
  });

  it('removes its event handlers when disposed', () => {
    const fixture = createTarget(false);
    const checkService = vi.fn(async () => undefined);
    const runtime = createPwaConnectivityRuntime(fixture.target, checkService);
    runtime.dispose();
    fixture.setOnline(true);
    expect(checkService).not.toHaveBeenCalled();
    expect(runtime.getState()).toBe('offline');
  });
});
