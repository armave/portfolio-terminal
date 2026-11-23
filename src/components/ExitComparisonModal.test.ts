import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatExitComparisonDate, getProjectedCashDebtStatus, parseScenarioSignedMoney } from '../features/scenarios/exitComparisonPresentation';

const source = readFileSync(new URL('./ExitComparisonModal.tsx', import.meta.url), 'utf8');

describe('Compare Exits modal presentation', () => {
  it('shows exact dates, quote provenance and a complete-lot fallback explanation', () => {
    expect(source).toContain('formatExitComparisonDate(period.date, language)');
    expect(source).toContain('getQuoteFreshness(position)');
    expect(source).toContain('position?.quoteDetails?.sourceTimestamp');
    expect(source).toContain("translateText('Based on complete tracked lots', language)");
    expect(source).toContain("translateText('Observation time unknown', language)");
  });

  it('uses explicit net-P&L winner language and retains the detailed fee breakdown', () => {
    expect(source).toContain("translateText('BEST NET P&L', language)");
    expect(source).toContain("translateText('Best period is selected by the highest net P&L after modeled fees and financing.', language)");
    for (const label of ['Buy Commission', 'Sell Commission', 'Estimated Margin Interest', 'Total Fee Friction']) {
      expect(source).toContain(label);
    }
  });

  it('stacks the position selector and actions on narrow screens without shrinking the ticker control', () => {
    expect(source).toContain('exit-comparison-toolbar flex flex-col items-stretch');
    expect(source).toContain('exit-comparison-position w-full min-w-0');
    expect(source).toContain('exit-comparison-toolbar-actions flex w-full');
  });

  it('renders mobile period cards and a semantic desktop comparison table', () => {
    expect(source).toContain('sm:hidden');
    expect(source).toContain('hidden overflow-x-auto sm:block');
    expect(source).toContain('scope="col"');
    expect(source).toContain('scope="row"');
  });

  it('explains a negative signed cash/debt balance as remaining margin debt', () => {
    expect(source).toContain("translateText('Projected cash/debt balance is not portfolio equity; negative values represent remaining margin debt.', language)");
    expect(source).toContain("translateText('Remaining margin debt', language)");
    expect(getProjectedCashDebtStatus('−$1,416.64')).toBe('debt');
    expect(parseScenarioSignedMoney('−$1,416.64')).toBe(-1416.64);
    expect(formatExitComparisonDate('2026-11-23', 'en')).toBe('Nov 23, 2026');
  });

  it('does not synthesize historical fee components for old saved comparisons', () => {
    expect(source).toContain('savedFallback && !hasFeeBreakdown');
    expect(source).toContain("translateText('Fee breakdown is unavailable for this older saved estimate. Recalculate to see the component costs.', language)");
  });
});
