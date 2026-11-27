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

  it('uses explicit TradeNet transaction codes and labels', () => {
    expect(classifyCashflow({
      type: 'Commission refund for negative cash balance',
      typeCode: 'commission_for_margin_refund',
      typeCodeName: 'Commission refund for negative cash balance'
    })).toMatchObject({ category: 'commission', eventType: 'fee', classified: true });
    expect(classifyCashflow({
      type: 'Monetary transaction',
      description: 'Fee for negative cash balance USD',
      raw: { type_code: 'commission', type_code_name: 'Monetary transaction', balance_note: 'Margin Debt Adjustment' }
    })).toMatchObject({ category: 'commission', eventType: 'fee', classified: true });
    expect(classifyCashflow({
      type: 'Fee for negative cash balance USD',
      description: 'Fee rate as a percentage: 0.041095',
      raw: { balance_note: 'Margin Debt Adjustment' }
    })).toMatchObject({ category: 'fee', eventType: 'fee', classified: true });
  });

  it('ignores unrelated raw fields and keeps genuinely ambiguous margin rows unclassified', () => {
    expect(classifyCashflow({
      type: 'Account adjustment',
      description: 'Adjustment',
      raw: { balance_note: 'Margin call fee rate', balance: '1200.00' }
    }).category).toBe('adjustment');
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
    expect(normalizeClassifiedCashflowAmount('commission', 3, 'commission_for_margin_refund')).toBe(3);
    expect(normalizeClassifiedCashflowAmount('transfer', -4)).toBe(-4);
  });
});
