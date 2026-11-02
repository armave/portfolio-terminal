import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isCurrentGuestPortfolioSession, type GuestPortfolioSessionIdentity } from './guestPortfolioSession';

function readAppSource(): string {
  return readFileSync(new URL('../../app.ts', import.meta.url), 'utf8');
}

const session = (overrides: Partial<GuestPortfolioSessionIdentity> = {}): GuestPortfolioSessionIdentity => ({
  role: 'guest',
  accountId: 'guest-a',
  secret: 'session-token-a',
  generation: 1,
  ...overrides
});

describe('isCurrentGuestPortfolioSession', () => {
  it('checks the captured account session before importing a guest snapshot', () => {
    const source = readAppSource();
    expect(source).toContain('const requestedIdentity = currentAccountSessionGuard.capture()');
    expect(source).toContain('const currentIdentity = currentAccountSessionGuard.capture()');
    expect(source).toContain('if (!isCurrentGuestPortfolioSession(requestedSession, currentSession)) return');
    expect(source).toContain('const guestId = requestedSession.accountId');
  });

  it('accepts a snapshot response for the same active guest and credential', () => {
    expect(isCurrentGuestPortfolioSession(session(), session())).toBe(true);
  });

  it('rejects an earlier login generation when the same guest returns with the same credential', () => {
    expect(isCurrentGuestPortfolioSession(session(), session({ generation: 3 }))).toBe(false);
  });

  it('rejects a response after switching to a different guest account', () => {
    expect(isCurrentGuestPortfolioSession(session(), session({ accountId: 'guest-b', secret: 'session-token-b' }))).toBe(false);
  });

  it('rejects a response after the active credential changes before account state updates', () => {
    expect(isCurrentGuestPortfolioSession(session(), session({ secret: 'session-token-b' }))).toBe(false);
  });

  it('rejects a response after the session changes role or signs out', () => {
    expect(isCurrentGuestPortfolioSession(session(), session({ role: 'admin' }))).toBe(false);
    expect(isCurrentGuestPortfolioSession(session(), session({ role: null, accountId: null, secret: '' }))).toBe(false);
  });

  it('does not accept an unbound or credential-free request session', () => {
    expect(isCurrentGuestPortfolioSession(session({ accountId: null }), session({ accountId: null }))).toBe(false);
    expect(isCurrentGuestPortfolioSession(session({ secret: '' }), session({ secret: '' }))).toBe(false);
    expect(isCurrentGuestPortfolioSession(session({ role: 'admin' }), session({ role: 'admin' }))).toBe(false);
  });
});
