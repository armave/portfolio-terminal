import { describe, expect, it } from 'vitest';
import {
  createGuestDirectoryState,
  guestDirectoryReducer
} from './guestDirectoryState';

describe('guest directory request state', () => {
  it('starts loading only when the active-tranche view needs guest accounts', () => {
    expect(createGuestDirectoryState(true)).toEqual({
      users: [],
      status: 'loading',
      error: ''
    });
    expect(createGuestDirectoryState(false)).toEqual({
      users: [],
      status: 'idle',
      error: ''
    });
  });

  it('retains the last known guest list while a refresh is in progress', () => {
    const users = [{ id: 'guest-1' }, { id: 'guest-2' }];
    const state = guestDirectoryReducer(
      { users, status: 'ready', error: '' },
      { type: 'request' }
    );
    expect(state).toEqual({
      users,
      status: 'refreshing',
      error: ''
    });
  });

  it('retains known guests and marks the directory stale when refresh fails', () => {
    const users = [{ id: 'guest-1' }];
    const state = guestDirectoryReducer(
      { users, status: 'refreshing', error: '' },
      { type: 'failure', message: 'Guest refresh failed.' }
    );
    expect(state).toEqual({
      users,
      status: 'stale',
      error: 'Guest refresh failed.'
    });
  });

  it('shows a first-load error when no guest list is available', () => {
    expect(guestDirectoryReducer(
      createGuestDirectoryState(true),
      { type: 'failure', message: 'Guest request failed.' }
    )).toEqual({
      users: [],
      status: 'error',
      error: 'Guest request failed.'
    });
  });

  it('replaces a stale list only after a successful retry', () => {
    const stale = guestDirectoryReducer(
      {
        users: [{ id: 'guest-old' }],
        status: 'stale',
        error: 'Guest refresh failed.'
      },
      { type: 'request' }
    );
    expect(stale.users).toEqual([{ id: 'guest-old' }]);
    expect(stale.status).toBe('refreshing');

    expect(guestDirectoryReducer(stale, {
      type: 'success',
      users: [{ id: 'guest-new' }]
    })).toEqual({
      users: [{ id: 'guest-new' }],
      status: 'ready',
      error: ''
    });
  });
});
