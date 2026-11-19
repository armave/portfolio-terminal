import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PWA update registration policy', () => {
  it('stages detected updates without forcing service-worker activation or a page reload', () => {
    const entry = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const handler = entry.match(/onNeedRefresh: \(\) => \{([\s\S]*?)\n  \},\n  onRegisteredSW:/)?.[1];
    const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');

    expect(handler).toBeDefined();
    expect(handler).toContain('pwaUpdateRuntime.markUpdateAvailable()');
    expect(handler).not.toMatch(/updateServiceWorker|skipWaiting|location\.reload/);
    expect(viteConfig).toMatch(/registerType:\s*'prompt'/);
  });
});
