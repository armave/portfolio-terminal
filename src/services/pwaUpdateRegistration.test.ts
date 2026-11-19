import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PWA update registration policy', () => {
  it('stages detected updates and only considers activation after a browser refresh', () => {
    const entry = readFileSync(new URL('../main.ts', import.meta.url), 'utf8');
    const handler = entry.match(/onNeedRefresh: \(\) => \{([\s\S]*?)\n  \},\n  onNeedReload:/)?.[1];
    const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8');
    const serviceWorker = readFileSync(new URL('../sw.ts', import.meta.url), 'utf8');

    expect(handler).toBeDefined();
    expect(handler).toContain('pwaUpdateRuntime.markUpdateAvailable()');
    expect(handler).not.toMatch(/updateServiceWorker|skipWaiting|location\.reload/);
    expect(entry).toContain('isPageRefreshNavigation(pageNavigation?.type)');
    expect(entry).toContain('startupOverlayDismissed');
    expect(entry).toContain('initialWorkspaceSyncSettled');
    expect(entry).toContain("'app:initial-workspace-sync-settled'");
    expect(entry).toContain('isOnlyOpenAppClient(waitingWorker)');
    expect(entry).toContain('onNeedReload:');
    expect(viteConfig).toMatch(/registerType:\s*'prompt'/);
    expect(viteConfig).toMatch(/strategies:\s*'injectManifest'/);
    expect(viteConfig).toContain("filename: 'sw.ts'");
    expect(serviceWorker).toContain("message?.type === 'SKIP_WAITING'");
    expect(serviceWorker).toContain('self.clients.matchAll');
    expect(serviceWorker).toContain('includeUncontrolled: true');
    expect(serviceWorker).toContain('self.clients.claim()');
  });
});
