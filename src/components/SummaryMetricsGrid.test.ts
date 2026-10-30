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

  it('falls through empty canonical placeholders to valid legacy quantity fields', () => {
    expect(getMarginTrancheQuantity({ qty: 0, shares: 5 })).toBe(5);
    expect(getMarginTrancheQuantity({ qty: '', quantity: 14 })).toBe(14);
    expect(getMarginTrancheQuantity({ qty: 'invalid', shares: 10 })).toBe(10);
  });

  it('returns null for missing, invalid, or non-positive quantities', () => {
    expect(getMarginTrancheQuantity({})).toBeNull();
    expect(getMarginTrancheQuantity({ qty: 'invalid' })).toBeNull();
    expect(getMarginTrancheQuantity({ qty: 0, shares: 0 })).toBeNull();
  });

  it('recovers a missing persisted lot quantity from one exact broker execution-log match', () => {
    const purchasedAt = Date.parse('2026-10-22T09:30:00.000Z');
    const brokerLots = [{
      id: 'GOOGL:lot-1',
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity: 10,
      marketPrice: 423,
      averagePrice: 328,
      marketValue: 4230,
      purchasedAt
    }];
    expect(getMarginTrancheQuantity({
      price: 328,
      date: '2026-10-22'
    }, brokerLots, 'GOOGL')).toBe(10);
  });

  it('does not guess when broker execution matches are ambiguous or mismatched', () => {
    const brokerLots = [{
      id: 'GOOGL:lot-1',
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity: 10,
      marketPrice: 423,
      averagePrice: 328,
      marketValue: 4230,
      purchasedAt: Date.parse('2026-10-22T09:30:00.000Z')
    }];
    expect(getMarginTrancheQuantity({ price: 328, date: '2026-10-22' }, [...brokerLots, ...brokerLots], 'GOOGL')).toBeNull();
    expect(getMarginTrancheQuantity({ price: 328, date: '2026-10-22' }, brokerLots, 'AAPL')).toBeNull();
    expect(getMarginTrancheQuantity({ price: 329, date: '2026-10-22' }, brokerLots, 'GOOGL')).toBeNull();
  });
});
