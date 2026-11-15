import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const host = '127.0.0.1';
const basePath = '/portfolio-terminal/';
const timeoutMs = 30_000;
const scanFailure = /Failed to run dependency scan|virtual:pwa-register[^\n]*(?:could not be resolved|Are they installed\?)/i;

async function reservePort() {
  const socket = createNetServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, host, resolve);
  });
  const address = socket.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not determine an available Vite port.');
  }
  const { port } = address;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await reservePort();
const origin = `http://${host}:${port}`;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', host, '--port', String(port), '--strictPort', '--clearScreen', 'false'],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: 'true' }, windowsHide: true }
);

let output = '';
let exited = false;
server.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
server.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
server.once('exit', () => { exited = true; });

function assertNoDependencyScanFailure() {
  if (scanFailure.test(output)) {
    throw new Error('Vite reported a dependency-scan failure:\n' + output);
  }
}

async function waitForApp() {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (exited) throw new Error('Vite exited before serving the app:\n' + output);
    assertNoDependencyScanFailure();
    try {
      const response = await fetch(new URL(basePath, origin), { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return await response.text();
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(200);
  }
  throw new Error(`Vite did not serve the app within ${timeoutMs} ms: ${lastError?.message || 'unknown error'}\n${output}`);
}

try {
  const html = await waitForApp();
  const entryScript = html.match(/<script[^>]+src=["']([^"']*\/src\/main\.ts)["']/i);
  if (!entryScript) {
    throw new Error('Vite served index.html without the src/main.ts entry script.');
  }

  const entryUrl = new URL(entryScript[1], origin);
  const entryResponse = await fetch(entryUrl, { signal: AbortSignal.timeout(5_000) });
  if (!entryResponse.ok) {
    throw new Error(`Vite returned HTTP ${entryResponse.status} for ${entryUrl.pathname}.`);
  }

  const transformedEntry = await entryResponse.text();
  if (!transformedEntry.includes('registerSW') || /from\s+['"]virtual:pwa-register['"]/.test(transformedEntry)) {
    throw new Error('The PWA registration import was not resolved by vite-plugin-pwa in the served development entry.');
  }

  await delay(500);
  assertNoDependencyScanFailure();
  console.log(`[dev server smoke] Vite served ${basePath} and transformed src/main.ts without dependency-scan errors.`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (!exited) {
    server.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => server.once('exit', resolve)),
      delay(3_000)
    ]);
  }
}
