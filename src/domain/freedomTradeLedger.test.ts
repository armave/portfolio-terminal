import { describe, expect, it } from 'vitest';
import { buildFreedomMarginLedger } from './freedomTradeLedger';
import type { FreedomExecutedTrade } from '../services/api';

function trade(overrides: Partial<FreedomExecutedTrade> & Pick<FreedomExecutedTrade, 'id' | 'side' | 'quantity' | 'price' | 'marginClassification'>): FreedomExecutedTrade {
  return {
    ticker: 'AAPL.US',
    currency: 'USD',
    executedAt: null,
    tradeValue: null,
    profit: null,
    marginInitialRequirement: overrides.marginClassification === 'margin' ? 100 : 0,
    marginFee: null,
    commission: 0,
    commissionCurrency: 'USD',
    raw: {},
    ...overrides
  };
}

describe('buildFreedomMarginLedger', () => {
  it('uses broker fills and removes a fully sold margin stock', () => {
    const result = buildFreedomMarginLedger([
      trade({ id: '1', side: 'BUY', quantity: 10, price: 100, marginClassification: 'margin' }),
      trade({ id: '2', side: 'SELL', quantity: 4, price: 120, marginClassification: 'margin' }),
      trade({ id: '3', side: 'SELL', quantity: 6, price: 130, marginClassification: 'margin' })
    ]);

    expect(result.reliable).toBe(true);
    expect(result.positions).toEqual({});
  });

  it('rebuilds the remaining quantity and weighted average fill cost', () => {
    const result = buildFreedomMarginLedger([
      trade({ id: '1', side: 'BUY', quantity: 10, price: 100, marginClassification: 'margin' }),
      trade({ id: '2', side: 'BUY', quantity: 10, price: 120, marginClassification: 'margin' }),
      trade({ id: '3', side: 'SELL', quantity: 5, price: 130, marginClassification: 'margin' })
    ]);

    expect(result.reliable).toBe(true);
    expect(result.positions.AAPL).toMatchObject({ ticker: 'AAPL', shares: 15, currentPrice: 110, pt: 0 });
  });

  it('keeps unclassified buys out of the margin ledger without blocking transferred shares', () => {
    const result = buildFreedomMarginLedger([
      trade({ id: '1', side: 'BUY', quantity: 10, price: 100, marginClassification: 'unknown', marginInitialRequirement: null })
    ], { AAPL: { ticker: 'AAPL', shares: 10, currentPrice: 101, pt: 120, commBuy: 0 } });

    expect(result.reliable).toBe(true);
    expect(result.positions).toEqual({});
  });

  it('fails closed when a sell exceeds known margin shares', () => {
    const result = buildFreedomMarginLedger([
      trade({ id: '1', side: 'SELL', quantity: 1, price: 100, marginClassification: 'margin' })
    ]);

    expect(result.reliable).toBe(false);
    expect(result.reason).toContain('exceeds known active margin shares');
  });

  it('preserves cash-transferred tranches across rebuilds and subtracts only later sells', () => {
    const current = {
      AAPL: {
        ticker: 'AAPL', shares: 10, currentPrice: 100, pt: 0, commBuy: 0,
        tranches: [{
          qty: 6, transferQty: 10, price: 100, date: '2026-10-01',
          classificationTransfer: true, afterTradeId: '100'
        }]
      }
    };
    const trades = [
      trade({ id: '90', side: 'SELL', quantity: 4, price: 110, marginClassification: 'unknown', executedAt: '2026-09-30T10:00:00' }),
      trade({ id: '101', side: 'SELL', quantity: 3, price: 110, marginClassification: 'unknown', executedAt: '2026-10-02T10:00:00' })
    ];
    const result = buildFreedomMarginLedger(trades, current);
    expect(result.reliable).toBe(true);
    expect(result.positions.AAPL.shares).toBe(7);
    expect(result.positions.AAPL.tranches).toEqual([
      expect.objectContaining({ classificationTransfer: true, transferQty: 10, qty: 7 })
    ]);
  });

  it('removes transferred shares after a full broker sale', () => {
    const result = buildFreedomMarginLedger([
      trade({ id: '101', side: 'SELL', quantity: 10, price: 110, marginClassification: 'unknown' })
    ], {
      AAPL: {
        ticker: 'AAPL', shares: 10, currentPrice: 100, pt: 0, commBuy: 0,
        tranches: [{ qty: 10, transferQty: 10, price: 100, classificationTransfer: true, afterTradeId: '100' }]
      }
    });
    expect(result.reliable).toBe(true);
    expect(result.positions).toEqual({});
  });

  it('does not treat an empty history response as proof all margin positions were sold', () => {
    const result = buildFreedomMarginLedger([], {
      AAPL: { ticker: 'AAPL', shares: 10, currentPrice: 100, pt: 0, commBuy: 0 }
    });
    expect(result.reliable).toBe(false);
    expect(result.reason).toContain('no executions');
  });

  it('does not count cash executions as margin positions', () => {
    const result = buildFreedomMarginLedger([
      trade({ id: '1', side: 'BUY', quantity: 10, price: 100, marginClassification: 'cash' })
    ]);

    expect(result.reliable).toBe(true);
    expect(result.positions).toEqual({});
  });
});
