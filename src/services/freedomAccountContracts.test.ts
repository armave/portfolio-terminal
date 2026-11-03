import { describe, expect, it } from 'vitest';
import { compareFreedomPortfolioSnapshots, normalizeFreedomActiveOrders, normalizeFreedomPortfolio } from './freedomAccountContracts';

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

describe('compareFreedomPortfolioSnapshots', () => {
  const snapshot = (amount: number, quantity: number, marketPrice: number) => ({
    ok: true,
    data: {
      result: {
        ps: {
          loaded: true,
          acc: [{ curr: 'USD', s: amount, currval: amount + 10, forecast_in: 2, forecast_out: 1, t2_in: 3, t2_out: 4 }],
          pos: [{
            curr: 'USD', i: 'GOOGL.US', name: 'Alphabet', q: quantity,
            mkt_price: marketPrice, market_value: quantity * marketPrice,
            bal_price_a: 280, profit_close: 100, acc_pos_id: 7
          }]
        }
      }
    }
  });

  it('reports matching normalized WebSocket and REST USD snapshots within the tolerance', () => {
    const result = compareFreedomPortfolioSnapshots(
      snapshot(10000, 31, 300),
      snapshot(10000.005, 31, 300.005)
    );
    expect(result).toEqual({
      matches: true,
      tolerance: 0.01,
      websocket: { accounts: 1, positions: 1 },
      rest: { accounts: 1, positions: 1 },
      differenceCount: 0,
      differences: []
    });
  });

  it('reports balance, position, and missing-row discrepancies without mutating either snapshot', () => {
    const websocket = snapshot(10000, 31, 300);
    const rest = snapshot(9990, 30, 299);
    rest.data.result.ps.pos.push({
      curr: 'USD', i: 'META.US', name: 'Meta', q: 2, mkt_price: 600,
      market_value: 1200, bal_price_a: 580, profit_close: 40, acc_pos_id: 8
    });
    const websocketBefore = JSON.stringify(websocket);
    const restBefore = JSON.stringify(rest);

    const result = compareFreedomPortfolioSnapshots(websocket, rest);

    expect(result.matches).toBe(false);
    expect(result.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'balances[USD#0].amount', websocketValue: 10000, restValue: 9990, delta: 10 }),
      expect.objectContaining({ path: 'positions[GOOGL.US].quantity', websocketValue: 31, restValue: 30, delta: 1 }),
      expect.objectContaining({ path: 'positions[GOOGL.US].marketPrice', websocketValue: 300, restValue: 299, delta: 1 }),
      expect.objectContaining({ path: 'positions[META.US].missing_in_websocket', websocketValue: null, restValue: 'present' })
    ]));
    expect(result.differenceCount).toBe(result.differences.length);
    expect(JSON.stringify(websocket)).toBe(websocketBefore);
    expect(JSON.stringify(rest)).toBe(restBefore);
  });

  it('rejects a snapshot until TradeNet marks its portfolio loaded', () => {
    expect(() => compareFreedomPortfolioSnapshots(
      { data: { result: { ps: { loaded: false } } } },
      snapshot(100, 1, 1)
    )).toThrow('not loaded yet');
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

  it('normalizes the observed authenticated WebSocket order fields without losing status or remaining quantity', () => {
    const orders = normalizeFreedomActiveOrders({
      data: {
        orders: {
          order: [
            { order_id: 'active-1', instr: 'GOOGL.US', oper: 3, type: 4, p: 335, q: 68, leaves_qty: 68, stat: '10' },
            { order_id: 'history-1', instr: 'GOOGL.US', oper: 3, type: 4, p: 353, q: 50, leaves_qty: 50, stat: '31' },
            { order_id: 'filled-1', instr: 'GOOGL.US', oper: 1, type: 2, p: 282, q: 20, leaves_qty: 0, stat: '21' }
          ]
        }
      }
    });

    expect(orders).toMatchObject([
      { id: 'active-1', ticker: 'GOOGL.US', operation: 3, orderType: 4, limitPrice: 335, remainingQuantity: 68, status: '10' },
      { id: 'history-1', ticker: 'GOOGL.US', operation: 3, orderType: 4, limitPrice: 353, remainingQuantity: 50, status: '31' },
      { id: 'filled-1', ticker: 'GOOGL.US', operation: 1, orderType: 2, limitPrice: 282, remainingQuantity: 0, status: '21' }
    ]);
  });

  it('returns an empty list for unknown envelope shapes and ignores non-record list entries', () => {
    expect(normalizeFreedomActiveOrders(null)).toEqual([]);
    expect(normalizeFreedomActiveOrders({ data: { orders: 'invalid' } })).toEqual([]);
    expect(normalizeFreedomActiveOrders([{ id: 'good', ticker: 'AAPL' }, 'invalid']))
      .toEqual([expect.objectContaining({ id: 'good', ticker: 'AAPL' })]);
  });
});
