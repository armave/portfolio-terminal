import { describe, expect, it } from 'vitest';
import {
  getCashCushionTotal,
  getTotalPortfolioInvested,
  getPortfolioProjectionInputs,
  getMarketInsightsTicker,
  resolvePositionEntryDate
} from './portfolioSelectors';
import type { BoardState } from '../types/portfolio';



describe('market insights ticker selector', () => {
  it('resolves the first tracked position when the Margin desk is in combined view', () => {
    const state = {
      activeView: 'COMBINED',
      positions: {
        AAPL: { ticker: 'AAPL' },
        MSFT: { ticker: 'MSFT' }
      }
    } as unknown as BoardState;

    expect(getMarketInsightsTicker(state)).toBe('AAPL');
  });

  it('resolves the active ticker when a single Margin position is selected', () => {
    const state = {
      activeView: 'MSFT',
      positions: {
        AAPL: { ticker: 'AAPL' },
        MSFT: { ticker: 'MSFT' }
      }
    } as unknown as BoardState;

    expect(getMarketInsightsTicker(state)).toBe('MSFT');
  });
});

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


describe('portfolio projection selectors', () => {
  const rules = {
    annualRate: 0,
    dayCountBasis: 365,
    maintenanceMarginRatio: 0.1,
    stopOutRatio: 0,
    commPerShare: 0,
    commVolumePct: 0,
    minCommOrder: 0
  };

  it('derives a single-position projection from the active position and allocated debt', () => {
    const state = {
      activeView: 'AAPL',
      balance: -100,
      realizedMarginCharged: 7,
      startDate: '2026-10-01',
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 12,
          pt: 15,
          commBuy: 2,
          startDate: '2026-10-01',
          tranches: [{ qty: 10, price: 10, date: '2026-10-01' }]
        }
      }
    } as unknown as BoardState;

    expect(getPortfolioProjectionInputs(state, rules)).toEqual({
      gross: 50,
      totalComms: 2,
      debtToUse: 100,
      marginChargedToUse: 0,
      entryDate: '2026-10-01',
      dailyRate: 0
    });
  });

  it('derives combined projections with aggregate target, commissions, debt and earliest entry date', () => {
    const state = {
      activeView: 'COMBINED',
      balance: -300,
      realizedMarginCharged: 4,
      startDate: '2026-10-15',
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 12,
          pt: 15,
          commBuy: 2,
          tranches: [{ qty: 10, price: 10, date: '2026-10-05' }]
        },
        MSFT: {
          ticker: 'MSFT',
          shares: 10,
          currentPrice: 21,
          pt: 22,
          commBuy: 3,
          tranches: [{ qty: 10, price: 20, date: '2026-10-01' }]
        }
      }
    } as unknown as BoardState;

    expect(getPortfolioProjectionInputs(state, rules)).toEqual({
      gross: 70,
      totalComms: 5,
      debtToUse: 300,
      marginChargedToUse: 4,
      entryDate: '2026-10-01',
      dailyRate: 0
    });
  });

  it('preserves the earliest-date and legacy tranche date rules in the domain selector', () => {
    expect(resolvePositionEntryDate([
      { date: '22 Oct' },
      { date: '2026-10-20' },
      { acquiredAt: Date.parse('2026-10-19T12:00:00Z') }
    ], '2026-10-28', new Date('2026-10-30T12:00:00Z'))).toBe('2026-10-19');
  });
});
