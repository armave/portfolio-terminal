import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BrokerAssumptions, PositionRecord, TrancheItem } from '../types/portfolio';
import { resolveClosedTradeAllocation } from './closedTradeAllocation';
import { getGuestHoldingValuation } from './guestPortfolio';
import { calculateFreedomMarginFeeAllocations } from './freedomMarginFees';
import { processRollovers } from './portfolio';
import {
  allocateFifoSaleTranches,
  calculateSaleAccounting,
  calculateSaleCommission,
  settleSaleProceeds
} from './portfolioTransactions';
import { calculatePortfolioValuation, getPortfolioValuationReliability } from './portfolioValuation';

const brokerAssumptions: BrokerAssumptions = {
  broker: 'PT-01 reference fixture',
  annualBorrowRate: 0,
  dayCountBasis: 365,
  rolloverHour: 4,
  rolloverMinute: 0,
  rolloverTimeZone: 'Asia/Yerevan',
  maintenanceEquityRatio: 0.25,
  stopOutRatio: 0.1,
  commissionMin: 0.5,
  commissionPerShare: 0.01,
  commissionRatePct: 0.001
};

afterEach(() => {
  vi.useRealTimers();
});

describe('PT-01 independent financial reference fixtures', () => {
  it('reconciles cash, margin debt, cash holdings, margin holdings, and equity', () => {
    // Independent arithmetic: cash = 0 + 250; debt = 1,200;
    // holdings = (10 * 105) + (2 * 55) = 1,160; equity = 250 + 1,160 - 1,200 = 210.
    const actual = calculatePortfolioValuation({
      signedAccountBalance: -1_200,
      freeCash: 250,
      marginPositions: [{ shares: 10, currentPrice: 105 }],
      cashHoldings: [{ shares: 2, currentPrice: 55, price: 50 }]
    });

    expect(actual).toEqual({
      accountBalanceAvailable: true,
      cashBalance: 250,
      marginDebt: 1_200,
      marginHoldingsValue: 1_050,
      cashHoldingsValue: 110,
      totalHoldingsValue: 1_160,
      equity: 210,
      pricedHoldings: 2,
      unpricedHoldings: 0
    });
  });

  it('keeps cash and margin quantities separately reconcilable for a mixed-funded position', () => {
    const allocation = resolveClosedTradeAllocation(10, 'margin', [], {
      fundingType: 'mix',
      cashQuantity: 4,
      marginQuantity: 6,
      guestId: 'reference-guest'
    });

    expect(allocation).toEqual({
      fundingType: 'mix',
      cashQuantity: 4,
      marginQuantity: 6,
      guestAllocations: [{ guestId: 'reference-guest', quantity: 4 }]
    });
    expect(allocation.cashQuantity + allocation.marginQuantity).toBe(10);
  });

  it('allocates a partial sale FIFO and preserves the unsold lot cost and fee', () => {
    const tranches: TrancheItem[] = [
      { qty: 5, price: 10, date: '2026-01-01', buyCommission: 1 },
      { qty: 5, price: 20, date: '2026-01-02', buyCommission: 2 }
    ];

    const allocation = allocateFifoSaleTranches(tranches, 6, 10, 3);

    // $50 from the first lot + $20 from the second lot; $1 + 1/5 of $2 in buy fees.
    expect(allocation.soldCostBasis).toBe(70);
    expect(allocation.buyCommissionAllocated).toBe(1.4);
    expect(allocation.remainingTranches).toEqual([
      { qty: 4, price: 20, date: '2026-01-02', buyCommission: 1.6 }
    ]);
    expect(tranches).toEqual([
      { qty: 5, price: 10, date: '2026-01-01', buyCommission: 1 },
      { qty: 5, price: 20, date: '2026-01-02', buyCommission: 2 }
    ]);
  });

  it('matches the independent partial-sale accounting reference', () => {
    const tranches: TrancheItem[] = [
      { qty: 5, price: 10, date: '2026-01-01', buyCommission: 1 },
      { qty: 5, price: 20, date: '2026-01-02', buyCommission: 2 }
    ];
    const position: PositionRecord = {
      ticker: 'PT01',
      shares: 10,
      currentPrice: 25,
      pt: 30,
      commBuy: 3,
      marginCharged: 5,
      tranches
    };
    const fifo = allocateFifoSaleTranches(tranches, 6, 10, 3);
    const sellCommission = calculateSaleCommission(6, 150, brokerAssumptions);

    expect(sellCommission).toBe(0.5);
    const result = calculateSaleAccounting({
      tranches,
      positions: { PT01: position },
      positionShares: 10,
      sharesSold: 6,
      balance: 0,
      brokerAssumptions,
      positionMarginCharged: 5,
      sellProceeds: 150,
      soldCostBasis: fifo.soldCostBasis,
      buyCommissionAllocated: fifo.buyCommissionAllocated,
      sellCommission
    });

    // Gross = 150 - 70; commissions = 1.40 + 0.50;
    // recorded financing floor = 5, sold proportion = 6/10, allocation = 3.
    expect(result).toEqual({
      marginInterestAllocated: 3,
      totalCommissions: 1.9,
      grossProfit: 80,
      netProfit: 75.1,
      netCashProceeds: 149.5
    });
  });

  it('reconciles a full liquidation of the remaining FIFO lot', () => {
    const tranches: TrancheItem[] = [
      { qty: 4, price: 20, date: '2026-01-02', buyCommission: 1.6 }
    ];
    const position: PositionRecord = {
      ticker: 'PT01',
      shares: 4,
      currentPrice: 30,
      pt: 30,
      commBuy: 1.6,
      marginCharged: 2,
      tranches
    };
    const fifo = allocateFifoSaleTranches(tranches, 4, 4, 1.6);
    const sellCommission = calculateSaleCommission(4, 120, brokerAssumptions);
    const result = calculateSaleAccounting({
      tranches,
      positions: { PT01: position },
      positionShares: 4,
      sharesSold: 4,
      balance: 0,
      brokerAssumptions,
      positionMarginCharged: 2,
      sellProceeds: 120,
      soldCostBasis: fifo.soldCostBasis,
      buyCommissionAllocated: fifo.buyCommissionAllocated,
      sellCommission
    });

    expect(fifo.soldCostBasis).toBe(80);
    expect(fifo.buyCommissionAllocated).toBe(1.6);
    expect(fifo.remainingTranches).toEqual([]);
    expect(result).toEqual({
      marginInterestAllocated: 2,
      totalCommissions: 2.1,
      grossProfit: 40,
      netProfit: 35.9,
      netCashProceeds: 119.5
    });
  });

  it('repays margin debt before increasing free cash', () => {
    expect(settleSaleProceeds(80, 5, 100)).toEqual({
      remainingDebt: 0,
      freeCash: 25,
      debtRepaid: 80,
      cashSurplus: 20
    });
  });

  it('allocates USD financing fees only to USD exposure and excludes known EUR rows', () => {
    const fee = (id: string, currency: string) => ({
      id: `freedom-${id}`,
      date: '2026-02-02',
      type: 'Margin Fee',
      amount: -1,
      currency,
      raw: { comment: 'Negative cash balance fee' }
    });
    const executions = [
      { ticker: 'AAPL', side: 'buy', quantity: 1, price: 100, currency: 'USD', executedAt: '2026-02-01T10:00:00Z' },
      { ticker: 'BMW', side: 'buy', quantity: 1, price: 100, currency: 'EUR', executedAt: '2026-02-01T10:00:00Z' },
      { ticker: 'AAPL', side: 'sell', quantity: 1, price: 110, currency: 'USD', executedAt: '2026-02-03T10:00:00Z' },
      { ticker: 'BMW', side: 'sell', quantity: 1, price: 110, currency: 'EUR', executedAt: '2026-02-03T10:00:00Z' }
    ];

    const result = calculateFreedomMarginFeeAllocations([
      fee('usd', 'USD'),
      fee('eur', 'EUR')
    ], executions);

    expect(result.brokerAllocations.get(2)).toEqual({ 'freedom-usd': 1 });
    expect(result.brokerAllocations.has(3)).toBe(false);
    expect(result.matchedFeeRows).toBe(1);
    expect(result.allocatedAmount).toBe(1);
  });

  it('calculates gross cash-holding unrealized P&L and preserves unavailable data', () => {
    // Five shares: market value 60, cost basis 50, gross unrealized gain 10 (20%).
    expect(getGuestHoldingValuation({
      shares: 5,
      currentPrice: 12,
      price: 11,
      averagePrice: 10
    })).toEqual({
      shares: 5,
      currentPrice: 12,
      marketValue: 60,
      averagePrice: 10,
      costBasis: 50,
      unrealizedPnl: 10,
      unrealizedPnlPercent: 20
    });

    // A missing live price may fall back to a valid stored price, but absent
    // both price sources must not be turned into a fabricated zero P&L.
    expect(getGuestHoldingValuation({
      shares: 5,
      currentPrice: null,
      price: 11,
      averagePrice: 10
    })).toMatchObject({ currentPrice: 11, marketValue: 55, unrealizedPnl: 5 });
    expect(getGuestHoldingValuation({
      shares: 5,
      currentPrice: null,
      price: null,
      averagePrice: 10
    })).toMatchObject({ currentPrice: null, marketValue: null, unrealizedPnl: null, unrealizedPnlPercent: null });
  });

  it('keeps current, provisional, and incomplete valuation states distinct', () => {
    const complete = {
      accountBalanceAvailable: true,
      unpricedHoldings: 0,
      staleQuotes: 0,
      delayedQuotes: 0,
      unknownQuotes: 0,
      unavailableQuotes: 0
    };

    expect(getPortfolioValuationReliability(complete)).toBe('current');
    expect(getPortfolioValuationReliability({ ...complete, delayedQuotes: 1 })).toBe('provisional');
    expect(getPortfolioValuationReliability({ ...complete, accountBalanceStale: true })).toBe('provisional');
    expect(getPortfolioValuationReliability({ ...complete, unknownQuotes: 1 })).toBe('provisional');
    expect(getPortfolioValuationReliability({ ...complete, accountBalanceAvailable: false })).toBe('incomplete');
    expect(getPortfolioValuationReliability({ ...complete, unpricedHoldings: 1, staleQuotes: 1 })).toBe('incomplete');
  });

  it('charges one configured 04:00 Asia/Yerevan rollover with per-cycle cent rounding', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T01:00:00.000Z')); // 05:00 in Asia/Yerevan.
    const state = {
      balance: -1_000,
      lastRolloverTimestamp: Date.parse('2026-01-01T00:00:00.000Z'),
      brokerAssumptions: {
        annualRate: 0.365,
        dayCountBasis: 365,
        rolloverHour: 4,
        rolloverMinute: 0
      }
    };

    expect(processRollovers(state)).toBe(true);
    expect(state.balance).toBe(-1_001);
    expect(state.lastRolloverTimestamp).toBe(Date.parse('2026-01-02T00:00:00.000Z'));
  });
});
