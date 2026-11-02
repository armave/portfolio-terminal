import { describe, expect, it } from 'vitest';
import {
  calculatePortfolioValuation,
  getPortfolioValuationReliability,
  getPositiveMarketPrice
} from './portfolioValuation';

describe('getPositiveMarketPrice', () => {
  it('uses the first finite positive price and falls back past zero or invalid values', () => {
    expect(getPositiveMarketPrice(125, 100)).toBe(125);
    expect(getPositiveMarketPrice(0, 100)).toBe(100);
    expect(getPositiveMarketPrice('invalid', '100')).toBe(100);
    expect(getPositiveMarketPrice(null, undefined, 75)).toBe(75);
    expect(getPositiveMarketPrice(-1, Number.NaN, 0)).toBeNull();
  });
});

describe('calculatePortfolioValuation', () => {
  it('calculates cash and total equity separately using current extended-hours prices', () => {
    const result = calculatePortfolioValuation({
      signedAccountBalance: -1200,
      freeCash: 250,
      marginPositions: [{ shares: 10, currentPrice: 105 }],
      cashHoldings: [{ shares: 2, currentPrice: 55, price: 50 }]
    });

    expect(result).toEqual({
      accountBalanceAvailable: true,
      cashBalance: 250,
      marginDebt: 1200,
      marginHoldingsValue: 1050,
      cashHoldingsValue: 110,
      totalHoldingsValue: 1160,
      equity: 210,
      pricedHoldings: 2,
      unpricedHoldings: 0
    });
  });

  it('uses positive account cash and fallback cash-holding prices without treating cash as debt', () => {
    const result = calculatePortfolioValuation({
      signedAccountBalance: 500,
      freeCash: 100,
      marginPositions: [{ shares: 2, currentPrice: 10 }],
      cashHoldings: [{ shares: 3, price: 20 }]
    });

    expect(result.cashBalance).toBe(600);
    expect(result.marginDebt).toBe(0);
    expect(result.equity).toBe(680);
  });

  it('does not invent values for missing or invalid prices and reports unpriced holdings', () => {
    const result = calculatePortfolioValuation({
      signedAccountBalance: -50,
      freeCash: 20,
      marginPositions: [{ shares: 3, currentPrice: Number.NaN }],
      cashHoldings: [{ shares: 2, currentPrice: 0, price: -1 }]
    });

    expect(result.equity).toBe(-30);
    expect(result.pricedHoldings).toBe(0);
    expect(result.unpricedHoldings).toBe(2);
  });

  it('ignores malformed cash and non-positive quantities safely', () => {
    const result = calculatePortfolioValuation({
      signedAccountBalance: Number.NaN,
      freeCash: 'invalid',
      marginPositions: [{ shares: -3, currentPrice: 20 }, { shares: 2, currentPrice: 0 }],
      cashHoldings: []
    });

    expect(result.accountBalanceAvailable).toBe(false);
    expect(result.cashBalance).toBe(0);
    expect(result.marginDebt).toBe(0);
    expect(result.equity).toBe(0);
    expect(result.unpricedHoldings).toBe(1);
  });

  it('marks a missing account balance unavailable while retaining a finite calculation fallback', () => {
    const result = calculatePortfolioValuation({
      signedAccountBalance: undefined,
      freeCash: 100,
      marginPositions: [],
      cashHoldings: []
    });

    expect(result.accountBalanceAvailable).toBe(false);
    expect(result.cashBalance).toBe(100);
    expect(result.equity).toBe(100);
  });
});

describe('getPortfolioValuationReliability', () => {
  const current = {
    accountBalanceAvailable: true,
    unpricedHoldings: 0,
    staleQuotes: 0,
    delayedQuotes: 0,
    unknownQuotes: 0,
    unavailableQuotes: 0
  };

  it('classifies verified current quotes as current', () => {
    expect(getPortfolioValuationReliability(current)).toBe('current');
  });

  it.each([
    ['stale', { staleQuotes: 1 }],
    ['delayed', { delayedQuotes: 1 }],
    ['unknown timestamp', { unknownQuotes: 1 }],
    ['unavailable quote', { unavailableQuotes: 1 }]
  ])('classifies %s observations as provisional', (_label, override) => {
    expect(getPortfolioValuationReliability({ ...current, ...override })).toBe('provisional');
  });

  it('classifies missing balances or unpriced holdings as incomplete', () => {
    expect(getPortfolioValuationReliability({ ...current, accountBalanceAvailable: false })).toBe('incomplete');
    expect(getPortfolioValuationReliability({ ...current, unpricedHoldings: 1, staleQuotes: 1 })).toBe('incomplete');
  });
});
