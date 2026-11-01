import { describe, expect, it } from 'vitest';
import { getMarginTranchePreview, getMarginTrancheQuantity, getMarginTrancheQuantities, getUsableMarketPrice } from './SummaryMetricsGrid';

describe('usable margin market prices', () => {
  it('accepts only finite positive prices', () => {
    expect(getUsableMarketPrice(123.45)).toBe(123.45);
    expect(getUsableMarketPrice('123.45')).toBe(123.45);
    expect(getUsableMarketPrice(0)).toBeNull();
    expect(getUsableMarketPrice(-1)).toBeNull();
    expect(getUsableMarketPrice(Number.NaN)).toBeNull();
    expect(getUsableMarketPrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(getUsableMarketPrice(null)).toBeNull();
    expect(getUsableMarketPrice(undefined)).toBeNull();
    expect(getUsableMarketPrice('')).toBeNull();
  });
});

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

  it('matches broker UTC timestamps against the TradeNet Armenia calendar date', () => {
    const brokerLots = [{
      id: 'GOOGL:late-utc-buy',
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity: 5,
      marketPrice: 423,
      averagePrice: 282,
      marketValue: 2115,
      // 01:00 on 29 Oct in Armenia is still 28 Oct in UTC.
      purchasedAt: Date.parse('2026-10-28T21:00:00.000Z')
    }];

    expect(getMarginTrancheQuantities([
      { price: 282, date: '2026-10-29' }
    ], brokerLots, 'GOOGL')).toEqual([5]);
  });

  it('pairs repeated GOOGL price/date rows one-to-one with matching broker open lots', () => {
    const tranches = [
      { price: 282, date: '2026-10-29' },
      { price: 282, date: '2026-10-29' },
      { price: 328, date: '2026-10-22' },
      { price: 336.3, date: '2026-10-21' },
      { price: 341.4, date: '2026-10-20' }
    ];
    const lot = (quantity: number, averagePrice: number, date: string, id: string) => ({
      id,
      ticker: 'GOOGL',
      name: 'GOOGL',
      quantity,
      marketPrice: 423,
      averagePrice,
      marketValue: quantity * 423,
      purchasedAt: Date.parse(date + 'T09:30:00.000Z')
    });
    const brokerLots = [
      lot(5, 282, '2026-10-29', 'lot-1'),
      lot(14, 282, '2026-10-29', 'lot-2'),
      lot(10, 328, '2026-10-22', 'lot-3'),
      lot(20, 336.3, '2026-10-21', 'lot-4'),
      lot(20, 341.4, '2026-10-20', 'lot-5')
    ];

    expect(getMarginTrancheQuantities(tranches, brokerLots, 'GOOGL')).toEqual([5, 14, 10, 20, 20]);
  });
});
