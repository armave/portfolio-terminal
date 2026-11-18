import { describe, expect, it, vi } from 'vitest';
import {
  createPwaInstallRuntime,
  isIOSDevice,
  type PwaInstallTarget
} from './pwaInstallRuntime';

function createTarget(userAgent = 'Mozilla/5.0 Chrome/126.0', installed = false) {
  const eventListeners = new Map<string, Set<EventListener>>();
  const mediaListeners = new Set<EventListener>();
  const mediaQuery = {
    matches: installed,
    addEventListener: (_type: string, listener: EventListener) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => mediaListeners.delete(listener)
  };
  const target = {
    navigator: {
      userAgent,
      platform: userAgent.includes('iPhone') ? 'iPhone' : 'Linux x86_64',
      maxTouchPoints: 0,
      standalone: false
    },
    matchMedia: vi.fn(() => mediaQuery),
    addEventListener: (type: string, listener: EventListener) => {
      const listeners = eventListeners.get(type) ?? new Set<EventListener>();
      listeners.add(listener);
      eventListeners.set(type, listeners);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      eventListeners.get(type)?.delete(listener);
    }
  } as unknown as PwaInstallTarget;

  return {
    target,
    dispatch(type: string, event = new Event(type, { cancelable: true })) {
      eventListeners.get(type)?.forEach((listener) => listener(event));
    },
    dispatchDisplayModeChange() {
      mediaListeners.forEach((listener) => listener(new Event('change')));
    }
  };
}

describe('PWA install runtime', () => {
  it('captures the install event early and requests the native prompt only on user action', async () => {
    const fixture = createTarget();
    const runtime = createPwaInstallRuntime(fixture.target);
    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const })
    });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    fixture.dispatch('beforeinstallprompt', event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(runtime.getState().canInstall).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    await expect(runtime.promptInstall()).resolves.toBe('accepted');
    expect(prompt).toHaveBeenCalledOnce();
    expect(runtime.getState().canInstall).toBe(false);
    runtime.dispose();
  });

  it('does not reuse a dismissed, one-use install prompt', async () => {
    const fixture = createTarget();
    const runtime = createPwaInstallRuntime(fixture.target);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: 'dismissed' as const })
    });
    fixture.dispatch('beforeinstallprompt', event);

    await expect(runtime.promptInstall()).resolves.toBe('dismissed');
    await expect(runtime.promptInstall()).resolves.toBe('unavailable');
    runtime.dispose();
  });

  it('marks the app installed after browser installation or standalone mode', () => {
    const fixture = createTarget();
    const runtime = createPwaInstallRuntime(fixture.target);
    fixture.dispatch('appinstalled');
    expect(runtime.getState().installed).toBe(true);
    expect(runtime.getState().canInstall).toBe(false);

    const standalone = createTarget('Mozilla/5.0 Chrome/126.0', true);
    const standaloneRuntime = createPwaInstallRuntime(standalone.target);
    expect(standaloneRuntime.getState().installed).toBe(true);
    runtime.dispose();
    standaloneRuntime.dispose();
  });

  it('detects iOS and iPadOS desktop-mode user agents for manual installation guidance', () => {
    expect(isIOSDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(isIOSDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5)).toBe(true);
    expect(isIOSDevice('Mozilla/5.0 Chrome/126.0', 'Linux x86_64', 0)).toBe(false);
  });
});
