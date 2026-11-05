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
      }, {
        curr: 'USD', i: 'MSFT.US', name: 'Microsoft', q: '2',
        mkt_price: '21', market_value: '42', bal_price_a: '20',
        profit_close: '2', acc_pos_id: 7002
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
    }, {
      trade_id: 'smoke-buy-msft-1',
      instr_nm: 'MSFT.US',
      operation: '1',
      quantity: '2',
      p: '20',
      date: '2026-11-02T10:00:00.000Z',
      v: '40',
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
          await json(route, 200, [{
            id: 'smoke-news-1',
            url: 'https://example.com/smoke-news',
            headline: 'Smoke Test Market Update',
            datetime: 1_799_999_940,
            source: 'Smoke Test Wire',
            summary: 'Deterministic news content for modal accessibility coverage.'
          }], {}, call);
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


async function assertResponsiveLayout(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const main = document.querySelector('#mainTerminalView');
    const navigation = document.querySelector('#tickerTabs');
    const mainBounds = main?.getBoundingClientRect();
    const navBounds = navigation?.getBoundingClientRect();
    const navControls = Array.from(navigation?.querySelectorAll('[data-nav-tab="true"]') || [])
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const tickerStrip = element.closest('.workspace-nav-ticker-list');
        const tickerStripBounds = tickerStrip?.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          inScrollableTickerStrip: Boolean(tickerStrip),
          tickerStripWidth: tickerStripBounds?.width || 0,
          tickerStripDisplay: tickerStrip ? getComputedStyle(tickerStrip).display : ''
        };
      });
    return {
      viewportWidth,
      documentWidth: document.documentElement.scrollWidth,
      mainBounds: mainBounds ? { left: mainBounds.left, right: mainBounds.right } : null,
      navBounds: navBounds ? { left: navBounds.left, right: navBounds.right } : null,
      navControls,
      overflowElements: Array.from(document.body.querySelectorAll('*'))
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          const styles = getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            id: element.id || '',
            className: typeof element.className === 'string' ? element.className : '',
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
            width: Math.round(bounds.width),
            position: styles.position,
            text: (element.textContent || '').trim().slice(0, 80)
          };
        })
        .filter((element) => element.right > viewportWidth + 1 || element.left < -1)
        .sort((left, right) => right.right - left.right)
        .slice(0, 12)
    };
  });

  if (layout.documentWidth > layout.viewportWidth + 1) {
    throw new Error(`Unexpected page-level horizontal overflow at ${width}px: ${layout.documentWidth}px content in ${layout.viewportWidth}px viewport. Offenders: ${JSON.stringify(layout.overflowElements)}`);
  }
  if (!layout.mainBounds || layout.mainBounds.left < -1 || layout.mainBounds.right > layout.viewportWidth + 1) {
    throw new Error(`The portfolio workspace is clipped at ${width}px.`);
  }
  if (!layout.navBounds || layout.navControls.some((control) =>
    !control.inScrollableTickerStrip &&
    (control.left < layout.navBounds.left - 1 || control.right > layout.navBounds.right + 1)
  )) {
    throw new Error(`Workspace navigation contains a clipped fixed destination at ${width}px.`);
  }
  if (layout.navControls.some((control) =>
    control.inScrollableTickerStrip &&
    control.tickerStripDisplay !== 'contents' &&
    control.tickerStripWidth < 1
  )) {
    throw new Error(`The ticker navigation strip is not visible at ${width}px.`);
  }
}

