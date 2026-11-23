import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldApplyCloudSyncStatusOutcome } from './cloudSyncStatus';

describe('cloud sync status ownership', () => {
  it('does not let a quiet checkpoint clear an active foreground sync', () => {
    expect(shouldApplyCloudSyncStatusOutcome('synced', 'syncing', false)).toBe(false);
  });

  it('allows a quiet checkpoint to publish success when no foreground sync is active', () => {
    expect(shouldApplyCloudSyncStatusOutcome('synced', 'idle', false)).toBe(true);
    expect(shouldApplyCloudSyncStatusOutcome('synced', 'error', false)).toBe(true);
  });

  it('allows the foreground operation to publish its own successful completion', () => {
    expect(shouldApplyCloudSyncStatusOutcome('synced', 'syncing', true)).toBe(true);
  });

  it('always surfaces failures and revision conflicts during foreground work', () => {
    expect(shouldApplyCloudSyncStatusOutcome('error', 'syncing', false)).toBe(true);
    expect(shouldApplyCloudSyncStatusOutcome('conflict', 'syncing', false)).toBe(true);
  });

  it('wires the ownership guard into the application status callback', () => {
    const source = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8');
    const start = source.indexOf('onStatusChange: (status) => {');
    const end = source.indexOf('\n    }\n    });', start);
    const callback = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(callback).toContain('shouldApplyCloudSyncStatusOutcome(');
    expect(callback).toContain('getCloudSyncStatus().status');
    expect(callback).toContain('pullOptions.announceProgress === true');
  });
});
