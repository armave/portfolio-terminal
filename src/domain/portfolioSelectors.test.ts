import { describe, expect, it } from 'vitest';
import { getCashCushionTotal, getTotalPortfolioInvested } from './portfolioSelectors';
import type { BoardState } from '../types/portfolio';

describe('portfolio selectors', () => {
  it('returns zero for missing portfolio state', () => {
    expect(getTotalPortfolioInvested()).toBe(0);
    expect(getTotalPortfolioInvested(null)).toBe(0);
    expect(getCashCushionTotal()).toBe(0);
    expect(getCashCushionTotal(null)).toBe(0);
  });

  it('sums the cost basis of all open position tranches', () => {
    const state = {
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 5,
          currentPrice: 120,
          pt: 130,
          commBuy: 0,
          tranches: [
            { qty: 2, price: 100 },
            { qty: 3, price: 110 }
          ]
        },
        MSFT: {
          ticker: 'MSFT',
          shares: 1,
          currentPrice: 200,
          pt: 220,
          commBuy: 0,
          tranches: [{ qty: 1, price: 200 }]
        }
      }
    } as unknown as BoardState;

    expect(getTotalPortfolioInvested(state)).toBe(730);
  });

  it('uses current quote before fallback price for cash holdings', () => {
    const state = {
      cashCushion: {
        freeCash: '2500',
        holdings: [
          { ticker: 'MSFT', shares: 10, price: 400, currentPrice: 420 },
          { ticker: 'AAPL', shares: '2', price: '150' },
          { ticker: 'TSLA', shares: 3, price: 100, currentPrice: 'invalid' }
        ]
      }
    } as unknown as BoardState;

    expect(getCashCushionTotal(state)).toBe(2500 + 4200 + 300 + 0);
  });
});
