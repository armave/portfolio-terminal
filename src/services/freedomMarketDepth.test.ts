import { describe, expect, it } from 'vitest';
import { normalizeFreedomMarketDepth } from './freedomMarketDepth';

describe('normalizeFreedomMarketDepth', () => {
  it('unwraps the Worker response and keeps only finite positive book levels', () => {
    expect(normalizeFreedomMarketDepth({
      ok: true,
      symbol: 'AAPL',
      data: {
        symbol: 'AAPL',
        bids: [
          { price: '189.5', quantity: '20', position: '1' },
          { price: 0, quantity: 5, position: 2 },
          { price: 190, quantity: true, position: 3 },
          null
        ],
        asks: [{ price: 190, quantity: 7, position: null }],
        depth: '2',
        minPriceStep: '0.01',
        updatedAt: 123456
      }
    }, 'aapl')).toEqual({
      symbol: 'AAPL',
      bids: [{ price: 189.5, quantity: 20, position: 1 }],
      asks: [{ price: 190, quantity: 7, position: null }],
      depth: 2,
      minPriceStep: 0.01,
      updatedAt: 123456
    });
  });

  it('supports the nested data.data envelope and derives depth when absent', () => {
    expect(normalizeFreedomMarketDepth({
      data: {
        data: {
          symbol: 'MSFT',
          bids: [{ price: 100, quantity: 2 }],
          asks: []
        }
      }
    }, 'MSFT')).toMatchObject({
      symbol: 'MSFT',
      bids: [{ price: 100, quantity: 2, position: null }],
      asks: [],
      depth: 1,
      minPriceStep: null
    });
  });

  it('rejects symbol mismatches, missing arrays and malformed envelopes', () => {
    expect(() => normalizeFreedomMarketDepth(null, 'AAPL')).toThrow('unrecognized market-depth');
    expect(() => normalizeFreedomMarketDepth({
      data: { symbol: 'MSFT', bids: [], asks: [] }
    }, 'AAPL')).toThrow('unrecognized market-depth');
    expect(() => normalizeFreedomMarketDepth({
      data: { symbol: 'AAPL', bids: [], asks: 'invalid' }
    }, 'AAPL')).toThrow('unrecognized market-depth');
  });
});
