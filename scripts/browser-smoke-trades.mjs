import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.TRADE_SMOKE_PORT || 4175);
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
  return { id, name, role, language: 'en', createdAt: '2026-11-05T00:00:00.000Z' };
}

async function mockWorkerApi(page) {
  const admin = authUser('trade-smoke-admin', 'Trade Smoke Admin', 'admin');
  let bootstrapComplete = false;
  let currentUser = null;
  let token = '';
  let stateRevision = 0;
  let stateExists = false;
  let statePayload = '';
  let historyRevision = 0;
  let historyExists = false;
  let historyPayload = '';
  const calls = [];

  const json = async (route, status, payload, extraHeaders = {}, call) => {
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
  const etag = (revision) => `"${revision}"`;
  const parseRevision = (value) =>
    Number(String(value || '0').replace(/^W\//, '').replaceAll('"', '')) || 0;

  await page.route(workerOrigin + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const pathname = url.pathname;
    const headers = request.headers();
    const requestToken = headers['x-app-auth'] ||
      headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { body = {}; }
    const call = {
      method, pathname, token: requestToken, body,
      action: url.searchParams.get('action') || ''
    };
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
      await json(route, 200, {
        setupRequired: !bootstrapComplete,
        userCount: bootstrapComplete ? 1 : 0
      }, {}, call);
      return;
    }
    if (pathname === '/api/auth/bootstrap' && method === 'POST') {
      if (bootstrapComplete || body.bootstrapSecret !== 'trade-smoke-bootstrap-secret') {
        await json(route, 401, { error: 'Invalid bootstrap credentials.' }, {}, call);
        return;
      }
      bootstrapComplete = true;
      currentUser = admin;
      token = 'trade-smoke-admin-session';
      await json(route, 200, {
        token, user: admin, expiresAt: Date.now() + 3600000
      }, {}, call);
      return;
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!currentUser || requestToken !== token) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      await json(route, 200, { user: currentUser }, {}, call);
      return;
    }
    if (pathname === '/api/auth/cloud-key' && method === 'GET') {
      if (!currentUser || requestToken !== token) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      await json(route, 200, { key: 'trade-smoke-workspace-key' }, {}, call);
      return;
    }
    if (pathname === '/api/auth/users' && method === 'GET') {
      if (currentUser?.role !== 'admin' || requestToken !== token) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      await json(route, 200, { users: [admin] }, {}, call);
      return;
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      if (requestToken !== token) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      currentUser = null;
      token = '';
      await json(route, 200, { success: true }, {}, call);
      return;
    }

    if (pathname === '/' && call.action) {
      if (!currentUser || requestToken !== token) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      switch (call.action) {
        case 'freedom-positions':
          await json(route, 200, {
            data: { result: { ps: {
              loaded: true,
              acc: [{ curr: 'USD', s: '10000', currval: '10000' }],
              pos: []
            } } }
          }, {}, call);
          return;
        case 'freedom-trades':
          await json(route, 200, { data: { trades: { trade: [] } } }, {}, call);
          return;
        case 'freedom-orders':
          await json(route, 200, { ok: true, data: { orders: { order: [] } } }, {}, call);
          return;
        case 'quote': {
          const symbols = String(url.searchParams.get('symbol') || '').split(',').filter(Boolean);
          await json(route, 200, symbols.map((symbol) => ({
            symbol: symbol.toUpperCase(),
            price: { current: 100, previousClose: 99, marketState: 'REGULAR' }
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
          await json(route, 200, {}, {}, call);
          return;
      }
    }

    if (pathname === '/api/state') {
      if (currentUser?.role !== 'admin' || requestToken !== token) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      if (method === 'GET') {
        if (!stateExists) {
          await json(route, 404, { error: 'No cloud workspace has been saved yet.' }, { ETag: etag(stateRevision) }, call);
          return;
        }
        await json(route, 200, { encryptedPayload: statePayload }, { ETag: etag(stateRevision) }, call);
        return;
      }
      if (method === 'POST') {
        if (parseRevision(headers['if-match']) !== stateRevision) {
          await json(route, 412, { error: 'Cloud revision conflict.' }, { ETag: etag(stateRevision) }, call);
          return;
        }
        stateRevision += 1;
        stateExists = true;
        statePayload = String(body.encryptedPayload || '');
        await json(route, 200, { success: true, revision: stateRevision }, { ETag: etag(stateRevision) }, call);
        return;
      }
    }

    if (pathname === '/api/history') {
      if (currentUser?.role !== 'admin' || requestToken !== token) {
        await json(route, 403, { error: 'Administrator access required.' }, {}, call);
        return;
      }
      if (method === 'GET') {
        if (!historyExists) {
          await json(route, 404, { error: 'No cloud history has been saved yet.' }, { ETag: etag(historyRevision) }, call);
          return;
        }
        await json(route, 200, { encryptedPayload: historyPayload }, { ETag: etag(historyRevision) }, call);
        return;
      }
      if (method === 'POST') {
        if (parseRevision(headers['if-match']) !== historyRevision) {
          await json(route, 412, { error: 'Cloud history revision conflict.' }, { ETag: etag(historyRevision) }, call);
          return;
        }
        historyRevision += 1;
        historyExists = true;
        historyPayload = String(body.encryptedPayload || '');
        await json(route, 200, { success: true, revision: historyRevision }, { ETag: etag(historyRevision) }, call);
        return;
      }
    }

    await json(route, 401, { error: 'External service is not available in this deterministic smoke test.' }, {}, call);
  });

  return { calls };
}

async function waitForCondition(page, predicate, label, argument = null, timeoutMs = 20000) {
  try {
    await page.waitForFunction(predicate, argument, { timeout: timeoutMs });
  } catch {
    throw new Error(`Timed out waiting for ${label}.`);
  }
}

async function portfolioSnapshot(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw ? JSON.parse(raw) : null;
  });
}

async function runCommand(page, command, { confirmTrade = false, accept = true } = {}) {
  const input = page.locator('#cmdInput');
  await input.fill(command);
  const run = page.locator('button[title^="Run the command"]');
  if (confirmTrade) {
    // Native window.confirm pauses the click action until a dialog listener
    // handles it, so accept/dismiss inside the listener rather than afterward.
    const dialogPromise = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        const message = dialog.message();
        if (accept) await dialog.accept();
        else await dialog.dismiss();
        resolve(message);
      });
    });
    await run.click();
    const message = await dialogPromise;
    if (!String(message).includes('Review this portfolio change:') &&
        !String(message).includes('Проверьте это изменение портфеля:')) {
      throw new Error(`Trade dialog did not show the expected review heading: ${String(message)}`);
    }
    return String(message);
  }
  await run.click();
}

