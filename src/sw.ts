/// <reference lib="webworker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision?: string | null }>;
};

// Keep the static-only Workbox precache contract. No API, portfolio, account,
// credential, or broker response is added to runtime caching.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Preserve the generated worker's app-shell fallback for scoped SPA navigation.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const message = event.data as { type?: unknown } | null;
  if (message?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (message?.type !== 'PORTFOLIO_TERMINAL_QUERY_APP_CLIENTS') return;
  const replyPort = event.ports[0];
  if (!replyPort) return;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });
    const appScope = self.registration.scope;
    const appClients = windows.filter((client) => client.url.startsWith(appScope));
    replyPort.postMessage({
      type: 'PORTFOLIO_TERMINAL_APP_CLIENT_COUNT',
      clientCount: appClients.length
    });
  })());
});
