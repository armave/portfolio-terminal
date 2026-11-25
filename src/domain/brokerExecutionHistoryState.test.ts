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

  it('treats a successful empty refresh as ready rather than a failed refresh', () => {
    const previous = [{ id: 'saved-buy' }];
    const refreshing = brokerExecutionHistoryReducer(
      createBrokerExecutionHistoryState(previous, [], true),
      { type: 'refresh' }
    );
    expect(brokerExecutionHistoryReducer(refreshing, { type: 'success', trades: [] })).toEqual({
      trades: [],
      status: 'ready'
    });
  });

  it('does not show a loading state when the current view must not request account history', () => {
    expect(createBrokerExecutionHistoryState([], [], false)).toEqual({
      trades: [],
      status: 'ready'
    });
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

  it('does not let an unrelated live update settle an explicit refresh', () => {
    const previous = [{ id: 'cached-sell' }];
    const refreshing = brokerExecutionHistoryReducer(
      createBrokerExecutionHistoryState(previous, [], true),
      { type: 'refresh', requestId: 'manual-17' }
    );
    const liveUpdate = [{ id: 'new-live-sell' }];
    const updated = brokerExecutionHistoryReducer(refreshing, {
      type: 'success',
      trades: liveUpdate
    });

    expect(updated).toMatchObject({
      trades: liveUpdate,
      status: 'refreshing',
      activeRequestId: 'manual-17'
    });
    expect(brokerExecutionHistoryReducer(updated, {
      type: 'failure',
      requestId: 'older-request'
    })).toBe(updated);
    expect(brokerExecutionHistoryReducer(updated, {
      type: 'success',
      requestId: 'manual-17',
      trades: liveUpdate
    })).toEqual({ trades: liveUpdate, status: 'ready' });
  });

  it('does not let a background refresh clear ownership of an explicit foreground request', () => {
    const cached = [{ id: 'cached-sell' }];
    const explicit = brokerExecutionHistoryReducer(
      createBrokerExecutionHistoryState(cached, [], true),
      { type: 'refresh', requestId: 'manual-21' }
    );
    const backgroundRefresh = brokerExecutionHistoryReducer(explicit, { type: 'refresh' });
    const backgroundUpdate = brokerExecutionHistoryReducer(backgroundRefresh, {
      type: 'success',
      trades: [{ id: 'background-sell' }]
    });

    expect(backgroundUpdate).toMatchObject({
      status: 'refreshing',
      activeRequestId: 'manual-21',
      trades: [{ id: 'background-sell' }]
    });

    const foregroundComplete = brokerExecutionHistoryReducer(backgroundUpdate, {
      type: 'success',
      requestId: 'manual-21',
      trades: [{ id: 'foreground-sell' }]
    });
    expect(foregroundComplete).toEqual({
      status: 'ready',
      trades: [{ id: 'foreground-sell' }]
    });
  });

  it('ignores a late completion from a superseded foreground refresh', () => {
    const initial = createBrokerExecutionHistoryState([{ id: 'cached-sell' }], [], true);
    const first = brokerExecutionHistoryReducer(initial, { type: 'refresh', requestId: 'manual-old' });
    const second = brokerExecutionHistoryReducer(first, { type: 'refresh', requestId: 'manual-new' });
    const late = brokerExecutionHistoryReducer(second, {
      type: 'success',
      requestId: 'manual-old',
      trades: [{ id: 'old-result' }]
    });

    expect(late).toMatchObject({
      status: 'refreshing',
      activeRequestId: 'manual-new',
      trades: [{ id: 'old-result' }]
    });
    expect(brokerExecutionHistoryReducer(late, {
      type: 'success',
      requestId: 'manual-new',
      trades: [{ id: 'new-result' }]
    })).toEqual({
      status: 'ready',
      trades: [{ id: 'new-result' }]
    });
  });

});
