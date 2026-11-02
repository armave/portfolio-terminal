import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isCurrentGuestPortfolioSession,
  resolveGuestPortfolioRefreshView,
  type GuestPortfolioSessionIdentity
} from './guestPortfolioSession';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

const session = (overrides: Partial<GuestPortfolioSessionIdentity> = {}): GuestPortfolioSessionIdentity => ({
  role: 'guest',
  accountId: 'guest-a',
  secret: 'session-token-a',
  generation: 1,
  ...overrides
});

describe('isCurrentGuestPortfolioSession', () => {
  it('preserves the active desk while applying a refreshed guest snapshot', () => {
    const runtime = readSource('./guestPortfolioHydrationRuntime.ts');
    expect(runtime).toContain('resolveGuestPortfolioRefreshView(dependencies.getActiveView())');
    expect(runtime).toContain('activeView: refreshActiveView');
    expect(runtime).not.toContain("switchView('CASH_CUSHION')");
  });


  it('checks the captured account session before importing a guest snapshot', () => {
    const app = readSource('../../app.ts');
    const runtime = readSource('./guestPortfolioHydrationRuntime.ts');
    expect(app).toContain('createGuestPortfolioHydrationRuntime({');
    expect(app).toContain('currentAccountSessionGuard.capture()');
    expect(runtime).toContain('const requestedSession = dependencies.getSessionIdentity()');
    expect(runtime).toContain('const currentSession = dependencies.getSessionIdentity()');
    expect(runtime).toContain('if (!isCurrentGuestPortfolioSession(requestedSession, currentSession)) return');
    expect(runtime).toContain('const guestId = requestedSession.accountId');
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


describe('resolveGuestPortfolioRefreshView', () => {
  it.each(['BALANCE', 'CASH_CUSHION', 'GUEST_HISTORY', 'SETTINGS'])(
    'preserves the currently selected guest desk: %s',
    (view) => {
      expect(resolveGuestPortfolioRefreshView(view)).toBe(view);
    }
  );

  it('uses Balance only when the existing route is inaccessible to a guest', () => {
    expect(resolveGuestPortfolioRefreshView('COMBINED')).toBe('BALANCE');
    expect(resolveGuestPortfolioRefreshView('CLOSED_HISTORY')).toBe('BALANCE');
    expect(resolveGuestPortfolioRefreshView(null)).toBe('BALANCE');
    expect(resolveGuestPortfolioRefreshView(undefined)).toBe('BALANCE');
  });
});
