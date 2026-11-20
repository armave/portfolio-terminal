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
    expect(buildTrancheDetailsRows([
      { qty: 1, price: 10, buyCommission: '   ' as unknown as number }
    ], [1], 'en')[0].buyCommission).toBeNull();
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

  it('styles one compact responsive panel for market value and position basis', () => {
    const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const summaryStyles = stylesheet.slice(
      stylesheet.indexOf('/* One compact financial summary surface'),
      stylesheet.indexOf('/* Purchase tranche ledger modal')
    );

    expect(summaryStyles).toContain('.portfolio-health-summary-column>.portfolio-micro-summary--redesigned {');
    expect(summaryStyles).toContain('"market basis"');
    expect(summaryStyles).not.toContain('"costs costs"');
    expect(summaryStyles).toContain('grid-template-rows: auto;');
    expect(summaryStyles).toContain('flex: 0 0 auto;');
    expect(summaryStyles).toContain('min-height: 0;');
    expect(summaryStyles).toContain('background: transparent;');
    expect(summaryStyles).toContain('box-shadow: none;');
    expect(summaryStyles).not.toContain('margin-top: auto;');
    expect(summaryStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(summaryStyles).toContain('@container portfolio-health-summary (max-width: 30rem)');
    expect(summaryStyles).toContain('@container portfolio-health-summary (max-width: 24rem)');
  });

  it('keeps the tranche dialog centered in the mobile viewport', () => {
    const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
    const modalStyles = stylesheet.slice(stylesheet.indexOf('/* Purchase tranche ledger modal'));
    const mobileStyles = modalStyles.slice(modalStyles.indexOf('@media (max-width: 640px)'));
    const backdropStyles = mobileStyles.slice(0, mobileStyles.indexOf('  .tranche-details-dialog'));

    expect(backdropStyles).toContain('align-items: center;');
    expect(backdropStyles).not.toContain('align-items: flex-end;');
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
