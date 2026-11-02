import { describe, expect, it } from 'vitest';
import { applyActiveLimitSellTargets, classifyFreedomPortfolio, getActiveBrokerTranches, getActiveLimitSellTargets, getActiveTranchesFromTrades, normalizeActiveTrancheMix, reconcileFreedomPortfolio, resolveActiveTrancheMixInput } from './freedomPortfolio';

describe('resolveActiveTrancheMixInput', () => {
  it('keeps the previous split when an input is cleared or invalid', () => {
    expect(resolveActiveTrancheMixInput('', 10, 4)).toBe(4);
    expect(resolveActiveTrancheMixInput('   ', 10, 4)).toBe(4);
    expect(resolveActiveTrancheMixInput('not-a-number', 10, 4)).toBe(4);
    expect(resolveActiveTrancheMixInput(undefined, 10, 4)).toBe(4);
  });

  it('clamps valid values to the total quantity', () => {
    expect(resolveActiveTrancheMixInput('3.5', 10, 4)).toBe(3.5);
    expect(resolveActiveTrancheMixInput('-2', 10, 4)).toBe(0);
    expect(resolveActiveTrancheMixInput('12', 10, 4)).toBe(10);
  });

  it('returns zero for invalid total quantities and clamps the fallback', () => {
    expect(resolveActiveTrancheMixInput('5', 0, 4)).toBe(0);
    expect(resolveActiveTrancheMixInput('', 10, 12)).toBe(10);
    expect(resolveActiveTrancheMixInput('', 10, -2)).toBe(0);
  });
});

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

  it('uses the stored cash price when current quotes are zero or invalid for a new margin position', () => {
    const result = classifyFreedomPortfolio({
      loaded: true,
      balances: [],
      positions: [{ ticker: 'AAPL.US', quantity: 5, marketPrice: null }]
    }, {}, [
      { ticker: 'AAPL', shares: 2, currentPrice: 0, price: 150 }
    ], { AAPL: 'margin' });

    expect(result.positions.AAPL.currentPrice).toBe(150);
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

  it('can preserve individual same-price FIFO lots instead of grouping nearby buys', () => {
    const trades = [
      { id: 'buy-5', ticker: 'GOOGL.US', side: 'BUY', quantity: 5, price: 282, executedAt: '2026-10-29T09:00:00Z' },
      { id: 'buy-14', ticker: 'GOOGL.US', side: 'BUY', quantity: 14, price: 282, executedAt: '2026-10-29T09:04:00Z' }
    ];

    const grouped = getActiveTranchesFromTrades(trades);
    const individual = getActiveTranchesFromTrades(trades, undefined, undefined, false);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ quantity: 19, averagePrice: 282 });
    expect(individual).toHaveLength(2);
    expect(individual.map((lot) => lot.quantity)).toEqual([14, 5]);
    expect(individual.map((lot) => lot.averagePrice)).toEqual([282, 282]);
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
    expect(result[0]).toMatchObject({ ticker: 'AAPL', quantity: 4, averagePrice: 120, purchasedAt: Date.parse('2026-01-01T10:10:00Z') });
    expect(result[1]).toMatchObject({ ticker: 'AAPL', quantity: 4, averagePrice: 102.5, purchasedAt: Date.parse('2026-01-01T10:00:00Z'), marketPrice: 110 });
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

  it('splits one active purchase operation between cash holdings and margin lots', () => {
    const trades = [
      { id: 'mixed-buy', ticker: 'AAPL.US', side: 'BUY', quantity: 10, price: 100, buyCommission: 5, executedAt: '2026-01-01T10:00:00Z' }
    ];
    const snapshot = {
      loaded: true,
      balances: [],
      positions: [{ ticker: 'AAPL.US', quantity: 10, marketPrice: 120 }]
    };
    const tranche = getActiveTranchesFromTrades(trades, snapshot)[0];
    const result = classifyFreedomPortfolio(
      snapshot, {}, [],
      { [tranche.id]: 'mix' },
      123,
      trades,
      undefined,
      { [tranche.id]: { cash: 4, margin: 6 } }
    );

    expect(result.cashStocks).toEqual([
      expect.objectContaining({ ticker: 'AAPL', shares: 4, currentPrice: 120 })
    ]);
    expect(result.positions.AAPL).toMatchObject({
      ticker: 'AAPL',
      shares: 6,
      commBuy: 3,
      tranches: [{ qty: 6, price: 100, buyCommission: 3 }]
    });
  });

  it('rescales a saved Mix split when the open quantity changes after a sale', () => {
    expect(normalizeActiveTrancheMix(8, { cash: 4, margin: 6 })).toEqual({
      cash: 3.2,
      margin: 4.8
    });
  });
  it('calculates margin commissions from executed buy operations, not legacy in-app trades', () => {
    const trades = [
      { id: 'buy-1', ticker: 'AAPL.US', side: 'BUY', quantity: 1, price: 100, executedAt: '2026-01-01T10:00:00Z' },
      { id: 'buy-2', ticker: 'AAPL.US', side: 'BUY', quantity: 1, price: 100, executedAt: '2026-01-01T10:04:00Z' }
    ];
    const result = classifyFreedomPortfolio({
      loaded: true,
      balances: [],
      positions: [{ ticker: 'AAPL.US', quantity: 2, marketPrice: 120 }]
    }, {
      AAPL: {
        ticker: 'AAPL',
        shares: 50,
        currentPrice: 80,
        pt: 150,
        commBuy: 99,
        tranches: [{ qty: 50, price: 5, buyCommission: 77 }]
      }
    }, [], { AAPL: 'margin' }, 123, trades, {
      commPerShare: 0.012,
      commVolumePct: 0.0012,
      minCommOrder: 1.2
    });

    expect(result.positions.AAPL).toMatchObject({
      shares: 2,
      pt: 150,
      commBuy: 2.4,
      tranches: [{ qty: 2, price: 100, buyCommission: 2.4 }]
    });
  });

  it('assigns a 5% default target to newly classified margin positions without a target', () => {
    const result = classifyFreedomPortfolio({
      loaded: true,
      balances: [],
      positions: [{ ticker: 'AAPL', quantity: 2, marketPrice: 120 }]
    }, {}, [], { AAPL: 'margin' }, 123, [
      { id: 'buy-1', ticker: 'AAPL', side: 'BUY', quantity: 2, price: 100, executedAt: '2026-01-01T10:00:00Z' }
    ]);

    expect(result.positions.AAPL).toMatchObject({
      shares: 2,
      pt: 105,
      tranches: [{ qty: 2, price: 100 }]
    });
  });

  it('recovers quantities from legacy persisted raw TradeNet rows', () => {
    const trades = [
      {
        id: 'legacy-buy-1',
        ticker: '',
        side: 'Unknown',
        quantity: null,
        price: null,
        executedAt: null,
        raw: {
          instr_nm: 'GOOGL.US',
          operation: 'unrecognized',
          type: '1',
          q: '0',
          quantity: '5',
          p: '0',
          price: '282',
          date: '2026-10-29T09:00:00'
        }
      },
      {
        id: 'legacy-buy-2',
        ticker: 'GOOGL.US',
        side: 'BUY',
        quantity: null,
        price: null,
        executedAt: null,
        raw: {
          q: '14',
          p: '282',
          date: '2026-10-29T09:10:00'
        }
      }
    ];

    const lots = getActiveTranchesFromTrades(trades);

    expect(lots.map((lot) => ({
      ticker: lot.ticker,
      quantity: lot.quantity,
      averagePrice: lot.averagePrice
    }))).toEqual([
      { ticker: 'GOOGL', quantity: 14, averagePrice: 282 },
      { ticker: 'GOOGL', quantity: 5, averagePrice: 282 }
    ]);
  });

  it('uses broker-reported buy commission when available', () => {
    const result = getActiveTranchesFromTrades([
      { id: 'buy-1', ticker: 'MSFT', side: 'BUY', quantity: 3, price: 100, commission: 0.85, executedAt: '2026-01-01T10:00:00Z' }
    ], undefined, {
      commPerShare: 0.012,
      commVolumePct: 0.0012,
      minCommOrder: 1.2
    });
    expect(result[0]).toMatchObject({ quantity: 3, buyCommission: 0.85 });
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


describe('active limit sell target synchronization', () => {
  it('uses Freedom TradeNet type 4 order at $353 for all 50 GOOGL shares', () => {
    const targets = getActiveLimitSellTargets([
      {
        ticker: 'GOOGL.US',
        operation: 3,
        orderType: 4,
        limitPrice: 353,
        remainingQuantity: 50
      }
    ]);
    const positions = {
      GOOGL: { ticker: 'GOOGL', shares: 50, currentPrice: 350, pt: 354.58, commBuy: 0 }
    };

    expect(targets).toEqual({ GOOGL: 353 });
    expect(applyActiveLimitSellTargets(positions, targets).GOOGL.pt).toBe(353);
  });

  it('uses the exact $353 broker limit for one sell order covering all 50 shares across three margin buys', () => {
    const targets = getActiveLimitSellTargets([
      { ticker: 'AAPL.US', operation: 3, orderType: 2, limitPrice: 353, remainingQuantity: 50 }
    ]);
    const refreshed = {
      AAPL: {
        ticker: 'AAPL',
        shares: 50,
        currentPrice: 350,
        pt: 354.58,
        commBuy: 3.4,
        tranches: [
          { qty: 20, price: 340 },
          { qty: 15, price: 345 },
          { qty: 15, price: 350 }
        ]
      }
    };

    expect(targets).toEqual({ AAPL: 353 });
    expect(applyActiveLimitSellTargets(refreshed, targets).AAPL.pt).toBe(353);
  });

  it('selects one active order instead of quantity-weighting different limit prices', () => {
    const targets = getActiveLimitSellTargets([
      { ticker: 'AAPL', operation: 3, orderType: 2, limitPrice: 300, remainingQuantity: 20, date: '2026-10-01T10:00:00Z' },
      { ticker: 'AAPL.US', operation: 3, orderType: 2, limitPrice: 320, remainingQuantity: 15, date: '2026-10-02T10:00:00Z' },
      { ticker: 'AAPL', operation: 3, orderType: 2, limitPrice: 340, remainingQuantity: 10, date: '2026-10-03T10:00:00Z' }
    ], { AAPL: 30 });

    // With no single order covering the full position, use the largest live order.
    expect(targets).toEqual({ AAPL: 300 });
  });

  it('uses the live order price even when its remaining quantity does not cover the tracked position', () => {
    expect(getActiveLimitSellTargets([
      { ticker: 'AAPL', operation: 3, orderType: 2, limitPrice: 320, remainingQuantity: 10, date: '2026-10-02T10:00:00Z' }
    ], { AAPL: 20 })).toEqual({ AAPL: 320 });
  });

  it('does not guess between different prices without a known margin quantity', () => {
    expect(getActiveLimitSellTargets([
      { ticker: 'AAPL', operation: 3, orderType: 2, limitPrice: 353, remainingQuantity: 25 },
      { ticker: 'AAPL.US', operation: 3, orderType: 2, limitPrice: 354, remainingQuantity: 25 }
    ])).toEqual({});
  });

  it('does not guess when different active limit-sell prices exist for the same ticker', () => {
    expect(getActiveLimitSellTargets([
      { ticker: 'AAPL.US', operation: 3, orderType: 2, limitPrice: 353, remainingQuantity: 25 },
      { ticker: 'AAPL', operation: 3, orderType: 2, limitPrice: 354, remainingQuantity: 25 }
    ])).toEqual({});
  });

  it('prefers an exact-quantity live order price over blending other live order rows', () => {
    const targets = getActiveLimitSellTargets([
      { ticker: 'GOOGL.US', operation: 3, orderType: 4, limitPrice: 353, remainingQuantity: 50, status: '16' },
      { ticker: 'GOOGL.US', operation: 3, orderType: 4, limitPrice: 333, remainingQuantity: 70, status: '16' }
    ], { GOOGL: 70 });

    expect(targets).toEqual({ GOOGL: 333 });
  });

  it('selects the 70-share GOOGL order at $333 with TradeNet status 10 over historical rows', () => {
    const targets = getActiveLimitSellTargets([
      { ticker: 'GOOGL.US', operation: 3, orderType: 4, limitPrice: 353, remainingQuantity: 50, status: '31' },
      { ticker: 'GOOGL.US', operation: 1, orderType: 2, limitPrice: 285, remainingQuantity: 20, status: '31' },
      { ticker: 'GOOGL.US', operation: 1, orderType: 2, limitPrice: 282, remainingQuantity: 0, status: '21' },
      { ticker: 'GOOGL.US', operation: 3, orderType: 4, limitPrice: 333, remainingQuantity: 70, status: '10' }
    ], { GOOGL: 70 });

    expect(targets).toEqual({ GOOGL: 333 });
  });

  it('ignores non-sell, non-limit, and fully filled orders', () => {
    expect(getActiveLimitSellTargets([
      { ticker: 'AAPL', operation: 1, orderType: 2, limitPrice: 353, remainingQuantity: 50 },
      { ticker: 'AAPL', operation: 3, orderType: 1, limitPrice: 353, remainingQuantity: 50 },
      { ticker: 'AAPL', operation: 3, orderType: 2, limitPrice: 353, remainingQuantity: 0 }
    ])).toEqual({});
  });
});


describe('cash holdings average purchase price', () => {
  it('weights open cash lots by their allocated quantity and excludes margin shares', () => {
    const trades = [
      { id: 'buy-cash', ticker: 'AAPL.US', side: 'BUY', quantity: 4, price: 100, executedAt: '2026-01-01T10:00:00Z' },
      { id: 'buy-mix', ticker: 'AAPL.US', side: 'BUY', quantity: 6, price: 120, executedAt: '2026-01-01T10:10:00Z' }
    ];
    const snapshot = {
      loaded: true,
      balances: [],
      positions: [{ ticker: 'AAPL.US', quantity: 10, marketPrice: 130 }]
    };
    const mixedTranche = getActiveTranchesFromTrades(trades, snapshot)
      .find((tranche) => tranche.purchasedAt === Date.parse('2026-01-01T10:10:00Z'));
    expect(mixedTranche).toBeDefined();

    const result = classifyFreedomPortfolio(
      snapshot,
      {},
      [],
      { [mixedTranche!.id]: 'mix' },
      123,
      trades,
      undefined,
      { [mixedTranche!.id]: { cash: 3, margin: 3 } }
    );

    expect(result.cashStocks).toHaveLength(1);
    expect(result.cashStocks[0]).toMatchObject({
      ticker: 'AAPL',
      shares: 7,
      currentPrice: 130
    });
    expect(result.cashStocks[0].averagePrice).toBeCloseTo(760 / 7, 8);
  });

  it('does not fabricate an average when an open cash lot has no purchase price', () => {
    const trades = [
      { id: 'buy-priced', ticker: 'MSFT', side: 'BUY', quantity: 2, price: 100, executedAt: '2026-01-01T10:00:00Z' },
      { id: 'buy-unpriced', ticker: 'MSFT', side: 'BUY', quantity: 3, executedAt: '2026-01-01T10:10:00Z' }
    ];
    const snapshot = {
      loaded: true,
      balances: [],
      positions: [{ ticker: 'MSFT', quantity: 5, marketPrice: 110 }]
    };

    const result = classifyFreedomPortfolio(snapshot, {}, [], {}, 123, trades);

    expect(result.cashStocks[0].shares).toBe(5);
    expect(result.cashStocks[0].averagePrice).toBeNull();
  });
});
