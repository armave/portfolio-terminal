import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
  let stateRevision = 0;
  let stateExists = false;
  let stateCiphertext = '';
  let historyRevision = 0;
  let historyExists = false;
  let historyCiphertext = '';
  let failNextBrokerAccount = false;
  let failNextStateConflict = false;
  let brokerAccountFailures = 0;
  let stateConflictCount = 0;
  let guestPublication = null;

  const accountPayload = {
    data: { result: { ps: {
      loaded: true,
      acc: [{ curr: 'USD', s: '10000', currval: '10000' }],
      pos: [{
        curr: 'USD', i: 'AAPL.US', name: 'Apple', q: '5',
        mkt_price: '11', market_value: '55', bal_price_a: '10',
        profit_close: '5', acc_pos_id: 7001
      }]
    } } }
  };
  const tradesPayload = {
    data: { trades: { trade: [{
      trade_id: 'smoke-buy-aapl-1',
      instr_nm: 'AAPL.US',
      operation: '1',
      quantity: '5',
      p: '10',
      date: '2026-11-02T09:00:00.000Z',
      v: '50',
      curr_c: 'USD',
      commiss: '0.10',
      profit: '0'
    }] } }
  };
  const json = async (route, status, payload, extraHeaders = {}, call = null) => {
    if (call) call.responseStatus = status;
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
  const etag = (revision) => '"' + revision + '"';
  const parseRevision = (value) => {
    const revision = Number(String(value || '0').replace(/^W\//, '').replaceAll('"', ''));
    return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
  };

  await page.route(workerOrigin + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const pathname = url.pathname;
    const headers = request.headers();
    const token = headers['x-app-auth'] || headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { body = {}; }
    const call = { method, pathname, token, body, action: url.searchParams.get('action') || '' };
    calls.push(call);

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
      call.responseStatus = 204;
      return;
    }
    if (pathname === '/api/auth/status' && method === 'GET') {
      await json(route, 200, { setupRequired: !bootstrapComplete, userCount: bootstrapComplete ? 1 : 0 }, {}, call);
      return;
    }
    if (pathname === '/api/auth/bootstrap' && method === 'POST') {
      if (bootstrapComplete || body.bootstrapSecret !== 'smoke-bootstrap-secret') {
        await json(route, 401, { error: 'Invalid bootstrap credentials.' }, {}, call);
        return;
      }
      bootstrapComplete = true;
      currentUser = adminUser;
      currentToken = 'smoke-admin-session';
      await json(route, 200, { token: currentToken, user: adminUser, expiresAt: Date.now() + 3600000 }, {}, call);
      return;
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      if (body.name !== 'Smoke Guest' || body.password !== 'valid-smoke-password') {
        await json(route, 401, { error: 'Invalid account credentials.' }, {}, call);
        return;
      }
      currentUser = guestUser;
      currentToken = 'smoke-guest-session';
      await json(route, 200, { token: currentToken, user: guestUser, expiresAt: Date.now() + 3600000 }, {}, call);
      return;
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      await json(route, 200, { user: currentUser }, {}, call);
      return;
    }
    if (pathname === '/api/auth/cloud-key' && method === 'GET') {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      await json(route, 200, { key: 'smoke-workspace-encryption-key' }, {}, call);
      return;
    }
    if (pathname === '/api/auth/users' && method === 'GET') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      await json(route, 200, { users: [adminUser, guestUser] }, {}, call);
      return;
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      if (token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      currentUser = null;
      currentToken = '';
      await json(route, 200, { success: true }, {}, call);
      return;
    }

    if (pathname === '/' && call.action) {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      switch (call.action) {
        case 'freedom-session':
          await json(route, 200, { success: true }, {}, call);
          return;
        case 'freedom-positions':
          if (failNextBrokerAccount) {
            failNextBrokerAccount = false;
            brokerAccountFailures += 1;
            await json(route, 503, { error: 'Broker balance source unavailable in smoke test.' }, {}, call);
            return;
          }
          await json(route, 200, accountPayload, {}, call);
          return;
        case 'freedom-trades':
          await json(route, 200, tradesPayload, {}, call);
          return;
        case 'freedom-orders':
          await json(route, 200, { ok: true, data: { orders: { order: [] } } }, {}, call);
          return;
        case 'quote': {
          const symbols = String(url.searchParams.get('symbol') || '').split(',').filter(Boolean);
          await json(route, 200, symbols.map((symbol) => ({
            symbol: symbol.toUpperCase(),
            price: { current: 11, previousClose: 10, marketState: 'REGULAR' }
          })), {}, call);
          return;
        }
        case 'news':
          await json(route, 200, [], {}, call);
          return;
        case 'stocktwits':
          await json(route, 200, { messages: [] }, {}, call);
          return;
        default:
          await json(route, 400, { error: 'Unsupported smoke action: ' + call.action }, {}, call);
          return;
      }
    }

    if (pathname === '/api/state') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      if (method === 'GET') {
        if (!stateExists) {
          await json(route, 404, { error: 'No cloud workspace has been saved yet.' }, { ETag: etag(stateRevision) }, call);
          return;
        }
        await json(route, 200, { encryptedPayload: stateCiphertext }, { ETag: etag(stateRevision) }, call);
        return;
      }
      if (method === 'POST') {
        if (failNextStateConflict) {
          failNextStateConflict = false;
          stateConflictCount += 1;
          await json(route, 412, { error: 'Cloud revision conflict.' }, { ETag: etag(stateRevision) }, call);
          return;
        }
        if (parseRevision(headers['if-match']) !== stateRevision) {
          stateConflictCount += 1;
          await json(route, 412, { error: 'Cloud revision conflict.' }, { ETag: etag(stateRevision) }, call);
          return;
        }
        stateRevision += 1;
        stateExists = true;
        stateCiphertext = String(body.encryptedPayload || '');
        await json(route, 200, { success: true, revision: stateRevision }, { ETag: etag(stateRevision) }, call);
        return;
      }
    }

    if (pathname === '/api/history') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      if (method === 'GET') {
        if (!historyExists) {
          await json(route, 404, { error: 'No cloud history has been saved yet.' }, { ETag: etag(historyRevision) }, call);
          return;
        }
        await json(route, 200, { encryptedPayload: historyCiphertext }, { ETag: etag(historyRevision) }, call);
        return;
      }
      if (method === 'POST') {
        if (parseRevision(headers['if-match']) !== historyRevision) {
          await json(route, 412, { error: 'Cloud history revision conflict.' }, { ETag: etag(historyRevision) }, call);
          return;
        }
        historyRevision += 1;
        historyExists = true;
        historyCiphertext = String(body.encryptedPayload || '');
        await json(route, 200, { success: true, revision: historyRevision }, { ETag: etag(historyRevision) }, call);
        return;
      }
    }

    if (pathname === '/api/guest-portfolio') {
      if (method === 'GET' && currentUser?.role === 'guest' && token === currentToken) {
        const ownPublication = guestPublication?.snapshots?.find((item) => item.guestId === currentUser.id);
        await json(route, 200, {
          snapshot: ownPublication?.snapshot || { updatedAt: 1, tranches: [] },
          ledger: ownPublication?.ledgerUpserts || [],
          ledgerUpdatedAt: guestPublication ? Date.now() : 1
        }, {}, call);
        return;
      }
      if (method === 'POST' && currentUser?.role === 'admin' && token === currentToken) {
        guestPublication = body;
        await json(route, 200, { success: true, revisions: {} }, {}, call);
        return;
      }
      await json(route, 403, { error: 'This session cannot access the guest projection.' }, {}, call);
      return;
    }

    await json(route, 401, { error: 'External services are disabled in the browser smoke test.' }, {}, call);
  });

  return {
    calls,
    count: (method, pathname) => calls.filter((call) => call.method === method && call.pathname === pathname).length,
    countAction: (action) => calls.filter((call) => call.action === action).length,
    failNextBrokerAccount: () => { failNextBrokerAccount = true; },
    failNextStateConflict: () => { failNextStateConflict = true; },
    brokerAccountFailures: () => brokerAccountFailures,
    stateConflictCount: () => stateConflictCount,
    getGuestPublication: () => guestPublication
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

async function waitForCondition(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + label + '.');
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

  // Assign the active cash tranche through the admin UI and verify that the
  // Worker receives both the guest projection and durable LOTS ledger record.
  await page.getByRole('button', { name: /BALANCE/ }).click();
  await page.locator('#activeTranches').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#activeTranches').getByRole('button', { name: 'Expand' }).click();
  await page.locator('#activeTranchesTable .active-tranche-row').first().waitFor({ state: 'visible', timeout: 20_000 });
  const guestAssignment = page.locator('#activeTranchesTable select').first();
  await guestAssignment.waitFor({ state: 'visible', timeout: 20_000 });
  await waitForCondition(
    () => worker.calls.some((call) => call.method === 'GET' && call.pathname === '/api/auth/users'),
    'administrator guest directory request'
  );
  await page.waitForFunction(() => {
    const select = document.querySelector('#activeTranchesTable select');
    return Boolean(select && Array.from(select.options).some((option) => option.value === 'guest-smoke'));
  }, null, { timeout: 20_000 });
  await guestAssignment.selectOption('guest-smoke');
  await waitForCondition(
    () => worker.calls.some((call) =>
      call.method === 'POST' &&
      call.pathname === '/api/guest-portfolio' &&
      Array.isArray(call.body.snapshots) &&
      call.body.snapshots.some((snapshot) => snapshot.guestId === 'guest-smoke' &&
        Array.isArray(snapshot.snapshot?.tranches) &&
        snapshot.snapshot.tranches.some((tranche) => String(tranche.ticker || '').toUpperCase().includes('AAPL')) &&
        Array.isArray(snapshot.ledgerUpserts) &&
        snapshot.ledgerUpserts.some((row) => row.status === 'active'))
    ),
    'guest snapshot and active assignment ledger publication'
  );

  // Fail the broker account snapshot once; executions, active orders, quotes
  // and cloud sync should still complete and report a partial-success warning.
  worker.failNextBrokerAccount();
  const previousBrokerFailures = worker.brokerAccountFailures();
  const syncButton = page.locator('#syncPortfolioButton');
  await syncButton.waitFor({ state: 'visible', timeout: 20_000 });
  await syncButton.click();
  await waitForCondition(
    () => worker.brokerAccountFailures() > previousBrokerFailures,
    'one-shot TradeNet account-info failure'
  );
  await page.getByText('Portfolio sync completed with issues. Check the activity log.', { exact: true })
    .waitFor({ state: 'visible', timeout: 20_000 });
  if (worker.countAction('freedom-trades') < 2 || worker.countAction('freedom-orders') < 2) {
    throw new Error('Partial broker failure prevented other TradeNet sources from refreshing.');
  }

  // A single 412 response proves the manual sync preserves cloud revision safety.
  worker.failNextStateConflict();
  const previousConflicts = worker.stateConflictCount();
  await page.waitForFunction(() => {
    const button = document.querySelector('#syncPortfolioButton');
    return Boolean(button && !button.disabled);
  }, null, { timeout: 20_000 });
  await syncButton.click();
  await waitForCondition(
    () => worker.stateConflictCount() > previousConflicts,
    'cloud state revision conflict response'
  );
  await page.getByText(/Cloud push failed: Cloud revision conflict/i)
    .waitFor({ state: 'visible', timeout: 20_000 });

  // Export the actual browser snapshot, reject malformed JSON, restore the valid
  // backup and confirm a reset of local portfolio plus revisioned cloud history.
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export portfolio backup as JSON' }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  if (!backupPath) throw new Error('Backup export did not produce a readable download.');
  const backupBytes = await readFile(backupPath);

  await page.locator('#importFileInput').setInputFiles({
    name: 'invalid-smoke-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ invalid json')
  });
  await page.getByText(/Backup import failed:/).waitFor({ state: 'visible', timeout: 10_000 });

  const stateWritesBeforeImport = worker.count('POST', '/api/state');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.locator('#importFileInput').setInputFiles({
    name: 'smoke-backup.json',
    mimeType: 'application/json',
    buffer: backupBytes
  });
  await waitForCondition(
    () => worker.count('POST', '/api/state') > stateWritesBeforeImport,
    'valid backup import cloud write'
  );

  const stateWritesBeforeReset = worker.count('POST', '/api/state');
  const historyWritesBeforeReset = worker.count('POST', '/api/history');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Reset local and cloud portfolio data' }).click();
  await waitForCondition(
    () => worker.count('POST', '/api/state') > stateWritesBeforeReset &&
      worker.count('POST', '/api/history') > historyWritesBeforeReset,
    'confirmed local portfolio and closed-history reset'
  );
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
  const publishedGuestSnapshot = worker.getGuestPublication()?.snapshots?.find((snapshot) => snapshot.guestId === 'guest-smoke');
  if (!publishedGuestSnapshot?.snapshot?.tranches?.some((tranche) => String(tranche.ticker || '').toUpperCase().includes('AAPL'))) {
    throw new Error('Guest login could not verify the AAPL assignment published by the administrator.');
  }

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  if (!(await page.locator('#settingsDesk').innerText()).includes('Smoke Guest')) {
    throw new Error('The guest identity was not reflected in Settings after account switching.');
  }
  if (pageErrors.length > 0) {
    throw new Error(`Uncaught browser errors during authenticated journeys: ${pageErrors.join('; ')}`);
  }

  console.log('Browser smoke passed: responsive mounting, admin bootstrap, broker partial failure, cloud revision conflict, backup export/import/reset, guest assignment publication, sign-out/account switch, failed sign-in recovery, and guest-only workspace hydration.');
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
