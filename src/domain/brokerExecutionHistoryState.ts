export type BrokerExecutionHistoryStatus = 'loading' | 'ready' | 'refreshing' | 'stale' | 'error';

export interface BrokerExecutionHistoryState<T> {
  trades: T[];
  status: BrokerExecutionHistoryStatus;
}

export type BrokerExecutionHistoryAction<T> =
  | { type: 'refresh' }
  | { type: 'success'; trades: readonly T[] }
  | { type: 'failure' };

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
    case 'refresh':
      return {
        ...state,
        status: state.trades.length > 0 ? 'refreshing' : 'loading'
      };
    case 'success':
      return {
        trades: [...action.trades],
        status: 'ready'
      };
    case 'failure':
      return {
        ...state,
        status: state.trades.length > 0 ? 'stale' : 'error'
      };
  }
}
