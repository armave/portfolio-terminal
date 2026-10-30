import { describe, expect, it } from 'vitest';
import type { ActiveBrokerTranche } from '../types/portfolio';
import { calculateGuestPersonalEquity, getGuestAssignedCashHoldings } from './guestPortfolio';

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
});
