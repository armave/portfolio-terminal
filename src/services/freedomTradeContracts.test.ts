import { describe, expect, it } from 'vitest';
import { normalizeFreedomTrades } from './freedomTradeContracts';

describe('Freedom execution contract normalization', () => {
  it('normalizes the nested TradeNet execution envelope and keeps provider facts', () => {
    const [trade] = normalizeFreedomTrades({
      data: {
        trades: {
          trade: [{
            trade_id: 701,
            instr_nm: 'AAPL.US',
            operation: '1',
            q: 0,
            quantity: '5',
            p: '12.50',
            date: '2026-10-31T10:20:00Z',
            v: '62.50',
            curr_c: 'USD',
            commiss: '0.25',
            profit: '4.50'
          }]
        }
      }
    });

    expect(trade).toMatchObject({
      id: '701',
      ticker: 'AAPL.US',
      side: 'BUY',
      quantity: 5,
      price: 12.5,
      currency: 'USD',
      executedAt: '2026-10-31T10:20:00Z',
      tradeValue: 62.5,
      profit: 4.5,
      commission: 0.25,
      commissionCurrency: 'USD'
    });
    expect(trade.raw).toMatchObject({ trade_id: 701, quantity: '5' });
  });

  it('preserves stable IDs and app-calculated fee metadata when loading saved rows', () => {
    const [trade] = normalizeFreedomTrades([{
      id: 'saved-sell-1',
      ticker: 'AAPL',
      side: 'SELL',
      quantity: 2,
      price: 20,
      executedAt: '2026-10-31T11:00:00Z',
      currency: 'USD',
      commissionCurrency: 'USD',
      marginFeeAllocations: { 'freedom-1': 0.17 },
      feesAndCommissions: 0.42,
      netProfit: 3.58
    }]);

    expect(trade).toMatchObject({
      id: 'saved-sell-1',
      marginFeeAllocations: { 'freedom-1': 0.17 },
      feesAndCommissions: 0.42,
      netProfit: 3.58
    });
  });

  it('produces distinct stable fallback IDs for duplicate executions in one response', () => {
    const row = {
      instr_nm: 'MSFT',
      operation: '2',
      q: '1',
      p: '10',
      date: '2026-10-31T12:00:00Z'
    };
    const trades = normalizeFreedomTrades({ items: [row, row] });
    expect(trades).toHaveLength(2);
    expect(trades[0].id).not.toBe(trades[1].id);
    expect(trades[0].id).toMatch(/^fallback-/);
  });

  it('accepts a successful empty trade collection', () => {
    expect(normalizeFreedomTrades({ data: { trades: [] } })).toEqual([]);
  });
});
