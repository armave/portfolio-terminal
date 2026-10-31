import { describe, expect, it } from 'vitest';
import { createSessionIdentityGuard } from './sessionIdentityGuard';

describe('createSessionIdentityGuard', () => {
  it('accepts work only for the currently authenticated identity', () => {
    const guard = createSessionIdentityGuard('admin:account-a');
    const request = guard.capture();

    expect(guard.isCurrent(request)).toBe(true);
    guard.setIdentity('admin:account-b');
    expect(guard.isCurrent(request)).toBe(false);
  });

  it('invalidates a request when the same user changes role', () => {
    const guard = createSessionIdentityGuard('admin:account-a');
    const request = guard.capture();

    guard.setIdentity('guest:account-a');

    expect(guard.isCurrent(request)).toBe(false);
  });

  it('does not revive requests when switching away from and back to an identity', () => {
    const guard = createSessionIdentityGuard('admin:account-a');
    const firstSession = guard.capture();

    guard.setIdentity(null);
    guard.setIdentity('admin:account-a');

    expect(guard.isCurrent(firstSession)).toBe(false);
    expect(guard.capture()).toMatchObject({ identity: 'admin:account-a', generation: 2 });
  });

  it('invalidates pending work on sign-out and returns no token without a session', () => {
    const guard = createSessionIdentityGuard('admin:account-a');
    const request = guard.capture();

    guard.setIdentity(null);

    expect(guard.capture()).toBeNull();
    expect(guard.isCurrent(request)).toBe(false);
  });

  it('does not advance the generation for repeated identity notifications', () => {
    const guard = createSessionIdentityGuard('admin:account-a');
    const request = guard.capture();

    guard.setIdentity('admin:account-a');

    expect(guard.isCurrent(request)).toBe(true);
    expect(guard.capture()).toEqual(request);
  });
});
