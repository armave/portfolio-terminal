import { describe, expect, it } from 'vitest';
import { normalizeFreedomActiveOrders, normalizeFreedomPortfolio } from './freedomAccountContracts';

describe('normalizeFreedomPortfolio', () => {
  it('accepts only record rows, scopes the snapshot to USD and preserves broker field aliases', () => {
    const snapshot = normalizeFreedomPortfolio({
      data: {
        result: {
          ps: {
            loaded: true,
            acc: [
              { curr: 'USD', s: '-125.50', currval: 999, forecast_in: '10', forecast_out: 2, t2_in: 3, t2_out: 4 },
              { curr: 'EUR', s: 500 },
              null,
              'malformed'
            ],
            pos: [
              { i: 'AAPL.US', name: 'Apple', q: '2.5', mkt_price: '190', market_value: '475', bal_price_a: 180, profit_close: '25', acc_pos_id: '77', curr: 'USD' },
              { base_contract_code: 'MSFT.US', name2: 'Microsoft', q: 3, mkt_price: true, curr: 'USD' },
              { i: 'IGNORED', q: 1, curr: 'EUR' },
              false
            ]
          }
        }
      }
    });

    expect(snapshot).toEqual({
      loaded: true,
      balances: [{
        currency: 'USD',
        amount: -125.5,
        forecastIn: 10,
        forecastOut: 2,
        t2In: 3,
        t2Out: 4
      }],
      positions: [
        {
          ticker: 'AAPL.US',
          name: 'Apple',
          quantity: 2.5,
          currency: 'USD',
          marketPrice: 190,
          marketValue: 475,
          averagePrice: 180,
          profitClose: 25,
          accountPositionId: 77
        },
        {
          ticker: 'MSFT.US',
          name: 'Microsoft',
          quantity: 3,
          currency: 'USD',
          marketPrice: null,
          marketValue: null,
          averagePrice: null,
          profitClose: null,
          accountPositionId: null
        }
      ]
    });
  });

  it('rejects unrecognized or not-yet-loaded account envelopes', () => {
    expect(() => normalizeFreedomPortfolio(null)).toThrow('missing data.result.ps');
    expect(() => normalizeFreedomPortfolio({ data: { result: { ps: { loaded: false } } } }))
      .toThrow('not loaded yet');
  });

  it('does not coerce boolean broker values into numeric balances or positions', () => {
    const snapshot = normalizeFreedomPortfolio({
      data: { result: { ps: {
        loaded: true,
        acc: [{ curr: 'USD', s: true, currval: false }],
        pos: [{ curr: 'USD', i: 'AAPL', q: true, mkt_price: false }]
      } } }
    });
    expect(snapshot.balances[0].amount).toBe(0);
    expect(snapshot.positions[0]).toMatchObject({ quantity: 0, marketPrice: null });
  });
});

describe('normalizeFreedomActiveOrders', () => {
  it('normalizes sanitized Worker order envelopes with validated aliases', () => {
    expect(normalizeFreedomActiveOrders({
      ok: true,
      data: {
        orders: {
          order: [
            {
              order_id: 'order-1',
              instr: 'AAPL.US',
              oper: 3,
              type: '2',
              p: '190.50',
              leaves_qty: '5',
              stat: '10',
              unknown_provider_field: { detail: 'preserved' }
            },
            { id: 2, ticker: 'msft.us', operation: true, price: false, quantity: '3' },
            null
          ]
        }
      }
    })).toEqual([
      {
        id: 'order-1',
        ticker: 'AAPL.US',
        operation: 3,
        orderType: 2,
        limitPrice: 190.5,
        remainingQuantity: 5,
        date: null,
        status: '10',
        raw: {
          order_id: 'order-1',
          instr: 'AAPL.US',
          oper: 3,
          type: '2',
          p: '190.50',
          leaves_qty: '5',
          stat: '10',
          unknown_provider_field: { detail: 'preserved' }
        }
      },
      {
        id: '2',
        ticker: 'MSFT.US',
        operation: null,
        orderType: null,
        limitPrice: null,
        remainingQuantity: 3,
        date: null,
        status: '',
        raw: { id: 2, ticker: 'msft.us', operation: true, price: false, quantity: '3' }
      }
    ]);
  });

  it('returns an empty list for unknown envelope shapes and ignores non-record list entries', () => {
    expect(normalizeFreedomActiveOrders(null)).toEqual([]);
    expect(normalizeFreedomActiveOrders({ data: { orders: 'invalid' } })).toEqual([]);
    expect(normalizeFreedomActiveOrders([{ id: 'good', ticker: 'AAPL' }, 'invalid']))
      .toEqual([expect.objectContaining({ id: 'good', ticker: 'AAPL' })]);
  });
});
