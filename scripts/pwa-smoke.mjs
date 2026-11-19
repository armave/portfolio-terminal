import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.PWA_SMOKE_PORT || 4175);
const appUrl = `http://${host}:${port}/portfolio-terminal/`;
const expectedScope = new URL('/portfolio-terminal/', appUrl).href;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', host, '--port', String(port), '--strictPort'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' }, windowsHide: true }
);

let serverOutput = '';
let browser;
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });

async function waitForPreview() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite preview exited before PWA smoke: ${serverOutput}`);
    }
    try {
      const response = await fetch(appUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`Vite preview returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`PWA preview did not become ready: ${lastError?.message || 'unknown error'}\n${serverOutput}`);
}

try {
  await waitForPreview();

  const manifestUrl = new URL('manifest.webmanifest', appUrl);
  const manifestResponse = await fetch(manifestUrl);
  assert.equal(manifestResponse.status, 200, 'production manifest must be reachable');
  const manifest = await manifestResponse.json();

  assert.equal(manifest.id, '/portfolio-terminal/', 'manifest ID must be stable and app-scoped');
  assert.equal(manifest.scope, '/portfolio-terminal/', 'manifest scope must match GitHub Pages base path');
  assert.equal(manifest.start_url, '/portfolio-terminal/', 'manifest start URL must match GitHub Pages base path');
  assert.equal(manifest.display, 'standalone', 'installed app must open in standalone mode');
  assert.ok(Array.isArray(manifest.icons), 'manifest must declare icons');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'), 'manifest must include a 192px PNG icon');
  assert.ok(
    manifest.icons.some((icon) => icon.sizes === '512x512' && String(icon.purpose || '').includes('maskable')),
    'manifest must include a 512px maskable icon'
  );

  for (const icon of manifest.icons) {
    const iconUrl = new URL(icon.src, manifestUrl);
    assert.ok(iconUrl.pathname.startsWith('/portfolio-terminal/'), `icon escaped the app scope: ${iconUrl.pathname}`);
    const iconResponse = await fetch(iconUrl);
    assert.equal(iconResponse.status, 200, `manifest icon must load: ${iconUrl.pathname}`);
    const iconBytes = await iconResponse.arrayBuffer();
    assert.ok(iconBytes.byteLength > 0, 'manifest icon must not be empty');
  }

  const htmlResponse = await fetch(appUrl);
  const html = await htmlResponse.text();
  assert.match(html, /rel=["']apple-touch-icon["']/i, 'HTML must declare an Apple touch icon');
  const appleIconResponse = await fetch(new URL('/portfolio-terminal/pwa-180.png', appUrl));
  assert.equal(appleIconResponse.status, 200, 'Apple touch icon must be reachable');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(async (scope) => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.some((registration) =>
      registration.scope === scope &&
      registration.installing === null &&
      registration.waiting === null &&
      registration.active?.state === 'activated'
    );
  }, expectedScope, { timeout: 15_000 });
  // Registration/activation is the lifecycle contract here. Control of an
  // existing page is browser-timing dependent; the subsequent offline cold
  // navigation below proves that the worker actually serves the cached shell.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 10_000 });

  const queryAppClientCount = (targetPage) => targetPage.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active;
    if (!worker) throw new Error('The app service worker is not active.');
    const channel = new MessageChannel();
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The service worker did not answer the app-client query.')), 2_000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        const response = event.data;
        if (response?.type !== 'PORTFOLIO_TERMINAL_APP_CLIENT_COUNT') {
          reject(new Error('The service worker returned an invalid app-client response.'));
          return;
        }
        resolve(response.clientCount);
      };
    });
    worker.postMessage({ type: 'PORTFOLIO_TERMINAL_QUERY_APP_CLIENTS' }, [channel.port2]);
    return result;
  });

  assert.equal(await queryAppClientCount(page), 1, 'one open app tab must be reported as one scoped client');
  const secondAppPage = await context.newPage();
  await secondAppPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await secondAppPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 10_000 });
  assert.equal(await queryAppClientCount(page), 2, 'the waiting-worker probe must see another open app tab');
  await secondAppPage.close();
  assert.equal(await queryAppClientCount(page), 1, 'closing the other app tab must restore the single-client state');

  // Poll in one browser evaluation and return the final plain-JSON cache snapshot.
  // Registration readiness and the cache audit must refer to the same stable worker.
  const cacheAudit = await page.evaluate(async (scopePath) => {
    const deadline = Date.now() + 15_000;
    let latestEntries = [];

    while (Date.now() < deadline) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find((candidate) =>
        candidate.scope === new URL(scopePath, location.origin).href
      );
      const workerReady = Boolean(
        registration &&
        registration.installing === null &&
        registration.waiting === null &&
        registration.active?.state === 'activated'
      );

      const cacheNames = (await caches.keys()).filter((name) => name.startsWith('workbox-precache-'));
      const cacheEntries = [];
      let hasCompleteAppShell = false;

      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        const urls = requests.map((request) => request.url);
        const paths = urls.map((url) => new URL(url).pathname);
        const hasDocument = paths.some((path) =>
          path === scopePath || path === scopePath + 'index.html'
        );
        const hasEntryScript = paths.some((path) => {
          const fileName = path.slice(path.lastIndexOf('/') + 1);
          return path.startsWith(scopePath + 'assets/') &&
            fileName.startsWith('index-') &&
            fileName.endsWith('.js');
        });
        const hasStylesheet = paths.some((path) =>
          path.startsWith(scopePath + 'assets/') && path.endsWith('.css')
        );
        cacheEntries.push({ name, urls });
        if (hasDocument && hasEntryScript && hasStylesheet) hasCompleteAppShell = true;
      }

      latestEntries = cacheEntries;
      if (workerReady && hasCompleteAppShell) return { cacheEntries };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return { cacheEntries: latestEntries };
  }, '/portfolio-terminal/');

  assert.ok(cacheAudit.cacheEntries.length > 0, 'a Workbox precache must exist');
  const requestUrls = cacheAudit.cacheEntries.flatMap((entry) => entry.urls);
  const appScopePath = '/portfolio-terminal/';
  const hasCompleteAppShell = cacheAudit.cacheEntries.some((entry) => {
    const paths = entry.urls.map((url) => new URL(url).pathname);
    const hasDocument = paths.some((path) => path === appScopePath || path === appScopePath + 'index.html');
    const hasEntryScript = paths.some((path) => {
      const fileName = path.slice(path.lastIndexOf('/') + 1);
      return path.startsWith(appScopePath + 'assets/') &&
        fileName.startsWith('index-') &&
        fileName.endsWith('.js');
    });
    const hasStylesheet = paths.some((path) =>
      path.startsWith(appScopePath + 'assets/') && path.endsWith('.css')
    );
    return hasDocument && hasEntryScript && hasStylesheet;
  });
  const cachedPaths = requestUrls.map((url) => new URL(url).pathname);
  assert.ok(hasCompleteAppShell,
    `one Workbox precache must contain the app document, entry JS and stylesheet. Caches: ${JSON.stringify(cacheAudit.cacheEntries)}`
  );
  assert.ok(
    !requestUrls.some((url) => new URL(url).pathname.includes('/api/')),
    'authenticated API responses must not enter the Workbox precache'
  );

  await context.setOffline(true);
  const offlinePage = await context.newPage();
  await offlinePage.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await offlinePage.locator('#root').waitFor({ state: 'attached', timeout: 10_000 });
  await offlinePage.locator('[data-pwa-connectivity="offline"]').waitFor({ state: 'visible', timeout: 10_000 });

  console.log('[PWA smoke] Manifest, icons, app-scoped service worker, static precache and offline shell passed.');
} catch (error) {
  console.error(error);
  console.error(serverOutput);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
