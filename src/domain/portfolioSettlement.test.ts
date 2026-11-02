import { describe, expect, it } from 'vitest';
import { calculateSaleCommission, settleSaleProceeds } from './portfolioSettlement';

describe('portfolio sale commission boundary', () => {
  it('preserves the broker minimum commission for small orders', () => {
    expect(calculateSaleCommission(1, 10, { commPerShare: 0.012, commVolumePct: 0.0012, minCommOrder: 1.2 })).toBe(1.2);
  });
  it('uses per-share and notional commission components when they exceed the minimum', () => {
    expect(calculateSaleCommission(100, 10_000, { commPerShare: 0.02, commVolumePct: 0.003, minCommOrder: 1 })).toBe(32);
  });
  it('rounds the calculated sale commission to cents', () => {
    expect(calculateSaleCommission(3, 101.11, { commPerShare: 0.012, commVolumePct: 0.0012, minCommOrder: 0 })).toBe(0.16);
  });
  it('retains the legacy fallback when broker commission assumptions are invalid', () => {
    expect(calculateSaleCommission(10, 100, { commPerShare: -1, commVolumePct: 0, minCommOrder: 1.2 })).toBe(1.2);
  });
});

describe('portfolio sale proceeds settlement boundary', () => {
  it('repays debt before adding any surplus to existing free cash', () => {
    expect(settleSaleProceeds(75, 20, 100)).toEqual({ remainingDebt: 0, freeCash: 45, debtRepaid: 75, cashSurplus: 25 });
  });
  it('leaves debt outstanding when sale proceeds do not cover it', () => {
    expect(settleSaleProceeds(200, 15, 80)).toEqual({ remainingDebt: 120, freeCash: 15, debtRepaid: 80, cashSurplus: 0 });
  });
  it('preserves free cash when there is no debt', () => {
    expect(settleSaleProceeds(0, 125, 40)).toEqual({ remainingDebt: 0, freeCash: 165, debtRepaid: 0, cashSurplus: 40 });
  });
  it('normalizes negative and non-finite inputs', () => {
    expect(settleSaleProceeds(-100, Number.NaN, Number.NaN)).toEqual({ remainingDebt: 0, freeCash: 0, debtRepaid: 0, cashSurplus: 0 });
  });
});
