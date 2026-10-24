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

  it('returns an empty list for unrecognized response shapes', () => {
    expect(normalizeFreedomTrades({ ok: true, data: { result: { ps: {} } } })).toEqual([]);
  });
});
