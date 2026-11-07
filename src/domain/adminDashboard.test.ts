import { describe, expect, it } from 'vitest';
import type { PortfolioState } from '../types/portfolio';
import { buildAdminDashboardSummary } from './adminDashboard';

function makeState(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    positions: {
      AAPL: {
        ticker: 'AAPL', shares: 2, currentPrice: 120, pt: 130, commBuy: 0,
        tranches: [{ qty: 2, price: 100 }]
      }
    },
    cashCushion: {
      freeCash: 50,
      holdings: [{ ticker: 'MSFT', shares: 1, averagePrice: 80, currentPrice: 90, price: 90 }]
    },
    brokerAssumptions: {
      broker: 'test', annualBorrowRate: 0.15, dayCountBasis: 365,
      rolloverHour: 0, rolloverMinute: 0, rolloverTimeZone: 'UTC',
      maintenanceEquityRatio: 0.25, stopOutRatio: 0.1,
      commissionMin: 0, commissionPerShare: 0, commissionRatePct: 0
    },
    brokerAccountInfo: {
      loaded: false, balances: [], positions: [], receivedAt: 0
    },
    cashBalance: 0, holdings: [], apiKeys: {}, activeView: 'COMBINED', closedTrades: [],
    balance: -100, realizedMarginCharged: 0,
    ...overrides
  } as PortfolioState;
}

describe('admin dashboard summary', () => {
  it('uses the shared portfolio valuation and separates free cash from market value', () => {
    const summary = buildAdminDashboardSummary(makeState(), 1000, 60000);
    expect(summary.marketValue).toBe(330);
    expect(summary.marginDebt).toBe(100);
    expect(summary.freeCash).toBe(50);
    expect(summary.equity).toBe(280);
    expect(summary.dailyMarginCost).toBeCloseTo(100 * 0.15 / 365);
    expect(summary.investedCostBasis).toBe(200);
    expect(summary.unrealizedPnl).toBe(40);
    expect(summary.unrealizedPnlPercent).toBe(20);
    expect(summary.marginMarketValue).toBe(240);
  });

  it('keeps account equity incomplete but calculates margin-only P/L when a cash holding is unpriced', () => {
    const state = makeState({
      cashCushion: { freeCash: 50, holdings: [
        { ticker: 'MSFT', shares: 1, averagePrice: 80, currentPrice: 0, price: 0 }
      ] }
    });
    const summary = buildAdminDashboardSummary(state, 1000, 60000);
    expect(summary.status).toBe('incomplete');
    expect(summary.equity).toBeNull();
    expect(summary.unrealizedPnl).toBe(40);
    expect(summary.unrealizedPnlPercent).toBe(20);
    expect(summary.unpricedHoldings).toBe(1);
    expect(summary.marginRisk).toBeNull();
  });

  it('withholds margin unrealized P/L when a margin position has no usable quote', () => {
    const state = makeState({
      positions: {
        AAPL: { ticker: 'AAPL', shares: 2, currentPrice: 0, pt: 130, commBuy: 0, tranches: [{ qty: 2, price: 100 }] }
      }
    });
    const summary = buildAdminDashboardSummary(state, 1000, 60000);
    expect(summary.marginMarketValue).toBe(0);
    expect(summary.marginUnpricedPositions).toBe(1);
    expect(summary.investedCostBasis).toBe(200);
    expect(summary.unrealizedPnl).toBeNull();
  });

  it('withholds unrealized P/L when cost basis does not cover all open shares', () => {
    const state = makeState({
      positions: {
        AAPL: { ticker: 'AAPL', shares: 3, currentPrice: 120, pt: 130, commBuy: 0, tranches: [{ qty: 2, price: 100 }] }
      }
    });
    const summary = buildAdminDashboardSummary(state, 1000, 60000);
    expect(summary.investedCostBasis).toBeNull();
    expect(summary.unrealizedPnl).toBeNull();
  });
});
