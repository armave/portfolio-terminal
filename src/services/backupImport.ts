/**
 * Replace the active portfolio snapshot only when the replacement can be
 * persisted. If persistence fails or throws, restore the previous snapshot
 * before propagating the failure to the caller.
 */
export function commitPortfolioBackupImport<TState>(
  importedState: TState,
  previousState: TState,
  replaceState: (state: TState) => void,
  persistState: () => boolean
): void {
  replaceState(importedState);
  try {
    if (!persistState()) {
      throw new Error('Could not persist the imported backup to browser storage.');
    }
  } catch (error) {
    replaceState(previousState);
    throw error;
  }
}

export interface PendingBackupCloudSyncOperations<TState> {
  /** Refresh the cloud revision before attempting the conditional replacement. */
  refreshCloudRevision: () => Promise<unknown>;
  isCurrentSession: () => boolean;
  restoreLocalSnapshot: (snapshot: TState) => boolean;
  persistLocalSnapshot: () => boolean;
  pushCloudSnapshot: () => Promise<boolean>;
  clearPendingMarker: () => void;
}

/**
 * Retry a previously imported backup after first refreshing the server revision.
 * The imported snapshot is restored after the pull, so older cloud fields never
 * become the new local source of truth. A failed push leaves the pending marker.
 */
export async function retryPendingBackupCloudSync<TState>(
  importedSnapshot: TState,
  operations: PendingBackupCloudSyncOperations<TState>
): Promise<boolean> {
  try {
    await operations.refreshCloudRevision();
    if (!operations.isCurrentSession()) return false;
    if (!operations.restoreLocalSnapshot(importedSnapshot)) return false;
    if (!operations.persistLocalSnapshot()) return false;
    const pushed = await operations.pushCloudSnapshot();
    if (!operations.isCurrentSession() || !pushed) return false;
    operations.clearPendingMarker();
    return true;
  } catch {
    return false;
  }
}
