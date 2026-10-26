import { describe, expect, it } from 'vitest';
import { reconcileFreedomPortfolio } from './freedomPortfolio';

describe('reconcileFreedomPortfolio', () => {
  it('prefers Freedom USD cash and derives cash shares after app margin lots', () => {
    const result = reconcileFreedomPortfolio({
      loaded: true,
      balances: [{ currency: 'USD', amount: -1200 }],
      positions: [
        { ticker: 'AAPL.US', quantity: 15, marketPrice: 200 },
        { ticker: 'MSFT.US', quantity: 4, marketPrice: 400 }
      ]
    }, {
      AAPL: { ticker: 'AAPL', shares: 10, currentPrice: 190, pt: 220, tranches: [{ qty: 10, price: 180 }] }
    }, []);

    expect(result.brokerUsdBalance).toEqual({ amount: -1200 });
    expect(result.cashStocks).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 5, currentPrice: 200 }),
      expect.objectContaining({ ticker: 'MSFT', shares: 4, currentPrice: 400 })
    ]);
    expect(result.positions.AAPL).toMatchObject({
      shares: 10,
      currentPrice: 200,
      pt: 220,
      quoteSource: 'Freedom TradeNet',
      tranches: [{ qty: 10, price: 180 }]
    });
  });

  it('preserves affected local cash quantity when broker and app margin quantities conflict', () => {
    const result = reconcileFreedomPortfolio({
      loaded: true,
      balances: [],
      positions: [{ ticker: 'AAPL.US', quantity: 5, marketPrice: 200 }]
    }, {
      AAPL: { ticker: 'AAPL', shares: 10, currentPrice: 190 }
    }, [{ ticker: 'AAPL', shares: 3, currentPrice: 185 }, { ticker: 'MSFT', shares: 2 }]);

    expect(result.mismatches).toEqual([{ ticker: 'AAPL', marginQuantity: 10, freedomQuantity: 5 }]);
    expect(result.cashStocks).toEqual([{ ticker: 'AAPL', shares: 3, currentPrice: 185 }]);
  });

  it('preserves cash holdings for a margin ticker missing from the broker snapshot', () => {
    const result = reconcileFreedomPortfolio({
      loaded: true,
      balances: [],
      positions: []
    }, {
      AAPL: { ticker: 'AAPL', shares: 10 }
    }, [{ ticker: 'AAPL', shares: 2, currentPrice: 190 }]);

    expect(result.mismatches).toEqual([{ ticker: 'AAPL', marginQuantity: 10, freedomQuantity: 0 }]);
    expect(result.cashStocks).toEqual([{ ticker: 'AAPL', shares: 2, currentPrice: 190 }]);
  });

  it('aggregates duplicate broker instrument rows and rejects invalid prices', () => {
    const result = reconcileFreedomPortfolio({
      loaded: true,
      balances: [{ currency: 'USD', amount: 100 }],
      positions: [
        { ticker: 'GOOGL.US', quantity: 2, marketPrice: 100 },
        { ticker: 'GOOGL', quantity: 3, marketPrice: -1 }
      ]
    }, {}, []);

    expect(result.cashStocks).toEqual([expect.objectContaining({ ticker: 'GOOGL', shares: 5, currentPrice: 100 })]);
  });

  it('does not invent a USD balance when Freedom has no usable USD row', () => {
    const result = reconcileFreedomPortfolio({
      loaded: true,
      balances: [{ currency: 'EUR', amount: 50 }, { currency: 'USD', amount: Number.NaN }],
      positions: []
    }, {}, []);

    expect(result.brokerUsdBalance).toBeUndefined();
  });
});
