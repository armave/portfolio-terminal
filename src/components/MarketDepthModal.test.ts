import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeMarketDepthSnapshot, summarizeMarketDepth } from './MarketDepthModal';
import { groupFreedomMarketDepthByPrice } from '../services/freedomMarketDepth.js';

const response = {
  ok: true,
  updatedAt: 1_793_800_112_463,
  data: {
    symbol: 'AAPL.US',
    sequence: 12,
    reportedDepth: 2,
    updateCount: 3,
    insertionsApplied: 2,
    rowUpdatesApplied: 1,
    deletionsApplied: 0,
    captureDurationMs: 408,
    bids: [
      { position: 0, price: 340.74, quantity: 100 },
      { position: 1, price: 340.7, quantity: 50 }
    ],
    asks: [
      { position: 0, price: 340.93, quantity: 2 },
      { position: 1, price: 341, quantity: 48 }
    ]
  }
};

describe('Market Depth response normalization', () => {
  it('accepts a bounded authenticated snapshot and normalizes a bare ticker', () => {
    expect(normalizeMarketDepthSnapshot(response, ' aapl ')).toMatchObject({
      symbol: 'AAPL.US',
      sequence: 12,
      reportedDepth: 2,
      bids: response.data.bids,
      asks: response.data.asks,
      updatedAt: response.updatedAt
    });
  });

  it('rejects unsuccessful, mismatched, or malformed snapshots', () => {
    expect(() => normalizeMarketDepthSnapshot({ ok: false, error: 'Access denied' }, 'AAPL')).toThrow('Access denied');
    expect(() => normalizeMarketDepthSnapshot(response, 'MSFT')).toThrow('incomplete Market Depth snapshot');
    expect(() => normalizeMarketDepthSnapshot({
      ...response,
      data: { ...response.data, asks: [{ position: 0, price: Number.NaN, quantity: 1 }] }
    }, 'AAPL')).toThrow('incomplete Market Depth snapshot');
  });
});

describe('Market Depth book summary', () => {
  it('calculates best prices, spread, visible quantities, and size imbalance', () => {
    const snapshot = normalizeMarketDepthSnapshot(response, 'AAPL.US');
    expect(summarizeMarketDepth(snapshot)).toMatchObject({
      bestBid: response.data.bids[0],
      bestAsk: response.data.asks[0],
      spread: expect.closeTo(0.19, 8),
      midpoint: expect.closeTo(340.835, 8),
      spreadPercent: expect.closeTo((0.19 / 340.835) * 100, 8),
      bidQuantity: 150,
      askQuantity: 50,
      imbalancePercent: 50
    });
  });

  it('reports missing two-sided prices and zero-size imbalance without inventing values', () => {
    const snapshot = normalizeMarketDepthSnapshot({
      ok: true,
      updatedAt: 100,
      data: { symbol: 'AAPL.US', bids: [], asks: [{ position: 0, price: 20, quantity: 0 }] }
    }, 'AAPL');

    expect(summarizeMarketDepth(snapshot)).toMatchObject({
      bestBid: null,
      spread: null,
      midpoint: null,
      spreadPercent: null,
      bidQuantity: 0,
      askQuantity: 0,
      imbalancePercent: null
    });
  });
});

describe('Market Depth modal wiring', () => {
  it('uses a live admin socket and offers an accessible price-grouped ladder and details table', () => {
    const modalSource = readFileSync(new URL('./MarketDepthModal.tsx', import.meta.url), 'utf8');
    const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

    expect(modalSource).toContain('createFreedomMarketDepthStreamRuntime');
    expect(modalSource).toContain('groupFreedomMarketDepthByPrice');
    expect(modalSource).toContain('role="dialog"');
    expect(modalSource).toContain('aria-modal="true"');
    expect(modalSource).toContain('aria-label="Proportional market depth ladder"');
    expect(modalSource).toContain('<details');
    expect(modalSource).toContain('maximum depth available to this account');
    expect(modalSource).toContain('Rows at identical prices are combined');
    expect(modalSource).toContain('runtime.stop()');
    expect(appSource).toContain('if (permissions.isAdmin) setMarketDepthTicker');
    expect(appSource).toContain('{permissions.isAdmin && marketDepthTicker');
    expect(appSource).toContain('setMarketDepthTicker(null)');
  });

  it('aggregates multiple broker levels at the same price for the displayed book', () => {
    const grouped = groupFreedomMarketDepthByPrice({
      symbol: 'GOOGL.US',
      bids: [
        { position: 0, price: 287.72, quantity: 10 },
        { position: 1, price: 287.72, quantity: 5 }
      ],
      asks: [
        { position: 0, price: 287.79, quantity: 20 },
        { position: 1, price: 287.79, quantity: 7 }
      ]
    });
    expect(grouped.bids).toEqual([{ position: 0, price: 287.72, quantity: 15 }]);
    expect(grouped.asks).toEqual([{ position: 0, price: 287.79, quantity: 27 }]);
  });
});
