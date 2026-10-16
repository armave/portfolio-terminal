import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildHoldingsProjection,
  migrateLegacyHoldingsToPositions,
  PortfolioStore
} from './portfolioStore';
import type { Holding, PositionRecord } from '../types/portfolio';

describe('canonical portfolio-state migration', () => {
  it('migrates legacy holdings into positions with weighted cost basis and stable dates', () => {
    const legacy: Holding[] = [{
      ticker: 'aapl',
      isMargin: true,
      currentPrice: 125,
      analystTarget: 150,
      tranches: [
        { id: 'old-1', shares: 2, entryPrice: 100, purchaseDate: '2026-01-03' },
        { id: 'old-2', shares: 3, entryPrice: 120, purchaseDate: '2026-01-05' }
      ]
    }];

    const positions = migrateLegacyHoldingsToPositions({}, legacy, '2026-10-16');

    expect(positions.AAPL).toMatchObject({
      ticker: 'AAPL',
      shares: 5,
      currentPrice: 125,
      pt: 150,
      commBuy: 0,
      startDate: '2026-01-03',
      tranches: [
        { qty: 2, price: 100, date: '2026-01-03' },
        { qty: 3, price: 120, date: '2026-01-05' }
      ]
    });
  });

  it('keeps canonical positions authoritative when legacy data has the same ticker', () => {
    const canonical: Record<string, PositionRecord> = {
      AAPL: {
        ticker: 'AAPL',
        shares: 7,
        currentPrice: 130,
        pt: 160,
        commBuy: 4,
        tranches: [{ qty: 7, price: 110, date: '2026-02-01', buyCommission: 4 }]
      }
    };
    const legacy: Holding[] = [{
      ticker: 'AAPL',
      isMargin: true,
      currentPrice: 99,
      analystTarget: 100,
      tranches: [{ id: 'legacy', shares: 2, entryPrice: 50, purchaseDate: '2025-01-01' }]
    }];

    const positions = migrateLegacyHoldingsToPositions(canonical, legacy, '2026-10-16');

    expect(positions).toEqual(canonical);
    expect(positions.AAPL.shares).toBe(7);
    expect(positions.AAPL.tranches).toHaveLength(1);
  });

  it('ignores legacy holdings without valid positive share and price lots', () => {
    const legacy: Holding[] = [
      { ticker: 'EMPTY', isMargin: true, tranches: [] },
      { ticker: 'BAD', isMargin: true, tranches: [{ id: 'bad', shares: 3, entryPrice: 0, purchaseDate: '2026-01-01' }] },
      { ticker: '   ', isMargin: true, tranches: [{ id: 'blank', shares: 1, entryPrice: 10, purchaseDate: '2026-01-01' }] }
    ];

    expect(migrateLegacyHoldingsToPositions({}, legacy, '2026-10-16')).toEqual({});
  });

  it('rebuilds the legacy holdings projection from canonical positions while preserving legacy metadata', () => {
    const positions: Record<string, PositionRecord> = {
      MSFT: {
        ticker: 'MSFT',
        shares: 4,
        currentPrice: 420,
        pt: 460,
        commBuy: 2,
        startDate: '2026-03-01',
        tranches: [
          { qty: 4, price: 400, date: '2026-03-01', buyCommission: 2 }
        ]
      }
    };
    const legacy: Holding[] = [{
      ticker: 'MSFT',
      isMargin: true,
      notes: 'Keep this user note',
      tranches: []
    }];

    expect(buildHoldingsProjection(positions, legacy, '2026-10-16')).toEqual([{
      ticker: 'MSFT',
      isMargin: true,
      notes: 'Keep this user note',
      tranches: [{
        id: 'MSFT-0',
        shares: 4,
        entryPrice: 400,
        purchaseDate: '2026-03-01',
        targetPrice: 460
      }],
      currentPrice: 420,
      analystTarget: 460
    }]);
  });

  it('does not create compatibility holdings for an empty canonical positions map', () => {
    expect(buildHoldingsProjection({}, [], '2026-10-16')).toEqual([]);
  });
});


describe('canonical trade lifecycle and persistence', () => {
  const stored = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, String(value)); },
    removeItem: (key: string) => { stored.delete(key); }
  };

  afterEach(() => {
    stored.clear();
    vi.unstubAllGlobals();
  });

  it('persists buys, partial sells, and full exits without resurrecting closed positions on reload', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.buyStock('aapl', 5, 100, '2026-10-01');
    const afterBuy = store.getState();
    expect(afterBuy.positions.AAPL.shares).toBe(5);
    expect(afterBuy.holdings.find((holding) => holding.ticker === 'AAPL')?.tranches)
      .toHaveLength(1);

    const afterBuyReload = new PortfolioStore().getState();
    expect(afterBuyReload.positions.AAPL.shares).toBe(5);
    expect(afterBuyReload.holdings.find((holding) => holding.ticker === 'AAPL')?.tranches)
      .toHaveLength(1);

    store.sellStock('AAPL', 2, 120, '2026-10-10');
    expect(store.getState().positions.AAPL.shares).toBe(3);
    expect(store.getState().positions.AAPL.tranches).toEqual([
      expect.objectContaining({ qty: 3, price: 100 })
    ]);
    expect(store.getState().closedTrades).toHaveLength(1);

    const afterPartialReload = new PortfolioStore().getState();
    expect(afterPartialReload.positions.AAPL.shares).toBe(3);
    expect(afterPartialReload.holdings.find((holding) => holding.ticker === 'AAPL')?.tranches)
      .toEqual([expect.objectContaining({ shares: 3, entryPrice: 100 })]);
    expect(afterPartialReload.closedTrades).toHaveLength(1);

    store.sellStock('AAPL', 'ALL', 130, '2026-10-16');
    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().holdings.some((holding) => holding.ticker === 'AAPL')).toBe(false);
    expect(store.getState().closedTrades).toHaveLength(2);

    const afterFullExitReload = new PortfolioStore().getState();
    expect(afterFullExitReload.positions.AAPL).toBeUndefined();
    expect(afterFullExitReload.holdings.some((holding) => holding.ticker === 'AAPL')).toBe(false);
    expect(afterFullExitReload.closedTrades).toHaveLength(2);

    // Repeated app/cloud synchronization may still pass a stale compatibility
    // snapshot. It must never turn that snapshot back into an active position.
    const reloadedStore = new PortfolioStore();
    reloadedStore.importState({
      holdings: [{
        ticker: 'AAPL',
        isMargin: true,
        currentPrice: 130,
        analystTarget: 110,
        tranches: [{
          id: 'stale-aapl',
          shares: 5,
          entryPrice: 100,
          purchaseDate: '2026-10-01'
        }]
      }]
    });
    expect(reloadedStore.getState().positions.AAPL).toBeUndefined();
    expect(reloadedStore.getState().holdings.some((holding) => holding.ticker === 'AAPL')).toBe(false);
    expect(reloadedStore.getState().closedTrades).toHaveLength(2);
  });
});
