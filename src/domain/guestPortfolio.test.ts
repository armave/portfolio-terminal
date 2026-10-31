import { describe, expect, it } from 'vitest';
import type { ActiveBrokerTranche, GuestTrancheLedgerRecord } from '../types/portfolio';
import {
  calculateGuestPersonalEquity,
  filterGuestTrancheLedger,
  getGuestAssignedCashHoldings,
  summarizeGuestTrancheLedger
} from './guestPortfolio';

const tranche = (overrides: Partial<ActiveBrokerTranche>): ActiveBrokerTranche => ({
  id: 'AAPL:buy-1',
  ticker: 'AAPL',
  name: 'Apple',
  quantity: 10,
  marketPrice: 200,
  averagePrice: 150,
  marketValue: 2000,
  purchasedAt: null,
  ...overrides
});

describe('guest assigned cash holdings', () => {
  it('returns only the selected guest cash tranches', () => {
    const holdings = getGuestAssignedCashHoldings({
      guestId: 'guest-1',
      activeTranches: [
        tranche({ id: 'AAPL:buy-1', quantity: 10 }),
        tranche({ id: 'MSFT:buy-2', ticker: 'MSFT', quantity: 5, marketPrice: 400 }),
        tranche({ id: 'GOOGL:buy-3', ticker: 'GOOGL' })
      ],
      assignments: { 'AAPL:buy-1': 'guest-1', 'MSFT:buy-2': 'guest-2' }
    });

    expect(holdings).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 10, averagePrice: 150, currentPrice: 200, marketValue: 2000 })
    ]);
  });

  it('includes only the positive cash quantity of an assigned Mix tranche', () => {
    const holdings = getGuestAssignedCashHoldings({
      guestId: 'guest-1',
      activeTranches: [tranche({ quantity: 10 })],
      assignments: { 'AAPL:buy-1': 'guest-1' },
      types: { 'AAPL:buy-1': 'mix' },
      mixes: { 'AAPL:buy-1': { cash: 3.5, margin: 6.5 } }
    });

    expect(holdings).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 3.5, averagePrice: 150, marketValue: 700 })
    ]);
  });

  it('excludes Margin-only and zero-cash Mix tranches, even if stale assignment data exists', () => {
    const holdings = getGuestAssignedCashHoldings({
      guestId: 'guest-1',
      activeTranches: [
        tranche({ id: 'AAPL:buy-1' }),
        tranche({ id: 'MSFT:buy-2', ticker: 'MSFT' })
      ],
      assignments: { 'AAPL:buy-1': 'guest-1', 'MSFT:buy-2': 'guest-1' },
      types: { 'AAPL:buy-1': 'margin', 'MSFT:buy-2': 'mix' },
      mixes: { 'MSFT:buy-2': { cash: 0, margin: 10 } }
    });

    expect(holdings).toEqual([]);
  });

  it('aggregates multiple assigned lots by ticker with a weighted average entry', () => {
    const holdings = getGuestAssignedCashHoldings({
      guestId: 'guest-1',
      activeTranches: [
        tranche({ id: 'AAPL:buy-1', quantity: 2, averagePrice: 100 }),
        tranche({ id: 'AAPL:buy-2', quantity: 3, averagePrice: 200 })
      ],
      assignments: { 'AAPL:buy-1': 'guest-1', 'AAPL:buy-2': 'guest-1' }
    });

    expect(holdings).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 5, averagePrice: 160, marketValue: 1000 })
    ]);
  });

  it('calculates personal equity using assigned stocks only and skips unpriced holdings', () => {
    expect(calculateGuestPersonalEquity([
      { ticker: 'AAPL', shares: 3, averagePrice: 100, currentPrice: 110, price: 110, marketValue: 330 },
      { ticker: 'MSFT', shares: 2, averagePrice: null, currentPrice: null, price: null, marketValue: null }
    ])).toBe(330);
  });

  it('prefers a refreshed cash-holding quote over the older broker tranche snapshot price', () => {
    const holdings = getGuestAssignedCashHoldings({
      guestId: 'guest-1',
      activeTranches: [tranche({ quantity: 4, marketPrice: 100 })],
      assignments: { 'AAPL:buy-1': 'guest-1' },
      cashHoldings: [{ ticker: 'AAPL', currentPrice: 125, price: 125 }]
    });

    expect(holdings).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 4, currentPrice: 125, marketValue: 500 })
    ]);
    expect(calculateGuestPersonalEquity(holdings)).toBe(500);
  });
});


