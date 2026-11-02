import { describe, expect, it } from 'vitest';
import type { BrokerAssumptions, PositionRecord, TrancheItem } from '../types/portfolio';
import {
  allocateFifoSaleTranches,
  calculateSaleAccounting,
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
      { shares: 2, entryPrice: 90, date: '2026-10-01' },
      { qty: 3, price: 110, date: '2026-10-02' }
    ] as unknown as TrancheItem[], 1, 5, 0);

    expect(result.soldCostBasis).toBe(90);
    expect(result.remainingTranches).toEqual([
      { shares: 2, entryPrice: 90, date: '2026-10-01', qty: 1 },
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

  it('weights accrued margin interest by position investment and builds realized sale totals', () => {
    const aapl: PositionRecord = {
      ticker: 'AAPL',
      shares: 10,
      currentPrice: 100,
      pt: 110,
      commBuy: 2,
      tranches: [{ qty: 10, price: 100, date: '2026-10-15' }]
    };
    const msft: PositionRecord = {
      ticker: 'MSFT',
      shares: 10,
      currentPrice: 100,
      pt: 110,
      commBuy: 2,
      tranches: [{ qty: 10, price: 100, date: '2026-10-15' }]
    };

    const result = calculateSaleAccounting({
      tranches: aapl.tranches || [],
      positions: { AAPL: aapl, MSFT: msft },
      positionShares: 10,
      sharesSold: 5,
      balance: -1_000,
      brokerAssumptions: { ...brokerRules, annualBorrowRate: 0.365 },
      sellProceeds: 600,
      soldCostBasis: 500,
      buyCommissionAllocated: 2,
      sellCommission: 1,
      now: new Date('2026-10-17T12:00:00.000Z')
    });

    expect(result).toEqual({
      marginInterestAllocated: 0.5,
      totalCommissions: 3,
      grossProfit: 100,
      netProfit: 96.5,
      netCashProceeds: 599
    });
  });

  it('uses the remaining one-shot position charge as a floor and rounds the sold allocation to cents', () => {
    const position: PositionRecord = {
      ticker: 'AAPL',
      shares: 2,
      currentPrice: 100,
      pt: 110,
      commBuy: 1,
      marginCharged: 10,
      tranches: [{ qty: 2, price: 100, date: '2026-10-15' }]
    };

    const result = calculateSaleAccounting({
      tranches: position.tranches || [],
      positions: { AAPL: position },
      positionShares: 2,
      sharesSold: 1,
      balance: 0,
      brokerAssumptions: { ...brokerRules, annualBorrowRate: 0 },
      positionMarginCharged: position.marginCharged,
      sellProceeds: 110,
      soldCostBasis: 100,
      buyCommissionAllocated: 1,
      sellCommission: 1.2
    });

    expect(result).toEqual({
      marginInterestAllocated: 5,
      totalCommissions: 2.2,
      grossProfit: 10,
      netProfit: 2.8,
      netCashProceeds: 108.8
    });
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
