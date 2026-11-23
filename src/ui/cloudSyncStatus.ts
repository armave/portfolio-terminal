export type CloudSyncStatusOutcome = 'synced' | 'error' | 'conflict';

/**
 * Background sync work must not settle the shared indicator owned by an
 * explicit foreground operation. Failures and conflicts remain visible.
 */
export function shouldApplyCloudSyncStatusOutcome(
  outcome: CloudSyncStatusOutcome,
  activeSyncStatus: string | null | undefined,
  announceProgress: boolean
): boolean {
  if (outcome !== 'synced') return true;
  return announceProgress || activeSyncStatus !== 'syncing';
}
