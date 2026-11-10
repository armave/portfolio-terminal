import { afterEach, describe, expect, it } from 'vitest';
import { getAppLanguage, setAppLanguage } from '../services/i18n';
import { formatNumberGroups } from './ScenarioComparisonModal';

describe('scenario modal financial number formatting', () => {
  afterEach(() => setAppLanguage('en'));
  it('adds thousand separators to positive, negative, and currency amounts', () => {
    expect(formatNumberGroups('$74287.83')).toBe('$74,287.83');
    expect(formatNumberGroups('-$74287.83')).toBe('-$74,287.83');
    expect(formatNumberGroups('+5895.20')).toBe('+5,895.20');
    expect(formatNumberGroups('-74287.83')).toBe('-74,287.83');
    expect(formatNumberGroups('33500.00 shares')).toBe('33,500.00 shares');
  });

  it('uses a locale-appropriate thousands separator in Russian', () => {
    setAppLanguage('ru');
    expect(formatNumberGroups('$74287.83')).toBe('$74\u202f287.83');
  });

  it('leaves small values, already-grouped values, and date-like labels unchanged', () => {
    expect(formatNumberGroups('169.77 (9.19)')).toBe('169.77 (9.19)');
    expect(formatNumberGroups('$1,234.56')).toBe('$1,234.56');
    expect(formatNumberGroups('WED, OCT 28 · ENTRY')).toBe('WED, OCT 28 · ENTRY');
    expect(formatNumberGroups('2026-11-10')).toBe('2026-11-10');
  });
});
