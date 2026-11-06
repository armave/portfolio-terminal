import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const host = '127.0.0.1';
const port = Number(process.env.PERFORMANCE_BASELINE_PORT || 4175);
const appUrl = `http://${host}:${port}/portfolio-terminal/`;
const workerOrigin = 'https://trading-proxy.armenavetisyan-sa.workers.dev';
const outputPath = 'artifacts/browser-performance-baseline.json';
const runsPerViewport = 3;
const syntheticPositionCount = 100;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 }
];

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

function createLargePortfolioFixture() {
  const positions = {};
  const activeTrancheTypes = {};
  const now = Date.now();
  for (let index = 0; index < syntheticPositionCount; index += 1) {
    const ticker = `PT${String(index + 1).padStart(3, '0')}`;
    const price = 20 + index * 0.35;
    positions[ticker] = {
      ticker,
      shares: 50,
      currentPrice: price,
      pt: price * 1.12,
      commBuy: 0.2,
      marginCharged: 0,
      startDate: '2026-10-01',
      tranches: [
        { qty: 25, price: price * 0.94, date: '2026-10-01', purchaseDate: '2026-10-01' },
        { qty: 25, price: price * 0.97, date: '2026-10-15', purchaseDate: '2026-10-15' }
      ]
    };
    activeTrancheTypes[ticker] = 'margin';
  }

  return {
    positions,
    activeTrancheTypes,
    activeTrancheMixes: {},
    activeTrancheGuestAssignments: {},
    activeTrancheGuestAssignmentDetails: {},
    closedTradeAllocations: {},
    guestPortfolioSnapshot: undefined,
    guestTrancheLedger: [],
    brokerAccountInfo: undefined,
    cashCushion: { freeCash: 10000, holdings: [] },
    balance: -25000,
    portfolioEquity: undefined,
    portfolioEquityUpdatedAt: undefined,
    realizedMarginCharged: 100,
    tranches: [],
    startDate: '2026-10-01',
    activeView: 'COMBINED',
    closedTrades: [],
    brokerExecutedTrades: [],
    closedHistory: [],
    cashflows: [],
    brokerAssumptions: {
      broker: 'Performance fixture',
      annualBorrowRate: 0.15,
      dayCountBasis: 365,
      rolloverHour: 0,
      rolloverMinute: 0,
      rolloverTimeZone: 'Asia/Yerevan',
      maintenanceEquityRatio: 0.25,
      stopOutRatio: 0.2,
      commissionMin: 1,
      commissionPerShare: 0.012,
      commissionRatePct: 0.12
    },
    lastRolloverTimestamp: now,
    lastUpdated: now,
    cashBalance: 0,
    holdings: [],
    cashStocks: [],
    apiKeys: {},
    selectedTicker: null,
    pendingMutation: null
  };
}

function authUser() {
  return {
    id: 'performance-admin',
    name: 'Performance Admin',
    role: 'admin',
    language: 'en',
    createdAt: '2026-11-06T00:00:00.000Z'
  };
}

