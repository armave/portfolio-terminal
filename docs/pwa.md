# Progressive Web App

## Implemented behavior

The production client uses `vite-plugin-pwa` and Workbox. The manifest uses the GitHub Pages base path `/portfolio-terminal/`, a stable application ID, standalone display mode, a 192px PNG icon and a 512px maskable SVG icon. The HTML document declares a 180px Apple touch icon and Apple standalone metadata. The manifest does not lock the application to portrait orientation.

The install event is captured during application module startup, before a Settings screen is opened. The native install prompt is invoked only after a user clicks Install. iPhone/iPad users receive Add to Home Screen instructions; the app does not attempt to show a Chromium prompt on iOS. The `appinstalled` event and standalone display-mode changes update the installed state.

The application-level connectivity banner distinguishes:
- **Offline:** the browser reports no available network.
- **Reconnecting:** the browser reports a network connection and the app is checking the unauthenticated `/api/auth/status` endpoint.
- **Service unavailable:** the application status endpoint did not respond successfully; the user can retry.

The reconnect check reads only the public application setup/status response. It does not request account data, portfolio snapshots, broker balances, orders, or quotes. A successful status response only confirms that the application status endpoint responded; cloud synchronization, broker connectivity, quote availability and quote freshness remain independent.

Device Check now reports whether the app-scoped Workbox precache contains the document, entry script and stylesheet. This is a static-shell check, not a promise that authentication or financial data is available offline.

## Offline and security boundary

Workbox precaches the static application shell and static assets only. No runtime caching rule is added for Worker API responses. The PWA must not cache authenticated state, guest projections, portfolio snapshots, cloud history, broker balances, active orders, quotes, session credentials or encryption keys.

Offline availability means that the cached application document and static assets can load. It does **not** mean that authentication or an authenticated owner/guest portfolio is available offline. The normal identity lookup and the existing `offline` storage namespace remain authoritative. A failed or unresolved authentication transition must not expose an earlier authenticated workspace. No service-worker change may bypass that isolation or hydrate an authenticated portfolio from an unauthenticated cache.

The reconnect banner is not a synchronization command. Existing role-specific refresh scheduling, cloud revision checks, last-known-good recovery and quote freshness rules remain unchanged. A successful `/api/auth/status` response is not evidence that market data is fresh or that a portfolio has synchronized.

## Service-worker updates and recovery

The startup update gate is preserved and made observable:
- the app checks for an update immediately after service-worker registration and then every 30 minutes while the page is visible;
- returning to a visible tab triggers a catch-up check when at least 30 minutes have elapsed since the previous attempt;
- Settings → Diagnostics & Maintenance shows the latest update-check state and timestamp, and offers a safe Check now action;
- a check only discovers and stages updates; it does not bypass the startup activation gate;
- updates discovered while the startup overlay is active can activate automatically;
- updates discovered after startup remain waiting until the next app startup;
- first controller acquisition does not force a reload;
- startup cache repair removes only the app-scoped service worker and Workbox precache and preserves account data.

An update-check failure after successful service-worker registration is shown as a check failure, not as proof that the app is out of date; the runtime retries on the next interval. If registration itself fails, Settings explains that reopening the app is required to retry registration. Check now performs another detection attempt only when a registration is available; it never forces a reload or applies a waiting worker mid-session.

Do not switch back to unconditional `autoUpdate` activation or clear localStorage/IndexedDB as part of PWA repair.

## Validation

`npm run test:pwa` runs the production build through Vite preview with Playwright service workers enabled. It verifies the generated manifest and icon URLs, the Apple touch icon, exact app scope, an active app-scoped service-worker registration, one Workbox precache containing the app document/entry-script/stylesheet, exclusion of API URLs from that precache, and a cold offline navigation that displays the offline status.

The existing unit suite separately tests install-event capture, user-initiated prompting, iOS detection, reconnect verification, failed service checks, retry, and stale connectivity-probe races. Existing browser performance and Operations journeys remain isolated from service-worker caching to preserve reproducible measurements.

## Manual release verification

After exact-head GitHub Actions pass, verify on real devices:
- Android Chrome: install prompt, accepted install, standalone launch and relaunch.
- Desktop Chrome/Edge: install prompt, standalone launch, a 30-minute visible-tab update check, Settings status, and safe update activation.
- iPhone/iPad Safari: Add to Home Screen guidance, touch icon, standalone launch and status-bar appearance.
- Offline restart: cached shell opens, authenticated data remains unavailable until identity is verified online.
- Reconnection: banner remains while the application status endpoint is unavailable and clears only after a successful status response.

The automated offline test uses a fresh browser profile and does not certify real authenticated cloud, broker, or market-data behavior.
