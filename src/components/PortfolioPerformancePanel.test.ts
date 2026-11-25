import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translatePortfolioPerformanceText } from './PortfolioPerformancePanel';

describe('Portfolio Performance panel integration', () => {
  it('keeps the performance panel restricted to the administrator combined desk', () => {
    const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    expect(source).toContain("permissions.isAdmin && activeDeskView === 'COMBINED'");
    expect(source).toContain('<PortfolioPerformancePanel />');
  });

  it('discloses Modified Dietz approximation, XIRR methodology, and unavailable FX/benchmarks', () => {
    const source = readFileSync(new URL('./PortfolioPerformancePanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Linked Modified Dietz');
    expect(source).toContain('Annualized XIRR · ACT/365');
    expect(source).toContain('Historical FX and benchmark comparison are not enabled.');
    expect(source).toContain('Performance methodology in Settings');
  });

  it('does not expose a benchmark number or imply exact subperiod TWR', () => {
    const source = readFileSync(new URL('./PortfolioPerformancePanel.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('S&P 500');
    expect(source).not.toContain('Exact TWR');
  });
  it('localizes performance copy inside the lazy panel chunk', () => {
    expect(translatePortfolioPerformanceText('Portfolio performance', 'ru')).toBe('Доходность портфеля');
    expect(translatePortfolioPerformanceText('History collecting', 'ru')).toBe('Сбор истории');
    expect(translatePortfolioPerformanceText('Annualized XIRR · ACT/365', 'ru')).toBe('Годовая XIRR · ACT/365');
    expect(translatePortfolioPerformanceText(
      'A broker income/cost row ambiguously matches multiple manual Cash Activity postings; the summary is withheld until the records are reviewed.',
      'ru'
    )).not.toContain('A broker income/cost row');
    expect(translatePortfolioPerformanceText(
      'A broker income/cost row conflicts with the category or event type of a matching manual Cash Activity posting.',
      'ru'
    )).not.toContain('A broker income/cost row');
    expect(translatePortfolioPerformanceText(
      "A broker income/cost row has the opposite signed movement from a matching manual Cash Activity posting; the summary is withheld until the records are reviewed.",
      'ru'
    )).not.toBe("A broker income/cost row has the opposite signed movement from a matching manual Cash Activity posting; the summary is withheld until the records are reviewed.");
    expect(translatePortfolioPerformanceText(
      'The same stable broker cashflow ID contains conflicting facts; income and costs are unavailable until its revision is reconciled.',
      'ru'
    )).not.toContain('The same stable broker cashflow ID');
    expect(translatePortfolioPerformanceText('An income or cost cashflow has an invalid amount.', 'ru'))
      .not.toBe('An income or cost cashflow has an invalid amount.');
    expect(translatePortfolioPerformanceText(
      "A cash transfer or balance adjustment is missing a valid amount; performance is unavailable until its source evidence is repaired.",
      'ru'
    )).not.toBe("A cash transfer or balance adjustment is missing a valid amount; performance is unavailable until its source evidence is repaired.");
    expect(translatePortfolioPerformanceText('Portfolio performance', 'en')).toBe('Portfolio performance');
  });

});
