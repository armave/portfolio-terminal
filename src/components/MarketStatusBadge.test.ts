import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import {
  getMarketStatusLabel,
  getMarketStatusRoleLabel,
  getMarketStatusTone,
  formatMarketCountdown,
  getMarketStatusCountdown,
  getMarketStatusCountdownParts,
  getEffectiveMarketStatusCountdownParts,
  reconcileMarketStatusWithCalendar,
  resolveEffectiveMarketStatus,
  getEffectiveMarketStatusCountdown,
  getCalendarMarketStatus,
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


  it('deduplicates repeated startup auth events and does not fetch before identity is known', () => {
    const source = readFileSync(new URL('./MarketStatusBadge.tsx', import.meta.url), 'utf8');

    expect(source).toContain('let activeIdentity: string | null = null;');
    expect(source).toContain('if (nextIdentity === activeIdentity) return;');
    expect(source).toContain('if (!active || !authenticated || document.visibilityState === \'hidden\') return;');
    expect(source).toContain('}, []);');
    expect(source).not.toContain('}, [snapshot?.marketStatus.status, status]);');
    expect(source).not.toContain('    void refresh();\n    const intervalId');
  });

  it('uses different labels for administrator and guest workspaces', () => {
    expect(getMarketStatusRoleLabel(true)).toBe('Portfolio market');
    expect(getMarketStatusRoleLabel(false)).toBe('Your market');
  });

  it('uses explicit market-state labels for guest workspaces while preserving admin copy', () => {
    expect(getMarketStatusLabel('PREMARKET', false)).toBe('Market Pre-market');
    expect(getMarketStatusLabel('MARKET', false)).toBe('Market Open');
    expect(getMarketStatusLabel('POSTMARKET', false)).toBe('Market After-hours');
    expect(getMarketStatusLabel('CLOSED', false)).toBe('Market Closed');
    expect(getMarketStatusLabel('UNKNOWN', false)).toBe('Market Unavailable');
    expect(getMarketStatusLabel('MARKET', true)).toBe('Market');
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

  it('uses a fresh broker market phase as authoritative even when the local calendar differs', () => {
    const now = new Date('2026-11-02T15:00:00.000Z'); // 10:00 New York time
    expect(getCalendarMarketStatus(now)).toBe('MARKET');
    expect(resolveEffectiveMarketStatus('CLOSED', now.getTime(), now)).toBe('CLOSED');
    expect(resolveEffectiveMarketStatus('MARKET', now.getTime(), now)).toBe('MARKET');
  });

  it('falls back to the New York calendar only when broker status is absent, stale, or implausibly future-dated', () => {
    const now = new Date('2026-11-02T15:00:00.000Z');
    expect(resolveEffectiveMarketStatus(null, null, now)).toBe('MARKET');
    expect(resolveEffectiveMarketStatus('CLOSED', now.getTime() - 16 * 60_000, now)).toBe('MARKET');
    expect(resolveEffectiveMarketStatus('CLOSED', now.getTime() + 2 * 60_000, now)).toBe('MARKET');
    expect(resolveEffectiveMarketStatus('CLOSED', now.getTime() - 5 * 60_000, now)).toBe('CLOSED');
  });

  it('keeps a MIXED exchange status visible and suppresses a misleading single-market countdown', () => {
    const now = new Date('2026-11-02T15:00:00.000Z');
    expect(normalizeMarketSessionStatus('MIXED')).toBe('MIXED');
    expect(getMarketStatusLabel('MIXED')).toBe('Mixed exchange status');
    expect(getMarketStatusLabel('MIXED', false)).toBe('Exchanges report different states');
    expect(getEffectiveMarketStatusCountdown('MIXED', now.getTime(), now)).toBeNull();
    expect(getEffectiveMarketStatusCountdown('CLOSED', now.getTime(), now)).toBeNull();
    expect(getEffectiveMarketStatusCountdown('MARKET', now.getTime(), now)).toBe(getMarketStatusCountdown('MARKET', now));
    expect(getMarketStatusTone('MIXED')).toBe('unknown');
    const source = readFileSync(new URL('./MarketStatusBadge.tsx', import.meta.url), 'utf8');
    expect(source).toContain('snapshot.marketStatus.exchanges.map');
    expect(source).toContain('exchange.openTime');
    expect(source).toContain('exchange.closeTime');
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
    expect(formatMarketCountdown((24 * 60 + 20) * 60_000)).toBe('1d');
    expect(formatMarketCountdown(25 * 60 * 60_000 + 20 * 60_000)).toBe('1d 1h');
    expect(formatMarketCountdown(49 * 60 * 60_000 + 59 * 60_000)).toBe('2d 1h');
  });

  it('separates the countdown label from its time value for brighter time styling', () => {
    const now = new Date('2026-11-07T22:00:00.000Z');
    expect(getMarketStatusCountdownParts('CLOSED', now)).toEqual({
      label: 'Premarket in ',
      time: '1d 11h'
    });
    expect(getEffectiveMarketStatusCountdownParts('CLOSED', now.getTime(), now)).toEqual({
      label: 'Premarket in ',
      time: '1d 11h'
    });
    const source = readFileSync(new URL('./MarketStatusBadge.tsx', import.meta.url), 'utf8');
    expect(source).toContain('text-slate-100');
    expect(source).toContain('{countdownParts?.time}');
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
