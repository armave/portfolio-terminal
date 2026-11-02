import { describe, expect, it } from 'vitest';
import type { BrokerAssumptions, TrancheItem } from '../types/portfolio';
import {
  allocateFifoSaleTranches,
  calculateSaleCommission,
  settleSaleProceeds
} from './portfolioTransactions';

const brokerRules: BrokerAssumptions = {
  broker: 'Test broker',
  annualBorrowRate: 0.15,
  dayCountBasis: 365,
  rolloverHour: 4,
  rolloverMinute: 0,
  rolloverTimeZone: 'Asia/Yerevan',
  maintenanceEquityRatio: 0.25,
  stopOutRatio: 0.1,
  commissionMin: 1.2,
  commissionPerShare: 0.012,
  commissionRatePct: 0.0012
};

describe('portfolio transaction calculations', () => {
  it('allocates partial sales across FIFO lots and retains the unsold lot fee', () => {
    const tranches: TrancheItem[] = [
      { qty: 2, price: 100, date: '2026-10-01', buyCommission: 2 },
      { qty: 3, price: 120, date: '2026-10-02', buyCommission: 6 }
    ];

    const result = allocateFifoSaleTranches(tranches, 3, 5, 8);

    expect(result.soldCostBasis).toBe(320);
    expect(result.buyCommissionAllocated).toBe(4);
    expect(result.remainingTranches).toEqual([
      { qty: 2, price: 120, date: '2026-10-02', buyCommission: 4 }
    ]);
    expect(tranches).toEqual([
      { qty: 2, price: 100, date: '2026-10-01', buyCommission: 2 },
      { qty: 3, price: 120, date: '2026-10-02', buyCommission: 6 }
    ]);
  });

  it('uses proportional aggregate buy-fee allocation for legacy lots without per-lot fees', () => {
    const result = allocateFifoSaleTranches([
      { qty: 2, price: 100 },
      { qty: 3, price: 120 }
    ], 2, 5, 10);

    expect(result.soldCostBasis).toBe(200);
    expect(result.buyCommissionAllocated).toBe(4);
    expect(result.remainingTranches).toEqual([
      { qty: 3, price: 120 }
    ]);
  });

  it('normalizes legacy tranche aliases while allocating FIFO quantities', () => {
    const result = allocateFifoSaleTranches([
      { qty: 0, shares: 2, price: 0, entryPrice: 90, date: '2026-10-01' },
      { qty: 3, price: 110, date: '2026-10-02' }
    ], 1, 5, 0);

    expect(result.soldCostBasis).toBe(90);
    expect(result.remainingTranches).toEqual([
      { qty: 1, shares: 2, price: 0, entryPrice: 90, date: '2026-10-01' },
      { qty: 3, price: 110, date: '2026-10-02' }
    ]);
  });

  it('calculates sale commissions from the normalized broker assumptions', () => {
    expect(calculateSaleCommission(10, 1_000, brokerRules)).toBe(1.32);
  });

  it('preserves a zero-commission broker configuration', () => {
    const freeTrading = {
      ...brokerRules,
      commissionMin: 0,
      commissionPerShare: 0,
      commissionRatePct: 0
    };

    expect(calculateSaleCommission(10, 1_000, freeTrading)).toBe(0);
  });

  it('repays margin debt before adding remaining sale proceeds to free cash', () => {
    expect(settleSaleProceeds(80, 5, 100)).toEqual({
      remainingDebt: 0,
      freeCash: 25,
      debtRepaid: 80,
      cashSurplus: 20
    });
  });

  it('retains debt when sale proceeds are insufficient and leaves existing cash unchanged', () => {
    expect(settleSaleProceeds(100, 12, 35)).toEqual({
      remainingDebt: 65,
      freeCash: 12,
      debtRepaid: 35,
      cashSurplus: 0
    });
  });

  it('clamps invalid negative debt, cash, and proceeds to zero', () => {
    expect(settleSaleProceeds(-10, -5, -1)).toEqual({
      remainingDebt: 0,
      freeCash: 0,
      debtRepaid: 0,
      cashSurplus: 0
    });
  });
});
