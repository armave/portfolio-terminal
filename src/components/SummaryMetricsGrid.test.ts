import { describe, expect, it } from 'vitest';
import { getMarginTranchePreview, getMarginTrancheQuantity } from './SummaryMetricsGrid';

describe('margin tranche preview', () => {
  it('hides every individual tranche by default', () => {
    expect(getMarginTranchePreview(['oldest', 'second', 'third', 'fourth'])).toEqual([]);
  });

  it('shows every tranche when expanded, without a three-lot cutoff', () => {
    const tranches = ['oldest', 'second', 'third', 'fourth', 'newest'];
    expect(getMarginTranchePreview(tranches, true)).toEqual(tranches);
  });

  it('does not mutate the stored tranche array', () => {
    const tranches = [1, 2, 3, 4];
    getMarginTranchePreview(tranches, true);
    expect(tranches).toEqual([1, 2, 3, 4]);
  });
});

describe('margin tranche quantity display', () => {
  it('uses canonical qty first and supports legacy shares and broker quantity fields', () => {
    expect(getMarginTrancheQuantity({ qty: 5, shares: 9, quantity: 12 })).toBe(5);
    expect(getMarginTrancheQuantity({ shares: 9 })).toBe(9);
    expect(getMarginTrancheQuantity({ quantity: 12 })).toBe(12);
  });

  it('returns null for missing, invalid, or non-positive quantities', () => {
    expect(getMarginTrancheQuantity({})).toBeNull();
    expect(getMarginTrancheQuantity({ qty: 'invalid' })).toBeNull();
    expect(getMarginTrancheQuantity({ qty: 0, shares: 0 })).toBeNull();
  });
});
