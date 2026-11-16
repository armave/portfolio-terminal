export interface BrowserProfileRepairDependencies {
  appBaseUrl: string;
  origin: string;
  getServiceWorkerRegistration: (scope: string) => Promise<ServiceWorkerRegistration | undefined>;
  getCacheNames: () => Promise<string[]>;
  deleteCache: (name: string) => Promise<boolean>;
  reload: (url: string) => void;
  now?: () => number;
}

export interface BrowserProfileRepairResult {
  serviceWorkerUnregistered: boolean;
  precacheCachesDeleted: number;
  reloadUrl: string;
}

/**
 * Removes only this app's service worker and Workbox precache.
 *
 * Portfolio localStorage, IndexedDB, encrypted Gateway credentials, and all
 * non-precache caches are deliberately left untouched. This is a shell repair,
 * not a portfolio reset or sign-out.
 */
export async function repairBrowserProfile(
  dependencies: BrowserProfileRepairDependencies
): Promise<BrowserProfileRepairResult> {
  const appScope = new URL(dependencies.appBaseUrl, dependencies.origin);
  if (!appScope.pathname.endsWith('/')) appScope.pathname += '/';

  let serviceWorkerUnregistered = false;
  try {
    const registration = await dependencies.getServiceWorkerRegistration(appScope.href);
    if (registration) {
      const registeredScope = new URL(registration.scope);
      const registrationMatchesApp =
        registeredScope.origin === appScope.origin &&
        (registeredScope.pathname.endsWith('/') ? registeredScope.pathname : registeredScope.pathname + '/') === appScope.pathname;
      if (registrationMatchesApp) {
        serviceWorkerUnregistered = await registration.unregister();
      }
    }
  } catch (error) {
    console.warn('[Browser Repair]: Could not unregister the app service worker.', error);
  }

  let precacheCachesDeleted = 0;
  try {
    const cacheNames = await dependencies.getCacheNames();
    const appPrecacheNames = cacheNames.filter((name) =>
      name.startsWith('workbox-precache-') && name.includes(appScope.pathname)
    );
    for (const name of appPrecacheNames) {
      try {
        if (await dependencies.deleteCache(name)) precacheCachesDeleted += 1;
      } catch (error) {
        console.warn('[Browser Repair]: Could not remove an app precache.', error);
      }
    }
  } catch (error) {
    console.warn('[Browser Repair]: Could not inspect browser app caches.', error);
  }

  const reloadUrl = new URL(appScope.href);
  reloadUrl.searchParams.set('_pt_repair', String((dependencies.now ?? Date.now)()));
  dependencies.reload(reloadUrl.href);

  return {
    serviceWorkerUnregistered,
    precacheCachesDeleted,
    reloadUrl: reloadUrl.href
  };
}

/** Repair the current Portfolio Terminal shell without touching saved portfolio data. */
export async function repairCurrentBrowserAppCache(): Promise<BrowserProfileRepairResult> {
  if (typeof window === 'undefined') {
    throw new Error('Browser profile repair is available only in a browser.');
  }

  return repairBrowserProfile({
    appBaseUrl: import.meta.env.BASE_URL,
    origin: window.location.origin,
    getServiceWorkerRegistration: async (scope) => {
      if (!('serviceWorker' in navigator)) return undefined;
      return (await navigator.serviceWorker.getRegistration(scope)) ?? undefined;
    },
    getCacheNames: async () => {
      if (!('caches' in window)) return [];
      return window.caches.keys();
    },
    deleteCache: async (name) => {
      if (!('caches' in window)) return false;
      return window.caches.delete(name);
    },
    reload: (url) => window.location.replace(url)
  });
}
