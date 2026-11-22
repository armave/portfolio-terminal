import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatExactSyncTimestamp,
  formatRelativeSyncTime,
  resolveCloudSyncDisplayTone,
  resolveCloudSyncLabel,
  resolveCloudSyncTone,
  CLOUD_SYNC_PENDING_VISIBILITY_DELAY_MS,
  CLOUD_SYNC_PENDING_MIN_VISIBLE_MS
} from './CloudSyncIndicator';

const status = (value: string, text = '') => ({ status: value, text });

describe('resolveCloudSyncTone', () => {
  it('prioritizes sync failures over successful KV connectivity', () => {
    expect(resolveCloudSyncTone(status('synced', 'UPDATED'), status('error', 'Sync failed'))).toBe('error');
    expect(resolveCloudSyncTone(status('error', 'FAIL'), status('synced', 'Synced'))).toBe('error');
  });

  it('surfaces revision conflicts separately from ordinary failures and success', () => {
    expect(resolveCloudSyncTone(status('synced', 'UPDATED'), status('conflict', 'Recovery required'))).toBe('conflict');
    expect(resolveCloudSyncLabel(status('conflict'), 'conflict', 'en')).toBe('Conflict');
    expect(resolveCloudSyncLabel(status('conflict'), 'conflict', 'ru')).toBe('Конфликт');
  });

  it('marks active writes as pending', () => {
    expect(resolveCloudSyncTone(status('syncing', 'WRITING...'), status('idle'))).toBe('pending');
    expect(resolveCloudSyncTone(status('pending'), status('idle'))).toBe('pending');
  });

  it('marks completed cloud and sync states as successful', () => {
    expect(resolveCloudSyncTone(status('synced', 'UPDATED'), status('synced', 'Synced'))).toBe('success');
  });

  it('warns when setup requires a gateway secret', () => {
    expect(resolveCloudSyncTone(status('idle', 'ADD SECRET'), status('idle'))).toBe('warning');
  });

  it('keeps ordinary offline state neutral rather than presenting it as a failure', () => {
    expect(resolveCloudSyncTone(status('offline', 'OFFLINE'), status('idle'))).toBe('neutral');
  });
});

describe('resolveCloudSyncLabel', () => {
  it('uses short state labels rather than the old verbose KV text', () => {
    expect(resolveCloudSyncLabel(status('synced'), 'success', 'en')).toBe('Saved');
    expect(resolveCloudSyncLabel(status('syncing'), 'pending', 'en')).toBe('Syncing…');
    expect(resolveCloudSyncLabel(status('pending'), 'pending', 'en')).toBe('Pending');
    expect(resolveCloudSyncLabel(status('error'), 'error', 'en')).toBe('Failed');
    expect(resolveCloudSyncLabel(status('offline'), 'neutral', 'en')).toBe('Offline');
    expect(resolveCloudSyncLabel(status('online'), 'neutral', 'en')).toBe('Connected');
  });
});

describe('formatRelativeSyncTime', () => {
  const now = Date.UTC(2026, 10, 8, 20, 0, 0);

  it('uses compact relative time across seconds, minutes, hours and days', () => {
    expect(formatRelativeSyncTime(now - 25_000, now, 'en')).toBe('Just now');
    expect(formatRelativeSyncTime(now - 2 * 60_000, now, 'en')).toBe('2m ago');
    expect(formatRelativeSyncTime(now - 3 * 60 * 60_000, now, 'en')).toBe('3h ago');
    expect(formatRelativeSyncTime(now - 2 * 24 * 60 * 60_000, now, 'en')).toBe('2d ago');
  });

  it('handles future, missing and invalid timestamps safely', () => {
    expect(formatRelativeSyncTime(now + 60_000, now, 'en')).toBe('Just now');
    expect(formatRelativeSyncTime(null, now, 'en')).toBe('');
    expect(formatRelativeSyncTime(Number.NaN, now, 'en')).toBe('');
  });

  it('localizes the compact relative time', () => {
    expect(formatRelativeSyncTime(now - 2 * 60_000, now, 'ru')).toBe('2 мин. назад');
    expect(formatRelativeSyncTime(now - 3 * 60 * 60_000, now, 'ru')).toBe('3 ч назад');
  });
});

describe('formatExactSyncTimestamp', () => {
  it('provides an exact localized date and time for the tooltip', () => {
    const timestamp = Date.UTC(2026, 10, 8, 19, 55, 34);
    expect(formatExactSyncTimestamp(timestamp, 'en')).toContain('Nov 8, 2026');
    expect(formatExactSyncTimestamp(null, 'en')).toBe('');
  });
});


describe('resolveCloudSyncDisplayTone', () => {
  it('suppresses short pending writes until the visibility delay elapses', () => {
    expect(CLOUD_SYNC_PENDING_VISIBILITY_DELAY_MS).toBe(700);
    expect(CLOUD_SYNC_PENDING_MIN_VISIBLE_MS).toBe(650);
    expect(resolveCloudSyncDisplayTone('pending', false)).toBe('neutral');
    expect(resolveCloudSyncDisplayTone('pending', true)).toBe('pending');
  });

  it('holds a visible pending pulse briefly after a successful operation completes', () => {
    expect(resolveCloudSyncDisplayTone('success', false)).toBe('success');
    expect(resolveCloudSyncDisplayTone('success', true)).toBe('pending');
  });

  it('does not delay warning, error, or conflict states', () => {
    expect(resolveCloudSyncDisplayTone('warning', true)).toBe('warning');
    expect(resolveCloudSyncDisplayTone('error', true)).toBe('error');
    expect(resolveCloudSyncDisplayTone('conflict', true)).toBe('conflict');
  });
});


describe('cloud sync progress presentation', () => {
  it('keeps scheduled guest snapshot polling out of the global cloud-write progress state', () => {
    const source = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8').replace(/\\r\\n/g, '\\n');
    const start = source.indexOf('async function refreshGuestPortfolioSnapshot');
    const end = source.indexOf('async function pullGuestPortfolioSnapshot', start);
    const guestRefresh = source.slice(start, end);

    expect(guestRefresh).not.toContain("setCloudStatus('syncing'");
    expect(guestRefresh).not.toContain("setCloudSyncStatus({ text: 'Assigned data refresh in progress'");
    expect(guestRefresh).toContain("getCloudSyncStatus().status !== 'syncing'");
    expect(guestRefresh).toContain("setCloudStatus('online', 'CONNECTED')");
  });

  it('keeps scheduled checkpoints quiet while explicit sync operations announce progress', () => {
    const source = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(source).toContain('async function pushStateToCloud(forceImmediate = false, announceProgress = false)');
    expect(source).toContain("syncState: () => currentAccountRole === 'admin' ? pushStateToCloud(true, false) : undefined");
    expect(source).toContain('if (pullOptions.announceProgress !== true) return;');
    expect(source).toContain('return pushStateToCloud(true, true);');
  });
});
