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
          // A stable broker-only fill gives the reconciliation audit-review
          // browser journey a deterministic finding that cannot alter app state.
          await json(route, 200, {
            data: { trades: { trade: [{
              trade_id: 'audit-review-smoke-fill',
              instr_nm: 'REV',
              type: '1',
              q: '2',
              p: '101',
              curr_c: 'USD',
              date: '2026-11-08T13:00:00.000Z',
              commission: '0',
              commission_currency: 'USD'
            }] } }
          }, {}, call);
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

  // Record a review note against an intentionally broker-only test execution.
  // The review is audit-only and must survive reload without changing any
  // financial fields or converting the provisional finding into a resolution.
  await page.getByRole('button', { name: /Reconcile broker activity/ }).click();
  const reviewFinding = page.locator('article').filter({ hasText: 'REV BUY' }).first();
  await reviewFinding.waitFor({ state: 'visible', timeout: 20000 });
  await reviewFinding.getByRole('button', { name: 'Review item' })
    .waitFor({ state: 'visible', timeout: 10000 });
  const financialSnapshot = async () => page.evaluate(() => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    const state = raw ? JSON.parse(raw) : {};
    const positions = Object.fromEntries(Object.entries(state.positions || {}).map(([ticker, position]) => [
      ticker,
      {
        shares: position.shares,
        commBuy: position.commBuy,
        marginCharged: position.marginCharged,
        tranches: (position.tranches || []).map((tranche) => ({
          qty: tranche.qty,
          price: tranche.price,
          date: tranche.date,
          acquiredAt: tranche.acquiredAt,
          buyCommission: tranche.buyCommission
        }))
      }
    ]));
    const closedTrades = (state.closedTrades || []).map((trade) => ({
      id: trade.id,
      ticker: trade.ticker,
      shares: trade.shares,
      avgBuyPrice: trade.avgBuyPrice,
      entryPrice: trade.entryPrice,
      sellPrice: trade.sellPrice,
      exitPrice: trade.exitPrice,
      buyDate: trade.buyDate,
      purchaseDate: trade.purchaseDate,
      sellDate: trade.sellDate,
      exitDate: trade.exitDate,
      grossProfit: trade.grossProfit,
      commissions: trade.commissions,
      feesAndCommissions: trade.feesAndCommissions,
      totalCommissions: trade.totalCommissions,
      marginInterest: trade.marginInterest,
      netProfit: trade.netProfit,
      netRealizedGain: trade.netRealizedGain
    }));
    return {
      positions,
      balance: Number(state.balance ?? 0),
      freeCash: Number(state.cashCushion?.freeCash ?? state.cashBalance ?? 0),
      cashHoldings: (state.cashCushion?.holdings || []).map((holding) => ({
        ticker: holding.ticker,
        shares: holding.shares,
        averagePrice: holding.averagePrice
      })),
      closedTrades
    };
  });
  const financialBeforeReview = await financialSnapshot();
  const reviewReason = 'Browser smoke: broker-only execution evidence checked; no posting authorized.';
  await reviewFinding.getByRole('button', { name: 'Review item' }).click();
  await reviewFinding.getByLabel('Reason for review').fill(reviewReason);
  await reviewFinding.getByRole('button', { name: 'Record review' }).click();
  await reviewFinding.getByText('Reviewed · not resolved').waitFor({ state: 'visible', timeout: 15000 });
  const reviewedSnapshot = await portfolioSnapshot(page);
  const reviewEvents = (reviewedSnapshot.transactionEvents || []).filter((event) =>
    event.type === 'portfolio.reconciliation' &&
    event.actor?.type === 'user' &&
    event.source === 'broker-reconciliation-review' &&
    event.idempotencyKey === 'reconciliation-review:activity:execution-unmatched-broker:audit-review-smoke-fill' &&
    event.requestFingerprint &&
    event.note?.includes(reviewReason)
  );
  if (reviewEvents.length !== 1) {
    throw new Error(`Expected one stable audit-only review event; found ${reviewEvents.length}.`);
  }
  const reviewEvent = reviewEvents[0];
  if (reviewEvent.positionQuantityDelta !== undefined ||
      reviewEvent.cashHoldingQuantityDelta !== undefined ||
      reviewEvent.cashDelta !== undefined ||
      reviewEvent.marginDebtDelta !== undefined) {
    throw new Error('Reconciliation review event contains a financial delta.');
  }
  const financialAfterReview = await financialSnapshot();
  if (JSON.stringify(financialAfterReview) !== JSON.stringify(financialBeforeReview)) {
    throw new Error('Recording a reconciliation review changed portfolio/accounting fields.');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  // The active desk is restored as Trades after reload, so the terminal
  // command editor is expected to remain hidden until Combined Portfolio opens.
  await page.getByRole('button', { name: 'Trades' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'Trades' }).click();
  await page.locator('#closedHistoryContainer').waitFor({ state: 'visible', timeout: 20000 });
  await page.getByRole('button', { name: /Reconcile broker activity/ }).click();
  const restoredFinding = page.locator('article').filter({ hasText: 'REV BUY' }).first();
  await restoredFinding.getByText(reviewReason, { exact: false }).waitFor({ state: 'visible', timeout: 20000 });
  await restoredFinding.getByText('Reviewed · not resolved').waitFor({ state: 'visible', timeout: 15000 });
  if (await restoredFinding.getByRole('button', { name: 'Review item' }).count() !== 0) {
    throw new Error('Reloaded reviewed finding still offered a duplicate review action.');
  }
  const afterReloadSnapshot = await portfolioSnapshot(page);
  const persistedReviewEvents = (afterReloadSnapshot.transactionEvents || []).filter((event) =>
    event.idempotencyKey === reviewEvent.idempotencyKey
  );
  if (persistedReviewEvents.length !== 1) {
    throw new Error('The audit-only review event was duplicated or lost after reload.');
  }
  const financialAfterReload = await financialSnapshot();
  if (JSON.stringify(financialAfterReload) !== JSON.stringify(financialBeforeReview)) {
    throw new Error('Reloading the audit-only review changed portfolio/accounting fields.');
  }

  // Exercise the Balance-desk reversal UI only after the original trade and
  // Closed History journey has passed. Keeping this test at the end prevents
  // navigation in the reversal check from perturbing the earlier trade fixture.
  await page.getByRole('button', { name: 'COMBINED PORTFOLIO' }).click();
  await page.locator('#cmdInput').waitFor({ state: 'visible', timeout: 20000 });

  const freeCashBeforeReversal = Number((await portfolioSnapshot(page)).cashCushion?.freeCash);
  await runCommand(page, 'cash 1000');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && Number(JSON.parse(raw).cashCushion?.freeCash) === 1000;
  }, 'balance reversal smoke adjustment');
  const firstCashAdjustment = await page.evaluate(() => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    const events = raw ? JSON.parse(raw).transactionEvents || [] : [];
    return [...events].reverse().find((event) =>
      event.type === 'cash.adjustment' &&
      Number.isFinite(Number(event.cashDelta)) &&
      Math.abs(Number(event.cashDelta)) > 1e-8
    ) || null;
  });
  if (!firstCashAdjustment?.id) {
    throw new Error('Balance reversal smoke adjustment was not journaled.');
  }
  const firstCashDelta = Number(firstCashAdjustment.cashDelta);
  const balanceNav = page.locator('button[data-nav-tab="true"]').filter({ hasText: 'BALANCE' });
  await balanceNav.click();
  await page.getByRole('heading', { name: 'Recent balance adjustments' })
    .waitFor({ state: 'visible', timeout: 20000 });
  await page.getByLabel('Reason for reversal').first().fill('Browser smoke: reverse the test cash adjustment');
  await page.getByRole('button', { name: 'Review reversal' }).first().click();
  await page.getByRole('button', { name: 'Confirm reversal' }).click();
  await waitForCondition(
    page,
    (input) => {
      const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
      if (!raw) return false;
      const state = JSON.parse(raw);
      const correction = (state.transactionEvents || []).find((event) =>
        event.type === 'correction' &&
        event.relatedEventId === input.eventId &&
        Math.abs(Number(event.cashDelta) + input.delta) < 1e-8
      );
      return Math.abs(Number(state.cashCushion?.freeCash) - input.previousFreeCash) < 1e-8 && Boolean(correction);
    },
    'confirmed balance reversal and immutable correction',
    { eventId: firstCashAdjustment.id, delta: firstCashDelta, previousFreeCash: freeCashBeforeReversal }
  );
  const firstReversalState = await portfolioSnapshot(page);
  const successfulCorrection = firstReversalState.transactionEvents.find((event) =>
    event.type === 'correction' && event.relatedEventId === firstCashAdjustment.id
  );
  if (!successfulCorrection?.note?.includes('Browser smoke: reverse the test cash adjustment')) {
    throw new Error('Successful balance reversal did not retain the review reason.');
  }
  if (await page.locator(`article[data-balance-adjustment-event-id="${firstCashAdjustment.id}"]`).count() !== 0) {
    throw new Error('The reversed cash adjustment remained in the eligible Balance-desk list.');
  }

  await page.getByRole('button', { name: 'COMBINED PORTFOLIO' }).click();
  await page.locator('#cmdInput').waitFor({ state: 'visible', timeout: 20000 });
  const freeCashBeforeSecondAdjustment = Number((await portfolioSnapshot(page)).cashCushion?.freeCash);
  await runCommand(page, 'cash 1000');
  await waitForCondition(page, () => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    return raw && Number(JSON.parse(raw).cashCushion?.freeCash) === 1000;
  }, 'second balance reversal smoke adjustment');
  const consumedCashAdjustment = await page.evaluate((previousId) => {
    const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    const events = raw ? JSON.parse(raw).transactionEvents || [] : [];
    return [...events].reverse().find((event) =>
      event.id !== previousId &&
      event.type === 'cash.adjustment' &&
      Number.isFinite(Number(event.cashDelta)) &&
      Math.abs(Number(event.cashDelta)) > 1e-8
    ) || null;
  }, firstCashAdjustment.id);
  if (!consumedCashAdjustment?.id) {
    throw new Error('Second balance reversal smoke adjustment was not journaled.');
  }
  const consumedCashDelta = Number(consumedCashAdjustment.cashDelta);
  if (!(consumedCashDelta > 0 && consumedCashDelta > 500)) {
    throw new Error('Second smoke adjustment is not large enough to verify spent-cash rejection.');
  }

  await runCommand(page, 'bought 5 QA for 100, pt 150', { confirmTrade: true });
  await waitForPosition(page, 'QA', 5);
  const cashAfterSmokeBuy = Number((await portfolioSnapshot(page)).cashCushion?.freeCash);
  if (!(cashAfterSmokeBuy >= 0 && cashAfterSmokeBuy < consumedCashDelta)) {
    throw new Error('Synthetic purchase did not consume enough of the adjusted cash to reject reversal.');
  }
  await balanceNav.click();
  await page.getByRole('heading', { name: 'Recent balance adjustments' })
    .waitFor({ state: 'visible', timeout: 20000 });
  await page.getByLabel('Reason for reversal').first().fill('Browser smoke: reject after cash has been spent');
  await page.getByRole('button', { name: 'Review reversal' }).first().click();
  await page.getByRole('button', { name: 'Confirm reversal' }).click();
  await page.getByText(
    'Balance adjustment could not be reversed. The balance may have changed since the original adjustment.'
  ).waitFor({ state: 'visible', timeout: 10000 });
  const rejectedReversalState = await portfolioSnapshot(page);
  if (Number(rejectedReversalState.cashCushion?.freeCash) !== cashAfterSmokeBuy ||
      rejectedReversalState.transactionEvents.some((event) =>
        event.type === 'correction' && event.relatedEventId === consumedCashAdjustment.id
      )) {
    throw new Error('Rejected balance reversal changed cash or appended a correction.');
  }
  if (!rejectedReversalState.transactionEvents.some((event) => event.id === consumedCashAdjustment.id)) {
    throw new Error('Rejected balance reversal lost its original journal event.');
  }

  if (pageErrors.length > 0) {
    throw new Error(`Uncaught browser errors during trade lifecycle: ${pageErrors.join('; ')}`);
  }

  console.log('Trade lifecycle browser smoke passed: confirmation/cancellation, additional buys, target persistence, FIFO partial exit, oversell rejection, final exit, independent cash holding, margin funding/debt settlement, reload recovery, Closed History, balance-adjustment review/confirmation, immutable inverse correction and consumed-cash reversal rejection.');
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
