import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import {
  getMarketStatusLabel,
  getMarketStatusRoleLabel,
  getMarketStatusTone,
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
