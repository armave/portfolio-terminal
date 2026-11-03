import { describe, expect, it } from 'vitest';
import { resolveCloudSyncTone } from './CloudSyncIndicator';

const status = (value: string, text = '') => ({ status: value, text });

describe('resolveCloudSyncTone', () => {
  it('prioritizes sync failures over successful KV connectivity', () => {
    expect(resolveCloudSyncTone(status('synced', 'UPDATED'), status('error', 'Sync failed'))).toBe('error');
    expect(resolveCloudSyncTone(status('error', 'FAIL'), status('synced', 'Synced'))).toBe('error');
  });

  it('marks active writes as pending', () => {
    expect(resolveCloudSyncTone(status('syncing', 'WRITING...'), status('idle'))).toBe('pending');
  });

  it('marks completed cloud and sync states as successful', () => {
    expect(resolveCloudSyncTone(status('synced', 'UPDATED'), status('synced', 'Synced: 12:30'))).toBe('success');
  });

  it('warns when setup requires a gateway secret', () => {
    expect(resolveCloudSyncTone(status('idle', 'ADD SECRET'), status('idle'))).toBe('warning');
  });

  it('keeps ordinary offline state neutral rather than presenting it as a failure', () => {
    expect(resolveCloudSyncTone(status('idle', 'OFFLINE'), status('idle'))).toBe('neutral');
  });
});
