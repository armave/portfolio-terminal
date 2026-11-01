type BalanceSyncStatus = 'loading' | 'ready' | 'refreshing' | 'stale' | 'error';

export interface BalanceSyncState {
  status: BalanceSyncStatus;
  hasSnapshot: boolean;
}

export type BalanceSyncAction =
  | { type: 'refresh' }
  | { type: 'success' }
  | { type: 'failure' }
  | { type: 'snapshot'; loaded: boolean; status?: 'current' | 'stale' | 'unavailable' };

/** A persisted broker snapshot is immediately usable while a fresh full read runs. */
export function createBalanceSyncState(
  hasSnapshot: boolean,
  shouldRefresh: boolean
): BalanceSyncState {
  return {
    hasSnapshot,
    status: shouldRefresh
      ? hasSnapshot ? 'refreshing' : 'loading'
      : 'ready'
  };
}

/** Refresh and failure transitions never discard a previously loaded balance snapshot. */
export function balanceSyncReducer(
  state: BalanceSyncState,
  action: BalanceSyncAction
): BalanceSyncState {
  switch (action.type) {
    case 'refresh':
      return { ...state, status: state.hasSnapshot ? 'refreshing' : 'loading' };
    case 'success':
      return { hasSnapshot: true, status: 'ready' };
    case 'failure':
      return { ...state, status: state.hasSnapshot ? 'stale' : 'error' };
    case 'snapshot': {
      if (!action.loaded) return state;
      // Older local/cloud snapshots predate the status field. A loaded snapshot
      // is still usable; missing metadata must never keep the first-load screen up.
      const withSnapshot = { ...state, hasSnapshot: true };
      return action.status === 'stale' || action.status === 'unavailable'
        ? { ...withSnapshot, status: 'stale' }
        : { ...withSnapshot, status: 'ready' };
    }
  }
}
