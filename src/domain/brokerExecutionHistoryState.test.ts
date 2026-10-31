import { describe, expect, it } from 'vitest';
import {
  brokerExecutionHistoryReducer,
  createBrokerExecutionHistoryState
} from './brokerExecutionHistoryState';

describe('broker execution history view state', () => {
  it('restores the saved history when the in-memory snapshot is empty', () => {
    const saved = [{ id: 'saved-buy' }];
    expect(createBrokerExecutionHistoryState([], saved, true)).toEqual({
      trades: saved,
      status: 'ready'
    });
  });

  it('prefers a non-empty current snapshot over saved history', () => {
    const current = [{ id: 'current-sell' }];
    const saved = [{ id: 'saved-buy' }];
    expect(createBrokerExecutionHistoryState(current, saved, true)).toEqual({
      trades: current,
      status: 'ready'
    });
  });

  it('retains the last good executions and marks them stale after a refresh error', () => {
    const previous = [{ id: 'older-buy' }, { id: 'recent-sell' }];
    const initial = createBrokerExecutionHistoryState(previous, [], true);
    const refreshing = brokerExecutionHistoryReducer(initial, { type: 'refresh' });
    expect(refreshing).toEqual({ trades: previous, status: 'refreshing' });

    const failed = brokerExecutionHistoryReducer(refreshing, { type: 'failure' });
    expect(failed).toEqual({ trades: previous, status: 'stale' });
  });

  it('shows an error state when the first broker request fails without a saved snapshot', () => {
    const initial = createBrokerExecutionHistoryState([], [], true);
    expect(initial.status).toBe('loading');
    expect(brokerExecutionHistoryReducer(initial, { type: 'failure' })).toEqual({
      trades: [],
      status: 'error'
    });
  });

  it('replaces the stale snapshot and clears the warning after a successful retry', () => {
    const previous = [{ id: 'older-buy' }];
    const stale = brokerExecutionHistoryReducer(
      createBrokerExecutionHistoryState(previous, [], true),
      { type: 'failure' }
    );
    const fresh = [{ id: 'fresh-buy' }, { id: 'fresh-sell' }];
    expect(brokerExecutionHistoryReducer(stale, { type: 'success', trades: fresh })).toEqual({
      trades: fresh,
      status: 'ready'
    });
  });
});
