import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import {
  getMarketStatusLabel,
  getMarketStatusRoleLabel,
  getMarketStatusTone,
  formatMarketCountdown,
  getMarketStatusCountdown,
  reconcileMarketStatusWithCalendar,
  isCurrentMarketStatusRequest,
  normalizeMarketSessionStatus
} from './MarketStatusBadge';

beforeEach(() => setAppLanguage('en'));

describe('US-equities market status presentation', () => {

  it('ignores a market-status response started before an authentication transition', () => {
    const requestGeneration = 4;
    expect(isCurrentMarketStatusRequest(true, requestGeneration, requestGeneration)).toBe(true);

    // A logout or account switch increments the generation before the request resolves.
    expect(isCurrentMarketStatusRequest(true, requestGeneration, requestGeneration + 1)).toBe(false);
    expect(isCurrentMarketStatusRequest(false, requestGeneration, requestGeneration)).toBe(false);
  });

  it('invalidates in-flight responses and clears the previous snapshot when the account changes', () => {
    const source = readFileSync(new URL('./MarketStatusBadge.tsx', import.meta.url), 'utf8');

    expect(source).toContain('const requestGeneration = authGeneration;');
    expect(source).toContain('if (!isCurrentMarketStatusRequest(active, requestGeneration, authGeneration)) return;');
    expect(source).toContain('authGeneration += 1;');
    expect(source).toContain('hasLoaded = false;');
    expect(source).toContain('setSnapshot(null);');
  });

  it('uses different labels for administrator and guest workspaces', () => {
    expect(getMarketStatusRoleLabel(true)).toBe('Portfolio market');
    expect(getMarketStatusRoleLabel(false)).toBe('Your market');
  });

  it.each([
    ['PREV', 'PREMARKET', 'Premarket'],
    ['PRE', 'PREMARKET', 'Premarket'],
    ['PREPRE', 'PREMARKET', 'Premarket'],
    ['PRE-MARKET', 'PREMARKET', 'Premarket'],
    ['OPEN', 'MARKET', 'Market'],
    ['REGULAR', 'MARKET', 'Market'],
    ['POST', 'POSTMARKET', 'Postmarket'],
    ['POSTPOST', 'POSTMARKET', 'Postmarket'],
    ['POST-MARKET', 'POSTMARKET', 'Postmarket'],
    ['CLOSE', 'CLOSED', 'Closed'],
    ['CLOSED', 'CLOSED', 'Closed']
  ])('normalizes provider state %s to %s', (providerValue, expectedState, expectedLabel) => {
    expect(normalizeMarketSessionStatus(providerValue)).toBe(expectedState);
    expect(getMarketStatusLabel(providerValue)).toBe(expectedLabel);
  });

  it('does not display unknown provider codes as if they were a supported market phase', () => {
    expect(normalizeMarketSessionStatus('PREV_UNKNOWN')).toBeNull();
    expect(getMarketStatusLabel('PREV_UNKNOWN')).toBe('Unavailable');
    expect(getMarketStatusTone('PREV_UNKNOWN')).toBe('unknown');
  });

  it('uses distinct tones for premarket, regular market, postmarket, and closed', () => {
    expect(getMarketStatusTone('PREMARKET')).toBe('premarket');
    expect(getMarketStatusTone('MARKET')).toBe('open');
    expect(getMarketStatusTone('POSTMARKET')).toBe('postmarket');
    expect(getMarketStatusTone('CLOSED')).toBe('closed');
  });

  it('corrects provider phases that conflict with the actual New York market session', () => {
    expect(reconcileMarketStatusWithCalendar('CLOSED', new Date('2026-11-02T09:00:00.000Z')))
      .toBe('PREMARKET');
    expect(reconcileMarketStatusWithCalendar('CLOSED', new Date('2026-11-02T15:00:00.000Z')))
      .toBe('MARKET');
    expect(reconcileMarketStatusWithCalendar('MARKET', new Date('2026-11-02T22:00:00.000Z')))
      .toBe('POSTMARKET');
    expect(reconcileMarketStatusWithCalendar('MARKET', new Date('2026-11-03T02:00:00.000Z')))
      .toBe('CLOSED');
    expect(reconcileMarketStatusWithCalendar('CLOSED', new Date('2026-11-27T19:00:00.000Z')))
      .toBe('POSTMARKET');
    expect(reconcileMarketStatusWithCalendar('UNKNOWN', new Date('2026-11-02T08:00:00.000Z')))
      .toBeNull();
  });

  it('shows the next transition and includes days for waits longer than 24 hours', () => {
    expect(getMarketStatusCountdown('CLOSED', new Date('2026-11-02T07:00:00.000Z')))
      .toBe('Premarket in 2h');
    expect(getMarketStatusCountdown('PRE', new Date('2026-11-02T13:00:00.000Z')))
      .toBe('Opens in 1h 30m');
    expect(getMarketStatusCountdown('MARKET', new Date('2026-11-02T14:30:00.000Z')))
      .toBe('Closes in 6h 30m');
    expect(getMarketStatusCountdown('POST', new Date('2026-11-02T22:00:00.000Z')))
      .toBe('Closes in 3h');
    expect(getMarketStatusCountdown('CLOSED', new Date('2026-11-06T22:00:00.000Z')))
      .toBe('Premarket in 2d 11h');
    expect(getMarketStatusCountdown('UNKNOWN', new Date('2026-11-02T13:00:00.000Z'))).toBeNull();
  });

  it('uses the reconciled phase for the countdown when provider status is stale', () => {
    const now = new Date('2026-11-02T09:00:00.000Z');
    const effectiveStatus = reconcileMarketStatusWithCalendar('CLOSED', now);
    expect(getMarketStatusCountdown(effectiveStatus, now)).toBe('Opens in 5h 30m');
  });

  it('formats countdowns in minutes, hours, and day-aware durations', () => {
    expect(formatMarketCountdown(45 * 60_000)).toBe('45m');
    expect(formatMarketCountdown((60 + 30) * 60_000)).toBe('1h 30m');
    expect(formatMarketCountdown(24 * 60 * 60_000)).toBe('24h');
    expect(formatMarketCountdown((24 * 60 + 20) * 60_000)).toBe('1d 0h 20m');
    expect(formatMarketCountdown(25 * 60 * 60_000 + 20 * 60_000)).toBe('1d 1h 20m');
  });

  it('localizes countdown labels and duration units in Russian', () => {
    setAppLanguage('ru');
    expect(getMarketStatusCountdown('CLOSED', new Date('2026-11-06T22:00:00.000Z')))
      .toBe('До премаркета: 2 дн 11 ч');
  });

  it('does not mount a duplicate status badge inside the Balance desk', () => {
    const source = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('MarketStatusBadge');
    expect(source).not.toContain('useState<AuthUser | null>(null)');
  });

  it('keeps the status badge in the shared header without gating it on currentUser state', () => {
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(appSource).toContain('<MarketStatusBadge isAdmin={permissions.isAdmin} />');
    expect(appSource).not.toContain('{currentUser && <MarketStatusBadge');
    expect(appSource).not.toContain('{permissions.isAdmin && <MarketStatusBadge');
  });
});