describe('guest holding valuation', () => {
  it('does not turn a missing market quote into a zero market value or false loss', async () => {
    const { getGuestHoldingValuation } = await import('./guestPortfolio');
    expect(getGuestHoldingValuation({
      shares: 4,
      averagePrice: 150,
      currentPrice: null,
      price: null,
    })).toEqual({
      shares: 4,
      currentPrice: null,
      marketValue: null,
      averagePrice: 150,
      costBasis: 600,
      unrealizedPnl: null,
      unrealizedPnlPercent: null
    });
  });

  it('calculates market value and unrealized P/L when both quotes are available', async () => {
    const { getGuestHoldingValuation } = await import('./guestPortfolio');
    expect(getGuestHoldingValuation({
      shares: 4,
      averagePrice: 150,
      currentPrice: 175,
      price: 175,
    })).toEqual({
      shares: 4,
      currentPrice: 175,
      marketValue: 700,
      averagePrice: 150,
      costBasis: 600,
      unrealizedPnl: 100,
      unrealizedPnlPercent: 100 / 600 * 100
    });
  });
});


describe('guest tranche ledger reports and filtering', () => {
  const records: GuestTrancheLedgerRecord[] = [
    {
      assignmentId: 'assignment-aapl', trancheId: 'AAPL:buy-1', ticker: 'AAPL', name: 'Apple',
      assignedQuantity: 10, openQuantity: 4, averagePrice: 100, purchasedAt: 10,
      operationAt: 40, assignedAt: 100, updatedAt: 300, endedAt: null, status: 'active'
    },
    {
      assignmentId: 'assignment-msft', trancheId: 'MSFT:buy-2', ticker: 'MSFT', name: 'Microsoft',
      assignedQuantity: 2, openQuantity: 0, averagePrice: 50, purchasedAt: 20,
      operationAt: 220, assignedAt: 200, updatedAt: 250, endedAt: 250, status: 'closed'
    },
    {
      assignmentId: 'assignment-goog', trancheId: 'GOOG:buy-3', ticker: 'GOOG', name: 'Alphabet',
      assignedQuantity: 1, openQuantity: 0, averagePrice: 10, purchasedAt: 30,
      operationAt: 330, assignedAt: 300, updatedAt: 350, endedAt: 350, status: 'unassigned'
    }
  ];

  it('filters guest LOTS by ticker, lifecycle state and operation date', () => {
    expect(filterGuestTrancheLedger(records, {
      ticker: 'aap',
      status: 'active',
      operationDateFrom: 35,
      operationDateTo: 45
    })).toEqual([records[0]]);
    expect(filterGuestTrancheLedger(records, {
      operationDateFrom: 210,
      operationDateTo: 230
    })).toEqual([records[1]]);
    expect(filterGuestTrancheLedger(records, {
      operationDateFrom: 5,
      operationDateTo: 15
    })).toEqual([]);
    expect(filterGuestTrancheLedger(records, { status: 'closed' })).toEqual([records[1]]);
    expect(filterGuestTrancheLedger(records, { ticker: 'zzz' })).toEqual([]);
  });

  it('sorts by operation date and falls back to purchase date for older ledger records', () => {
    expect(filterGuestTrancheLedger(records)).toEqual([records[2], records[1], records[0]]);
    const legacyRecord: GuestTrancheLedgerRecord = {
      assignmentId: 'legacy-aapl',
      trancheId: 'AAPL:legacy',
      ticker: 'AAPL',
      name: 'Apple',
      assignedQuantity: 1,
      openQuantity: 1,
      averagePrice: 100,
      purchasedAt: 60,
      assignedAt: 500,
      updatedAt: 600,
      endedAt: null,
      status: 'active'
    };
    expect(filterGuestTrancheLedger([legacyRecord], {
      operationDateFrom: 50,
      operationDateTo: 70
    })).toEqual([legacyRecord]);
  });

  it('summarizes historical assigned capital and current open value without inventing realized P/L', () => {
    const activeTranches = [tranche({
      id: 'AAPL:buy-1', quantity: 4, averagePrice: 100, marketPrice: 130, marketValue: 520
    })];
    expect(summarizeGuestTrancheLedger(records, activeTranches)).toEqual({
      totalAssignments: 3,
      activeAssignments: 1,
      closedAssignments: 1,
      unassignedAssignments: 1,
      totalAssignedCostBasis: 1110,
      openCostBasis: 400,
      currentMarketValue: 520,
      pricedOpenTranches: 1,
      unpricedOpenTranches: 0
    });
  });
});
