import { describe, expect, it } from 'vitest';
import {
  classifyCashflow,
  hasKnownCashflowDirection,
  normalizeClassifiedCashflowAmount
} from './cashflowClassification';

describe('shared cashflow classification', () => {
  it('separates credited interest from margin financing and dividends', () => {
    expect(classifyCashflow({ type: 'Interest income' })).toMatchObject({
      category: 'interest_income', eventType: 'interest.income', classified: true
    });
    expect(classifyCashflow({ type: 'Margin Fee', description: 'Daily financing fee' })).toMatchObject({
      category: 'margin_interest', eventType: 'margin.interest', classified: true
    });
    expect(classifyCashflow({ type: 'Dividend' })).toMatchObject({
      category: 'dividend', eventType: 'dividend', classified: true
    });
  });

  it('leaves ambiguous margin and reinvestment operations unclassified', () => {
    expect(classifyCashflow({ type: 'Margin Debt Adjustment' }).category).toBe('unclassified');
    expect(classifyCashflow({ type: 'Margin Call' }).classified).toBe(false);
    expect(classifyCashflow({ type: 'Dividend Reinvestment' }).classified).toBe(false);
  });

  it('classifies tax separately from commission even though both use fee journal events', () => {
    expect(classifyCashflow({ type: 'Tax withheld' })).toMatchObject({
      category: 'tax', eventType: 'fee', classified: true
    });
    expect(classifyCashflow({ type: 'Broker commission' })).toMatchObject({
      category: 'commission', eventType: 'fee', classified: true
    });
  });

  it('does not infer the cash direction of generic adjustments or corporate actions', () => {
    expect(hasKnownCashflowDirection('adjustment')).toBe(false);
    expect(hasKnownCashflowDirection('correction')).toBe(false);
    expect(hasKnownCashflowDirection('corporate_action')).toBe(false);
    expect(hasKnownCashflowDirection('transfer')).toBe(true);
    expect(hasKnownCashflowDirection('dividend')).toBe(true);
  });

  it('normalizes cashflow direction and expense refunds', () => {
    expect(normalizeClassifiedCashflowAmount('deposit', -100)).toBe(100);
    expect(normalizeClassifiedCashflowAmount('withdrawal', 10)).toBe(-10);
    expect(normalizeClassifiedCashflowAmount('dividend', -5)).toBe(5);
    expect(normalizeClassifiedCashflowAmount('margin_interest', 2)).toBe(-2);
    expect(normalizeClassifiedCashflowAmount('margin_interest', 2, 'Margin interest refund')).toBe(2);
    expect(normalizeClassifiedCashflowAmount('fee', 3, 'Fee refund')).toBe(3);
    expect(normalizeClassifiedCashflowAmount('transfer', -4)).toBe(-4);
  });
});
