import { describe, expect, it } from 'vitest';
import { formatMarginCoverageStatus, formatMarginFetchedLabel, formatMarginSourcesHeading } from './marginIntelligenceCopy';

describe('margin intelligence localized evidence labels', () => {
  it('keeps provider failure distinct from an empty feed and retains provider detail', () => {
    expect(formatMarginCoverageStatus({ status: 'error', availableArticleCount: 0, selectedArticleCount: 0, error: 'Timeout' }, 'ru')).toBe('Лента недоступна: Timeout');
    expect(formatMarginCoverageStatus({ status: 'empty', availableArticleCount: 0, selectedArticleCount: 0 }, 'ru')).toBe('Лента не вернула статей');
  });

  it('localizes dynamic article counts and evidence prefixes', () => {
    expect(formatMarginCoverageStatus({ status: 'loaded', availableArticleCount: 4, selectedArticleCount: 2 }, 'ru')).toBe('4 доступно · 2 просмотрено');
    expect(formatMarginFetchedLabel('Nov 5, 2026', 'ru')).toBe('Получено Nov 5, 2026');
    expect(formatMarginSourcesHeading(3, 'ru')).toBe('Изученные источники (3)');
  });

  it('keeps English copy unchanged', () => {
    expect(formatMarginCoverageStatus({ status: 'loaded', availableArticleCount: 4, selectedArticleCount: 2 })).toBe('4 available · 2 reviewed');
    expect(formatMarginFetchedLabel('Nov 5, 2026')).toBe('Fetched Nov 5, 2026');
  });
});
