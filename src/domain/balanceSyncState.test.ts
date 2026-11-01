import { describe, expect, it } from 'vitest';
import { balanceSyncReducer, createBalanceSyncState } from './balanceSyncState';

describe('cache-first Balance synchronization state', () => {
  it('renders a cached broker snapshot while the full refresh runs', () => {
    const initial = createBalanceSyncState(true, true);
    expect(initial).toEqual({ hasSnapshot: true, status: 'refreshing' });
    expect(balanceSyncReducer(initial, { type: 'refresh' })).toEqual(initial);
  });

  it('waits for the first full snapshot only when no cached snapshot exists', () => {
    expect(createBalanceSyncState(false, true)).toEqual({
      hasSnapshot: false,
      status: 'loading'
    });
  });

  it('keeps the last good snapshot visible when a full refresh fails', () => {
    const initial = createBalanceSyncState(true, true);
    expect(balanceSyncReducer(initial, { type: 'failure' })).toEqual({
      hasSnapshot: true,
      status: 'stale'
    });
  });

  it('marks a successful full snapshot ready, including an empty account', () => {
    expect(balanceSyncReducer(
      createBalanceSyncState(false, true),
      { type: 'success' }
    )).toEqual({ hasSnapshot: true, status: 'ready' });
  });

  it('accepts a legacy cached snapshot with no status metadata', () => {
    expect(balanceSyncReducer(
      createBalanceSyncState(false, true),
      { type: 'snapshot', loaded: true }
    )).toEqual({ hasSnapshot: true, status: 'ready' });
  });

  it('shows a cached snapshot as stale instead of blocking when its saved status is stale', () => {
    expect(balanceSyncReducer(
      createBalanceSyncState(false, true),
      { type: 'snapshot', loaded: true, status: 'stale' }
    )).toEqual({ hasSnapshot: true, status: 'stale' });
  });

  it('does not mark an incomplete account payload as a usable snapshot', () => {
    const initial = createBalanceSyncState(false, true);
    expect(balanceSyncReducer(
      initial,
      { type: 'snapshot', loaded: false }
    )).toEqual(initial);
  });

  it('starts a new full refresh without clearing cached data', () => {
    const stale = balanceSyncReducer(
      createBalanceSyncState(true, true),
      { type: 'failure' }
    );
    expect(balanceSyncReducer(stale, { type: 'refresh' })).toEqual({
      hasSnapshot: true,
      status: 'refreshing'
    });
  });
});
