import { describe, expect, it } from 'vitest';
import { calculatePortfolioValuation } from './portfolioValuation';

describe('calculatePortfolioValuation', () => {
  it('calculates cash and total equity separately using current extended-hours prices', () => {
    const result = calculatePortfolioValuation({
      signedAccountBalance: -1200,
      freeCash: 250,
      marginPositions: [{ shares: 10, currentPrice: 105 }],
      cashHoldings: [{ shares: 2, currentPrice: 55, price: 50 }]
    });

    expect(result).toEqual({
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

    expect(result.cashBalance).toBe(0);
    expect(result.marginDebt).toBe(0);
    expect(result.equity).toBe(0);
    expect(result.unpricedHoldings).toBe(1);
  });
});
