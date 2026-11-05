import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.OPERATIONS_SMOKE_PORT || 4174);
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

function makeUser(id, name, role, language = 'en') {
  return { id, name, role, language, createdAt: '2026-11-05T00:00:00.000Z' };
}

async function mockWorkerApi(page) {
  const calls = [];
  const users = [];
  let bootstrapComplete = false;
  let currentUser = null;
  let currentToken = '';
  let nextUserId = 1;
  let stateRevision = 0;
  let historyRevision = 0;
  let newsRequestCount = 0;

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
  const publicUser = (user) => ({
    id: user.id, name: user.name, role: user.role,
    language: user.language, createdAt: user.createdAt
  });

  await page.route(workerOrigin + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const pathname = url.pathname;
    const headers = request.headers();
    const token = headers['x-app-auth'] || headers.authorization?.replace(/^Bearer\\s+/i, '') || '';
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { body = {}; }
    const action = url.searchParams.get('action') || '';
    const call = { method, pathname, action, symbol: url.searchParams.get('symbol') || '', token, body };
    calls.push(call);

    if (method === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': headers.origin || '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Auth, If-Match',
          'Access-Control-Expose-Headers': 'ETag'
        }
      });
      call.responseStatus = 204;
      return;
    }

    if (pathname === '/api/auth/status' && method === 'GET') {
      await json(route, 200, { setupRequired: !bootstrapComplete, userCount: users.length }, {}, call);
      return;
    }
    if (pathname === '/api/auth/bootstrap' && method === 'POST') {
      if (bootstrapComplete || body.bootstrapSecret !== 'operations-smoke-secret') {
        await json(route, 401, { error: 'Invalid bootstrap credentials.' }, {}, call);
        return;
      }
      bootstrapComplete = true;
      currentUser = { ...makeUser('admin-operations', String(body.name).trim(), 'admin') };
      currentToken = 'operations-admin-session';
      users.push({ ...currentUser, password: body.password });
      await json(route, 201, {
        token: currentToken, user: publicUser(currentUser), expiresAt: Date.now() + 3_600_000
      }, {}, call);
      return;
    }
    if (pathname === '/api/auth/login' && method === 'POST') {
      const user = users.find((item) =>
        item.name.toLocaleLowerCase('en-US') === String(body.name || '').trim().toLocaleLowerCase('en-US') &&
        item.password === body.password
      );
      if (!user) {
        await json(route, 401, { error: 'Invalid account credentials.' }, {}, call);
        return;
      }
      currentUser = user;
      currentToken = `operations-session-${user.id}`;
      await json(route, 200, {
        token: currentToken, user: publicUser(user), expiresAt: Date.now() + 3_600_000
      }, {}, call);
      return;
    }
    if (pathname.startsWith('/api/auth/')) {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      if (pathname === '/api/auth/me' && method === 'GET') {
        await json(route, 200, { user: publicUser(currentUser) }, {}, call);
        return;
      }
      if (pathname === '/api/auth/me' && method === 'POST') {
        if (body.language !== 'en' && body.language !== 'ru') {
          await json(route, 400, { error: 'Language must be either en or ru.' }, {}, call);
          return;
        }
        currentUser.language = body.language;
        const stored = users.find((user) => user.id === currentUser.id);
        if (stored) stored.language = body.language;
        await json(route, 200, { user: publicUser(currentUser) }, {}, call);
        return;
      }
      if (pathname === '/api/auth/cloud-key' && method === 'GET') {
        if (currentUser.role !== 'admin') {
          await json(route, 403, { error: 'Administrator access required.' }, {}, call);
          return;
        }
        await json(route, 200, { key: 'operations-smoke-workspace-key' }, {}, call);
        return;
      }
      if (pathname === '/api/auth/users' && method === 'GET') {
        if (currentUser.role !== 'admin') {
          await json(route, 403, { error: 'Admin role required.' }, {}, call);
          return;
        }
        await json(route, 200, { users: users.map(publicUser) }, {}, call);
        return;
      }
      if (pathname === '/api/auth/users' && method === 'POST') {
        if (currentUser.role !== 'admin') {
          await json(route, 403, { error: 'Admin role required.' }, {}, call);
          return;
        }
        if (body.action === 'create') {
          const name = String(body.name || '').trim();
          if (name.length < 2 || name.length > 60 || typeof body.password !== 'string' ||
              body.password.length < 6 || body.password.length > 128 ||
              (body.role !== undefined && !['admin', 'guest'].includes(body.role)) ||
              (body.language !== undefined && !['en', 'ru'].includes(body.language))) {
            await json(route, 400, { error: 'Invalid account details.' }, {}, call);
            return;
          }
          if (users.some((user) => user.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'))) {
            await json(route, 409, { error: 'A user with this name already exists.' }, {}, call);
            return;
          }
          const user = {
            ...makeUser(`operations-user-${nextUserId++}`, name, body.role || 'guest', body.language || 'en'),
            password: body.password
          };
          users.push(user);
          await json(route, 201, { user: publicUser(user) }, {}, call);
          return;
        }
        if (body.action === 'update') {
          const target = users.find((user) => user.id === body.id);
          if (!target) {
            await json(route, 404, { error: 'User not found.' }, {}, call);
            return;
          }
          const nextRole = body.role || target.role;
          if (target.role === 'admin' && nextRole !== 'admin' &&
              users.filter((user) => user.role === 'admin').length <= 1) {
            await json(route, 409, { error: 'At least one admin account must remain.' }, {}, call);
            return;
          }
          const nextName = body.name === undefined ? target.name : String(body.name).trim();
          if (nextName.length < 2 || nextName.length > 60 ||
              users.some((user) => user.id !== target.id &&
                user.name.toLocaleLowerCase('en-US') === nextName.toLocaleLowerCase('en-US'))) {
            await json(route, 400, { error: 'Invalid or duplicate account name.' }, {}, call);
            return;
          }
          target.name = nextName;
          target.role = nextRole;
          if (body.language === 'en' || body.language === 'ru') target.language = body.language;
          if (typeof body.password === 'string' && body.password) target.password = body.password;
          await json(route, 200, { user: publicUser(target) }, {}, call);
          return;
        }
        if (body.action === 'delete') {
          if (!body.id || body.id === currentUser.id) {
            await json(route, 400, { error: 'You cannot delete the currently signed-in account.' }, {}, call);
            return;
          }
          const index = users.findIndex((user) => user.id === body.id);
          if (index < 0) {
            await json(route, 404, { error: 'User not found.' }, {}, call);
            return;
          }
          if (users[index].role === 'admin' && users.filter((user) => user.role === 'admin').length <= 1) {
            await json(route, 409, { error: 'At least one admin account must remain.' }, {}, call);
            return;
          }
          users.splice(index, 1);
          await json(route, 200, { success: true }, {}, call);
          return;
        }
        await json(route, 400, { error: 'Unsupported account operation.' }, {}, call);
        return;
      }
      if (pathname === '/api/auth/logout' && method === 'POST') {
        currentUser = null;
        currentToken = '';
        await json(route, 200, { success: true }, {}, call);
        return;
      }
    }

    if (pathname === '/api/state') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      if (method === 'GET') {
        await json(route, 404, { error: 'No cloud workspace has been saved yet.' }, { ETag: `"${stateRevision}"` }, call);
        return;
      }
      stateRevision += 1;
      await json(route, 200, { success: true, revision: stateRevision }, { ETag: `"${stateRevision}"` }, call);
      return;
    }
    if (pathname === '/api/history') {
      if (currentUser?.role !== 'admin' || token !== currentToken) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      if (method === 'GET') {
        await json(route, 404, { error: 'No cloud history has been saved yet.' }, { ETag: `"${historyRevision}"` }, call);
        return;
      }
      historyRevision += 1;
      await json(route, 200, { success: true, revision: historyRevision }, { ETag: `"${historyRevision}"` }, call);
      return;
    }
    if (pathname === '/api/guest-portfolio') {
      if (method === 'GET' && currentUser?.role === 'guest' && token === currentToken) {
        await json(route, 200, { snapshot: { updatedAt: Date.now(), tranches: [] }, ledger: [], ledgerUpdatedAt: Date.now() }, {}, call);
        return;
      }
      if (method === 'POST' && currentUser?.role === 'admin' && token === currentToken) {
        await json(route, 200, { success: true, revisions: {} }, {}, call);
        return;
      }
      await json(route, 403, { error: 'This session cannot access the guest projection.' }, {}, call);
      return;
    }

    if (pathname === '/' && method === 'POST' && url.searchParams.has('symbol') && !action) {
      await json(route, 200, {}, {}, call);
      return;
    }

    if (pathname === '/' && action) {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      if (action === 'freedom-positions') {
        await json(route, 200, {
          data: { result: { ps: {
            loaded: true,
            acc: [{ curr: 'USD', s: '10000', currval: '10000' }],
            pos: [
              { curr: 'USD', i: 'AAPL.US', name: 'Apple', q: '5', mkt_price: '11', market_value: '55', bal_price_a: '10', profit_close: '5', acc_pos_id: 7001 },
              { curr: 'USD', i: 'MSFT.US', name: 'Microsoft', q: '2', mkt_price: '21', market_value: '42', bal_price_a: '20', profit_close: '2', acc_pos_id: 7002 }
            ]
          } } }
        }, {}, call);
        return;
      }
      if (action === 'freedom-trades') {
        await json(route, 200, {
          data: { trades: { trade: [
            { trade_id: 'operations-aapl-buy', instr_nm: 'AAPL.US', operation: '1', quantity: '5', p: '10', date: '2026-11-05T09:00:00.000Z', v: '50', curr_c: 'USD', commiss: '0.10', profit: '0' },
            { trade_id: 'operations-msft-buy', instr_nm: 'MSFT.US', operation: '1', quantity: '2', p: '20', date: '2026-11-05T10:00:00.000Z', v: '40', curr_c: 'USD', commiss: '0.10', profit: '0' }
          ] } }
        }, {}, call);
        return;
      }
      if (action === 'freedom-orders') {
        await json(route, 200, { ok: true, data: { orders: { order: [] } } }, {}, call);
        return;
      }
      if (action === 'quote') {
        const symbols = String(url.searchParams.get('symbol') || '').split(',').filter(Boolean);
        await json(route, 200, symbols.map((symbol) => ({
          symbol: symbol.toUpperCase(),
          price: { current: 11, previousClose: 10, marketState: 'REGULAR' }
        })), {}, call);
        return;
      }
      if (action === 'news') {
        newsRequestCount += 1;
        if (newsRequestCount === 1) {
          await json(route, 503, { error: 'news provider temporarily unavailable' }, {}, call);
        } else {
          await json(route, 200, [{
            id: 'operations-news-recovered',
            headline: 'Recovered Market News',
            summary: 'News transport recovered after retry.',
            datetime: Math.floor(Date.now() / 1000),
            source: 'Operations smoke'
          }], {}, call);
        }
        return;
      }
      if (action === 'stocktwits') {
        await json(route, 200, { messages: [] }, {}, call);
        return;
      }
      if (action === 'freedom-market-depth-stream-ticket') {
        const symbol = String(url.searchParams.get('symbol') || 'AAPL.US').toUpperCase();
        await json(route, 200, { ok: true, ticket: 'a'.repeat(64), symbol, expiresAt: Date.now() + 60_000 }, {}, call);
        return;
      }
      await json(route, 200, {}, {}, call);
      return;
    }

    await json(route, 200, {}, {}, call);
  });

  return {
    calls,
    users,
    count: (method, pathname) => calls.filter((call) => call.method === method && call.pathname === pathname).length,
    findCalls: (method, pathname) => calls.filter((call) => call.method === method && call.pathname === pathname)
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const worker = await mockWorkerApi(page);

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('#authModalTitle')?.textContent?.includes('Create administrator account'),
    null,
    { timeout: 20_000 }
  );
  await submitAuth(page, {
    name: 'Operations Admin',
    password: 'operations-admin-password',
    bootstrapSecret: 'operations-smoke-secret'
  });
  await waitForAuthOverlay(page, false);
  // Admin sign-in can restore the previously selected Balance view. Select the
  // combined margin workspace explicitly before asserting Market Insights.
  const combinedPortfolio = page.getByRole('button', { name: 'COMBINED PORTFOLIO' });
  if (await combinedPortfolio.count()) await combinedPortfolio.click();

  // The isolated browser starts with an empty local portfolio. Add a deterministic
  // paper-trade lot through the app's own Quick Buy terminal command so the
  // Market Insights ticker is backed by real board state; this does not place an order.
  const emptyState = page.locator('#emptyStatePanel');
  await emptyState.getByRole('button', { name: 'Quick Buy' }).waitFor({ state: 'visible', timeout: 10_000 });
  await emptyState.getByRole('button', { name: 'Quick Buy' }).click();
  const terminalCommand = page.getByRole('textbox', { name: 'Terminal command' });
  await terminalCommand.fill('bought 5 AAPL for 10');
  await terminalCommand.press('Enter');

  // Market Insights: provider outages must be visible and recoverable; deep data
  // is fetched only for its selected tab, and Stocktwits remains opt-in.
  await waitForCondition(
    () => worker.findCalls('GET', '/').some((call) => call.action === 'freedom-positions' && call.responseStatus === 200),
    'broker positions snapshot for Market Insights'
  );
  await page.locator('#marketInsightsPanel').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('#marketInsightsTicker')?.textContent?.includes('AAPL'), null, { timeout: 20_000 });
  await waitForCondition(() => worker.findCalls('GET', '/') .some((call) => call.action === 'news' && call.responseStatus === 503), 'initial News provider failure');
  await page.locator('#marketInsightsContent').getByText(/Failed to load news:/).waitFor({ state: 'visible', timeout: 10_000 });
  if (worker.findCalls('GET', '/').some((call) => call.action === 'stocktwits')) {
    throw new Error('Stocktwits was requested before the user opted in.');
  }
  await page.getByRole('button', { name: 'Refresh company news' }).click();
  await waitForCondition(() => worker.findCalls('GET', '/').some((call) => call.action === 'news' && call.responseStatus === 200), 'News retry recovery');
  await page.locator('#marketInsightsContent').getByText('Recovered Market News').waitFor({ state: 'visible', timeout: 10_000 });
  const newsCallsBeforeDeepData = worker.findCalls('GET', '/').filter((call) => call.action === 'news').length;
  await page.getByRole('tab', { name: 'Fundamentals' }).click();
  await waitForCondition(() => worker.findCalls('POST', '/').some((call) => !call.action && call.symbol === 'AAPL'), 'deep market data request');
  if (worker.findCalls('GET', '/').filter((call) => call.action === 'news').length !== newsCallsBeforeDeepData) {
    throw new Error('Switching to Fundamentals unexpectedly retriggered company News.');
  }
  await page.getByRole('button', { name: 'Refresh Stocktwits messages' }).click();
  await waitForCondition(() => worker.findCalls('GET', '/').some((call) => call.action === 'stocktwits'), 'Stocktwits opt-in request');

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.locator('#settingsDesk').evaluate((element) => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right
    }));
    if (layout.documentWidth > layout.viewportWidth + 1 || layout.left < -1 || layout.right > layout.viewportWidth + 1) {
      throw new Error(`Settings desk is clipped or causes page overflow at ${width}px: ${JSON.stringify(layout)}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Create two users, then exercise editing and deletion through the actual Settings form.
  const createUser = async (name, password) => {
    await page.getByLabel('User name').fill(name);
    await page.getByLabel('Password (6+ characters)').fill(password);
    if (await page.getByLabel('New user role').inputValue() !== 'guest') {
      throw new Error('New accounts must default to the guest role.');
    }
    await page.getByLabel('New user language').selectOption('en');
    await page.getByRole('button', { name: 'Add user' }).click();
    await page.locator('#settingsDesk tbody tr').filter({ has: page.locator(`input[aria-label="Name for ${name}"]`) })
      .waitFor({ state: 'visible', timeout: 10_000 });
  };
  await createUser('Browser Guest Delete', 'delete-guest-password');
  await createUser('Browser Guest Keep', 'keep-guest-password');

  const rowForUser = (name) => page.locator('#settingsDesk tbody tr')
    .filter({ has: page.locator(`input[aria-label="Name for ${name}"]`) });
  const deleteRow = rowForUser('Browser Guest Delete');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await deleteRow.getByRole('button', { name: 'Delete' }).click();
  await deleteRow.waitFor({ state: 'detached', timeout: 10_000 });

  const keepRow = rowForUser('Browser Guest Keep');
  await keepRow.getByLabel('Name for Browser Guest Keep').fill('Browser Guest Updated');
  await keepRow.getByLabel('Role for Browser Guest Keep').selectOption('admin');
  await keepRow.getByLabel('Language for Browser Guest Keep').selectOption('ru');
  await keepRow.getByLabel('New password for Browser Guest Keep').fill('updated-guest-password');
  await keepRow.getByRole('button', { name: 'Save' }).click();
  await waitForCondition(
    () => worker.users.some((user) => user.name === 'Browser Guest Updated' && user.role === 'admin' &&
      user.language === 'ru' && user.password === 'updated-guest-password'),
    'user rename, role, language and password update'
  );

  const updatedRow = rowForUser('Browser Guest Updated');
  await updatedRow.getByLabel('Role for Browser Guest Updated').selectOption('guest');
  await updatedRow.getByRole('button', { name: 'Save' }).click();
  await waitForCondition(
    () => worker.users.some((user) => user.name === 'Browser Guest Updated' && user.role === 'guest'),
    'guest role restoration'
  );

  // The server remains authoritative: the sole administrator cannot be demoted.
  const adminRow = rowForUser('Operations Admin');
  if (await adminRow.getByRole('button', { name: 'Delete' }).count() !== 0) {
    throw new Error('Settings exposed a self-delete action for the signed-in administrator.');
  }
  const userUpdateCountBeforeFinalAdmin = worker.count('POST', '/api/auth/users');
  await adminRow.getByLabel('Role for Operations Admin').selectOption('guest');
  await adminRow.getByRole('button', { name: 'Save' }).click();
  await waitForCondition(
    () => worker.findCalls('POST', '/api/auth/users').slice(userUpdateCountBeforeFinalAdmin)
      .some((call) => call.body.action === 'update' && call.body.role === 'guest'),
    'final administrator role update request'
  );
  const finalAdminCalls = worker.findCalls('POST', '/api/auth/users').slice(userUpdateCountBeforeFinalAdmin)
    .filter((call) => call.body.action === 'update' && call.body.role === 'guest');
  const finalAdminCall = finalAdminCalls[finalAdminCalls.length - 1];
  if (finalAdminCall.body.id !== 'admin-operations' || finalAdminCall.responseStatus !== 409) {
    throw new Error('Unexpected final-admin update request: ' + JSON.stringify({ body: finalAdminCall.body, responseStatus: finalAdminCall.responseStatus, users: worker.users.map(({ id, name, role }) => ({ id, name, role })) }));
  }
  const adminError = page.locator('#settingsDesk [role="alert"]').filter({ hasText: 'At least one admin account must remain.' });
  await adminError.waitFor({ state: 'visible', timeout: 10_000 });
  await adminRow.getByLabel('Role for Operations Admin').selectOption('admin');

  // Role-specific cadence is persisted in its own browser preference.
  await page.locator('#quoteRefreshInterval').selectOption('30000');
  await page.waitForFunction(() => localStorage.getItem('quote_refresh_interval') === '30000', null, { timeout: 10_000 });

  // The stop-out threshold cannot exceed the maintenance threshold.
  const brokerRules = page.locator('details.settings-broker-rules');
  await brokerRules.locator('summary').click();
  await page.locator('#maintenanceMarginInput').fill('5');
  await page.locator('#stopOutRatioInput').fill('10');
  await page.locator('#brokerRulesForm button[type="submit"]').click();
  const invalidStopOut = await page.locator('#stopOutRatioInput').evaluate((input) => input.validity.customError);
  if (!invalidStopOut) throw new Error('Settings accepted a stop-out threshold above maintenance equity.');
  await page.locator('#maintenanceMarginInput').fill('12.5');
  await page.locator('#stopOutRatioInput').fill('3');
  await page.locator('#annualMarginRateInput').fill('18');
  await page.locator('#brokerRulesForm button[type="submit"]').click();
  await page.waitForFunction(() => {
    const stored = JSON.parse(localStorage.getItem('tradernet_rules_v1') || 'null');
    return stored && Math.abs(stored.annualBorrowRate - 0.18) < 0.000001 &&
      Math.abs(stored.maintenanceEquityRatio - 0.125) < 0.000001 &&
      Math.abs(stored.stopOutRatio - 0.03) < 0.000001;
  }, null, { timeout: 10_000 });

  // Per-account language is server-backed and is restored after a browser reload.
  await page.getByLabel('Account language').selectOption('ru');
  await waitForCondition(
    () => worker.findCalls('POST', '/api/auth/me').some((call) => call.body.language === 'ru' && call.responseStatus === 200),
    'account language preference save'
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAuthOverlay(page, false);
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(
    () => document.querySelector('#settingsDesk select')?.value === 'ru',
    null,
    { timeout: 20_000 }
  );

  // A guest sees the account preference and manual sync controls, never admin-only user,
  // backup or broker-rule management. The shared owner workspace is not read.
  const sharedWorkspaceReadsBeforeGuest = worker.count('GET', '/api/state');
  const userDirectoryReadsBeforeGuest = worker.count('GET', '/api/auth/users');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await waitForAuthOverlay(page, true);
  await submitAuth(page, { name: 'Browser Guest Updated', password: 'updated-guest-password' });
  await waitForAuthOverlay(page, false);
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  if (await page.locator('#settingsDesk section.settings-user-panel').count() ||
      await page.locator('#settingsDesk details.settings-broker-rules').count()) {
    throw new Error('Guest Settings exposed administrator-only account or broker-rule controls.');
  }
  if (await page.getByRole('button', { name: /Экспорт/ }).count()) {
    throw new Error('Guest Settings exposed the administrator backup action.');
  }
  if (!(await page.getByRole('button', { name: 'Синхронизировать портфель' }).count())) {
    throw new Error('Guest Settings lost the manual portfolio sync control.');
  }
  if (worker.count('GET', '/api/guest-portfolio') < 1) {
    throw new Error('Guest sign-in did not hydrate its assigned projection.');
  }
  if (worker.count('GET', '/api/auth/users') !== userDirectoryReadsBeforeGuest) {
    throw new Error('Guest sign-in requested the administrator user directory.');
  }
  if (await page.locator('#quoteRefreshInterval').inputValue() !== '15000') {
    throw new Error('Guest refresh cadence inherited the administrator 30-second preference.');
  }
  if (worker.count('GET', '/api/state') !== sharedWorkspaceReadsBeforeGuest) {
    throw new Error('Guest sign-in attempted to read the administrator shared workspace.');
  }
  if (worker.calls.some((call) => call.method === 'GET' && call.pathname === '/api/state' && call.token === 'operations-session-operations-user-2')) {
    throw new Error('Guest session attempted to read the administrator shared workspace.');
  }
  if (pageErrors.length) throw new Error('Browser errors: ' + pageErrors.join('; '));

  console.log('Operations browser smoke passed: account creation, update, password reset, role changes, deletion, final-admin protection, language persistence, refresh cadence, broker-rule validation, and guest Settings isolation.');
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
