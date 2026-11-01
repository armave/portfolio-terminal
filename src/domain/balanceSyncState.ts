type BalanceSyncStatus = 'loading' | 'ready' | 'refreshing' | 'stale' | 'error';

export interface BalanceSyncState {
  status: BalanceSyncStatus;
  hasSnapshot: boolean;
}

export type BalanceSyncAction =
  | { type: 'refresh' }
  | { type: 'success' }
  | { type: 'failure' };

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
  }
}
