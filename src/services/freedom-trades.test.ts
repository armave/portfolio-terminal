import { describe, expect, it } from 'vitest';
import { normalizeFreedomTrades } from './api';

describe('normalizeFreedomTrades', () => {
  it('normalizes TradeNet trade history aliases without inventing absent fields', () => {
    const trades = normalizeFreedomTrades({
      ok: true,
      data: {
        result: {
          trades: [{
            trade_id: 123,
            i: 'GOOGL.US',
            operation: 'BUY',
            q: 2,
            price: 321.5,
            curr: 'USD',
            time: '2026-10-24T10:30:00'
          }]
        }
      }
    });
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      id: '123',
      ticker: 'GOOGL.US',
      side: 'BUY',
      quantity: 2,
      price: 321.5,
      currency: 'USD',
      executedAt: '2026-10-24T10:30:00'
    });
  });

  it('parses the real example.json data.trades.trade response shape', () => {
    const trades = normalizeFreedomTrades({
      ok: true,
      provider: 'Freedom TradeNet',
      data: {
        trades: {
          trade: [
            {
              id: '442648855',
              order_id: '392308907',
              p: '163.35600000',
              q: '30.00000000',
              v: 4900.68,
              date: '2024-09-26T17:41:30.000',
              profit: 0,
              margin_fee: '3.25',
              instr_nm: 'GOOGL.US',
              curr_c: 'USD',
              type: '1',
              commission: '24.86',
              commission_currency: 'USD'
            },
            {
              id: '450897125',
              p: '67.20040000',
              q: '1.00000000',
              date: '2024-10-17T18:00:13.000',
              profit: 2.26,
              instr_nm: 'SHEL.US',
              curr_c: 'USD',
              type: '2'
            }
          ]
        }
      }
    });

    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({
      id: '442648855',
      ticker: 'GOOGL.US',
      side: 'BUY',
      quantity: 30,
      price: 163.356,
      currency: 'USD',
      executedAt: '2024-09-26T17:41:30.000',
      tradeValue: 4900.68,
      profit: 0,
      marginFee: 3.25,
      commission: 24.86,
      commissionCurrency: 'USD'
    });
    expect(trades[1]).toMatchObject({ ticker: 'SHEL.US', side: 'SELL', profit: 2.26 });
  });

  it('classifies positive margin requirements and leaves zero/missing requirements unclassified', () => {
    const trades = normalizeFreedomTrades({
      data: { result: { trades: { trade: [
        { id: 1, instr_nm: 'AAPL.US', type: 1, q: 2, p: 100, go_sum: '25.00' },
        { id: 2, instr_nm: 'MSFT.US', type: 1, q: 2, p: 100, go_sum: '0.00' },
        { id: 3, instr_nm: 'TSLA.US', type: 1, q: 2, p: 100 }
      ] } } }
    });
    expect(trades.map(trade => trade.marginClassification)).toEqual(['margin', 'unknown', 'unknown']);
    expect(trades[0].marginInitialRequirement).toBe(25);
  });


  it('does not classify zero go_sum values in the supplied Freedom production shape as cash', () => {
    const trades = normalizeFreedomTrades({
      ok: true,
      provider: 'Freedom TradeNet',
      data: { trades: { trade: [
        { id: '442648855', instr_nm: 'GOOGL.US', type: '1', q: '30.00000000', p: '163.35600000', go_sum: '.00000000' },
        { id: '703813234', instr_nm: 'WDC.US', type: '2', q: '33.00000000', p: '436.00000000', go_sum: '.00000000' }
      ] } }
    });
    expect(trades.map(trade => trade.marginClassification)).toEqual(['unknown', 'unknown']);
  });

  it('returns an empty list for unrecognized response shapes', () => {
    expect(normalizeFreedomTrades({ ok: true, data: { result: { ps: {} } } })).toEqual([]);
  });
});
