import { describe, expect, it, vi } from 'vitest';
import { repairBrowserProfile } from './browserProfileRepairRuntime';

function createRegistration(scope: string) {
  return {
    scope,
    unregister: vi.fn(async () => true)
  } as unknown as ServiceWorkerRegistration & { unregister: ReturnType<typeof vi.fn> };
}

describe('browser profile repair', () => {
  it('unregisters only the exact app scope and deletes only its Workbox precache', async () => {
    const registration = createRegistration('https://example.test/portfolio-terminal/');
    const deleteCache = vi.fn(async () => true);
    const reload = vi.fn();
    const result = await repairBrowserProfile({
      appBaseUrl: '/portfolio-terminal/',
      origin: 'https://example.test',
      getServiceWorkerRegistration: vi.fn(async () => registration),
      getCacheNames: vi.fn(async () => [
        'workbox-precache-v2-https://example.test/portfolio-terminal/',
        'workbox-precache-v2-https://example.test/another-app/',
        'workbox-runtime-v2',
        'portfolio-terminal-user-cache'
      ]),
      deleteCache,
      reload,
      now: () => 12345
    });

    expect(registration.unregister).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith(
      'workbox-precache-v2-https://example.test/portfolio-terminal/'
    );
    expect(result).toMatchObject({
      serviceWorkerUnregistered: true,
      precacheCachesDeleted: 1,
      reloadUrl: 'https://example.test/portfolio-terminal/?_pt_repair=12345'
    });
    expect(reload).toHaveBeenCalledWith(result.reloadUrl);
  });

  it('does not unregister a broader/root service worker', async () => {
    const registration = createRegistration('https://example.test/');
    const reload = vi.fn();

    const result = await repairBrowserProfile({
      appBaseUrl: '/portfolio-terminal/',
      origin: 'https://example.test',
      getServiceWorkerRegistration: async () => registration,
      getCacheNames: async () => [],
      deleteCache: vi.fn(),
      reload,
      now: () => 1
    });

    expect(registration.unregister).not.toHaveBeenCalled();
    expect(result.serviceWorkerUnregistered).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when service-worker or Cache Storage APIs fail', async () => {
    const reload = vi.fn();

    const result = await repairBrowserProfile({
      appBaseUrl: '/portfolio-terminal/',
      origin: 'https://example.test',
      getServiceWorkerRegistration: async () => { throw new Error('blocked'); },
      getCacheNames: async () => { throw new Error('blocked'); },
      deleteCache: vi.fn(),
      reload,
      now: () => 987
    });

    expect(result.serviceWorkerUnregistered).toBe(false);
    expect(result.precacheCachesDeleted).toBe(0);
    expect(reload).toHaveBeenCalledWith('https://example.test/portfolio-terminal/?_pt_repair=987');
  });

  it('preserves other app caches and local data APIs are never accessed', async () => {
    const getCacheNames = vi.fn(async () => [
      'workbox-precache-v2-https://example.test/portfolio-terminal/',
      'workbox-precache-v2-https://example.test/other/'
    ]);
    const deleteCache = vi.fn(async () => false);
    const reload = vi.fn();

    await repairBrowserProfile({
      appBaseUrl: '/portfolio-terminal/',
      origin: 'https://example.test',
      getServiceWorkerRegistration: async () => undefined,
      getCacheNames,
      deleteCache,
      reload,
      now: () => 2
    });

    expect(deleteCache).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith(
      'workbox-precache-v2-https://example.test/portfolio-terminal/'
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
