import { describe, expect, it } from 'vitest';
import { validateSaleCostBasisTranches } from './saleCostBasis';

describe('validateSaleCostBasisTranches', () => {
  it('accepts canonical FIFO lots and reports their complete ledger', () => {
    const result = validateSaleCostBasisTranches([
      { qty: 2, price: 100, buyCommission: 2, date: '2026-10-01' },
      { qty: 3, price: 120, buyCommission: 6, date: '2026-10-02' }
    ], 5, 8, 'AAPL');

    expect(result).toMatchObject({
      positionShares: 5,
      aggregateBuyCommission: 8,
      totalShares: 5,
      totalCostBasis: 560,
      explicitBuyCommissionTotal: 8,
      hasPerTrancheCommissions: true
    });
    expect(result.tranches).toHaveLength(2);
  });

  it('normalizes supported legacy quantity, price, and date aliases', () => {
    const result = validateSaleCostBasisTranches([
      { shares: 2, entryPrice: 90, purchaseDate: '2026-10-01' },
      { quantity: 3, averagePrice: 110, entryDate: '2026-10-02' }
    ], 5, 0);

    expect(result.tranches).toEqual([
      { qty: 2, price: 90, date: '2026-10-01' },
      { qty: 3, price: 110, date: '2026-10-02' }
    ]);
    expect(result.totalCostBasis).toBe(510);
    expect(result.hasPerTrancheCommissions).toBe(false);
  });

  it('uses a valid legacy alias when a canonical placeholder value is empty or zero', () => {
    const result = validateSaleCostBasisTranches([
      { qty: 0, shares: 2, price: 0, entryPrice: 100, buyCommission: 1 }
    ], 2, 1);

    expect(result.tranches).toEqual([
      { qty: 2, price: 100, buyCommission: 1 }
    ]);
    expect(result.totalCostBasis).toBe(200);
  });

  it.each([undefined, null, [], {}])('rejects absent or empty lot ledgers: %j', (tranches) => {
    expect(() => validateSaleCostBasisTranches(tranches, 5, 0))
      .toThrow('Position has no cost-basis tranches');
  });

  it.each([
    { qty: 0, price: 10 },
    { qty: -1, price: 10 },
    { qty: Number.NaN, price: 10 },
    { qty: 1, price: 0 },
    { qty: 1, price: Number.POSITIVE_INFINITY },
    { qty: 1, price: 10, buyCommission: -1 },
    { qty: 1, price: 10, buyCommission: Number.NaN }
  ])('rejects invalid tranche values: %j', (tranche) => {
    expect(() => validateSaleCostBasisTranches([tranche], 1, 0))
      .toThrow('invalid cost-basis tranche');
  });

  it('rejects tranche quantities below or above recorded open shares', () => {
    expect(() => validateSaleCostBasisTranches([{ qty: 4, price: 10 }], 5, 0))
      .toThrow('Recorded open shares (5) do not match tranche total (4)');
    expect(() => validateSaleCostBasisTranches([{ qty: 6, price: 10 }], 5, 0))
      .toThrow('Position tranche total (6) exceeds recorded open shares (5)');
  });

  it('corrects only floating-point drift within the documented share tolerance', () => {
    const result = validateSaleCostBasisTranches([
      { qty: 0.1, price: 10 },
      { qty: 0.2 - 1e-10, price: 20 }
    ], 0.3, 0);

    expect(result.totalShares).toBe(0.3);
    expect(result.tranches[1].qty).toBeCloseTo(0.2, 9);
  });

  it('rejects invalid aggregate fees and tranche fees above the recorded aggregate', () => {
    expect(() => validateSaleCostBasisTranches([{ qty: 1, price: 10 }], 1, Number.NaN))
      .toThrow('Position entry commission must be finite and non-negative');
    expect(() => validateSaleCostBasisTranches([{ qty: 1, price: 10, buyCommission: 2 }], 1, 1))
      .toThrow('Tranche entry commissions exceed the recorded position commission');
  });

  it('rejects overflowed cost-basis totals rather than creating invalid realized P&L', () => {
    expect(() => validateSaleCostBasisTranches([
      { qty: Number.MAX_VALUE, price: 2 }
    ], Number.MAX_VALUE, 0)).toThrow('finite positive acquisition cost basis');
  });
});
