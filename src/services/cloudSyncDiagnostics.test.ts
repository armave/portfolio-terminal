import { describe, expect, it } from 'vitest';
import { createCloudSyncDiagnosticsStore } from './cloudSyncDiagnostics';

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

describe('cloud sync diagnostics', () => {
  it('retains only allowlisted metadata in the current tab session', () => {
    const storage = createStorage();
    const store = createCloudSyncDiagnosticsStore(() => storage);
    const saved = store.record({
      timestamp: 1_800_000_000_000,
      operation: 'push',
      outcome: 'conflict',
      reason: 'revision-conflict',
      httpStatus: 409,
      expectedRevision: 12,
      observedRevision: 13
    });

    expect(saved).toEqual({
      timestamp: 1_800_000_000_000,
      operation: 'push',
      outcome: 'conflict',
      reason: 'revision-conflict',
      httpStatus: 409,
      expectedRevision: 12,
      observedRevision: 13
    });
    const persisted = [...storage.values.values()].join('');
    expect(persisted).not.toContain('secret');
    expect(persisted).not.toContain('portfolio');
    expect(persisted).not.toContain('encryptedPayload');
    expect(store.getSnapshot()).toEqual([saved]);
  });

  it('restores valid diagnostics after a page refresh and ignores unknown fields', () => {
    const storage = createStorage();
    const first = createCloudSyncDiagnosticsStore(() => storage);
    first.record({
      timestamp: 1_800_000_000_001,
      operation: 'pull',
      outcome: 'error',
      reason: 'http-unauthorized',
      httpStatus: 401
    });
    const second = createCloudSyncDiagnosticsStore(() => storage);
    expect(second.getSnapshot()).toEqual([{
      timestamp: 1_800_000_000_001,
      operation: 'pull',
      outcome: 'error',
      reason: 'http-unauthorized',
      httpStatus: 401
    }]);
  });

  it('publishes new entries and caps retained history at eight entries', () => {
    const storage = createStorage();
    const store = createCloudSyncDiagnosticsStore(() => storage);
    const snapshots: number[] = [];
    store.subscribe((entries) => snapshots.push(entries.length));
    for (let index = 0; index < 10; index += 1) {
      store.record({
        timestamp: 1_800_000_000_000 + index,
        operation: 'pull',
        outcome: 'success',
        reason: 'confirmed'
      });
    }

    expect(store.getSnapshot()).toHaveLength(8);
    expect(store.getSnapshot()[0].timestamp).toBe(1_800_000_000_009);
    expect(snapshots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
  });

  it('rejects unsupported diagnostic fields and clears only its own metadata', () => {
    const storage = createStorage();
    const store = createCloudSyncDiagnosticsStore(() => storage);
    storage.setItem('unrelated', 'keep');
    expect(() => store.record({
      operation: 'push',
      outcome: 'error',
      reason: 'arbitrary-user-message' as never
    })).toThrow('Invalid cloud synchronization diagnostic.');

    store.record({ operation: 'push', outcome: 'success', reason: 'confirmed' });
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(storage.getItem('portfolio_cloud_sync_diagnostics_v1')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  it('fails closed on malformed persisted rows', () => {
    const storage = createStorage();
    storage.setItem('portfolio_cloud_sync_diagnostics_v1', JSON.stringify([
      { timestamp: 1, operation: 'push', outcome: 'error', reason: 'unknown', httpStatus: 999 },
      { timestamp: 'yesterday', operation: 'push', outcome: 'error', reason: 'unknown' },
      { timestamp: 3, operation: 'delete', outcome: 'error', reason: 'unknown' }
    ]));
    const store = createCloudSyncDiagnosticsStore(() => storage);
    expect(store.getSnapshot()).toEqual([{
      timestamp: 1,
      operation: 'push',
      outcome: 'error',
      reason: 'unknown'
    }]);
  });
});
