import { spawnSync } from 'node:child_process';
import { mkdir, readFile, lstat, realpath, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLAYWRIGHT_VERSION = '1.56.1';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installRoot = path.join(repositoryRoot, 'node_modules', '.cache', 'portfolio-terminal-playwright');
const installedPackage = path.join(installRoot, 'node_modules', 'playwright');
const linkedPackage = path.join(repositoryRoot, 'node_modules', 'playwright');
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error('Run this setup through npm: npm run setup:browser-tests.');
}

await mkdir(installRoot, { recursive: true });

async function readInstalledVersion(packagePath) {
  try {
    const packageJson = JSON.parse(await readFile(path.join(packagePath, 'package.json'), 'utf8'));
    return packageJson.version;
  } catch {
    return null;
  }
}

if (await readInstalledVersion(installedPackage) !== PLAYWRIGHT_VERSION) {
  console.log(`Installing isolated Playwright ${PLAYWRIGHT_VERSION}...`);
  const result = spawnSync(
    process.execPath,
    [
      npmCli,
      'install',
      '--prefix',
      installRoot,
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      `playwright@${PLAYWRIGHT_VERSION}`
    ],
    { cwd: repositoryRoot, stdio: 'inherit', windowsHide: true }
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Playwright installation failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

const expectedTarget = await realpath(installedPackage);
let shouldLink = true;

try {
  const currentStat = await lstat(linkedPackage);
  if (currentStat.isSymbolicLink()) {
    shouldLink = (await realpath(linkedPackage)) !== expectedTarget;
  } else {
    const currentVersion = await readInstalledVersion(linkedPackage);
    if (currentVersion === PLAYWRIGHT_VERSION) shouldLink = false;
    else {
      await rm(linkedPackage, { recursive: true, force: true });
    }
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

if (shouldLink) {
  await symlink(expectedTarget, linkedPackage, process.platform === 'win32' ? 'junction' : 'dir');
}

console.log(`Playwright ${PLAYWRIGHT_VERSION} is ready for the browser smoke tests.`);
