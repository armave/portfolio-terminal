import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkLocalStorageAvailability,
  getBrowserLabel,
  getApplicationApiLabel,
  getCloudRequestLabel,
  getDeviceHealth,
  getDeviceTypeLabel,
  getOperatingSystemLabel,
  getPortfolioSyncLabel,
  hasCompleteAppShellPrecache
} from './DeviceCheckSummary';

describe('Device Check summary diagnostics', () => {
  it.each([
    ['Mozilla/5.0 Chrome/126.0 Safari/537.36', 'Chrome'],
    ['Mozilla/5.0 Edg/126.0 Chrome/126.0 Safari/537.36', 'Microsoft Edge'],
    ['Mozilla/5.0 Firefox/126.0', 'Firefox'],
    ['Mozilla/5.0 Version/17.0 Safari/605.1', 'Safari'],
    ['unknown browser agent', 'Unknown browser']
  ])('identifies browser for %s', (userAgent, expected) => {
    expect(getBrowserLabel(userAgent)).toBe(expected);
  });

  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0, 'Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'MacIntel', 0, 'macOS'],
    ['Mozilla/5.0 (Linux; Android 14)', 'Linux armv8l', 0, 'Android'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 0, 'iOS / iPadOS'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5, 'iOS / iPadOS']
  ])('identifies operating system for %s', (ua, platform, touches, expected) => {
    expect(getOperatingSystemLabel(ua, platform, touches)).toBe(expected);
  });

  it('classifies common mobile and tablet user agents', () => {
    expect(getDeviceTypeLabel('Mozilla/5.0 (Linux; Android 14; Pixel) Mobile')).toBe('Mobile');
    expect(getDeviceTypeLabel('Mozilla/5.0 (Linux; Android 14; Pixel Tablet)')).toBe('Tablet');
    expect(getDeviceTypeLabel('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('Tablet');
    expect(getDeviceTypeLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Desktop');
  });

  it('checks local storage without leaving the temporary test value behind', () => {
    const data = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => data.set(key, value),
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => { data.delete(key); }
    };
    expect(checkLocalStorageAvailability(storage)).toBe(true);
    expect(data.size).toBe(0);
  });

  it('reports unavailable storage when writes throw', () => {
    const storage = {
      setItem: () => { throw new Error('Storage blocked'); },
      getItem: () => null,
      removeItem: () => undefined
    };
    expect(checkLocalStorageAvailability(storage)).toBe(false);
  });

  it('separates application API reachability from cloud portfolio synchronization', () => {
    expect(getApplicationApiLabel('reachable')).toBe('Reachable');
    expect(getApplicationApiLabel('unavailable')).toBe('Unavailable');
    expect(getCloudRequestLabel({ status: 'synced', text: 'READY' })).toBe('Last request confirmed');
    expect(getCloudRequestLabel({ status: 'syncing', text: 'CONNECTING' })).toBe('Request in progress');
    expect(getCloudRequestLabel({ status: 'error', text: 'UNAVAILABLE' })).toBe('Last request failed');
    expect(getCloudRequestLabel({ status: 'idle', text: '' })).toBe('Not checked');
    expect(getPortfolioSyncLabel({ status: 'synced', text: 'Synced' })).toBe('Synced');
    expect(getPortfolioSyncLabel({ status: 'syncing', text: 'Syncing' })).toBe('Syncing');
    expect(getPortfolioSyncLabel({ status: 'conflict', text: 'Conflict' })).toBe('Conflict');
    expect(getPortfolioSyncLabel({ status: 'error', text: 'Sync failed' })).toBe('Failed');
    expect(getPortfolioSyncLabel({ status: 'synced', text: 'Assigned data refreshed' })).toBe('Synced');
  });

  it('recognizes a complete app-scoped document, script and stylesheet precache', () => {
    const scope = 'https://example.test/portfolio-terminal/';
    const completeCache = {
      name: 'workbox-precache-v2',
      urls: [
        'https://example.test/portfolio-terminal/index.html',
        'https://example.test/portfolio-terminal/assets/index-abc123.js',
        'https://example.test/portfolio-terminal/assets/index-abc123.css'
      ]
    };

    expect(hasCompleteAppShellPrecache([completeCache], scope)).toBe(true);
    expect(hasCompleteAppShellPrecache([{
      name: 'workbox-precache-v2',
      urls: [
        'https://example.test/another-app/index.html',
        'https://example.test/another-app/assets/index-abc123.js',
        'https://example.test/another-app/assets/index-abc123.css'
      ]
    }], scope)).toBe(false);
    expect(hasCompleteAppShellPrecache([{
      ...completeCache,
      urls: completeCache.urls.slice(0, 2)
    }], scope)).toBe(false);
    expect(hasCompleteAppShellPrecache([
      { name: 'workbox-precache-v2-document', urls: [completeCache.urls[0]] },
      { name: 'workbox-precache-v2-assets', urls: completeCache.urls.slice(1) }
    ], scope)).toBe(false);
  });

  it('shows checking while device diagnostics have not loaded', () => {
    expect(getDeviceHealth(null, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('checking');
  });

  it('summarizes API, cloud request and portfolio sync states independently', () => {
    const readyDevice = {
      online: true, localStorageAvailable: true, secureContext: true, applicationApiStatus: 'reachable' as const
    };
    const offlineDevice = { ...readyDevice, online: false };
    const unavailableApiDevice = { ...readyDevice, applicationApiStatus: 'unavailable' as const };

    expect(getDeviceHealth(readyDevice, { status: 'synced', text: 'READY' }, { status: 'synced', text: 'Synced' })).toBe('ready');
    expect(getDeviceHealth(offlineDevice, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('offline');
    expect(getDeviceHealth({ ...readyDevice, localStorageAvailable: false }, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('attention');
    expect(getDeviceHealth({ ...readyDevice, secureContext: false }, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('attention');
    expect(getDeviceHealth(unavailableApiDevice, { status: 'idle', text: '' }, { status: 'idle', text: '' })).toBe('attention');
    expect(getDeviceHealth(readyDevice, { status: 'synced', text: 'READY' }, { status: 'conflict', text: 'Conflict' })).toBe('attention');
    expect(getDeviceHealth(readyDevice, { status: 'synced', text: 'READY' }, { status: 'error', text: 'Sync failed' })).toBe('attention');
    expect(getDeviceHealth(readyDevice, { status: 'error', text: 'UNAVAILABLE' }, { status: 'idle', text: '' })).toBe('attention');
  });


});


describe('Device Check progressive disclosure', () => {
  it('keeps technical device diagnostics collapsed behind the health summary', () => {
    const source = readFileSync(new URL('./DeviceCheckSummary.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<details class="settings-device-details">');
    expect(source).toContain("label('Technical details')");
    expect(source).toContain("['Application API', getApplicationApiLabel(diagnostics.applicationApiStatus)]");
    expect(source).toContain("['Cloud request', getCloudRequestLabel(cloudStatus)]");
    expect(source).toContain("['Cloud portfolio', getPortfolioSyncLabel(cloudSyncStatus)]");
    expect(source).toContain("['App shell cache', appShellCacheLabel(diagnostics.appShellCache)]");
    expect(source).toContain("label('Cloud synchronization diagnostics')");
    expect(source).toContain('cloudSyncDiagnostics.slice(0, 3)');
    expect(source).toContain('subscribeCloudSyncDiagnostics(setCloudSyncDiagnostics)');
  });
});
