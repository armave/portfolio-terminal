import { readFileSync } from 'node:fs';
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

  it('styles the two-card position summary and full-width cost strip', () => {
    const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    expect(stylesheet).toContain('portfolio-micro-summary--redesigned');
    expect(stylesheet).toContain('"market basis"');
    expect(stylesheet).toContain('"costs costs"');
    expect(stylesheet).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(stylesheet).toContain('@container portfolio-health-summary (max-width: 30rem)');
  });

  it('provides a scrollable table surface and a compact mobile dialog', () => {
    const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    expect(stylesheet).toContain('.tranche-details-backdrop');
    expect(stylesheet).toContain('.tranche-details-dialog');
    expect(stylesheet).toContain('.tranche-details-table-scroll');
    expect(stylesheet).toContain('min-width: 46rem;');
    expect(stylesheet).toContain('@media (max-width: 640px)');
  });
});
