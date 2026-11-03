import { describe, expect, it } from 'vitest';
import { normalizeFreedomOrderFills, normalizeFreedomTrades } from './freedomTradeContracts';

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
      tradeValue: 40,
      currency: 'USD',
      commissionCurrency: 'USD',
      marginFeeAllocations: { 'freedom-1': 0.17 },
      feesAndCommissions: 0.42,
      netProfit: 3.58
    }]);

    expect(trade).toMatchObject({
      id: 'saved-sell-1',
      executedAt: '2026-10-31T11:00:00Z',
      tradeValue: 40,
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

  it('normalizes order-stream fills with trade IDs and the parent order side', () => {
    const fills = normalizeFreedomOrderFills({
      ok: true,
      data: {
        orders: { order: [] },
        trades: {
          trade: [
            {
              id: 13446624,
              order_id: 8757875,
              instr: 'GOOGL.US',
              side: 'SELL',
              curr: 'USD',
              date: '2026-11-03T09:40:00',
              p: 352.5,
              q: 2,
              v: 705,
              profit: 12.5,
              acd: 0,
              fv: 1,
              go_sum: 100
            },
            {
              id: 13446625,
              order_id: 8757876,
              instr: 'GOOGL.US',
              side: 'BUY',
              curr: 'USD',
              date: '2026-11-03T09:41:00',
              p: 350,
              q: 1,
              v: 350
            }
          ]
        }
      }
    });

    expect(fills).toHaveLength(2);
    expect(fills[0]).toMatchObject({
      id: '13446624',
      ticker: 'GOOGL.US',
      side: 'SELL',
      quantity: 2,
      price: 352.5,
      currency: 'USD',
      executedAt: '2026-11-03T09:40:00',
      tradeValue: 705,
      profit: 12.5
    });
    expect(fills[0].raw).toMatchObject({ order_id: '8757875', id: 13446624 });
    expect(fills[1]).toMatchObject({ id: '13446625', side: 'BUY', quantity: 1, price: 350 });
  });

  it('keeps sell-short fills distinct from closing sells', () => {
    const [fill] = normalizeFreedomOrderFills({
      trades: { trade: [{
        id: 9001,
        order_id: 900,
        instr: 'GOOGL.US',
        side: 'SELL_SHORT',
        date: '2026-11-03T09:42:00',
        p: 350,
        q: 1,
        v: 350
      }] }
    });
    expect(fill.side).toBe('SELL_SHORT');
  });

  it('returns no executions for a valid order snapshot without fill rows', () => {
    expect(normalizeFreedomOrderFills({
      orders: { order: [{ order_id: 'open-1', instr: 'GOOGL.US' }] },
      trades: { trade: [] }
    })).toEqual([]);
  });

});
