import { describe, expect, it } from 'vitest';
import {
  createFreedomMarketDepthBook,
  groupFreedomMarketDepthByPrice,
  MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE,
  sanitizeFreedomMarketDepth
} from './freedomMarketDepth.js';

describe('TradeNet Market Depth accumulator', () => {
  it('applies live inserts, updates, deletes, and position shifts', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    book.apply({
      i: 'AAPL.US',
      n: 1,
      cnt: 2,
      ins: [
        { k: 0, p: 100, q: 10, s: 'B' },
        { k: 1, p: 99, q: 20, s: 'B' },
        { k: 0, p: 101, q: 11, s: 'S' },
        { k: 1, p: 102, q: 22, s: 'S' }
      ]
    });
    book.apply({
      i: 'AAPL.US',
      n: 2,
      ins: [{ k: 1, p: 99.5, q: 15, s: 'B' }],
      upd: [{ k: 0, p: 100.25, q: 12, s: 'B' }]
    });
    book.apply({
      i: 'AAPL.US',
      n: 3,
      del: [{ k: 2, s: 'B' }, { k: 1, s: 'S' }],
      upd: [{ k: 1, p: 101.5, q: 25, s: 'S' }]
    });

    expect(book.snapshot()).toMatchObject({
      sequence: 3,
      reportedDepth: 2,
      updateCount: 3,
      bids: [
        { position: 0, price: 100.25, quantity: 12 },
        { position: 1, price: 99.5, quantity: 15 }
      ],
      asks: [
        { position: 0, price: 101, quantity: 11 },
        { position: 1, price: 101.5, quantity: 25 }
      ]
    });
  });

  it('rejects symbol mismatches and limits each side at the high safety cap', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    expect(() => book.apply({ i: 'MSFT.US', ins: [] })).toThrow(/requested symbol/);
    const rows = Array.from({ length: MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE }, (_, k) => ({
      k, p: 2000 - k, q: 1, s: 'B'
    }));
    book.apply({ i: 'AAPL.US', ins: rows });
    book.apply(Array.from({ length: 20 }, () => ({
      i: 'AAPL.US',
      ins: [{ k: MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE, p: 900, q: 1, s: 'B' }]
    })));
    expect(book.snapshot().bids).toHaveLength(MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE);
  });

  it('aggregates quantities at identical prices and returns price-ranked levels', () => {
    const grouped = groupFreedomMarketDepthByPrice({
      symbol: 'AAPL.US',
      bids: [
        { position: 0, price: 100, quantity: 2 },
        { position: 1, price: 100, quantity: 3 },
        { position: 2, price: 99.5, quantity: 4 }
      ],
      asks: [
        { position: 0, price: 101, quantity: 1 },
        { position: 1, price: 101, quantity: 6 },
        { position: 2, price: 101.5, quantity: 2 }
      ]
    });
    expect(grouped.bids).toEqual([
      { position: 0, price: 100, quantity: 5 },
      { position: 1, price: 99.5, quantity: 4 }
    ]);
    expect(grouped.asks).toEqual([
      { position: 0, price: 101, quantity: 7 },
      { position: 1, price: 101.5, quantity: 2 }
    ]);
  });

  it('preserves position ordering across batched deletes, inserts, and row updates', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    book.apply({
      i: 'AAPL.US',
      ins: [
        { k: 0, p: 100, q: 10, s: 'B' },
        { k: 1, p: 99, q: 20, s: 'B' },
        { k: 2, p: 98, q: 30, s: 'B' },
        { k: 3, p: 97, q: 40, s: 'B' },
        { k: 0, p: 101, q: 11, s: 'S' },
        { k: 1, p: 102, q: 22, s: 'S' },
        { k: 2, p: 103, q: 33, s: 'S' }
      ]
    });
    book.apply({
      i: 'AAPL.US',
      del: [{ k: 1, s: 'B' }, { k: 3, s: 'B' }, { k: 1, s: 'S' }],
      ins: [{ k: 1, p: 99.5, q: 15, s: 'B' }, { k: 3, p: 97.5, q: 45, s: 'B' }],
      upd: [{ k: 2, p: 98.25, q: 35, s: 'B' }]
    });

    expect(book.snapshot().bids).toEqual([
      { position: 0, price: 100, quantity: 10 },
      { position: 1, price: 99.5, quantity: 15 },
      { position: 2, price: 98.25, quantity: 35 },
      { position: 3, price: 97.5, quantity: 45 }
    ]);
    expect(book.snapshot().asks).toEqual([
      { position: 0, price: 101, quantity: 11 },
      { position: 1, price: 103, quantity: 33 }
    ]);
  });

  it('keeps the existing sanitized snapshot contract and returns all levels up to the cap', () => {
    const sanitized = sanitizeFreedomMarketDepth({
      i: 'AAPL.US',
      ins: [
        { k: 0, p: 100, q: 1, s: 'B', account_id: 'private' },
        { k: 1, p: 99, q: 2, s: 'B' }
      ]
    }, 'AAPL.US');
    expect(sanitized.bids).toHaveLength(2);
    expect(JSON.stringify(sanitized)).not.toContain('private');
  });
});
