import { describe, expect, it } from 'vitest';
import { classifyFreedomPortfolio, getActiveBrokerTranches, getActiveTranchesFromTrades, reconcileFreedomPortfolio } from './freedomPortfolio';

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


describe('active broker tranches', () => {
  const snapshot = {
    loaded: true,
    balances: [],
    positions: [
      { ticker: 'AAPL.US', name: 'Apple', quantity: 3, marketPrice: 210, averagePrice: 180, marketValue: 630 },
      { ticker: 'AAPL', name: 'Apple', quantity: 2, marketPrice: 210, averagePrice: 190, marketValue: 420 },
      { ticker: 'MSFT.US', name: 'Microsoft', quantity: 4, marketPrice: 400, averagePrice: 350, marketValue: 1600 },
      { ticker: 'ZERO.US', name: 'Zero', quantity: 0, marketPrice: 20, averagePrice: 10, marketValue: 0 }
    ]
  };

  it('keeps same-ticker purchase operations separate when the broker provides no timestamps', () => {
    expect(getActiveBrokerTranches(snapshot)).toEqual([
      expect.objectContaining({ ticker: 'AAPL', quantity: 3, averagePrice: 180, marketPrice: 210, marketValue: 630, purchasedAt: null }),
      expect.objectContaining({ ticker: 'AAPL', quantity: 2, averagePrice: 190, marketPrice: 210, marketValue: 420, purchasedAt: null }),
      expect.objectContaining({ ticker: 'MSFT', quantity: 4, averagePrice: 350, marketPrice: 400, marketValue: 1600, purchasedAt: null })
    ]);
  });

  it('groups same-ticker buys within five minutes, leaves later buys separate, and removes sold quantity FIFO', () => {
    const trades = [
      { id: 'b1', ticker: 'AAPL.US', side: 'BUY', quantity: 3, price: 100, executedAt: '2026-01-01T10:00:00Z' },
      { id: 'b2', ticker: 'AAPL.US', side: 'BUY', quantity: 2, price: 105, executedAt: '2026-01-01T10:04:00Z' },
      { id: 'b3', ticker: 'AAPL.US', side: 'BUY', quantity: 4, price: 120, executedAt: '2026-01-01T10:10:00Z' },
      { id: 's1', ticker: 'AAPL.US', side: 'SELL', quantity: 1, price: 115, executedAt: '2026-01-01T10:12:00Z' },
      { id: 'b4', ticker: 'MSFT.US', side: 'BUY', quantity: 1, price: 50, executedAt: '2026-01-01T09:00:00Z' }
    ];
    const snapshot = {
      loaded: true,
      balances: [],
      positions: [
        { ticker: 'AAPL.US', quantity: 8, marketPrice: 110 },
        { ticker: 'MSFT.US', quantity: 1, marketPrice: 55 }
      ]
    };
    const result = getActiveTranchesFromTrades(trades, snapshot);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ ticker: 'AAPL', quantity: 4, averagePrice: 102.5, purchasedAt: Date.parse('2026-01-01T10:00:00Z'), marketPrice: 110 });
    expect(result[1]).toMatchObject({ ticker: 'AAPL', quantity: 4, averagePrice: 120, purchasedAt: Date.parse('2026-01-01T10:10:00Z') });
    expect(result[2]).toMatchObject({ ticker: 'MSFT', quantity: 1 });
  });

  it('defaults unclassified broker tickers to cash and moves selected margin tickers into positions', () => {
    const result = classifyFreedomPortfolio(snapshot, {}, [], { MSFT: 'margin' }, 123);
    expect(result.cashStocks).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 5, currentPrice: 210, price: 210 })
    ]);
    expect(result.positions.MSFT).toMatchObject({
      ticker: 'MSFT', shares: 4, currentPrice: 400,
      tranches: [{ qty: 4, price: 350 }], quoteSource: 'Freedom TradeNet',
      quoteDetails: { price: 400, freshness: 'unknown', receivedAt: 123 }
    });
  });

  it('retains an existing cost basis when the broker omits average price', () => {
    const result = classifyFreedomPortfolio({ loaded: true, balances: [], positions: [
      { ticker: 'NVDA', quantity: 2, marketPrice: 120 }
    ] }, {
      NVDA: { ticker: 'NVDA', shares: 2, currentPrice: 110, pt: 150, commBuy: 2, tranches: [{ qty: 2, price: 95 }] }
    }, [], { NVDA: 'margin' });
    expect(result.positions.NVDA).toMatchObject({ shares: 2, pt: 150, commBuy: 2, tranches: [{ qty: 2, price: 95 }] });
  });
});
