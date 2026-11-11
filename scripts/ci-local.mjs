import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const skipInstall = process.argv.slice(2).includes('--skip-install');

if (process.argv.slice(2).some((argument) => argument !== '--skip-install')) {
  console.error('Usage: npm run ci:local [-- --skip-install]');
  process.exit(2);
}

if (Number(process.versions.node.split('.')[0]) !== 22) {
  console.error(`CI uses Node.js 22; current runtime is ${process.versions.node}.`);
  process.exit(1);
}

if (!npmCli) {
  console.error('Run this command through npm: npm run ci:local.');
  process.exit(1);
}

if (skipInstall && !existsSync(path.join(repositoryRoot, 'node_modules'))) {
  console.error('node_modules is missing. Run npm ci, then retry the pre-push checks.');
  process.exit(1);
}

function execute(label, command, args) {
  console.log(`\n▶ ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

function npm(...args) {
  execute(`npm ${args.join(' ')}`, process.execPath, [npmCli, ...args]);
}

function node(...args) {
  execute(`node ${args.join(' ')}`, process.execPath, args);
}

const steps = [
  ...(!skipInstall ? [{ label: 'Install exact lockfile dependencies', run: () => npm('ci') }] : []),
  { label: 'TypeScript typecheck', run: () => npm('run', 'typecheck') },
  { label: 'Vitest unit and Worker suite', run: () => npm('test') },
  { label: 'Production build', run: () => npm('run', 'build') },
  { label: 'Install pinned Playwright runner', run: () => npm('run', 'setup:browser-tests') },
  { label: 'Install Chromium browser', run: () => node('node_modules/playwright/cli.js', 'install', 'chromium') },
  { label: 'Production browser smoke test', run: () => node('scripts/browser-smoke.mjs') },
  { label: 'Desktop and mobile performance baseline', run: () => node('scripts/browser-performance-baseline.mjs') },
  { label: 'Operations browser journey', run: () => node('scripts/browser-smoke-operations.mjs') },
  { label: 'Dead-code validation', run: () => npm('run', 'validate:dead-code') },
  { label: 'Full dependency audit', run: () => npm('run', 'audit:dependencies') },
  { label: 'Production dependency audit', run: () => npm('run', 'audit:production') }
];

console.log('Portfolio Terminal — local CI');
console.log(`Node.js ${process.versions.node}`);
console.log(skipInstall ? 'Reusing installed npm dependencies.' : 'Starting from a clean npm ci install.');

try {
  for (const step of steps) step.run();
  console.log('\n✓ All local CI checks passed.');
} catch (error) {
  console.error(`\n✗ Local CI stopped: ${error.message}`);
  process.exit(1);
}