async function assertResponsiveSurface(page, selector, surface) {
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    const layout = await page.locator(selector).evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        visible: element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
        viewportWidth: document.documentElement.clientWidth,
        documentWidth: document.documentElement.scrollWidth,
        left: bounds.left,
        right: bounds.right
      };
    });
    if (!layout.visible) {
      throw new Error(`${surface} is not visible at ${width}px.`);
    }
    if (layout.documentWidth > layout.viewportWidth + 1) {
      throw new Error(`${surface} caused page-level horizontal overflow at ${width}px: ${layout.documentWidth}px content in ${layout.viewportWidth}px viewport.`);
    }
    if (layout.left < -1 || layout.right > layout.viewportWidth + 1) {
      throw new Error(`${surface} is clipped at ${width}px: ${JSON.stringify(layout)}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
}

async function assertNewsDialogTouchTargets(page) {
  const controls = await page.locator('.news-article-dialog button, .news-article-dialog a[href]').evaluateAll((elements) =>
    elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName,
        width: bounds.width,
        height: bounds.height
      };
    })
  );
  const undersized = controls.filter((control) => control.height < 43 || control.width < 43);
  if (undersized.length) {
    throw new Error('News dialog actions are below the 44px touch target: ' + JSON.stringify(undersized));
  }
}

async function assertManyTickerNavigation(page) {
  await page.setViewportSize({ width: 360, height: 844 });
  const mobileMeasurements = await page.locator('.workspace-nav-ticker-list').evaluate((strip) => {
    const template = strip.querySelector('button');
    if (!template) throw new Error('The ticker navigation strip has no destination to extend.');
    const clones = [];
    for (let index = 0; index < 12; index += 1) {
      const ticker = 'SMK' + String(index + 1).padStart(2, '0');
      const clone = template.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('data-nav-tab');
      clone.removeAttribute('data-nav-index');
      clone.classList.add('stage3-nav-smoke-clone');
      clone.textContent = ticker;
      clone.setAttribute('aria-label', 'Margin: ' + ticker);
      strip.appendChild(clone);
      clones.push(clone);
    }
    const nav = document.querySelector('#tickerTabs');
    const navBounds = nav.getBoundingClientRect();
    const cloneBounds = clones.map((clone) => clone.getBoundingClientRect());
    const result = {
      stripDisplay: getComputedStyle(strip).display,
      navWidth: nav.clientWidth,
      navScrollWidth: nav.scrollWidth,
      navBounds: { left: navBounds.left, right: navBounds.right },
      cloneBounds: cloneBounds.map(({ left, right, top }) => ({ left, right, top })),
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      fixedDestinationVisible: Boolean(document.querySelector('#settingsBtn')?.getClientRects().length)
    };
    clones.forEach((clone) => clone.remove());
    return result;
  });

  if (mobileMeasurements.stripDisplay !== 'contents' || mobileMeasurements.navWidth < 200) {
    throw new Error('The mobile ticker destinations are not merged into the centered navigation group.');
  }
  if (new Set(mobileMeasurements.cloneBounds.map(({ top }) => Math.round(top))).size < 2) {
    throw new Error('A long mobile ticker list did not wrap within the centered navigation group.');
  }
  if (mobileMeasurements.cloneBounds.some(({ left, right }) =>
    left < mobileMeasurements.navBounds.left - 1 || right > mobileMeasurements.navBounds.right + 1
  )) {
    throw new Error('A mobile ticker destination is clipped by the centered navigation group.');
  }
  if (mobileMeasurements.documentWidth > mobileMeasurements.viewportWidth + 1) {
    throw new Error('A long mobile ticker list caused page-level horizontal overflow: ' + JSON.stringify(mobileMeasurements));
  }
  if (!mobileMeasurements.fixedDestinationVisible) {
    throw new Error('Fixed workspace destinations disappeared beside a long mobile ticker list.');
  }

  await page.setViewportSize({ width: 1024, height: 900 });
  const desktopMeasurements = await page.locator('.workspace-nav-ticker-list').evaluate((strip) => {
    const template = strip.querySelector('button');
    if (!template) throw new Error('The ticker navigation strip has no destination to extend.');
    const clones = [];
    for (let index = 0; index < 12; index += 1) {
      const ticker = 'SMK' + String(index + 1).padStart(2, '0');
      const clone = template.cloneNode(true);
      clone.removeAttribute('id');
      clone.removeAttribute('data-nav-tab');
      clone.removeAttribute('data-nav-index');
      clone.classList.add('stage3-nav-smoke-clone');
      clone.textContent = ticker;
      clone.setAttribute('aria-label', 'Margin: ' + ticker);
      strip.appendChild(clone);
      clones.push(clone);
    }
    const result = {
      clientWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      stripWidth: strip.getBoundingClientRect().width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      fixedDestinationVisible: Boolean(document.querySelector('#settingsBtn')?.getClientRects().length)
    };
    clones.forEach((clone) => clone.remove());
    return result;
  });

  if (desktopMeasurements.stripWidth < 200 || desktopMeasurements.clientWidth < 200) {
    throw new Error('The desktop ticker strip does not receive usable width.');
  }
  if (desktopMeasurements.scrollWidth <= desktopMeasurements.clientWidth + 20) {
    throw new Error('A long desktop ticker list did not become independently scrollable.');
  }
  if (desktopMeasurements.documentWidth > desktopMeasurements.viewportWidth + 1) {
    throw new Error('A long desktop ticker list caused page-level horizontal overflow: ' + JSON.stringify(desktopMeasurements));
  }
  if (!desktopMeasurements.fixedDestinationVisible) {
    throw new Error('Fixed workspace destinations disappeared beside a long ticker list.');
  }
}

async function assertVisibleControlsHaveNames(page, surface) {
  const unnamed = await page.evaluate(() => {
    const selectors = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      '[role="button"]',
      '[role="tab"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="combobox"]'
    ].join(', ');
    const controls = Array.from(document.querySelectorAll(selectors));
    const getText = (element) => String(element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
      getComputedStyle(element).visibility !== 'hidden';
    const getName = (element) => {
      const ariaLabel = element.getAttribute('aria-label')?.trim();
      if (ariaLabel) return ariaLabel;
      const labelledBy = element.getAttribute('aria-labelledby')
        ?.split(/\\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(getText)
        .filter(Boolean)
        .join(' ');
      if (labelledBy) return labelledBy;
      if ('labels' in element && element.labels?.length) {
        const labels = Array.from(element.labels).map(getText).filter(Boolean).join(' ');
        if (labels) return labels;
      }
      const alt = element.getAttribute('alt') ||
        element.querySelector('img[alt]')?.getAttribute('alt') ||
        element.querySelector('[role="img"][aria-label]')?.getAttribute('aria-label') ||
        getText(element.querySelector('svg title'));
      if (alt) return alt;
      const value = element.matches('input[type="submit"], input[type="button"], input[type="reset"]')
        ? element.value
        : '';
      if (value) return value;
      // Native form controls such as select, input, and textarea do not
      // derive their accessible name from child/option text. Only controls
      // whose naming rules allow content may use their text as a fallback.
      const allowsNameFromContent = element.matches(
        'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"]'
      );
      const content = allowsNameFromContent ? getText(element) : '';
      if (content && /[a-zA-ZА-Яа-яЁё0-9]/u.test(content)) return content;
      return element.getAttribute('title')?.trim() || '';
    };

    return controls
      .filter(isVisible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || '',
        role: element.getAttribute('role') || '',
        name: getName(element),
        markup: element.outerHTML.slice(0, 240)
      }))
      .filter((control) => !control.name || !/[a-zA-ZА-Яа-яЁё0-9]/u.test(control.name));
  });

  if (unnamed.length > 0) {
    throw new Error(
      `Visible controls without a meaningful accessible name in ${surface}: ` +
      unnamed.map((control) =>
        `<${control.tag}${control.id ? ' id="' + control.id + '"' : ''}> ${control.markup}`
      ).join(' | ')
    );
  }
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
  await assertVisibleControlsHaveNames(page, 'administrator bootstrap dialog');

  await submitAuth(page, {
    name: 'Smoke Admin',
    password: 'valid-smoke-password',
    bootstrapSecret: 'smoke-bootstrap-secret'
  });
  await waitForAuthOverlay(page, false);

  // Verify page geometry rather than treating successful mounting as responsive QA.
  await page.locator('#boardHeaderBanner #cloudStatus').waitFor({ state: 'visible', timeout: 10_000 });
  await assertVisibleControlsHaveNames(page, 'administrator dashboard');
  if (await page.locator('#cloudStatus').count() !== 1) {
    throw new Error('Cloud synchronization health must have one persistent header indicator.');
  }
  for (const width of [320, 360, 390, 768, 1024, 1440]) {
    await assertResponsiveLayout(page, width);
  }



  // Exercise roving keyboard navigation through the full destination list.
  const navigationTabs = page.locator('#tickerTabs [data-nav-tab="true"]');
  await navigationTabs.first().focus();
  await page.keyboard.press('End');
  if (await page.evaluate(() => document.activeElement?.id) !== 'settingsBtn') {
    throw new Error('End did not move focus to the final workspace destination.');
  }
  await page.keyboard.press('Enter');
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  await assertVisibleControlsHaveNames(page, 'administrator Settings desk navigation');
  await assertResponsiveSurface(page, '#settings', 'administrator Settings desk');
  await page.locator('#settingsBtn').focus();
  await page.keyboard.press('ArrowRight');
  if (!(await navigationTabs.first().evaluate((element) => element === document.activeElement))) {
    throw new Error('ArrowRight did not wrap from the final destination to the first.');
  }

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
  await assertVisibleControlsHaveNames(page, 'Balance desk before expanding tranches');
  await assertResponsiveSurface(page, '#cashCushionContainer', 'Balance desk');
  await page.locator('#activeTranches').getByRole('button', { name: 'Expand' }).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector('#activeTranchesPanel');
    if (!panel?.classList.contains('is-expanded')) return false;
    const bounds = panel.getBoundingClientRect();
    return bounds.height > 100 && Number(getComputedStyle(panel).opacity) >= 0.99;
  }, null, { timeout: 10_000 });
  await page.locator('#activeTranchesTable .active-tranche-row').first().waitFor({ state: 'visible', timeout: 20_000 });
  await assertVisibleControlsHaveNames(page, 'Expanded Balance tranche table');

  // Keep AAPL cash-funded for the guest assignment journey, while exercising
  // News against a second operation explicitly classified as Margin.
  const msftRow = page.locator('#activeTranchesTable .active-tranche-row').filter({ hasText: 'MSFT' });
  await msftRow.waitFor({ state: 'visible', timeout: 20_000 });
  await msftRow.getByRole('button', { name: 'Margin' }).click();
  const marginTickerTab = page.locator('#tickerTabs [aria-label="Margin: MSFT"]');
  await marginTickerTab.waitFor({ state: 'visible', timeout: 20_000 });
  await marginTickerTab.click();

  // Exercise the real News dialog with a deterministic provider response.
  const marketInsights = page.locator('#marketInsightsPanel');
  await marketInsights.waitFor({ state: 'visible', timeout: 20_000 });
  await waitForCondition(
    () => worker.calls.some((call) => call.action === 'news'),
    'Market Insights company news request'
  );
  const newsTrigger = page.getByRole('button', { name: 'Read news: Smoke Test Market Update' });
  await newsTrigger.waitFor({ state: 'visible', timeout: 20_000 });
  await newsTrigger.click();

  const newsDialog = page.getByRole('dialog', { name: 'Smoke Test Market Update' });
  await newsDialog.waitFor({ state: 'visible', timeout: 10_000 });
  await assertVisibleControlsHaveNames(page, 'Market Insights news dialog');
  await assertResponsiveSurface(page, '.news-article-dialog', 'Market Insights news article dialog');
  await assertNewsDialogTouchTargets(page);

  const newsDialogInitialFocus = await page.evaluate(() =>
    document.activeElement?.matches('[data-news-dialog-close]') === true
  );
  if (!newsDialogInitialFocus) {
    throw new Error('Opening a news article did not focus its Close button.');
  }
  const newsBackgroundIsolated = await page.locator('#root').evaluate((element) =>
    element.hasAttribute('inert') && element.getAttribute('aria-hidden') === 'true'
  );
  if (!newsBackgroundIsolated) {
    throw new Error('The news dialog did not isolate the application root from focus and assistive technology.');
  }

  await page.keyboard.press('Escape');
  await newsDialog.waitFor({ state: 'hidden', timeout: 10_000 });
  const newsTriggerRestored = await newsTrigger.evaluate((element) => element === document.activeElement);
  if (!newsTriggerRestored) {
    throw new Error('Closing the news dialog with Escape did not restore focus to its article trigger.');
  }
  const newsBackgroundRestored = await page.locator('#root').evaluate((element) =>
    !element.hasAttribute('inert') && !element.hasAttribute('aria-hidden')
  );
  if (!newsBackgroundRestored) {
    throw new Error('Closing the news dialog did not restore the application root accessibility state.');
  }
  await assertResponsiveSurface(page, '#marketInsightsPanel', 'Market Insights panel');

  await assertManyTickerNavigation(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /BALANCE/ }).click();
  await page.locator('#cashCushionContainer').waitFor({ state: 'visible', timeout: 20_000 });
  const aaplRow = page.locator('#activeTranchesTable .active-tranche-row').filter({ hasText: 'AAPL' });
  const guestAssignment = aaplRow.locator('select').first();
  await guestAssignment.waitFor({ state: 'visible', timeout: 20_000 });
  await waitForCondition(
    () => worker.calls.some((call) => call.method === 'GET' && call.pathname === '/api/auth/users'),
    'administrator guest directory request'
  );
  await page.waitForFunction(() => {
    const aaplRow = Array.from(document.querySelectorAll('#activeTranchesTable .active-tranche-row'))
      .find((row) => row.querySelector('[data-label="Ticker"]')?.textContent?.trim() === 'AAPL');
    const select = aaplRow?.querySelector('select');
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

  await page.getByRole('button', { name: 'Trades' }).click();
  await page.locator('#closedHistoryContainer').waitFor({ state: 'visible', timeout: 20_000 });
  await assertVisibleControlsHaveNames(page, 'Administrator Closed History desk');
  await assertResponsiveSurface(page, '#closedHistoryContainer', 'Administrator Closed History desk');
  await page.getByRole('button', { name: /BALANCE/ }).click();
  await page.locator('#cashCushionContainer').waitFor({ state: 'visible', timeout: 20_000 });

  // The first explicit sync may be the first snapshot trigger in this browser
  // session. It may therefore make the one allowed WebSocket/REST request per
  // source. A second sync must reuse those results and create no backup traffic.
  worker.failNextStateConflict();
  const previousConflicts = worker.stateConflictCount();
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  const syncButton = page.locator('#settingsDesk button[aria-label="Sync portfolio"]');
  await syncButton.waitFor({ state: 'visible', timeout: 10_000 });
  await syncButton.click();
  await waitForCondition(
    () => worker.stateConflictCount() > previousConflicts,
    'cloud state revision conflict response'
  );
  await page.getByRole('alert').filter({ hasText: 'Cloud push failed: Cloud revision conflict.' })
    .waitFor({ state: 'visible', timeout: 20_000 });

  const snapshotRequestsAfterInitialSync = {
    portfolio: worker.countAction('freedom-portfolio-snapshot') + worker.countAction('freedom-positions'),
    orders: worker.countAction('freedom-orders-stream') + worker.countAction('freedom-orders'),
    quotes: worker.countAction('freedom-quote-stream') + worker.countAction('freedom-quote')
  };
  const previousSecondSyncWrites = worker.count('POST', '/api/state');
  const previousSecondSyncTrades = worker.countAction('freedom-trades');
  await syncButton.click();
  await waitForCondition(
    () => worker.count('POST', '/api/state') > previousSecondSyncWrites,
    'second manual sync cloud push'
  );
  const snapshotRequestsAfterSecondSync = {
    portfolio: worker.countAction('freedom-portfolio-snapshot') + worker.countAction('freedom-positions'),
    orders: worker.countAction('freedom-orders-stream') + worker.countAction('freedom-orders'),
    quotes: worker.countAction('freedom-quote-stream') + worker.countAction('freedom-quote')
  };
  if (JSON.stringify(snapshotRequestsAfterSecondSync) !== JSON.stringify(snapshotRequestsAfterInitialSync)) {
    throw new Error('Second manual sync reopened a one-shot WebSocket snapshot or its REST backup.');
  }
  if (worker.countAction('freedom-trades') <= previousSecondSyncTrades) {
    throw new Error('Manual sync did not refresh canonical executed-trade history over REST.');
  }

  // Export the actual browser snapshot, reject malformed JSON, restore the valid
  // backup and confirm a reset of local portfolio plus revisioned cloud history.
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  await assertVisibleControlsHaveNames(page, 'administrator Settings desk');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export portfolio backup as JSON' }).click();
  const download = await downloadPromise;
  const exportedFilename = download.suggestedFilename();
  if (!exportedFilename.endsWith('.json')) {
    throw new Error(`Backup export used an extension the importer does not accept: ${exportedFilename}`);
  }
  const importAccept = await page.locator('#importFileInput').getAttribute('accept');
  if (importAccept !== '.json') {
    throw new Error(`Backup importer accepts ${importAccept || 'no explicit extension'}, expected .json`);
  }
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

  await page.waitForFunction(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('portfolio-terminal-state', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the local portfolio database.'));
      request.onblocked = () => reject(new Error('Local portfolio database upgrade is blocked.'));
    });
    try {
      if (!database.objectStoreNames.contains('snapshots')) return false;
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readonly');
        const request = transaction.objectStore('snapshots').get('current');
        request.onsuccess = () => {
          const snapshot = request.result;
          resolve(Boolean(snapshot &&
            snapshot.schemaVersion === 1 &&
            Number.isInteger(snapshot.revision) &&
            snapshot.state &&
            typeof snapshot.state === 'object' &&
            Array.isArray(snapshot.history?.brokerExecutedTrades) &&
            Array.isArray(snapshot.history?.cashflows)));
        };
        request.onerror = () => reject(request.error || new Error('Could not read the local portfolio snapshot.'));
      });
    } finally {
      database.close();
    }
  }, null, { timeout: 20_000 });

  const stateWritesBeforeReset = worker.count('POST', '/api/state');
  const historyWritesBeforeReset = worker.count('POST', '/api/history');
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.getByRole('button', { name: 'Reset local and cloud portfolio data' }).click();
  await waitForCondition(
    () => worker.count('POST', '/api/state') > stateWritesBeforeReset &&
      worker.count('POST', '/api/history') > historyWritesBeforeReset,
    'confirmed local portfolio and closed-history reset'
  );
  // Reset returns the app to its default desk; reopen Settings for sign-out.
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await waitForAuthOverlay(page, true);
  await page.waitForFunction(
    () => document.querySelector('#authModalTitle')?.textContent?.includes('Portfolio Terminal sign in'),
    null,
    { timeout: 20_000 }
  );
  await assertVisibleControlsHaveNames(page, 'sign-in dialog');

  const workspaceIsIsolated = await page.locator('#mainTerminalView').evaluate((element) => {
    const inertAncestor = element.closest('[inert]');
    return Boolean(inertAncestor && inertAncestor.getAttribute('aria-hidden') === 'true');
  });
  if (!workspaceIsIsolated) {
    throw new Error('The open authentication dialog did not make the background workspace inert and aria-hidden.');
  }

  // Confirm the shared authentication dialog traps keyboard focus at its boundaries.
  await page.locator('#authUserName').focus();
  await page.keyboard.press('Shift+Tab');
  if (await page.evaluate(() => document.activeElement?.type) !== 'submit') {
    throw new Error('Shift+Tab escaped the authentication dialog instead of wrapping to Submit.');
  }
  await page.keyboard.press('Tab');
  if (await page.evaluate(() => document.activeElement?.id) !== 'authUserName') {
    throw new Error('Tab did not wrap to the first authentication field.');
  }

  await submitAuth(page, { name: 'Unknown User', password: 'invalid-smoke-password' });
  await page.locator('.auth-feedback--error').waitFor({ state: 'visible', timeout: 10_000 });
  if (!(await page.locator('.auth-feedback--error').innerText()).includes('Invalid account credentials.')) {
    throw new Error('Failed guest sign-in did not show the expected error.');
  }
  await waitForAuthOverlay(page, true);

  const sharedWorkspaceReadsBeforeGuest = worker.count('GET', '/api/state');
  await submitAuth(page, { name: 'Smoke Guest', password: 'valid-smoke-password' });
  await waitForAuthOverlay(page, false);
  const workspaceRestored = await page.locator('#mainTerminalView').evaluate((element) =>
    !element.closest('[inert]') && !element.closest('[aria-hidden="true"]')
  );
  if (!workspaceRestored) {
    throw new Error('Closing the authentication dialog did not restore background workspace interaction.');
  }
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

  await page.getByRole('button', { name: 'LOTS' }).click();
  await page.locator('#guestHistoryContainer').waitFor({ state: 'visible', timeout: 20_000 });
  await assertVisibleControlsHaveNames(page, 'Guest LOTS history desk');
  await assertResponsiveSurface(page, '#guestHistoryContainer', 'Guest LOTS history desk');

  await page.locator('#settingsBtn').click();
  await page.locator('#settingsDesk').waitFor({ state: 'visible', timeout: 20_000 });
  await assertVisibleControlsHaveNames(page, 'guest Settings desk');
  await assertResponsiveSurface(page, '#settings', 'guest Settings desk');
  if (!(await page.locator('#settingsDesk').innerText()).includes('Smoke Guest')) {
    throw new Error('The guest identity was not reflected in Settings after account switching.');
  }
  if (pageErrors.length > 0) {
    throw new Error(`Uncaught browser errors during authenticated journeys: ${pageErrors.join('; ')}`);
  }

  console.log('Browser smoke passed: responsive admin/guest desks, News dialog focus and background isolation, named controls, touch targets, broker partial failure, cloud revision conflict, backup export/import/reset, guest assignment publication, account switching, and guest-only workspace hydration.');
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, delay(5_000)]);
    if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
  }
}
