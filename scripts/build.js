import { readdir, readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { build } from 'vite';
import { assertEntryBundleBudget, ENTRY_BUNDLE_BUDGET } from './bundleBudget.js';

try {
  await build();

  // Verify the PWA plugin injects service-worker registration without an app-side
  // virtual module import. This protects production registration from regressions.
  const [builtHtml, registrationScript] = await Promise.all([
    readFile(path.resolve('dist/index.html'), 'utf8'),
    readFile(path.resolve('dist/registerSW.js'), 'utf8')
  ]);
  if (!builtHtml.includes('registerSW.js') || registrationScript.length === 0) {
    throw new Error('Expected a non-empty PWA registerSW.js script referenced by dist/index.html.');
  }
  console.log('[PWA] Service-worker registration script was injected into production HTML.');

  const assetsDirectory = path.resolve('dist/assets');
  const assets = await readdir(assetsDirectory);
  const entryAssets = assets.filter((name) => /^index-[\w-]+\.js$/.test(name));
  if (entryAssets.length !== 1) {
    throw new Error(`Expected exactly one application entry chunk, found ${entryAssets.length}.`);
  }

  const entryName = entryAssets[0];
  const entryPath = path.join(assetsDirectory, entryName);
  const [entryStats, entryContents] = await Promise.all([stat(entryPath), readFile(entryPath)]);
  const gzipBytes = gzipSync(entryContents).byteLength;
  assertEntryBundleBudget({
    assetName: entryName,
    bytes: entryStats.size,
    gzipBytes
  });

  console.log(
    `[bundle budget] ${entryName}: ${entryStats.size.toLocaleString()} / ${ENTRY_BUNDLE_BUDGET.maxBytes.toLocaleString()} bytes; ${gzipBytes.toLocaleString()} / ${ENTRY_BUNDLE_BUDGET.maxGzipBytes.toLocaleString()} gzip bytes.`
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
