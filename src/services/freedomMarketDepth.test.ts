import { describe, expect, it } from 'vitest';
import {
  createFreedomMarketDepthBook,
  groupFreedomMarketDepthByPrice,
  MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE,
  sanitizeFreedomMarketDepth
} from './freedomMarketDepth.js';

describe('TradeNet Market Depth accumulator', () => {

  it('unwraps the documented dom envelope and seeds the initial combined book before deltas', () => {
    const book = createFreedomMarketDepthBook('GOOGL.US');
    const initialRows = [
      ...Array.from({ length: 10 }, (_, k) => ({
        k, p: 291.2 + k * 0.01, q: 10 + k, s: 'S'
      })),
      ...Array.from({ length: 10 }, (_, k) => ({
        k, p: 291.1 - k * 0.01, q: 20 + k, s: 'B'
      }))
    ];

    expect(book.apply({
      dom: [{
        n: 0,
        i: 'GOOGL.US',
        min_step: 0.01,
        step_price: 0,
        del: [],
        ins: initialRows,
        upd: [],
        cnt: 20
      }]
    })).toBe(1);

    // The next provider message is wrapped in the same dom[] envelope.
    expect(book.apply({
      dom: [{
        n: 1,
        i: 'GOOGL.US',
        del: [{ k: 9, p: 291.29, q: 19, s: 'S' }],
        ins: [{ k: 0, p: 291.21, q: 25, s: 'S' }],
        upd: [{ k: 0, p: 291.11, q: 28, s: 'B' }],
        cnt: 20
      }]
    })).toBe(1);

    const snapshot = book.snapshot();
    expect(snapshot.sequence).toBe(1);
    expect(snapshot.updateCount).toBe(2);
    expect(snapshot.asks[0]).toMatchObject({ position: 0, price: 291.21, quantity: 25 });
    expect(snapshot.bids[0]).toMatchObject({ position: 0, price: 291.11, quantity: 28 });
    expect(snapshot.bids).toHaveLength(10);
    expect(snapshot.asks).toHaveLength(10);
  });

  it('supports an array containing one or more dom envelopes', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    const applied = book.apply([
      { dom: [{ n: 0, i: 'AAPL.US', ins: [{ k: 0, p: 101, q: 5, s: 'S' }] }] },
      { dom: [{ n: 1, i: 'AAPL.US', ins: [{ k: 0, p: 100, q: 4, s: 'B' }] }] }
    ]);
    expect(applied).toBe(2);
    expect(book.snapshot().asks).toEqual([{ position: 0, price: 101, quantity: 5 }]);
    expect(book.snapshot().bids).toEqual([{ position: 0, price: 100, quantity: 4 }]);
  });

  it('applies a side-qualified position-only deletion before insertion and update', () => {
    const book = createFreedomMarketDepthBook('GOOGL.US');
    book.apply({
      i: 'GOOGL.US',
      n: 0,
      cnt: 2,
      ins: [
        { k: 0, p: 291.44, q: 10, s: 'S' },
        { k: 0, p: 291.42, q: 20, s: 'B' }
      ]
    });

    book.apply({
      i: 'GOOGL.US',
      n: 1,
      del: [{ k: 0, s: 'S' }],
      ins: [{ k: 0, p: 291.48, q: 12, s: 'S' }],
      upd: [{ k: 0, p: 291.42, q: 24, s: 'B' }]
    });

    expect(book.snapshot()).toMatchObject({
      sequence: 1,
      deletionsApplied: 1,
      insertionsApplied: 3,
      rowUpdatesApplied: 1,
      asks: [{ position: 0, price: 291.48, quantity: 12 }],
      bids: [{ position: 0, price: 291.42, quantity: 24 }]
    });
  });

  it('accepts a numeric deletion when its side is unambiguous', () => {
    const book = createFreedomMarketDepthBook('GOOGL.US');
    book.apply({
      i: 'GOOGL.US',
      n: 0,
      ins: [
        { k: 0, p: 291.44, q: 10, s: 'S' },
        { k: 1, p: 291.43, q: 15, s: 'S' }
      ]
    });

    book.apply({
      i: 'GOOGL.US',
      n: 1,
      del: [0],
      ins: [{ k: 0, p: 291.48, q: 12, s: 'S' }],
      upd: [{ k: 1, p: 291.43, q: 18, s: 'S' }]
    });

    expect(book.snapshot()).toMatchObject({
      sequence: 1,
      deletionsApplied: 1,
      asks: [
        { position: 0, price: 291.48, quantity: 12 },
        { position: 1, price: 291.43, quantity: 18 }
      ],
      bids: []
    });
  });

  it('rejects a side-less deletion when bid and ask share the same position', () => {
    const book = createFreedomMarketDepthBook('GOOGL.US');
    book.apply({
      i: 'GOOGL.US',
      n: 0,
      ins: [
        { k: 0, p: 101, q: 10, s: 'S' },
        { k: 0, p: 100, q: 20, s: 'B' }
      ]
    });

    expect(() => book.apply({ i: 'GOOGL.US', n: 1, del: [{ k: 0 }] }))
      .toThrow(/deletion at k=0 is ambiguous without a side/);
    expect(book.snapshot()).toMatchObject({
      sequence: 0,
      asks: [{ position: 0, price: 101, quantity: 10 }],
      bids: [{ position: 0, price: 100, quantity: 20 }]
    });

    // Price metadata can disambiguate a side-less delete when exactly one side matches.
    book.apply({ i: 'GOOGL.US', n: 1, del: [{ k: 0, p: 101 }] });
    expect(book.snapshot()).toMatchObject({
      sequence: 1,
      asks: [],
      bids: [{ position: 0, price: 100, quantity: 20 }]
    });
  });

  it('rejects duplicate deletes for the same side-local position without mutating the book', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    book.apply({ i: 'AAPL.US', n: 0, ins: [{ k: 0, p: 101, q: 1, s: 'S' }] });

    expect(() => book.apply({
      i: 'AAPL.US', n: 1,
      del: [{ k: 0, s: 'S' }, { k: 0, s: 'S' }]
    })).toThrow(/duplicate S deletion position k=0/);
    expect(book.snapshot()).toMatchObject({
      sequence: 0,
      asks: [{ position: 0, price: 101, quantity: 1 }]
    });
  });

  it('uses independent side-local positions and shifts only the affected side', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    book.apply({
      i: 'AAPL.US',
      n: 1,
      cnt: 6,
      ins: [
        { k: 0, p: 101, q: 11, s: 'S' },
        { k: 1, p: 102, q: 22, s: 'S' },
        { k: 2, p: 103, q: 33, s: 'S' },
        { k: 0, p: 100, q: 10, s: 'B' },
        { k: 1, p: 99, q: 20, s: 'B' },
        { k: 2, p: 98, q: 30, s: 'B' }
      ]
    });
    book.apply({ i: 'AAPL.US', n: 2, ins: [{ k: 0, p: 100.5, q: 12, s: 'S' }] });
    book.apply({
      i: 'AAPL.US',
      n: 3,
      del: [{ k: 2, s: 'S' }],
      upd: [{ k: 0, p: 100.25, q: 13, s: 'B' }]
    });

    const snapshot = book.snapshot();
    expect(snapshot).toMatchObject({
      sequence: 3,
      reportedDepth: 6,
      updateCount: 3,
      insertionsApplied: 7,
      rowUpdatesApplied: 1,
      deletionsApplied: 1,
      asks: [
        { position: 0, price: 100.5, quantity: 12 },
        { position: 1, price: 101, quantity: 11 },
        { position: 2, price: 103, quantity: 33 }
      ],
      bids: [
        { position: 0, price: 100.25, quantity: 13 },
        { position: 1, price: 99, quantity: 20 },
        { position: 2, price: 98, quantity: 30 }
      ]
    });
    expect(snapshot.asks[0].price - snapshot.bids[0].price).toBeCloseTo(0.25, 8);
  });


  it('applies batched deletes, inserts, and updates in TradeNet documented order', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    book.apply({
      i: 'AAPL.US',
      n: 1,
      ins: [
        { k: 0, p: 101, q: 11, s: 'S' },
        { k: 1, p: 102, q: 22, s: 'S' },
        { k: 2, p: 103, q: 33, s: 'S' },
        { k: 0, p: 100, q: 10, s: 'B' },
        { k: 1, p: 99, q: 20, s: 'B' },
        { k: 2, p: 98, q: 30, s: 'B' },
        { k: 3, p: 97, q: 40, s: 'B' }
      ]
    });
    book.apply({
      i: 'AAPL.US',
      n: 2,
      del: [{ k: 1, s: 'S' }, { k: 1, s: 'B' }],
      ins: [
        { k: 0, p: 100.75, q: 8, s: 'S' },
        { k: 1, p: 99.5, q: 15, s: 'B' }
      ],
      upd: [
        { k: 0, p: 100.1, q: 12, s: 'B' },
        { k: 1, p: 99.6, q: 16, s: 'B' }
      ]
    });

    expect(book.snapshot()).toMatchObject({
      sequence: 2,
      updateCount: 2,
      insertionsApplied: 9,
      rowUpdatesApplied: 2,
      deletionsApplied: 2,
      asks: [
        { position: 0, price: 100.75, quantity: 8 },
        { position: 1, price: 101, quantity: 11 },
        { position: 2, price: 103, quantity: 33 }
      ],
      bids: [
        { position: 0, price: 100.1, quantity: 12 },
        { position: 1, price: 99.6, quantity: 16 },
        { position: 2, price: 98, quantity: 30 },
        { position: 3, price: 97, quantity: 40 }
      ]
    });
  });

  it('rejects sequence gaps, missing side-local positions, and symbol mismatches', () => {
    const sequenceBook = createFreedomMarketDepthBook('AAPL.US');
    sequenceBook.apply({
      i: 'AAPL.US',
      n: 1,
      ins: [
        { k: 0, p: 101, q: 1, s: 'S' },
        { k: 0, p: 100, q: 1, s: 'B' }
      ]
    });
    expect(() => sequenceBook.apply({
      i: 'AAPL.US',
      n: 3,
      upd: [{ k: 1, p: 99, q: 2, s: 'B' }]
    })).toThrow(/sequence gap/);

    const mismatchBook = createFreedomMarketDepthBook('AAPL.US');
    mismatchBook.apply({
      i: 'AAPL.US',
      n: 1,
      ins: [
        { k: 0, p: 101, q: 1, s: 'S' },
        { k: 0, p: 100, q: 1, s: 'B' }
      ]
    });
    expect(() => mismatchBook.apply({
      i: 'AAPL.US',
      n: 2,
      upd: [{ k: 1, p: 99, q: 2, s: 'S' }]
    })).toThrow(/update referenced a missing S position k=1/);
    expect(() => mismatchBook.apply({
      i: 'MSFT.US',
      n: 2,
      ins: []
    })).toThrow(/requested symbol/);
    expect(() => mismatchBook.apply({
      i: 'AAPL.US',
      n: 2,
      ins: [{ k: 4, p: 98, q: 1, s: 'B' }]
    })).toThrow(/missing book position/);
  });

  it('limits bids and asks independently to the per-side safety cap', () => {
    const book = createFreedomMarketDepthBook('AAPL.US');
    const levels = ['B', 'S'].flatMap(s =>
      Array.from({ length: MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE }, (_, k) => ({
        k,
        p: s === 'B' ? 2000 - k : 2001 + k,
        q: 1,
        s
      }))
    );
    book.apply({ i: 'AAPL.US', ins: levels });
    book.apply(Array.from({ length: 20 }, () => ({
      i: 'AAPL.US',
      ins: [
        { k: 0, p: 1999, q: 1, s: 'B' },
        { k: 0, p: 2002, q: 1, s: 'S' }
      ]
    })));
    expect(book.snapshot().bids).toHaveLength(MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE);
    expect(book.snapshot().asks).toHaveLength(MAX_FREEDOM_MARKET_DEPTH_LEVELS_PER_SIDE);
  });

  it('aggregates quantities at identical prices and returns price-ranked levels', () => {
    const grouped = groupFreedomMarketDepthByPrice({
      symbol: 'AAPL.US',
      bids: [
        { position: 3, price: 100, quantity: 2 },
        { position: 4, price: 100, quantity: 3 },
        { position: 5, price: 99.5, quantity: 4 }
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

  it('keeps sanitized output free of raw broker and account fields', () => {
    const sanitized = sanitizeFreedomMarketDepth({
      i: 'AAPL.US',
      n: 1,
      ins: [
        { k: 0, p: 100, q: 1, s: 'S', account_id: 'private' },
        { k: 0, p: 99, q: 2, s: 'B' }
      ]
    }, 'AAPL.US');
    expect(sanitized.bids).toEqual([{ position: 0, price: 99, quantity: 2 }]);
    expect(sanitized.asks).toEqual([{ position: 0, price: 100, quantity: 1 }]);
    expect(JSON.stringify(sanitized)).not.toContain('private');
  });
});
