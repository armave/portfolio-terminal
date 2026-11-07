import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
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
  let tenantDirectoryRevision = 0;
  const tenantDirectories = [];
  const tenantCapabilities = {
    owner: ['tenant.read', 'tenant.manage', 'workspace.manage', 'portfolio.manage', 'membership.manage'],
    manager: ['tenant.read', 'portfolio.read', 'portfolio.write'],
    investor: ['tenant.read', 'portfolio.read'],
    guest: ['portfolio.projection.read']
  };
  const tenantDirectoryViewFor = (user) => {
    const visibleTenants = tenantDirectories.flatMap((entry) => {
      const membership = entry.memberships.find((item) =>
        item.userId === user.id && item.status === 'active'
      );
      if (!membership) return [];
      const isOwner = membership.role === 'owner';
      const grants = membership.portfolioIds || [];
      const portfolios = entry.portfolios.filter((portfolio) =>
        isOwner || grants.includes(portfolio.id)
      ).map((portfolio) => ({
        ...portfolio,
        access: isOwner ? 'owner' : membership.role === 'guest' ? 'projection' : 'portfolio',
        capabilities: isOwner ? tenantCapabilities.owner : tenantCapabilities[membership.role]
      }));
      const workspaceIds = new Set(portfolios.map((portfolio) => portfolio.workspaceId));
      const view = {
        tenant: entry.tenant,
        membership: {
          role: membership.role,
          status: 'active',
          membershipVersion: membership.membershipVersion,
          capabilities: tenantCapabilities[membership.role]
        },
        workspaces: entry.workspaces.filter((workspace) => isOwner || workspaceIds.has(workspace.id)),
        portfolios
      };
      if (isOwner) {
        view.memberships = entry.memberships.map((item) => ({
          userId: item.userId,
          role: item.role,
          status: item.status,
          membershipVersion: item.membershipVersion,
          createdAt: item.createdAt,
          portfolioIds: [...(item.portfolioIds || [])]
        }));
      }
      return [view];
    });
    return {
      version: 1,
      revision: tenantDirectoryRevision,
      mode: 'directory-metadata-only',
      financialDataEnabled: false,
      tenants: visibleTenants
    };
  };

  const json = async (route, status, payload, extraHeaders = {}, call = null) => {
    if (call) { call.responseStatus = status; call.responsePayload = payload; }
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

    if (pathname === '/api/tenants' && method === 'GET') {
      if (!currentUser || token !== currentToken) {
        await json(route, 401, { error: 'Not signed in.' }, {}, call);
        return;
      }
      await json(route, 200, tenantDirectoryViewFor(currentUser), {}, call);
      return;
    }
    if (pathname === '/api/tenants' && method === 'POST') {
      if (!currentUser || token !== currentToken || currentUser.role !== 'admin') {
        await json(route, 403, { error: 'Administrator access is required to provision a tenant.' }, {}, call);
        return;
      }
      const name = String(body.name || '').trim();
      const workspaceName = String(body.workspaceName || 'Main workspace').trim();
      const portfolioName = String(body.portfolioName || 'Main portfolio').trim();
      if (name.length < 2 || name.length > 80 ||
          workspaceName.length < 2 || workspaceName.length > 80 ||
          portfolioName.length < 2 || portfolioName.length > 80) {
        await json(route, 400, { error: 'Tenant, workspace and portfolio names must contain 2–80 characters.' }, {}, call);
        return;
      }
      const tenantId = 'tenant-' + (tenantDirectories.length + 1);
      const workspaceId = 'workspace-' + (tenantDirectories.length + 1);
      const portfolioId = 'portfolio-' + (tenantDirectories.length + 1);
      const createdAt = new Date().toISOString();
      const entry = {
        tenant: { id: tenantId, name, status: 'active', createdAt },
        workspaces: [{ id: workspaceId, name: workspaceName, status: 'active' }],
        portfolios: [{ id: portfolioId, workspaceId, name: portfolioName, status: 'active' }],
        memberships: [{
          userId: currentUser.id, role: 'owner', status: 'active',
          membershipVersion: 1, createdAt, portfolioIds: [portfolioId]
        }]
      };
      tenantDirectories.push(entry);
      tenantDirectoryRevision += 1;
      await json(route, 201, {
        success: true,
        revision: tenantDirectoryRevision,
        financialDataEnabled: false,
        tenant: { id: tenantId, name, status: 'active' },
        workspace: { id: workspaceId, tenantId, name: workspaceName },
        portfolio: { id: portfolioId, tenantId, workspaceId, name: portfolioName }
      }, {}, call);
      return;
    }
    const revokeMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/memberships\/revoke$/);
    if (revokeMatch && method === 'POST') {
      const entry = tenantDirectories.find((item) => item.tenant.id === revokeMatch[1]);
      const owner = entry?.memberships.find((item) =>
        item.userId === currentUser?.id && item.role === 'owner' && item.status === 'active'
      );
      const target = entry?.memberships.find((item) =>
        item.userId === body.userId && item.status === 'active'
      );
      if (!entry || !owner || !target || target.role === 'owner') {
        await json(route, 404, { error: 'Tenant not found or membership management is not permitted.' }, {}, call);
        return;
      }
      target.status = 'revoked';
      target.membershipVersion += 1;
      tenantDirectoryRevision += 1;
      await json(route, 200, {
        success: true,
        revision: tenantDirectoryRevision,
        membershipVersion: target.membershipVersion
      }, {}, call);
      return;
    }
    const grantMatch = pathname.match(/^\/api\/tenants\/([^/]+)\/memberships$/);
    if (grantMatch && method === 'POST') {
      const entry = tenantDirectories.find((item) => item.tenant.id === grantMatch[1]);
      const owner = entry?.memberships.find((item) =>
        item.userId === currentUser?.id && item.role === 'owner' && item.status === 'active'
      );
      const role = body.role;
      const portfolioIds = Array.isArray(body.portfolioIds) ? body.portfolioIds : [];
      if (!entry || !owner || !['manager', 'investor', 'guest'].includes(role) ||
          typeof body.userId !== 'string' || body.userId === currentUser?.id ||
          portfolioIds.length < 1 || (role === 'guest' && portfolioIds.length !== 1) ||
          portfolioIds.some((id) => !entry.portfolios.some((portfolio) => portfolio.id === id)) ||
          !users.some((user) => user.id === body.userId)) {
        await json(route, 404, { error: 'Tenant not found or membership management is not permitted.' }, {}, call);
        return;
      }
      let membership = entry.memberships.find((item) => item.userId === body.userId);
      if (membership) {
        membership.role = role;
        membership.status = 'active';
        membership.membershipVersion += 1;
        membership.portfolioIds = [...portfolioIds];
      } else {
        membership = {
          userId: body.userId, role, status: 'active', membershipVersion: 1,
          createdAt: new Date().toISOString(), portfolioIds: [...portfolioIds]
        };
        entry.memberships.push(membership);
      }
      tenantDirectoryRevision += 1;
      await json(route, 201, {
        success: true,
        revision: tenantDirectoryRevision,
        membership: {
          userId: membership.userId,
          role: membership.role,
          status: 'active',
          membershipVersion: membership.membershipVersion,
          capabilities: tenantCapabilities[role]
        }
      }, {}, call);
      return;
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

async function waitForAuthOverlay(page, open, worker = null) {
  await page.waitForFunction(
    (shouldBeOpen) => document.querySelector('#auth-container')?.classList.contains('auth-overlay-open') === shouldBeOpen,
    open,
    { timeout: 20_000 }
  );
  if (!open) {
    try {
      await page.locator('.startup-loading').waitFor({ state: 'detached', timeout: 20_000 });
    } catch {
      const startupState = await page.locator('.startup-loading').evaluate((element) => ({
        message: element.querySelector('.startup-loading__message')?.textContent?.trim() || '',
        hint: element.querySelector('.startup-loading__hint')?.textContent?.trim() || '',
        failed: element.textContent?.includes('Could not finish initializing the app.') || false,
        authOverlayClass: document.querySelector('#auth-container')?.className || '',
        savedBrokerRulesPresent: localStorage.getItem('tradernet_rules_v1') !== null,
        savedBrokerRulesBytes: localStorage.getItem('tradernet_rules_v1')?.length || 0,
        savedPortfolioPresent: localStorage.getItem('margin_portfolio_state_dynamic_v2') !== null,
        savedHistoryPresent: localStorage.getItem('portfolio_closed_history_v1') !== null
      }));
      const recentWorkerCalls = worker?.calls?.slice(-20).map((call) => ({
        method: call.method,
        pathname: call.pathname,
        action: call.action,
        responseStatus: call.responseStatus
      })) || [];
      throw new Error('Application startup overlay did not detach: ' +
        JSON.stringify({ startupState, recentWorkerCalls }));
    }
  }
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

async function captureAuthenticatedPortfolioPerformance(browser) {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 }
  ];
  const runsPerViewport = 3;
  const samples = [];

  for (const viewport of viewports) {
    for (let run = 1; run <= runsPerViewport; run += 1) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        serviceWorkers: 'block'
      });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      const worker = await mockWorkerApi(page);
      const startedAt = Date.now();

      try {
        await page.addInitScript(() => {
          window.__ptAuthenticatedPerformance = { lcp: null, cls: 0 };
          try {
            new PerformanceObserver((list) => {
              const entries = list.getEntries();
              const latest = entries[entries.length - 1];
              if (latest) window.__ptAuthenticatedPerformance.lcp = latest.startTime;
            }).observe({ type: 'largest-contentful-paint', buffered: true });
          } catch {
            // LCP is unavailable in this browser; the report will retain null.
          }
          try {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) window.__ptAuthenticatedPerformance.cls += entry.value;
              }
            }).observe({ type: 'layout-shift', buffered: true });
          } catch {
            // CLS is unavailable in this browser; the report will retain zero.
          }
        });

        await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
          () => document.querySelector('#authModalTitle')?.textContent?.includes('Create administrator account'),
          null,
          { timeout: 20_000 }
        );
        await submitAuth(page, {
          name: 'Performance Admin',
          password: 'performance-admin-password',
          bootstrapSecret: 'operations-smoke-secret'
        });
        await waitForAuthOverlay(page, false);

        const combinedPortfolio = page.getByRole('button', { name: 'COMBINED PORTFOLIO' });
        if (await combinedPortfolio.count()) await combinedPortfolio.click();

        const emptyState = page.locator('#emptyStatePanel');
        await emptyState.getByRole('button', { name: 'Quick Buy' }).waitFor({ state: 'visible', timeout: 10_000 });
        await emptyState.getByRole('button', { name: 'Quick Buy' }).click();
        const terminalCommand = page.getByRole('textbox', { name: 'Terminal command' });
        await terminalCommand.fill('bought 5 AAPL for 10');
        let tradeConfirmationMessage = '';
        page.once('dialog', async (dialog) => {
          tradeConfirmationMessage = dialog.message();
          await dialog.accept();
        });
        await terminalCommand.press('Enter');

        const positionSaved = await page.waitForFunction(() => {
          try {
            const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
            const saved = raw ? JSON.parse(raw) : null;
            return Number(saved?.positions?.AAPL?.shares) >= 5;
          } catch {
            return false;
          }
        }, null, { timeout: 15_000 }).then(() => true).catch(() => false);
        if (!positionSaved) {
          throw new Error('Authenticated performance fixture failed to seed its local-only AAPL paper position.');
        }
        if (!/apply this change\?/i.test(tradeConfirmationMessage) ||
            !/no broker order is submitted/i.test(tradeConfirmationMessage)) {
          throw new Error('Performance seed command did not show the expected local-only confirmation.');
        }

        await waitForCondition(
          () => worker.findCalls('GET', '/').some((call) => call.action === 'freedom-positions' && call.responseStatus === 200),
          'synthetic broker positions snapshot'
        );
        await page.locator('#marketInsightsPanel').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForFunction(
          () => document.querySelector('#marketInsightsTicker')?.textContent?.includes('AAPL'),
          null,
          { timeout: 20_000 }
        );
        await page.evaluate(() => new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        ));

        const metrics = await page.evaluate(() => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const paint = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null;
          const resources = performance.getEntriesByType('resource');
          return {
            firstContentfulPaintMs: paint('first-contentful-paint'),
            domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
            loadEventMs: navigation?.loadEventEnd ?? null,
            responseStartMs: navigation?.responseStart ?? null,
            totalResourceTransferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
            resourceCount: resources.length,
            largestContentfulPaintMs: window.__ptAuthenticatedPerformance?.lcp ?? null,
            cumulativeLayoutShift: window.__ptAuthenticatedPerformance?.cls ?? null
          };
        });
        if (pageErrors.length) throw new Error('Authenticated performance browser errors: ' + pageErrors.join('; '));

        samples.push({
          run,
          viewport: { name: viewport.name, width: viewport.width, height: viewport.height },
          authenticatedRole: 'admin',
          syntheticPortfolio: { ticker: 'AAPL', shares: 5, entryPrice: 10 },
          elapsedToPortfolioReadyMs: Date.now() - startedAt,
          ...metrics
        });
      } finally {
        await context.close();
      }
    }
  }

  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/authenticated-portfolio-performance.json', JSON.stringify({
    schemaVersion: 1,
    fixture: {
      authentication: 'Application bootstrap flow with a deterministic mocked Worker API',
      portfolioSeed: 'Application Quick Buy terminal command; local-only paper trade, no broker order',
      brokerSnapshot: 'Deterministic mocked Freedom positions response',
      liveBrokerVerification: false
    },
    methodology: {
      runsPerViewport,
      viewports,
      readiness: 'Market Insights panel visible and selected ticker confirmed as AAPL',
      timing: 'Elapsed wall-clock time from navigation start through authenticated seeded portfolio readiness'
    },
    samples
  }, null, 2));
  console.log('Authenticated synthetic-portfolio performance fixture captured:', samples.length, 'samples.');
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
  let tradeConfirmationMessage = '';
  page.once('dialog', async (dialog) => {
    tradeConfirmationMessage = dialog.message();
    await dialog.accept();
  });
  await terminalCommand.press('Enter');
  // Wait for the synchronous portfolio-store mutation to persist. The command's
  // quote/cloud follow-up and the broker snapshot are independent of this local write.
  const positionSaved = await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('margin_portfolio_state_dynamic_v2');
      const saved = raw ? JSON.parse(raw) : null;
      return Number(saved?.positions?.AAPL?.shares) > 0;
    } catch {
      return false;
    }
  }, null, { timeout: 15_000 }).then(() => true).catch(() => false);
  if (!positionSaved) {
    const terminalOutput = await page.locator('#terminalLog').innerText();
    throw new Error('Quick Buy seed command did not persist AAPL: ' + terminalOutput.slice(-1200) +
      (tradeConfirmationMessage ? ' | Confirmation: ' + tradeConfirmationMessage.slice(0, 500) : ' | No trade confirmation dialog was shown.'));
  }
  if (!/apply this change\?/i.test(tradeConfirmationMessage) || !/no broker order is submitted/i.test(tradeConfirmationMessage)) {
    throw new Error('Quick Buy did not show the expected local-only trade confirmation: ' + tradeConfirmationMessage.slice(0, 700));
  }

  // The executive overview is available to admins in Combined Portfolio and
  // individual ticker views, including the single-ticker navigation layout.
  const executiveOverview = page.locator('#adminExecutiveDashboardTitle');
  const executiveOverviewPanel = page.locator('section[aria-labelledby="adminExecutiveDashboardTitle"]');
  await executiveOverview.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await executiveOverview.innerText()).toLowerCase().includes('admin executive overview')) {
    throw new Error('Admin executive overview heading was not rendered for the authenticated admin.');
  }
  if (!(await page.locator('#adminExposureTitle').isVisible())) {
    throw new Error('Admin position exposure table was not visible.');
  }
  for (const sectionId of ['adminPositionBasisTitle', 'adminMarketValuationTitle', 'adminDebtCarryingCostsTitle']) {
    if (await executiveOverviewPanel.locator('#' + sectionId).count() !== 1) {
      throw new Error('Expected exactly one integrated legacy metric section: #' + sectionId);
    }
  }
  if (await page.locator('#portfolioMetricsGrid .portfolio-micro-summary').count() !== 0) {
    throw new Error('The legacy admin metric strip still renders separately above the executive dashboard.');
  }
  if (!(await page.locator('#adminRiskTitle').isVisible()) ||
      !(await page.locator('[aria-labelledby="adminRiskTitle"] [role="progressbar"]').isVisible())) {
    throw new Error('Admin margin risk summary is missing its risk buffer gauge.');
  }
  await page.getByRole('button', { name: 'Margin: AAPL' }).click();
  await executiveOverview.waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await page.locator('#adminExposureTitle').isVisible())) {
    throw new Error('Admin executive overview disappeared in the individual AAPL ticker view.');
  }

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

  const visibleSettingsDesk = () => page.locator('#settingsDesk').filter({ visible: true }).first();
  await page.locator('#settingsBtn').click();
  await visibleSettingsDesk().waitFor({ state: 'visible', timeout: 20_000 });
  if (await page.locator('#settingsDesk').filter({ visible: true }).count() !== 1) {
    throw new Error('Expected exactly one visible Settings desk after navigation.');
  }
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await visibleSettingsDesk().evaluate((element) => ({
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
  const waitForUserSaveReady = async (name) => {
    await page.waitForFunction((userName) => {
      const row = Array.from(Array.from(Array.from(document.querySelectorAll('#settingsDesk')).find((desk) => desk.getClientRects().length > 0)?.querySelectorAll('tbody tr') || [])).find((candidate) =>
        candidate.querySelector('input')?.getAttribute('aria-label') === `Name for ${userName}`
      );
      const saveButton = row?.querySelector('button[type="button"]');
      return saveButton instanceof HTMLButtonElement && !saveButton.disabled;
    }, name, { timeout: 10_000 });
  };
  const createUser = async (name, password) => {
    await visibleSettingsDesk().getByLabel('User name').fill(name);
    await visibleSettingsDesk().getByLabel('Password (6+ characters)').fill(password);
    if (await visibleSettingsDesk().getByLabel('New user role').inputValue() !== 'guest') {
      throw new Error('New accounts must default to the guest role.');
    }
    await visibleSettingsDesk().getByLabel('New user language').selectOption('en');
    const createCallsBefore = worker.count('POST', '/api/auth/users');
    const directoryReadsBefore = worker.count('GET', '/api/auth/users');
    await visibleSettingsDesk().getByRole('button', { name: 'Add user' }).click();
    try {
      await waitForCondition(
        () => worker.findCalls('POST', '/api/auth/users').slice(createCallsBefore).some((call) =>
          call.body.action === 'create' && call.body.name === name && call.responseStatus === 201
        ),
        'successful creation request for ' + name
      );
    } catch {
      const formState = await visibleSettingsDesk().locator('form.settings-user-form').evaluate((form) => {
        const controls = Array.from(form.querySelectorAll('input, select')).map((control) => ({
          ariaLabel: control.getAttribute('aria-label'),
          value: control.value,
          valid: control.validity.valid,
          validationMessage: control.validationMessage
        }));
        return {
          controls,
          formValid: form.checkValidity(),
          submitDisabled: form.querySelector('button[type="submit"]')?.disabled ?? null,
          alerts: Array.from(document.querySelectorAll('#settingsDesk [role="alert"]')).map((item) => item.textContent?.trim())
        };
      });
      const recentCalls = worker.findCalls('POST', '/api/auth/users').slice(createCallsBefore)
        .map((call) => ({ action: call.body.action, name: call.body.name, status: call.responseStatus }));
      throw new Error('User creation did not submit as expected: ' + JSON.stringify({
        requestedName: name, formState, recentCalls
      }));
    }
    await waitForCondition(
      () => worker.users.some((user) => user.name === name),
      'mock Worker account record for ' + name
    );
    await waitForCondition(
      () => worker.findCalls('GET', '/api/auth/users').slice(directoryReadsBefore)
        .some((call) => call.responseStatus === 200),
      'refreshed administrator user directory after creating ' + name
    );
    const row = visibleSettingsDesk().locator(`input[aria-label="Name for ${name}"]`).locator('xpath=ancestor::tr[1]');
    try {
      await row.waitFor({ state: 'visible', timeout: 20_000 });
    } catch {
      const visibleRows = await visibleSettingsDesk().locator('tbody tr').allInnerTexts();
      const alerts = await visibleSettingsDesk().locator('[role="alert"]').allInnerTexts();
      const recentRequests = worker.findCalls('GET', '/api/auth/users').slice(-3)
        .map((call) => ({ status: call.responseStatus, token: call.token }));
      throw new Error('Created account did not render in Settings: ' + JSON.stringify({
        requestedName: name, workerUsers: worker.users.map((user) => user.name),
        visibleRows, alerts, recentRequests
      }));
    }
    await waitForUserSaveReady(name);
  };
  await createUser('Browser Guest Delete', 'delete-guest-password');
  await createUser('Browser Guest Keep', 'keep-guest-password');

  const rowForUser = (name) => visibleSettingsDesk().locator(`input[aria-label="Name for ${name}"]`)
    .locator('xpath=ancestor::tr[1]');
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
  await waitForUserSaveReady('Browser Guest Updated');

  const updatedRow = rowForUser('Browser Guest Updated');
  await updatedRow.getByLabel('Role for Browser Guest Updated').selectOption('guest');
  await updatedRow.getByRole('button', { name: 'Save' }).click();
  await waitForCondition(
    () => worker.users.some((user) => user.name === 'Browser Guest Updated' && user.role === 'guest'),
    'guest role restoration'
  );
  await waitForUserSaveReady('Browser Guest Updated');

  // Tenant directory: owner metadata creation, least-privilege guest grant,
  // and guest projection-only view without an owner membership roster.
  const tenantPanel = visibleSettingsDesk().locator('section[aria-labelledby="tenantDirectoryTitle"]');
  await tenantPanel.locator('details').filter({ hasText: 'Create tenant metadata' }).locator('summary').click();
  await tenantPanel.getByLabel('Tenant name').fill('Operations Family');
  await tenantPanel.getByLabel('Workspace name').fill('Family workspace');
  await tenantPanel.getByLabel('Portfolio name').fill('Core portfolio');
  const tenantCreateCountBefore = worker.count('POST', '/api/tenants');
  await tenantPanel.getByRole('button', { name: 'Create directory entry' }).click();
  await waitForCondition(
    () => worker.findCalls('POST', '/api/tenants').slice(tenantCreateCountBefore)
      .some((call) => call.body.name === 'Operations Family' && call.responseStatus === 201),
    'tenant metadata creation'
  );
  await tenantPanel.locator('article h4').filter({ hasText: 'Operations Family' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  await tenantPanel.locator('details').filter({ hasText: 'Grant access' }).locator('summary').click();
  await tenantPanel.getByLabel('Member').selectOption({ label: 'Browser Guest Updated · Guest' });
  await tenantPanel.getByLabel('Access role').selectOption('guest');
  await tenantPanel.getByLabel('Core portfolio').check();
  const grantCountBefore = worker.findCalls('POST', '/api/tenants/tenant-1/memberships').length;
  await tenantPanel.getByRole('button', { name: 'Grant access' }).click();
  await waitForCondition(
    () => worker.findCalls('POST', '/api/tenants/tenant-1/memberships').slice(grantCountBefore)
      .some((call) => call.body.role === 'guest' && call.body.portfolioIds.length === 1 && call.responseStatus === 201),
    'single-portfolio guest membership grant'
  );
  await tenantPanel.locator('article').getByText('Browser Guest Updated', { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
  if (await tenantPanel.getByText('Directory only — financial storage is not enabled for newly created tenants.').count() !== 1) {
    throw new Error('Tenant directory UI did not disclose its metadata-only storage boundary.');
  }

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
  const adminError = visibleSettingsDesk().locator('[role="alert"]').filter({ hasText: 'At least one admin account must remain.' });
  await adminError.waitFor({ state: 'visible', timeout: 10_000 });
  await adminRow.getByLabel('Role for Operations Admin').selectOption('admin');

  // Role-specific cadence is persisted in its own browser preference.
  await visibleSettingsDesk().locator('#quoteRefreshInterval').selectOption('30000');
  await page.waitForFunction(() => localStorage.getItem('quote_refresh_interval') === '30000', null, { timeout: 10_000 });

  // The stop-out threshold cannot exceed the maintenance threshold.
  const brokerRules = visibleSettingsDesk().locator('details.settings-broker-rules');
  await brokerRules.locator('summary').click();
  // The panel is a native details element. Keep the smoke test focused on
  // broker-rule form validation and ensure the disclosure is open before
  // exercising the inputs.
  await brokerRules.evaluate((element) => {
    if (element instanceof HTMLDetailsElement) element.open = true;
  });
  await brokerRules.locator('#maintenanceMarginInput').waitFor({ state: 'visible', timeout: 5_000 });
  await visibleSettingsDesk().locator('#maintenanceMarginInput').fill('5');
  await visibleSettingsDesk().locator('#stopOutRatioInput').fill('10');
  await visibleSettingsDesk().locator('#brokerRulesForm button[type="submit"]').click();
  const invalidStopOut = await visibleSettingsDesk().locator('#stopOutRatioInput').evaluate((input) => input.validity.customError);
  if (!invalidStopOut) throw new Error('Settings accepted a stop-out threshold above maintenance equity.');
  await visibleSettingsDesk().locator('#maintenanceMarginInput').fill('12.5');
  await visibleSettingsDesk().locator('#stopOutRatioInput').fill('3');
  await visibleSettingsDesk().locator('#annualMarginRateInput').fill('18');
  await visibleSettingsDesk().locator('#brokerRulesForm button[type="submit"]').click();
  try {
    await page.waitForFunction(() => {
      const stored = JSON.parse(localStorage.getItem('tradernet_rules_v1') || 'null');
      return stored && Math.abs(stored.annualBorrowRate - 0.18) < 0.000001 &&
        Math.abs(stored.maintenanceEquityRatio - 0.125) < 0.000001 &&
        Math.abs(stored.stopOutRatio - 0.03) < 0.000001;
    }, null, { timeout: 10_000 });
  } catch {
    const brokerRulesState = await page.locator('#brokerRulesForm').evaluate((form) => {
      const ids = ['annualMarginRateInput', 'maintenanceMarginInput', 'stopOutRatioInput', 'rolloverTimeInput'];
      const inputs = Object.fromEntries(ids.map((id) => {
        const input = form.querySelector('#' + id);
        return [id, input ? {
          value: input.value,
          valid: input.validity.valid,
          customError: input.validity.customError,
          validationMessage: input.validationMessage
        } : null];
      }));
      return {
        inputs,
        formValid: form.checkValidity(),
        savedRules: JSON.parse(localStorage.getItem('tradernet_rules_v1') || 'null')
      };
    });
    throw new Error('Broker Rules values did not persist after a valid submission: ' + JSON.stringify(brokerRulesState));
  }

  // Per-account language is server-backed and is restored after a browser reload.
  await visibleSettingsDesk().getByLabel('Account language').selectOption('ru');
  await waitForCondition(
    () => worker.findCalls('POST', '/api/auth/me').some((call) => call.body.language === 'ru' && call.responseStatus === 200),
    'account language preference save'
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAuthOverlay(page, false, worker);
  await page.locator('#settingsBtn').click();
  await visibleSettingsDesk().waitFor({ state: 'visible', timeout: 20_000 });
  try {
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('#settingsDesk')).some((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const visible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        return visible && element.querySelector('.settings-toolbar select')?.value === 'ru';
      });
    }, null, { timeout: 20_000 });
  } catch {
    const restoredState = await page.evaluate(() => ({
      authClass: document.querySelector('#auth-container')?.className || '',
      desks: Array.from(document.querySelectorAll('#settingsDesk')).map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const language = element.querySelector('select[aria-label="Account language"]');
        return {
          visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          language: language?.value ?? null,
          languageCount: element.querySelectorAll('select[aria-label="Account language"]').length,
          text: (element.textContent || '').trim().slice(0, 180)
        };
      })
    }));
    throw new Error('Account language was not restored after reload: ' + JSON.stringify({
      restoredState,
      workerUser: (() => {
        const user = worker.users.find((item) => item.id === 'admin-operations');
        return user ? { id: user.id, role: user.role, language: user.language } : null;
      })(),
      authMe: worker.findCalls('GET', '/api/auth/me').slice(-3).map((call) => ({
        status: call.responseStatus, payload: call.responsePayload
      })),
      languagePosts: worker.findCalls('POST', '/api/auth/me').map((call) => ({
        language: call.body.language, status: call.responseStatus, payload: call.responsePayload
      }))
    }));
  }
  // Continue the admin journey in English; the created guest keeps its Russian preference.
  const adminLanguageSaveCount = worker.findCalls('POST', '/api/auth/me').length;
  const adminLanguageSelect = visibleSettingsDesk().locator('.settings-toolbar select').first();
  await adminLanguageSelect.waitFor({ state: 'visible', timeout: 10_000 });
  await adminLanguageSelect.selectOption('en');
  await waitForCondition(
    () => worker.findCalls('POST', '/api/auth/me').slice(adminLanguageSaveCount)
      .some((call) => call.body.language === 'en' && call.responseStatus === 200),
    'restore administrator language for remaining browser assertions'
  );

  // A guest sees the account preference and manual sync controls, never admin-only user,
  // backup or broker-rule management. The shared owner workspace is not read.
  const sharedWorkspaceReadsBeforeGuest = worker.count('GET', '/api/state');
  const userDirectoryReadsBeforeGuest = worker.count('GET', '/api/auth/users');
  await visibleSettingsDesk().getByRole('button', { name: 'Выйти' }).click();
  await waitForAuthOverlay(page, true);
  await submitAuth(page, { name: 'Browser Guest Updated', password: 'updated-guest-password' });
  await waitForAuthOverlay(page, false);
  if (await page.locator('#adminExecutiveDashboardTitle').count()) {
    throw new Error('Guest session rendered the admin executive dashboard.');
  }
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  const guestTenantPanel = visibleSettingsDesk().locator('section[aria-labelledby="tenantDirectoryTitle"]');
  await guestTenantPanel.locator('article h4').filter({ hasText: 'Operations Family' }).first().waitFor({ state: 'visible', timeout: 10_000 });
  if (await guestTenantPanel.locator('h5').filter({ hasText: 'Manage members' }).count() !== 0 ||
      await guestTenantPanel.getByRole('button', { name: 'Revoke' }).count() !== 0) {
    throw new Error('Guest tenant directory response exposed the owner-only membership roster or revocation controls.');
  }
  if (await visibleSettingsDesk().locator('section.settings-user-panel').count() ||
      await visibleSettingsDesk().locator('details.settings-broker-rules').count()) {
    throw new Error('Guest Settings exposed administrator-only account or broker-rule controls.');
  }
  if (await page.getByRole('button', { name: /Экспорт/ }).count()) {
    throw new Error('Guest Settings exposed the administrator backup action.');
  }
  if (!(await visibleSettingsDesk().getByRole('button', { name: 'Синхронизировать портфель' }).count())) {
    throw new Error('Guest Settings lost the manual portfolio sync control.');
  }
  if (worker.count('GET', '/api/guest-portfolio') < 1) {
    throw new Error('Guest sign-in did not hydrate its assigned projection.');
  }
  if (worker.count('GET', '/api/auth/users') !== userDirectoryReadsBeforeGuest) {
    throw new Error('Guest sign-in requested the administrator user directory.');
  }
  if (await visibleSettingsDesk().locator('#quoteRefreshInterval').inputValue() !== '15000') {
    throw new Error('Guest refresh cadence inherited the administrator 30-second preference.');
  }
  if (worker.count('GET', '/api/state') !== sharedWorkspaceReadsBeforeGuest) {
    throw new Error('Guest sign-in attempted to read the administrator shared workspace.');
  }
  if (worker.calls.some((call) => call.method === 'GET' && call.pathname === '/api/state' && call.token === 'operations-session-operations-user-2')) {
    throw new Error('Guest session attempted to read the administrator shared workspace.');
  }
  if (pageErrors.length) throw new Error('Browser errors: ' + pageErrors.join('; '));

  await captureAuthenticatedPortfolioPerformance(browser);

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
