export type GuestDirectoryStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'stale' | 'error';

export interface GuestDirectoryState<T> {
  users: T[];
  status: GuestDirectoryStatus;
  error: string;
}

export type GuestDirectoryAction<T> =
  | { type: 'request' }
  | { type: 'success'; users: readonly T[] }
  | { type: 'failure'; message: string };

export function createGuestDirectoryState<T>(
  shouldLoad: boolean
): GuestDirectoryState<T> {
  return {
    users: [],
    status: shouldLoad ? 'loading' : 'idle',
    error: ''
  };
}

/** Keep known guest accounts available while a refresh is in flight or fails. */
export function guestDirectoryReducer<T>(
  state: GuestDirectoryState<T>,
  action: GuestDirectoryAction<T>
): GuestDirectoryState<T> {
  switch (action.type) {
    case 'request':
      return {
        ...state,
        status: state.users.length > 0 ? 'refreshing' : 'loading',
        error: ''
      };
    case 'success':
      return {
        users: [...action.users],
        status: 'ready',
        error: ''
      };
    case 'failure':
      return {
        ...state,
        status: state.users.length > 0 ? 'stale' : 'error',
        error: action.message
      };
  }
}
