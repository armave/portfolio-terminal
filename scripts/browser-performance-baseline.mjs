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

async function measure(viewport) {
  const samples = [];
  for (let run = 1; run <= runsPerViewport; run += 1) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.addInitScript(() => {
      window.__ptPerformance = { lcp: null, cls: 0 };
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const latest = entries[entries.length - 1];
          if (latest) window.__ptPerformance.lcp = latest.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        // LCP is unavailable in this browser; the report will retain null.
      }
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__ptPerformance.cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      } catch {
        // CLS is unavailable in this browser; the report will retain zero.
      }
    });

    await page.route(workerOrigin + '/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const origin = request.headers().origin || '*';
      const corsHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-App-Auth, If-Match',
        'Access-Control-Expose-Headers': 'ETag'
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
        body: JSON.stringify({ error: 'Unauthenticated performance-baseline fixture.' }),
        headers: corsHeaders
      });
    });

    const startedAt = Date.now();
    try {
      await page.goto(appUrl, { waitUntil: 'load', timeout: 30_000 });
      await page.locator('#authModalTitle').waitFor({ state: 'visible', timeout: 20_000 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
          largestContentfulPaintMs: window.__ptPerformance?.lcp ?? null,
          cumulativeLayoutShift: window.__ptPerformance?.cls ?? null
        };
      });
      samples.push({
        run,
        elapsedToAuthReadyMs: Date.now() - startedAt,
        ...metrics,
        pageErrorCount: pageErrors.length,
        pageErrors
      });
      if (pageErrors.length > 0) {
        throw new Error(`${viewport.name} run ${run} produced browser errors: ${pageErrors.join('; ')}`);
      }
    } finally {
      await context.close();
    }
  }
  return samples;
}

try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const results = {};
  for (const viewport of viewports) {
    results[viewport.name] = await measure(viewport);
  }
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commitSha: process.env.GITHUB_SHA || null,
    ref: process.env.GITHUB_REF || null,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    browserVersion: browser.version(),
    fixture: {
      name: 'unauthenticated application shell',
      brokerAndMarketApis: 'mocked',
      userPortfolioData: 'not loaded',
      serviceWorkers: 'blocked to avoid cross-run cache contamination'
    },
    runsPerViewport,
    viewports: results
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Browser performance baseline written to ${outputPath}`);
  for (const [name, samples] of Object.entries(results)) {
    const fcp = samples.map((sample) => sample.firstContentfulPaintMs).filter(Number.isFinite);
    const auth = samples.map((sample) => sample.elapsedToAuthReadyMs);
    console.log(`${name}: median FCP ${fcp.length ? Math.round(fcp.sort((a,b)=>a-b)[Math.floor(fcp.length / 2)]) : 'n/a'}ms; median auth-shell readiness ${Math.round(auth.sort((a,b)=>a-b)[Math.floor(auth.length / 2)])}ms`);
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
