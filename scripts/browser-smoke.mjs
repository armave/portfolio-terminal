import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.BROWSER_SMOKE_PORT || 4173);
const appUrl = `http://${host}:${port}/portfolio-terminal/`;
const workerOrigin = 'https://trading-proxy.armenavetisyan-sa.workers.dev';

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', host, '--port', String(port), '--strictPort'],
  { stdio: 'inherit', env: { ...process.env, CI: 'true' } }
);

let browser;

async function waitForPreview() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(`Vite preview exited with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(appUrl);
      if (response.ok) return;
      lastError = new Error(`Vite preview returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw new Error(`Vite preview did not become ready: ${lastError?.message || 'unknown error'}`);
}

function authUser(id, name, role) {
  return { id, name, role, language: 'en', createdAt: '2026-11-02T00:00:00.000Z' };
}

async function mockWorkerApi(page) {
  const adminUser = authUser('admin-smoke', 'Smoke Admin', 'admin');
  const guestUser = authUser('guest-smoke', 'Smoke Guest', 'guest');
  const calls = [];
  let bootstrapComplete = false;
  let currentUser = null;
  let currentToken = '';

  const json = async (route, status, payload, extraHeaders = {}) => {
    const origin = route.request().headers().origin || '*';
    await route.fulfill({
      status,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Auth, If-Match',
        'Access-Control-Expose-Headers': 'ETag',
        ...extraHeaders
      },
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  };

  await page.route(`${workerOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const pathname = url.pathname;
    const headers = request.headers();
    const token = headers['x-app-auth'] || headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { body = {}; }
    calls.push({ method, pathname, token, body });

    if (method === 'OPTIONS') {
      const origin = headers.origin || '*';
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Auth, If-Match',
          'Access-Control-Expose-Headers': 'ETag'
        }
      });
      return;
    }

    if (pathname === '/api/auth/status' && method === 'GET') {
      await json(route, 200, { setupRequired: !bootstrapComplete, userCount: bootstrapComplete ? 1 : 0 });
      return;
    }
    if (pathname === '/api/auth/bootstrap' && method === 'POST') {
      if (bootstrapComplete || body.bootstrapSecret !== 'smoke-bootstrap-secret') {
        await json(route, 401, { error: 'Invalid bootstrap credentials.' });
        return;
      }
      bootstrapComplete = true;
      currentUser = adminUser;
      currentToken = 'smoke-admin-session';
      await json(route, 200, { token: currentToken, user: adminUser, expiresAt: Date.now() + 3_600_000 });
      return;
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      if (body.name !== 'Smoke Guest' || body.password !== 'valid-smoke-password') {
        await json(route, 401, { error: 'Invalid account credentials.' });
        return;
      }
      currentUser = guestUser;
      currentToken = 'smoke-guest-session';
      await json(route, 200, { token: currentToken, user: guestUser, expiresAt: Date.now() + 3_600_000 });
      return;
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' });
        return;
      }
      await json(route, 200, { user: currentUser });
      return;
    }
    if (pathname === '/api/auth/cloud-key' && method === 'GET') {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' });
        return;
      }
      await json(route, 200, { key: 'smoke-workspace-encryption-key' });
      return;
    }
    if (pathname === '/api/auth/users' && method === 'GET') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' });
        return;
      }
      await json(route, 200, { users: [adminUser, guestUser] });
      return;
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      if (token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' });
        return;
      }
      currentUser = null;
      currentToken = '';
      await json(route, 200, { success: true });
      return;
    }
    if (pathname === '/api/state') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' });
        return;
      }
      if (method === 'GET') {
        await json(route, 404, { error: 'No cloud workspace has been saved yet.' });
        return;
      }
      if (method === 'POST') {
        await json(route, 200, { success: true, revision: 1 }, { ETag: '"1"' });
        return;
      }
    }
    if (pathname === '/api/guest-portfolio') {
      if (method === 'GET' && currentUser?.role === 'guest' && token === currentToken) {
        await json(route, 200, {
          snapshot: { updatedAt: 1, tranches: [] },
          ledger: [],
          ledgerUpdatedAt: 1
        });
        return;
      }
      if (method === 'POST' && currentUser?.role === 'admin' && token === currentToken) {
        await json(route, 200, { success: true, revisions: {} });
        return;
      }
      await json(route, 403, { error: 'This session cannot access the guest projection.' });
      return;
    }
    if (pathname === '/api/history' && method === 'GET') {
      await json(route, 404, { error: 'No cloud history has been saved yet.' });
      return;
    }

    // Market-data/broker routes fail closed; no live services or credentials are used.
    await json(route, 401, { error: 'External services are disabled in the browser smoke test.' });
  });

  return {
    calls,
    count: (method, pathname) => calls.filter((call) => call.method === method && call.pathname === pathname).length
  };
}

async function waitForAuthOverlay(page, open) {
  await page.waitForFunction(
    (shouldBeOpen) => document.querySelector('#auth-container')?.classList.contains('auth-overlay-open') === shouldBeOpen,
    open,
    { timeout: 20_000 }
  );
}

async function submitAuth(page, { name, password, bootstrapSecret }) {
  await page.locator('#authUserName').fill(name);
  await page.locator('#authPassword').fill(password);
  if (bootstrapSecret) await page.locator('#bootstrapSecret').fill(bootstrapSecret);
  await page.locator('.auth-submit-button').click();
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const worker = await mockWorkerApi(page);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(document.querySelector('#root')?.firstElementChild),
      null,
      { timeout: 15_000 }
    );
    if (pageErrors.length > 0) {
      throw new Error(`Uncaught browser error at ${viewport.width}px: ${pageErrors.join('; ')}`);
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(
    () => document.querySelector('#authModalTitle')?.textContent?.includes('Create administrator account'),
    null,
    { timeout: 20_000 }
  );

  await submitAuth(page, {
    name: 'Smoke Admin',
    password: 'valid-smoke-password',
    bootstrapSecret: 'smoke-bootstrap-secret'
  });
  await waitForAuthOverlay(page, false);
  if (worker.count('POST', '/api/auth/bootstrap') !== 1) {
    throw new Error('Administrator bootstrap did not reach the mocked Worker exactly once.');
  }
  if (worker.count('GET', '/api/state') < 1) {
    throw new Error('Administrator startup did not request the shared workspace.');
  }
  if (worker.count('GET', '/api/guest-portfolio') !== 0) {
    throw new Error('Administrator startup unexpectedly requested the guest-scoped projection.');
  }

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await waitForAuthOverlay(page, true);
  await page.waitForFunction(
    () => document.querySelector('#authModalTitle')?.textContent?.includes('Portfolio Terminal sign in'),
    null,
    { timeout: 20_000 }
  );

  await submitAuth(page, { name: 'Unknown User', password: 'invalid-smoke-password' });
  await page.locator('.auth-feedback--error').waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await page.locator('.auth-feedback--error').innerText()).includes('Invalid account credentials.')) {
    throw new Error('Failed guest sign-in did not show the expected error.');
  }
  await waitForAuthOverlay(page, true);

  const sharedWorkspaceReadsBeforeGuest = worker.count('GET', '/api/state');
  await submitAuth(page, { name: 'Smoke Guest', password: 'valid-smoke-password' });
  await waitForAuthOverlay(page, false);
  if (worker.count('GET', '/api/guest-portfolio') < 1) {
    throw new Error('Guest login did not request the authenticated guest projection.');
  }
  if (worker.count('GET', '/api/state') !== sharedWorkspaceReadsBeforeGuest) {
    throw new Error('Guest login attempted to read the administrator shared workspace.');
  }

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  if (!(await page.locator('#settingsDesk').innerText()).includes('Smoke Guest')) {
    throw new Error('The guest identity was not reflected in Settings after account switching.');
  }
  if (pageErrors.length > 0) {
    throw new Error(`Uncaught browser errors during authenticated journeys: ${pageErrors.join('; ')}`);
  }

  console.log('Browser smoke passed: responsive mounting, admin bootstrap, sign-out/account switch, failed sign-in recovery, and guest-only workspace hydration.');
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
