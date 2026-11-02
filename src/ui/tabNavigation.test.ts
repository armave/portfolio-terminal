import { describe, expect, it } from 'vitest';
import { isBalanceDeskView, isMarginDeskView, resolveTabNavigationIndex, shouldRefreshQuotesOnNavigation, shouldRefreshQuotesWhenEnteringBalance } from './tabNavigation';

describe('resolveTabNavigationIndex', () => {
  it('wraps left and right navigation across the tab list', () => {
    expect(resolveTabNavigationIndex(0, 3, 'ArrowLeft')).toBe(2);
    expect(resolveTabNavigationIndex(2, 3, 'ArrowRight')).toBe(0);
    expect(resolveTabNavigationIndex(1, 3, 'ArrowLeft')).toBe(0);
    expect(resolveTabNavigationIndex(1, 3, 'ArrowRight')).toBe(2);
  });

  it('moves to the first or last tab with Home and End', () => {
    expect(resolveTabNavigationIndex(2, 3, 'Home')).toBe(0);
    expect(resolveTabNavigationIndex(0, 3, 'End')).toBe(2);
  });

  it('ignores unsupported keys and invalid tab indexes', () => {
    expect(resolveTabNavigationIndex(0, 3, 'ArrowDown')).toBeNull();
    expect(resolveTabNavigationIndex(-1, 3, 'ArrowRight')).toBeNull();
    expect(resolveTabNavigationIndex(3, 3, 'ArrowLeft')).toBeNull();
    expect(resolveTabNavigationIndex(0, 1, 'ArrowRight')).toBeNull();
  });
});

describe('workspace navigation quote refresh triggers', () => {
  it('refreshes when entering or switching between administrator Margin sections', () => {
    expect(shouldRefreshQuotesOnNavigation('BALANCE', 'COMBINED', true)).toBe(true);
    expect(shouldRefreshQuotesOnNavigation('SETTINGS', 'AAPL', true)).toBe(true);
    expect(shouldRefreshQuotesOnNavigation('COMBINED', 'AAPL', true)).toBe(true);
    expect(shouldRefreshQuotesOnNavigation('AAPL', 'MSFT', true)).toBe(true);
    expect(shouldRefreshQuotesOnNavigation('AAPL', 'AAPL', true)).toBe(false);
  });

  it('refreshes only when the normalized active view transitions into Balance', () => {
    expect(isBalanceDeskView('BALANCE')).toBe(true);
    expect(isBalanceDeskView('CASH_CUSHION')).toBe(true);
    expect(isBalanceDeskView('AAPL')).toBe(false);
    expect(shouldRefreshQuotesWhenEnteringBalance('AAPL', 'CASH_CUSHION')).toBe(true);
    expect(shouldRefreshQuotesWhenEnteringBalance('SETTINGS', 'BALANCE')).toBe(true);
    expect(shouldRefreshQuotesWhenEnteringBalance('GUEST_HISTORY', 'CASH_CUSHION')).toBe(true);
    expect(shouldRefreshQuotesWhenEnteringBalance('CASH_CUSHION', 'CASH_CUSHION')).toBe(false);
    expect(shouldRefreshQuotesWhenEnteringBalance('BALANCE', 'CASH_CUSHION')).toBe(false);
    expect(shouldRefreshQuotesWhenEnteringBalance('CASH_CUSHION', 'SETTINGS')).toBe(false);
  });

  it('does not start Margin requests for guest or unknown roles', () => {
    expect(isMarginDeskView('COMBINED', false)).toBe(false);
    expect(shouldRefreshQuotesOnNavigation('BALANCE', 'COMBINED', false)).toBe(false);
    expect(isMarginDeskView('GUEST_HISTORY', true)).toBe(false);
    expect(shouldRefreshQuotesOnNavigation('BALANCE', 'GUEST_HISTORY', true)).toBe(false);
  });
});
