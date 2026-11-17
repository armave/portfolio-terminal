import { describe, expect, it } from 'vitest';
import type { TrancheItem } from '../types/portfolio';
import { buildTrancheDetailsRows } from './TrancheDetailsModal';

describe('tranche details rows', () => {
  it('uses saved purchase lots and broker-resolved quantities without changing source records', () => {
    const tranches: TrancheItem[] = [
      { lotId: 'lot-old', qty: 5, price: 280, date: '2026-10-20', buyCommission: 1.25 },
      { lotId: 'lot-new', qty: 0, price: 295, date: '2026-11-03' }
    ];
    const before = structuredClone(tranches);
    const rows = buildTrancheDetailsRows(tranches, [5, 7], 'en');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      key: 'lot-old',
      number: 1,
      quantity: 5,
      entryPrice: 280,
      costBasis: 1400,
      buyCommission: 1.25
    });
    expect(rows[1]).toMatchObject({
      key: 'lot-new',
      number: 2,
      quantity: 7,
      entryPrice: 295,
      costBasis: 2065,
      buyCommission: null
    });
    expect(tranches).toEqual(before);
  });

  it('keeps unresolved quantities and missing price or commission unavailable instead of zero', () => {
    const tranches: TrancheItem[] = [
      { qty: 0, price: 280 },
      { qty: 4, price: Number.NaN, buyCommission: Number.NaN },
      { qty: 3, price: 290, date: '' }
    ];
    const rows = buildTrancheDetailsRows(tranches, [null, 4, 3], 'en');

    expect(rows[0].quantity).toBeNull();
    expect(rows[0].costBasis).toBeNull();
    expect(rows[1].entryPrice).toBeNull();
    expect(rows[1].costBasis).toBeNull();
    expect(rows[1].buyCommission).toBeNull();
    expect(rows[2].date).toBe('Date unavailable');
  });

  it('formats dates and computes each lot cost basis as quantity times entry price', () => {
    const rows = buildTrancheDetailsRows([
      { qty: 2, price: 125, date: '2026-11-03', buyCommission: 0 }
    ], [2], 'en');

    expect(rows[0].date).toBe('03 Nov');
    expect(rows[0].costBasis).toBe(250);
    expect(rows[0].buyCommission).toBe(0);
  });
});
