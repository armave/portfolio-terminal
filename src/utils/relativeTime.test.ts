import { afterEach, describe, expect, it } from 'vitest';
import { getAppLanguage, setAppLanguage } from '../services/i18n';
import { formatRelativeTime } from './relativeTime';

afterEach(() => setAppLanguage('en'));

describe('formatRelativeTime localization', () => {
  it('keeps compact English relative times by default', () => {
    expect(getAppLanguage()).toBe('en');
    expect(formatRelativeTime(1_000_000 - 60_000, 1_000_000)).toMatch(/ago$/);
    expect(formatRelativeTime(1_000_000 - 10_000, 1_000_000)).toBe('now');
  });

  it('formats past and future relative times in Russian', () => {
    setAppLanguage('ru');
    expect(formatRelativeTime(1_000_000 - 60_000, 1_000_000)).toContain('назад');
    expect(formatRelativeTime(1_000_000 + 60_000, 1_000_000)).toContain('через');
  });

  it('uses a translated fallback for invalid timestamps', () => {
    setAppLanguage('ru');
    expect(formatRelativeTime('not-a-date', 1_000_000)).toBe('Время неизвестно');
  });
});
