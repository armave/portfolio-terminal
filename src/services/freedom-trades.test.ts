import { describe, expect, it } from 'vitest';
import { normalizeFreedomTrades } from './api';
import { classifyFreedomPortfolio } from '../domain/freedomPortfolio';

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

  it('falls through zero quantity/price placeholders and unrecognized operation aliases', () => {
    const trades = normalizeFreedomTrades({
      data: {
        trades: { trade: [{
          id: 'buy-alias-fallback',
          instr_nm: 'GOOGL.US',
          operation: 'not-a-side-code',
          type: '1',
          q: '0',
          quantity: '5',
          p: '0',
          price: '282.00',
          date: '2026-10-29T09:00:00'
        }] }
      }
    });

    expect(trades[0]).toMatchObject({
      side: 'BUY',
      quantity: 5,
      price: 282,
      executedAt: '2026-10-29T09:00:00'
    });
  });

  it('carries normalized broker quantities into classified GOOGL position tranches', () => {
    const rawRows = [
      { id: 'buy-5', instr_nm: 'GOOGL.US', operation: 'unknown', type: '1', q: 0, quantity: 5, p: 0, price: 282, date: '2026-10-29T09:00:00' },
      { id: 'buy-14', instr_nm: 'GOOGL.US', operation: '1', q: 14, p: 282, date: '2026-10-29T09:10:00' },
      { id: 'buy-10', instr_nm: 'GOOGL.US', type: '1', q: 10, p: 328, date: '2026-10-22T10:00:00' },
      { id: 'buy-20a', instr_nm: 'GOOGL.US', type: '1', q: 20, p: 336.3, date: '2026-10-21T10:00:00' },
      { id: 'buy-20b', instr_nm: 'GOOGL.US', type: '1', q: 20, p: 341.4, date: '2026-10-20T10:00:00' }
    ];
    const trades = normalizeFreedomTrades({ data: { trades: { trade: rawRows } } });
    const result = classifyFreedomPortfolio({
      loaded: true,
      balances: [],
      positions: [{ ticker: 'GOOGL.US', quantity: 69, marketPrice: 280.66 }]
    }, {}, [], { GOOGL: 'margin' }, 123, trades);

    expect(result.positions.GOOGL.shares).toBe(69);
    expect(result.positions.GOOGL.tranches?.map((tranche) => ({
      qty: tranche.qty,
      price: tranche.price
    }))).toEqual([
      { qty: 14, price: 282 },
      { qty: 5, price: 282 },
      { qty: 10, price: 328 },
      { qty: 20, price: 336.3 },
      { qty: 20, price: 341.4 }
    ]);
  });

  it('accepts unknown input and safely rejects malformed history envelopes', () => {
    expect(normalizeFreedomTrades(null)).toEqual([]);
    expect(normalizeFreedomTrades('not a broker response')).toEqual([]);
    expect(normalizeFreedomTrades({ data: { trades: 'not-an-array' } })).toEqual([]);
    expect(normalizeFreedomTrades({ data: { result: null }, result: { trades: null } })).toEqual([]);
  });

  it('normalizes a numeric execution timestamp to the declared string output shape', () => {
    const trades = normalizeFreedomTrades({
      data: {
        trades: {
          trade: [{
            id: 77,
            instr_nm: 'AAPL.US',
            type: '1',
            q: 2,
            p: 100,
            date: 1790000000
          }]
        }
      }
    });
    expect(trades[0]).toMatchObject({
      id: '77',
      ticker: 'AAPL.US',
      side: 'BUY',
      quantity: 2,
      price: 100,
      executedAt: '1790000000'
    });
  });

  it('returns an empty list for unrecognized response shapes', () => {
    expect(normalizeFreedomTrades({ ok: true, data: { result: { ps: {} } } })).toEqual([]);
  });
});

it('assigns stable unique fallback execution IDs without collapsing fills from one order', () => {
  const payload = { data: { trades: { trade: [
    { order_id: 'same-order', instr_nm: 'AAPL.US', type: '2', q: '1', p: '100', date: '2026-06-01T10:00:00Z' },
    { order_id: 'same-order', instr_nm: 'AAPL.US', type: '2', q: '2', p: '100', date: '2026-06-01T10:01:00Z' }
  ] } } };
  const first = normalizeFreedomTrades(payload);
  const second = normalizeFreedomTrades(payload);
  expect(first.map(row => row.id)).toEqual(second.map(row => row.id));
  expect(new Set(first.map(row => row.id)).size).toBe(2);
  expect(first.every(row => row.id.startsWith('fallback-'))).toBe(true);
});
