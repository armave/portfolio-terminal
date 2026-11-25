type BrokerExecutionHistoryStatus = 'loading' | 'ready' | 'refreshing' | 'stale' | 'error';

export interface BrokerExecutionHistoryState<T> {
  trades: T[];
  status: BrokerExecutionHistoryStatus;
  /** Only the owning request may settle an explicit foreground refresh. */
  activeRequestId?: string;
}

export type BrokerExecutionHistoryAction<T> =
  | { type: 'refresh'; requestId?: string }
  | { type: 'success'; trades: readonly T[]; requestId?: string }
  | { type: 'failure'; requestId?: string };

/**
 * Prefer the current in-memory snapshot, then the separately persisted history.
 * A non-empty snapshot remains available while a refresh is in flight or fails.
 */
export function createBrokerExecutionHistoryState<T>(
  currentTrades: readonly T[] | null | undefined,
  savedTrades: readonly T[] | null | undefined,
  shouldFetch: boolean
): BrokerExecutionHistoryState<T> {
  const current = Array.isArray(currentTrades) ? currentTrades : [];
  const saved = Array.isArray(savedTrades) ? savedTrades : [];
  const trades = [...(current.length > 0 ? current : saved)];
  return {
    trades,
    status: shouldFetch && trades.length === 0 ? 'loading' : 'ready'
  };
}

/** Keep the last good broker snapshot visible if the next refresh fails. */
export function brokerExecutionHistoryReducer<T>(
  state: BrokerExecutionHistoryState<T>,
  action: BrokerExecutionHistoryAction<T>
): BrokerExecutionHistoryState<T> {
  switch (action.type) {
    case 'refresh': {
      const next: BrokerExecutionHistoryState<T> = {
        ...state,
        status: state.trades.length > 0 ? 'refreshing' : 'loading'
      };
      if (action.requestId) next.activeRequestId = action.requestId;
      // A background refresh without an owner must not clear a foreground
      // request's identity; only that request may settle its loader.
      else if (!state.activeRequestId) delete next.activeRequestId;
      return next;
    }
    case 'success':
      // Live-stream and background broker updates may improve the visible
      // snapshot, but cannot finish a different user-requested refresh.
      if (state.activeRequestId && action.requestId !== state.activeRequestId) {
        return { ...state, trades: [...action.trades] };
      }
      return {
        trades: [...action.trades],
        status: 'ready'
      };
    case 'failure':
      if (state.activeRequestId && action.requestId !== state.activeRequestId) return state;
      return {
        trades: state.trades,
        status: state.trades.length > 0 ? 'stale' : 'error'
      };
  }
}
