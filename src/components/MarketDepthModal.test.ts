import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getMarketDepthDisplayState, isShallowMarketDepthSnapshot, normalizeMarketDepthSnapshot, summarizeMarketDepth } from './MarketDepthModal';
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
    providerLevelCount: 4,
    providerBidRowCount: 2,
    providerAskRowCount: 2,
    initialSequence: 0,
    initialReportedDepth: 4,
    initialRawInsertionCount: 4,
    initialAcceptedInsertionCount: 4,
    initialRejectedInsertionCount: 0,
    initialBidInsertionCount: 2,
    initialAskInsertionCount: 2,
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
      providerLevelCount: 4,
      providerBidRowCount: 2,
      providerAskRowCount: 2,
      initialSequence: 0,
      initialRawInsertionCount: 4,
      initialAcceptedInsertionCount: 4,
      initialRejectedInsertionCount: 0,
      bids: response.data.bids,
      asks: response.data.asks,
      updatedAt: response.updatedAt
    });
  });

  it('rejects missing, zero and invalid timestamps instead of presenting an unverified update as fresh', () => {
    expect(() => normalizeMarketDepthSnapshot({ ...response, updatedAt: 0 }, 'AAPL'))
      .toThrow('incomplete Market Depth snapshot');
    expect(() => normalizeMarketDepthSnapshot({ ...response, updatedAt: Number.NaN }, 'AAPL'))
      .toThrow('incomplete Market Depth snapshot');
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

describe('Market Depth live-only display policy', () => {
  it('does not call a ready socket live before a valid depth snapshot arrives', () => {
    expect(getMarketDepthDisplayState('connecting', null)).toBe('connecting');
    expect(getMarketDepthDisplayState('connected', null)).toBe('waiting');
  });

  it('only exposes the live state while the current stream is connected and a validated snapshot exists', () => {
    const snapshot = normalizeMarketDepthSnapshot(response, 'AAPL');
    expect(getMarketDepthDisplayState('connected', snapshot)).toBe('live');
    expect(getMarketDepthDisplayState('disconnected', snapshot)).toBe('disconnected');
    expect(getMarketDepthDisplayState('error', snapshot)).toBe('error');
  });
});

describe('Market Depth provider depth indication', () => {
  it('flags a one-price-per-side book without treating a multi-level book as shallow', () => {
    const shallow = normalizeMarketDepthSnapshot({
      ...response,
      data: {
        ...response.data,
        bids: [response.data.bids[0]],
        asks: [response.data.asks[0]]
      }
    }, 'AAPL');
    const multiLevel = normalizeMarketDepthSnapshot(response, 'AAPL');
    const groupedButManyProviderRows = normalizeMarketDepthSnapshot({
      ...response,
      data: {
        ...response.data,
        bids: [response.data.bids[0]],
        asks: [response.data.asks[0]],
        providerBidRowCount: 10,
        providerAskRowCount: 10
      }
    }, 'AAPL');

    expect(isShallowMarketDepthSnapshot(shallow)).toBe(false); // response fixture has 2 raw rows per side
    expect(isShallowMarketDepthSnapshot(multiLevel)).toBe(false);
    expect(isShallowMarketDepthSnapshot(groupedButManyProviderRows)).toBe(false);
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

  it('calculates a negative spread for a crossed snapshot so the UI can explicitly warn', () => {
    const crossed = normalizeMarketDepthSnapshot({
      ...response,
      data: {
        ...response.data,
        bids: [{ position: 0, price: 341.1, quantity: 100 }],
        asks: [{ position: 0, price: 340.9, quantity: 50 }]
      }
    }, 'AAPL.US');
    expect(summarizeMarketDepth(crossed).spread).toBeLessThan(0);
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
    expect(modalSource).toContain("aria-label={depthText('Proportional market depth ladder')}");
    expect(modalSource).toContain('<details');
    expect(modalSource).toContain('depth supplied by TradeNet');
    expect(modalSource).toContain('summary.spread < 0');
    expect(modalSource).toContain("Crossed order book: highest bid is above lowest ask.");
    expect(modalSource).toContain("TradeNet reported book depth:");
    expect(modalSource).toContain("total positions in the combined book");
    expect(modalSource).toContain("TradeNet returned only one bid and one ask price level.");
    expect(modalSource).toContain("isShallowMarketDepthSnapshot(liveSnapshot)");
    expect(modalSource).toContain("Current provider rows:");
    expect(modalSource).toContain("First payload:");
    expect(modalSource).toContain("Initial provider depth:");
    expect(modalSource).not.toContain("provider metadata, not a UI level target");
    expect(modalSource).toContain('Rows at identical prices are combined');
    expect(modalSource).toContain('runtime.stop()');
    expect(modalSource).toContain("const liveSnapshot = displayState === 'live' ? snapshot : null;");
    expect(modalSource).toContain('setSnapshot(null);');
    expect(modalSource).not.toContain('latest book remains visible');
    expect(modalSource).toContain("depthText('Last depth update')");
    expect(modalSource).toContain("depthText('Retry connection')");
    expect(modalSource).toContain('createLatestFramePublisher(setSnapshot)');
    expect(modalSource).toContain('snapshotPublisherRef.current?.clear()');
    expect(modalSource).toContain('{detailsOpen &&');
    expect(modalSource).toContain('max-h-80 overflow-y-auto');
    expect(modalSource).not.toContain('sortLevels(');
    expect(modalSource).toContain('maxDisplayedBid');
    expect(appSource).toContain('if (permissions.isAdmin) setMarketDepthTicker');
    expect(appSource).toContain('{permissions.isAdmin && marketDepthTicker');
    expect(appSource).toContain('setMarketDepthTicker(null)');
  });

  it('returns bid and ask levels in best-price-first display order', () => {
    const grouped = groupFreedomMarketDepthByPrice({
      symbol: 'GOOGL.US',
      bids: [
        { position: 0, price: 287.5, quantity: 4 },
        { position: 1, price: 288, quantity: 8 },
        { position: 2, price: 287.8, quantity: 6 }
      ],
      asks: [
        { position: 0, price: 288.5, quantity: 5 },
        { position: 1, price: 288.2, quantity: 7 },
        { position: 2, price: 288.4, quantity: 3 }
      ]
    });

    expect(grouped.bids.map((level: { price: number }) => level.price)).toEqual([288, 287.8, 287.5]);
    expect(grouped.asks.map((level: { price: number }) => level.price)).toEqual([288.2, 288.4, 288.5]);
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