async function waitForPosition(page, ticker, shares) {
  await waitForCondition(
    page,
    (expected) => {
      const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
      if (!raw) return false;
      const state = JSON.parse(raw);
      return Number(state.positions?.[expected.ticker]?.shares || 0) === expected.shares;
    },
    `${ticker} position with ${shares} shares`,
    { ticker, shares },
    30000
  );
}

async function assertPositionAbsent(page, ticker) {
  await waitForCondition(page, (symbol) => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    if (!raw) return false;
    return !JSON.parse(raw).positions?.[symbol];
  }, `${ticker} position to close`, ticker);
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  const browserConsoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserConsoleErrors.push(message.text());
  });
  const worker = await mockWorkerApi(page);

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('#authModalTitle')?.textContent?.includes('Create administrator account'),
    null,
    { timeout: 20000 }
  );
  await page.locator('#authUserName').fill('Trade Smoke Admin');
  await page.locator('#authPassword').fill('valid-trade-smoke-password');
  await page.locator('#bootstrapSecret').fill('trade-smoke-bootstrap-secret');
  await page.locator('.auth-submit-button').click();
  await waitForCondition(
    page,
    () => !document.querySelector('#auth-container')?.classList.contains('auth-overlay-open'),
    'administrator authentication overlay to close',
    null,
    30000
  );

  // A new administrator with no tracked tickers starts on Balance. Select the
  // empty Margin Desk to expose the terminal, matching intended navigation.
  const marginDesk = page.getByRole('button', { name: 'COMBINED PORTFOLIO' });
  await marginDesk.waitFor({ state: 'visible', timeout: 30000 });
  await marginDesk.click();

  try {
    await page.locator('#cmdInput').waitFor({ state: 'visible', timeout: 30000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      title: document.title,
      authTitle: document.querySelector('#authModalTitle')?.textContent || '',
      authVisible: document.querySelector('#auth-container')?.classList.contains('auth-overlay-open') || false,
      commandInput: Boolean(document.querySelector('#cmdInput')),
      tradingConsoleCard: document.querySelector('#tradingConsoleCard')?.className || '',
      bodyText: document.body.innerText.slice(0, 1800)
    }));
    throw new Error(
      'Terminal did not mount after administrator authentication: ' + JSON.stringify(diagnostic) +
      '; Worker calls: ' + JSON.stringify(worker.calls) +
      '; page errors: ' + JSON.stringify(pageErrors) +
      '; console errors: ' + JSON.stringify(browserConsoleErrors) +
      '. Original: ' + error.message
    );
  }

  // A declined trade is not even allowed to trigger margin rollover or alter the
  // persisted position/cash snapshot.
  await runCommand(page, 'cash 1000');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && Number(JSON.parse(raw).cashCushion?.freeCash) === 1000;
  }, 'initial free cash snapshot');
  const beforeCancelledBuy = await portfolioSnapshot(page);
  await runCommand(page, 'bought 5 QA for 100, pt 150', { confirmTrade: true, accept: false });
  const afterCancelledBuy = await portfolioSnapshot(page);
  if (JSON.stringify(afterCancelledBuy.positions || {}) !== JSON.stringify(beforeCancelledBuy.positions || {}) ||
      Number(afterCancelledBuy.cashCushion?.freeCash) !== Number(beforeCancelledBuy.cashCushion?.freeCash)) {
    throw new Error('Declining a trade changed active positions or free cash.');
  }
  if (afterCancelledBuy.positions?.QA) {
    throw new Error('A declined buy created a position.');
  }

  // New buy and additional buy preserve distinct acquisition lots and target.
  await runCommand(page, 'bought 5 QA for 100, pt 150', { confirmTrade: true });
  await waitForPosition(page, 'QA', 5);
  await runCommand(page, 'bought 2 QA for 120', { confirmTrade: true });
  await waitForPosition(page, 'QA', 7);
  let state = await portfolioSnapshot(page);
  if (state.positions.QA.tranches?.length !== 2) {
    throw new Error('Additional buy did not retain two distinct acquisition lots.');
  }
  if (Number(state.positions.QA.pt) !== 150) {
    throw new Error('Initial price target was not retained after the additional buy.');
  }

  await runCommand(page, 'target QA 180');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && Number(JSON.parse(raw).positions?.QA?.pt) === 180;
  }, 'target price update');

  // Partial exit consumes three shares from the first FIFO lot. The two
  // remaining shares of that lot and the later two-share lot both stay open.
  await runCommand(page, 'sold 3 QA for 130', { confirmTrade: true });
  await waitForPosition(page, 'QA', 4);
  state = await portfolioSnapshot(page);
  const remainingLots = state.positions.QA.tranches || [];
  if (remainingLots.length !== 2 ||
      Number(remainingLots[0]?.qty) !== 2 || Number(remainingLots[0]?.price) !== 100 ||
      Number(remainingLots[1]?.qty) !== 2 || Number(remainingLots[1]?.price) !== 120) {
    throw new Error('Partial exit did not preserve the unsold FIFO acquisition lots.');
  }
  if (!Array.isArray(state.closedTrades) || state.closedTrades.length !== 1) {
    throw new Error('Partial sale was not retained in closed-trade history.');
  }

  // Over-sales are rejected before confirmation and must not be clamped to 4.
  await runCommand(page, 'sold 5 QA for 135');
  await waitForCondition(page, () =>
    document.querySelector('#terminalLog')?.textContent?.includes('only 4 shares are available') ||
    document.querySelector('#terminalLog')?.textContent?.includes('доступно только 4 акций'),
  'oversized sale rejection');
  state = await portfolioSnapshot(page);
  if (Number(state.positions.QA?.shares) !== 4 || state.closedTrades?.length !== 1) {
    throw new Error('Oversized sale modified the portfolio.');
  }

  await runCommand(page, 'sold all QA for 140', { confirmTrade: true });
  await assertPositionAbsent(page, 'QA');
  state = await portfolioSnapshot(page);
  if (state.closedTrades?.length !== 2) {
    throw new Error('Final sale did not create a second closed-trade record.');
  }

  // Cash holdings remain separate from margin positions and do not request a trade confirmation.
  await runCommand(page, 'cash add 3 CSH for 10');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && JSON.parse(raw).cashCushion?.holdings?.some((holding) => holding.ticker === 'CSH');
  }, 'cash holding addition');
  state = await portfolioSnapshot(page);
  if (state.positions?.CSH) throw new Error('Cash holding leaked into margin positions.');
  await runCommand(page, 'cash remove CSH');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && !JSON.parse(raw).cashCushion?.holdings?.some((holding) => holding.ticker === 'CSH');
  }, 'cash holding removal');

  // With no free cash, a buy creates margin debt; an exit pays debt before cash.
  // Reset signed cash/debt and the free-cash cushion independently so this
  // journey measures only the debit created by the MRG purchase.
  await runCommand(page, 'balance 0');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && Number(JSON.parse(raw).balance) === 0;
  }, 'zero signed account balance');
  await runCommand(page, 'cash 0');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && Number(JSON.parse(raw).cashCushion?.freeCash) === 0;
  }, 'zero free cash');
  await runCommand(page, 'bought 2 MRG for 50', { confirmTrade: true });
  await waitForPosition(page, 'MRG', 2);
  state = await portfolioSnapshot(page);
  const debtBeforeMarginExit = Math.abs(Number(state.balance) || 0);
  if (!(debtBeforeMarginExit > 0)) throw new Error('Margin-funded buy did not increase margin debt.');
  await runCommand(page, 'sold all MRG for 60', { confirmTrade: true });
  await assertPositionAbsent(page, 'MRG');
  state = await portfolioSnapshot(page);
  const remainingDebt = Math.max(0, -Number(state.balance || 0));
  if (remainingDebt > 0) {
    throw new Error(`Sale proceeds did not clear the test margin debit (before: ${debtBeforeMarginExit.toFixed(2)}, after: ${remainingDebt.toFixed(2)}).`);
  }
  if (!(Number(state.cashCushion?.freeCash) > 0)) {
    throw new Error('Sale surplus was not added to free cash after debt settlement.');
  }
  if (state.closedTrades?.length !== 3) {
    throw new Error('Margin-funded sale was not retained in closed-trade history.');
  }

  // Browser reload must hydrate active positions and the full closed-history ledger.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#cmdInput').waitFor({ state: 'visible', timeout: 30000 });
  state = await portfolioSnapshot(page);
  if (state.positions?.QA || state.positions?.MRG) {
    throw new Error('A closed position was resurrected after browser reload.');
  }
  if (state.closedTrades?.length !== 3) {
    throw new Error('Closed trade records were lost after browser reload.');
  }

  await page.getByRole('button', { name: 'Trades' }).click();
  await page.locator('#closedHistoryContainer').waitFor({ state: 'visible', timeout: 20000 });
  await waitForCondition(page, () => {
    const text = document.querySelector('#closedTradesTableBody')?.textContent || '';
    return text.includes('QA') && text.includes('MRG');
  }, 'closed history rows for the full trade lifecycle');

  if (pageErrors.length > 0) {
    throw new Error(`Uncaught browser errors during trade lifecycle: ${pageErrors.join('; ')}`);
  }

  console.log('Trade lifecycle browser smoke passed: confirmation/cancellation, additional buys, target persistence, FIFO partial exit, oversell rejection, final exit, independent cash holding, margin funding/debt settlement, reload recovery and Closed History.');
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
