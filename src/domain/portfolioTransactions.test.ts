import { describe, expect, it } from 'vitest';
import type { BrokerAssumptions, PositionRecord, TrancheItem } from '../types/portfolio';
import {
  allocateFifoSaleTranches,
  calculateSaleAccounting,
  calculateSaleCommission,
  createClosedTradeRecord,
  resolveClosedTradeTimestamp,
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
      { date: '2026-10-01', qty: 1, price: 90 },
      { qty: 3, price: 110, date: '2026-10-02' }
    ]);
  });

  it('rejects sales when tranche quantities do not exactly explain the open position', () => {
    expect(() => allocateFifoSaleTranches([], 1, 5, 0))
      .toThrow('Position has no cost-basis tranches');
    expect(() => allocateFifoSaleTranches([{ qty: 4, price: 10 }], 1, 5, 0))
      .toThrow('Recorded open shares (5) do not match tranche total (4)');
    expect(() => allocateFifoSaleTranches([{ qty: 6, price: 10 }], 1, 5, 0))
      .toThrow('Position tranche total (6) exceeds recorded open shares (5)');
    expect(() => allocateFifoSaleTranches([{ qty: 5, price: 10 }], 1, 5, -1))
      .toThrow('Position entry commission must be finite and non-negative');
  });

  it('allocates unassigned aggregate buy fees proportionally when lot fees are incomplete', () => {
    const result = allocateFifoSaleTranches([
      { qty: 2, price: 100, buyCommission: 2 },
      { qty: 2, price: 120 }
    ], 2, 4, 8);

    expect(result.soldCostBasis).toBe(200);
    expect(result.buyCommissionAllocated).toBe(4);
  });

  it('allocates unassigned aggregate buy fees in addition to complete lot fees', () => {
    const result = allocateFifoSaleTranches([
      { qty: 2, price: 100, buyCommission: 2 }
    ], 1, 2, 4);

    expect(result.soldCostBasis).toBe(100);
    expect(result.buyCommissionAllocated).toBe(2);
    expect(result.remainingTranches).toEqual([
      { qty: 1, price: 100, buyCommission: 1 }
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

  it('builds the complete legacy-compatible closed-trade record and rounds holding days', () => {
    const record = createClosedTradeRecord({
      id: 'AAPL-12345',
      ticker: 'AAPL',
      shares: 1.25,
      soldCostBasis: 125,
      sellPrice: 110,
      buyDate: '2026-10-15T00:00:00.000Z',
      sellDate: '2026-10-16T12:00:00.000Z',
      closedTimestamp: Date.parse('2026-10-16T12:30:00.000Z'),
      grossProfit: 12.5,
      commissions: 2.4,
      marginInterest: 0.5,
      netProfit: 9.6
    });

    expect(record).toEqual({
      id: 'AAPL-12345',
      ticker: 'AAPL',
      shares: 1.25,
      avgBuyPrice: 100,
      entryPrice: 100,
      sellPrice: 110,
      exitPrice: 110,
      buyDate: '2026-10-15T00:00:00.000Z',
      purchaseDate: '2026-10-15T00:00:00.000Z',
      sellDate: '2026-10-16T12:00:00.000Z',
      exitDate: '2026-10-16T12:00:00.000Z',
      date: Date.parse('2026-10-16T12:30:00.000Z'),
      closedAt: '2026-10-16T12:30:00.000Z',
      grossProfit: 12.5,
      commissions: 2.4,
      feesAndCommissions: 2.4,
      totalCommissions: 2.4,
      marginInterest: 0.5,
      netProfit: 9.6,
      netRealizedGain: 9.6,
      holdingDays: 2
    });
  });

  it('preserves invalid-date holding-day behavior in the closed-trade record', () => {
    const record = createClosedTradeRecord({
      id: 'AAPL-invalid-date',
      ticker: 'AAPL',
      shares: 1,
      soldCostBasis: 100,
      sellPrice: 110,
      buyDate: 'not-a-date',
      sellDate: '2026-10-16',
      closedTimestamp: 0,
      grossProfit: 10,
      commissions: 0,
      marginInterest: 0,
      netProfit: 10
    });

    expect(Number.isNaN(record.holdingDays)).toBe(true);
    expect(record.closedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('resolves requested close timestamps before exit-date and fallback timestamps', () => {
    expect(resolveClosedTradeTimestamp(1_234, 5_678, 9_012)).toBe(1_234);
    expect(resolveClosedTradeTimestamp(0, 5_678, 9_012)).toBe(5_678);
    expect(resolveClosedTradeTimestamp(Number.NaN, Number.NaN, 9_012)).toBe(9_012);
    expect(resolveClosedTradeTimestamp(-1, 0, 9_012)).toBe(0);
  });

  it('clamps invalid negative debt, cash, and proceeds to zero', () => {
    expect(settleSaleProceeds(-10, -5, -1)).toEqual({
      remainingDebt: 0,
      freeCash: 0,
      debtRepaid: 0,
      cashSurplus: 0
    });
  });

  it('rejects non-finite sale commission inputs and invalid broker fee assumptions', () => {
    expect(() => calculateSaleCommission(Number.NaN, 1_000, brokerRules))
      .toThrow('Sale quantity must be finite');
    expect(() => calculateSaleCommission(10, Number.POSITIVE_INFINITY, brokerRules))
      .toThrow('Sale proceeds must be finite');
    expect(() => calculateSaleCommission(10, 1_000, {
      ...brokerRules,
      commissionMin: Number.POSITIVE_INFINITY
    })).toThrow('Commission configuration must contain finite, non-negative rates and minimums.');

    // A non-positive finite quantity remains a no-op for legacy callers.
    expect(calculateSaleCommission(0, Number.NaN, brokerRules)).toBe(0);
  });

  it('rejects sale accounting when the sold quantity exceeds the open position', () => {
    const position: PositionRecord = {
      ticker: 'AAPL',
      shares: 10,
      currentPrice: 100,
      pt: 110,
      commBuy: 2,
      tranches: [{ qty: 10, price: 100, date: '2026-10-15' }]
    };

    expect(() => calculateSaleAccounting({
      tranches: position.tranches || [],
      positions: { AAPL: position },
      positionShares: 10,
      sharesSold: 10 + 1e-4,
      balance: -1_000,
      brokerAssumptions: { annualBorrowRate: 0.15, dayCountBasis: 365 },
      sellProceeds: 1_100,
      soldCostBasis: 1_000,
      buyCommissionAllocated: 1,
      sellCommission: 1
    })).toThrow('Sale quantity cannot exceed the open position');
  });

  it('rejects malformed sale accounting amounts and invalid rollover assumptions', () => {
    const position: PositionRecord = {
      ticker: 'AAPL',
      shares: 10,
      currentPrice: 100,
      pt: 110,
      commBuy: 2,
      tranches: [{ qty: 10, price: 100, date: '2026-10-15' }]
    };
    const validInput = {
      tranches: position.tranches || [],
      positions: { AAPL: position },
      positionShares: 10,
      sharesSold: 5,
      balance: -1_000,
      brokerAssumptions: { annualBorrowRate: 0.15, dayCountBasis: 365 },
      sellProceeds: 550,
      soldCostBasis: 500,
      buyCommissionAllocated: 1,
      sellCommission: 1
    };

    expect(() => calculateSaleAccounting({
      ...validInput,
      sellProceeds: Number.POSITIVE_INFINITY
    })).toThrow('Sale proceeds must be finite');
    expect(() => calculateSaleAccounting({
      ...validInput,
      brokerAssumptions: { annualBorrowRate: 0.15, dayCountBasis: 0 }
    })).toThrow('Day-count basis must be positive');
    expect(() => calculateSaleAccounting({
      ...validInput,
      balance: Number.NaN
    })).toThrow('Signed account balance must be finite');
    expect(() => calculateSaleAccounting({
      ...validInput,
      now: new Date('invalid')
    })).toThrow('Sale accounting clock must be a valid date');
  });

  it('rejects selected-position investment that is absent from the portfolio ledger', () => {
    expect(() => calculateSaleAccounting({
      tranches: [{ qty: 10, price: 100 }],
      positions: {},
      positionShares: 10,
      sharesSold: 5,
      balance: -1_000,
      brokerAssumptions: { annualBorrowRate: 0.15, dayCountBasis: 365 },
      sellProceeds: 550,
      soldCostBasis: 500,
      buyCommissionAllocated: 1,
      sellCommission: 1
    })).toThrow('Selected position investment is missing from the portfolio position ledger');
  });

  it('rejects malformed portfolio investment lots instead of misallocating margin debt', () => {
    const position: PositionRecord = {
      ticker: 'AAPL',
      shares: 10,
      currentPrice: 100,
      pt: 110,
      commBuy: 2,
      tranches: [{ qty: 10, price: 100 }]
    };

    expect(() => calculateSaleAccounting({
      tranches: position.tranches || [],
      positions: {
        AAPL: {
          ...position,
          tranches: [{ qty: Number.POSITIVE_INFINITY, price: 100 }]
        }
      },
      positionShares: 10,
      sharesSold: 5,
      balance: -1_000,
      brokerAssumptions: { annualBorrowRate: 0.15, dayCountBasis: 365 },
      sellProceeds: 550,
      soldCostBasis: 500,
      buyCommissionAllocated: 1,
      sellCommission: 1
    })).toThrow('quantity must be finite and non-negative');
  });

  it('rejects non-finite settlement inputs without changing legacy negative-value clamping', () => {
    expect(() => settleSaleProceeds(Number.POSITIVE_INFINITY, 0, 100))
      .toThrow('Margin debt must be finite');
    expect(() => settleSaleProceeds(100, 0, Number.NaN))
      .toThrow('Net sale proceeds must be finite');

    expect(settleSaleProceeds(-10, -5, -1)).toEqual({
      remainingDebt: 0,
      freeCash: 0,
      debtRepaid: 0,
      cashSurplus: 0
    });
  });

});