async function mockWorkerApi(page) {
  const user = authUser();
  const token = 'performance-admin-session';
  let stateRevision = 0;
  let historyRevision = 0;
  const calls = [];

  const json = async (route, status, payload, call = null, extraHeaders = {}) => {
    if (call) call.responseStatus = status;
    const origin = route.request().headers().origin || '*';
    await route.fulfill({
      status,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Auth, If-Match',
        'Access-Control-Expose-Headers': 'ETag',
        ...extraHeaders
      },
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  };

  await page.route(workerOrigin + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const pathname = url.pathname;
    const headers = request.headers();
    const requestToken = headers['x-app-auth'] ||
      headers.authorization?.replace(/^Bearer\\s+/i, '') || '';
    let body = {};
    try { body = request.postDataJSON() || {}; } catch { body = {}; }
    const action = url.searchParams.get('action') || '';
    const call = { method, pathname, action, tokenPresent: Boolean(requestToken) };
    calls.push(call);

    if (method === 'OPTIONS') {
      await json(route, 204, {}, call);
      return;
    }

    if (pathname === '/api/auth/status' && method === 'GET') {
      await json(route, 200, { setupRequired: true, userCount: 0 }, call);
      return;
    }
    if (pathname === '/api/auth/bootstrap' && method === 'POST') {
      if (body.bootstrapSecret !== 'performance-smoke-bootstrap-secret') {
        await json(route, 401, { error: 'Invalid bootstrap credentials.' }, call);
        return;
      }
      await json(route, 200, { token, user, expiresAt: Date.now() + 3600000 }, call);
      return;
    }
    if (!requestToken || requestToken !== token) {
      await json(route, 401, { error: 'Not signed in.' }, call);
      return;
    }
    if (pathname === '/api/auth/me' && method === 'GET') {
      await json(route, 200, { user }, call);
      return;
    }
    if (pathname === '/api/auth/cloud-key' && method === 'GET') {
      await json(route, 200, { key: 'performance-smoke-workspace-key' }, call);
      return;
    }
    if (pathname === '/api/auth/users' && method === 'GET') {
      await json(route, 200, { users: [user] }, call);
      return;
    }
    if (pathname === '/api/state' || pathname === '/api/history') {
      const isState = pathname === '/api/state';
      const revision = isState ? stateRevision : historyRevision;
      const etag = { ETag: `"${revision}"` };
      if (method === 'GET') {
        await json(route, 404, { error: isState ? 'No cloud workspace has been saved yet.' : 'No cloud history has been saved yet.' }, call, etag);
        return;
      }
      if (method === 'POST') {
        const suppliedRevision = Number(String(headers['if-match'] || '0').replaceAll('"', ''));
        if (suppliedRevision !== revision) {
          await json(route, 412, { error: 'Cloud revision conflict.' }, call, etag);
          return;
        }
        if (isState) stateRevision += 1;
        else historyRevision += 1;
        const nextRevision = isState ? stateRevision : historyRevision;
        await json(route, 200, { success: true, revision: nextRevision }, call, { ETag: `"${nextRevision}"` });
        return;
      }
    }

    if (pathname === '/' && action) {
      switch (action) {
        case 'freedom-portfolio-snapshot':
        case 'freedom-positions':
          await json(route, 200, {
            data: { result: { ps: { loaded: true, acc: [], pos: [] } } }
          }, call);
          return;
        case 'freedom-orders-stream':
        case 'freedom-orders':
          await json(route, 200, { ok: true, data: { orders: { order: [] } } }, call);
          return;
        case 'freedom-trades':
          await json(route, 200, { data: { trades: { trade: [] } } }, call);
          return;
        case 'quote': {
          const symbols = String(url.searchParams.get('symbol') || '').split(',').filter(Boolean);
          await json(route, 200, symbols.map((symbol) => ({
            symbol: symbol.toUpperCase(),
            price: { current: 100, previousClose: 99, marketState: 'REGULAR' }
          })), call);
          return;
        }
        case 'news':
          await json(route, 200, [], call);
          return;
        case 'stocktwits':
          await json(route, 200, { messages: [] }, call);
          return;
        default:
          await json(route, 200, {}, call);
          return;
      }
    }

    await json(route, 200, {}, call);
  });

  return { calls };
}

async function installPerformanceObservers(page, portfolioSnapshot = null) {
  await page.addInitScript((snapshot) => {
    if (snapshot) {
      localStorage.setItem('margin_portfolio_state_dynamic_v2', JSON.stringify(snapshot));
    }
    window.__ptPerformance = { lcp: null, cls: 0, longTaskCount: 0, longTaskDurationMs: 0 };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const latest = entries[entries.length - 1];
        if (latest) window.__ptPerformance.lcp = latest.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // LCP is unavailable in this browser; the report retains null.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__ptPerformance.cls += entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      // CLS is unavailable in this browser; the report retains zero.
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__ptPerformance.longTaskCount += 1;
          window.__ptPerformance.longTaskDurationMs += entry.duration;
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {
      // Long-task entries are unavailable in this browser.
    }
  }, portfolioSnapshot);
}

async function collectMetrics(page, startedAt) {
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  ));
  return page.evaluate((elapsedMs) => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null;
    const resources = performance.getEntriesByType('resource');
    const snapshotRaw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
    const snapshot = snapshotRaw ? JSON.parse(snapshotRaw) : null;
    const positions = snapshot?.positions || {};
    const positionCount = Object.keys(positions).length;
    const trancheCount = Object.values(positions).reduce((total, position) =>
      total + (Array.isArray(position?.tranches) ? position.tranches.length : 0), 0
    );
    return {
      elapsedToReadyMs: elapsedMs,
      firstContentfulPaintMs: paint('first-contentful-paint'),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      responseStartMs: navigation?.responseStart ?? null,
      totalResourceTransferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      resourceCount: resources.length,
      largestContentfulPaintMs: window.__ptPerformance?.lcp ?? null,
      cumulativeLayoutShift: window.__ptPerformance?.cls ?? null,
      longTaskCount: window.__ptPerformance?.longTaskCount ?? null,
      longTaskDurationMs: window.__ptPerformance?.longTaskDurationMs ?? null,
      domNodeCount: document.getElementsByTagName('*').length,
      visibleNavigationItemCount: document.querySelectorAll('#tickerTabs [data-nav-tab="true"]').length,
      positionCount,
      trancheCount,
      pageTextLength: document.body.innerText.length
    };
  }, Date.now() - startedAt);
}

async function measureUnauthenticatedShell(viewport, run) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installPerformanceObservers(page);
  await page.route(workerOrigin + '/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call = { method: request.method(), pathname: url.pathname };
    const origin = request.headers().origin || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Auth, If-Match'
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (url.pathname === '/api/auth/status' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ setupRequired: true, userCount: 0 }),
        headers: corsHeaders
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Unauthenticated performance fixture.' }),
      headers: corsHeaders
    });
  });

  const startedAt = Date.now();
  try {
    await page.goto(appUrl, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('#authModalTitle').waitFor({ state: 'visible', timeout: 20_000 });
    const metrics = await collectMetrics(page, startedAt);
    if (pageErrors.length > 0) {
      throw new Error(`Unauthenticated ${viewport.name} run ${run} produced browser errors: ${pageErrors.join('; ')}`);
    }
    return { run, ...metrics, pageErrorCount: 0 };
  } finally {
    await context.close();
  }
}

async function measureAuthenticatedLargePortfolio(viewport, run) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installPerformanceObservers(page, createLargePortfolioFixture());
  const worker = await mockWorkerApi(page);

  const startedAt = Date.now();
  try {
    await page.goto(appUrl, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('#authModalTitle').waitFor({ state: 'visible', timeout: 20_000 });
    const seededStateDiagnostics = await page.evaluate(() => {
      const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
      const state = raw ? JSON.parse(raw) : null;
      return {
        rawBytes: raw?.length || 0,
        positionCount: Object.keys(state?.positions || {}).length,
        keys: state ? Object.keys(state).sort() : []
      };
    });
    await page.locator('#authUserName').fill('Performance Admin');
    await page.locator('#authPassword').fill('performance-smoke-password');
    await page.locator('#bootstrapSecret').fill('performance-smoke-bootstrap-secret');
    await page.locator('.auth-submit-button').click();
    await page.waitForFunction(
      () => !document.querySelector('#auth-container')?.classList.contains('auth-overlay-open'),
      null,
      { timeout: 30_000 }
    );
    await page.getByRole('button', { name: 'COMBINED PORTFOLIO' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'COMBINED PORTFOLIO' }).click();
    await page.locator('#cmdInput').waitFor({ state: 'visible', timeout: 30_000 });
    const hydratedStateDiagnostics = await page.evaluate(() => {
      const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
      const state = raw ? JSON.parse(raw) : null;
      return {
        rawBytes: raw?.length || 0,
        positionCount: Object.keys(state?.positions || {}).length,
        activeView: state?.activeView || null,
        firstPosition: Object.keys(state?.positions || {})[0] || null,
        bodyExcerpt: document.body.innerText.slice(0, 500)
      };
    });
    if (hydratedStateDiagnostics.positionCount !== syntheticPositionCount) {
      throw new Error(
        `Authenticated portfolio fixture changed during startup: seeded=${JSON.stringify(seededStateDiagnostics)}, hydrated=${JSON.stringify(hydratedStateDiagnostics)}, workerActions=${worker.calls.map((call) => call.action || call.pathname).join(',')}`
      );
    }
    const metrics = await collectMetrics(page, startedAt);
    if (metrics.positionCount !== syntheticPositionCount) {
      throw new Error(`Authenticated fixture expected ${syntheticPositionCount} positions, found ${metrics.positionCount}.`);
    }
    if (metrics.trancheCount !== syntheticPositionCount * 2) {
      throw new Error(`Authenticated fixture expected ${syntheticPositionCount * 2} tranches, found ${metrics.trancheCount}.`);
    }
    if (pageErrors.length > 0) {
      throw new Error(`Authenticated ${viewport.name} run ${run} produced browser errors: ${pageErrors.join('; ')}`);
    }
    return {
      run,
      ...metrics,
      pageErrorCount: 0,
      workerRequestCount: worker.calls.length,
      fixture: 'authenticated-admin-with-synthetic-local-portfolio'
    };
  } finally {
    await context.close();
  }
}

function median(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return finite.length ? finite[Math.floor(finite.length / 2)] : null;
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const results = {};
  for (const viewport of viewports) {
    const unauthenticated = [];
    const authenticatedLargePortfolio = [];
    for (let run = 1; run <= runsPerViewport; run += 1) {
      unauthenticated.push(await measureUnauthenticatedShell(viewport, run));
      authenticatedLargePortfolio.push(await measureAuthenticatedLargePortfolio(viewport, run));
    }
    results[viewport.name] = { unauthenticatedShell: unauthenticated, authenticatedLargePortfolio };
  }

  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF || null,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    browserVersion: browser.version(),
    fixture: {
      brokerAndMarketApis: 'deterministic mocked Worker responses',
      authenticatedUser: 'synthetic administrator account',
      syntheticPortfolio: { positions: syntheticPositionCount, tranches: syntheticPositionCount * 2 },
      userData: 'synthetic test data; no real account or investor data'
    },
    runsPerViewport,
    viewports: results
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Browser performance baseline written to ${outputPath}`);
  for (const [name, scenarios] of Object.entries(results)) {
    for (const [scenario, samples] of Object.entries(scenarios)) {
      console.log(`${name} ${scenario}: median ready ${median(samples.map((sample) => sample.elapsedToReadyMs)) ?? 'n/a'}ms; median FCP ${median(samples.map((sample) => sample.firstContentfulPaintMs)) ?? 'n/a'}ms`);
    }
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
