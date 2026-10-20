import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildHoldingsProjection,
  migrateLegacyHoldingsToPositions,
  migrateLegacyCloudHoldingsToPositions,
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


describe('legacy cloud snapshot migration safety', () => {
  const legacyHolding: Holding = {
    ticker: 'AAPL',
    isMargin: true,
    currentPrice: 130,
    analystTarget: 145,
    tranches: [{
      id: 'legacy-aapl',
      shares: 5,
      entryPrice: 100,
      purchaseDate: '2026-10-01'
    }]
  };

  it('migrates a legacy-only cloud snapshot when no canonical local position conflicts', () => {
    const result = migrateLegacyCloudHoldingsToPositions(
      { holdings: [legacyHolding] },
      { positions: {}, closedTrades: [] },
      '2026-10-16'
    );

    expect(result.positions?.AAPL).toMatchObject({
      ticker: 'AAPL',
      shares: 5,
      currentPrice: 130,
      tranches: [{ qty: 5, price: 100, date: '2026-10-01' }]
    });
  });

  it('preserves canonical local positions over legacy cloud holdings', () => {
    const localPosition: PositionRecord = {
      ticker: 'AAPL',
      shares: 2,
      currentPrice: 120,
      pt: 140,
      commBuy: 1,
      tranches: [{ qty: 2, price: 110, date: '2026-10-12' }]
    };
    const result = migrateLegacyCloudHoldingsToPositions(
      { holdings: [legacyHolding] },
      { positions: { AAPL: localPosition }, closedTrades: [] },
      '2026-10-16'
    );

    expect(result.positions?.AAPL).toEqual(localPosition);
  });

  it('does not resurrect a locally closed ticker from a stale legacy cloud snapshot', () => {
    const result = migrateLegacyCloudHoldingsToPositions(
      { holdings: [legacyHolding] },
      {
        positions: {},
        closedTrades: [{
          ticker: 'AAPL',
          shares: 5,
          exitDate: '2026-10-10',
          netProfit: 100
        }]
      },
      '2026-10-16'
    );

    expect(result.positions?.AAPL).toBeUndefined();
  });

  it('does not run legacy migration when the cloud explicitly contains canonical positions', () => {
    const result = migrateLegacyCloudHoldingsToPositions(
      { positions: {}, holdings: [legacyHolding] },
      { positions: {}, closedTrades: [] },
      '2026-10-16'
    );

    expect(result.positions).toEqual({});
  });

  it('allows a legacy holding purchased after the latest local exit', () => {
    const reopened = {
      ...legacyHolding,
      tranches: [{
        id: 'legacy-rebuy',
        shares: 3,
        entryPrice: 115,
        purchaseDate: '2026-10-12'
      }]
    };
    const result = migrateLegacyCloudHoldingsToPositions(
      { holdings: [reopened] },
      {
        positions: {},
        closedTrades: [{
          ticker: 'AAPL',
          shares: 5,
          exitDate: '2026-10-10',
          netProfit: 100
        }]
      },
      '2026-10-16'
    );

    expect(result.positions?.AAPL?.shares).toBe(3);
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

  it('uses the same default broker assumptions as the application settings', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    expect(store.getState().brokerAssumptions).toMatchObject({
      annualRate: 0.15,
      annualBorrowRate: 0.15,
      dayCountBasis: 365,
      rolloverHour: 4,
      rolloverMinute: 0,
      commPerShare: 0.012,
      commVolumePct: 0.0012,
      minCommOrder: 1.2
    });
  });

  it('does not migrate stale holdings when persisted canonical positions are explicitly empty', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      positions: {},
      holdings: [{
        ticker: 'AAPL',
        isMargin: true,
        currentPrice: 120,
        analystTarget: 130,
        tranches: [{
          id: 'stale-aapl',
          shares: 5,
          entryPrice: 100,
          purchaseDate: '2026-10-01'
        }]
      }],
      closedTrades: [{
        ticker: 'AAPL',
        shares: 5,
        exitDate: '2026-10-10',
        netProfit: 100
      }],
      balance: 0,
      cashCushion: { freeCash: 0, holdings: [] }
    }));

    const store = new PortfolioStore();
    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().holdings.some((holding) => holding.ticker === 'AAPL')).toBe(false);
  });

  it('migrates persisted legacy holdings when the positions field is genuinely absent', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      holdings: [{
        ticker: 'MSFT',
        isMargin: true,
        currentPrice: 420,
        analystTarget: 460,
        tranches: [{
          id: 'legacy-msft',
          shares: 2,
          entryPrice: 400,
          purchaseDate: '2026-10-01'
        }]
      }],
      balance: -800,
      cashCushion: { freeCash: 0, holdings: [] }
    }));

    const store = new PortfolioStore();
    expect(store.getState().positions.MSFT).toMatchObject({
      shares: 2,
      tranches: [{ qty: 2, price: 400, date: '2026-10-01' }]
    });
  });

  it('preserves valid zero-valued broker assumptions', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.updateAssumptions({
      annualRate: 0,
      annualBorrowRate: 0,
      maintenanceMarginRatio: 0,
      maintenanceEquityRatio: 0
    });

    expect(store.getState().brokerAssumptions).toMatchObject({
      annualRate: 0,
      annualBorrowRate: 0,
      maintenanceMarginRatio: 0,
      maintenanceEquityRatio: 0
    });
  });

  it('does not charge margin interest when the configured annual rate is zero', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.updateAssumptions({ annualRate: 0, annualBorrowRate: 0 });
    store.buyStock('AAPL', 1, 100, '2026-10-15');
    store.setMarginDebt(110);
    store.sellStock('AAPL', 'ALL', 120, '2026-10-16');

    expect(store.getState().closedTrades[0].marginInterest).toBe(0);
  });

  it('clears prior margin debt when a positive cash balance is entered', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.setMarginDebt(250);
    expect(store.getState().balance).toBe(-250);

    store.setCashBalance(500);
    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBe(500);
    expect(store.getState().cashBalance).toBe(500);

    store.setCashBalance(-125);
    expect(store.getState().balance).toBe(-125);
    expect(store.getState().cashCushion.freeCash).toBe(0);
    expect(store.getState().cashBalance).toBe(0);
  });

  it('uses free cash before borrowing and applies sale proceeds to debt before cash across FIFO tranches', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({ commPerShare: 0, commVolumePct: 0, minCommOrder: 0, annualRate: 0, annualBorrowRate: 0 });
    store.setCashBalance(250);

    store.buyStock('AAPL', 1, 100, '2026-10-14');
    expect(store.getState().cashCushion.freeCash).toBe(150);
    expect(store.getState().balance).toBe(0);

    store.buyStock('AAPL', 2, 100, '2026-10-15');
    expect(store.getState().cashCushion.freeCash).toBe(0);
    expect(store.getState().balance).toBe(-50);
    expect(store.getState().positions.AAPL.tranches).toHaveLength(2);

    store.sellStock('AAPL', 1, 120, '2026-10-16');
    expect(store.getState().positions.AAPL.tranches).toEqual([
      expect.objectContaining({ qty: 2, price: 100, date: '2026-10-15' })
    ]);
    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBe(70);

    store.sellStock('AAPL', 'ALL', 120, '2026-10-17');
    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBe(310);
  });

  it('allocates buy commissions from the FIFO tranche actually sold', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commissionPerShare: 0,
      commVolumePct: 0.01,
      commissionRatePct: 0.01,
      minCommOrder: 0,
      commissionMin: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.setCashBalance(5_000);

    store.buyStock('AAPL', 1, 100, '2026-10-14');
    store.buyStock('AAPL', 1, 1_000, '2026-10-15');
    expect(store.getState().positions.AAPL?.tranches?.map((tranche) => tranche.buyCommission)).toEqual([1, 10]);

    store.sellStock('AAPL', 1, 200, '2026-10-16');

    expect(store.getState().closedTrades[0]?.commissions).toBe(3);
    expect(store.getState().positions.AAPL.commBuy).toBe(10);
    expect(store.getState().positions.AAPL.tranches).toEqual([
      expect.objectContaining({ qty: 1, price: 1_000, buyCommission: 10 })
    ]);
  });

  it('credits sale proceeds without deducting already-accrued margin interest twice', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.buyStock('AAPL', 1, 100, '2026-10-15');
    store.setMarginDebt(110);
    store.sellStock('AAPL', 'ALL', 120, '2026-10-16');

    // $120 proceeds - $1.20 sell commission - $110 debt = $8.80 free cash.
    // Accrued interest remains in the realized P&L record, not deducted twice.
    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBeCloseTo(8.8, 2);
    expect(store.getState().closedTrades[0].marginInterest).toBeGreaterThan(0);
  });

  it('returns to the combined desk after selling the final share of the active ticker', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({ commPerShare: 0, commVolumePct: 0, minCommOrder: 0, annualRate: 0, annualBorrowRate: 0 });

    store.buyStock('AAPL', 2, 100, '2026-10-15');
    expect(store.getState().activeView).toBe('AAPL');

    store.sellStock('AAPL', 'ALL', 110, '2026-10-16');

    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().activeView).toBe('COMBINED');
    expect(store.getState().selectedTicker).toBeNull();
  });

  it('ignores stale quote responses after a trade and never recreates a fully closed position', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.buyStock('AAPL', 5, 100, '2026-10-15');
    const lastTradeAt = store.getState().positions.AAPL.lastTradeAt || Date.now();

    store.updateLiveQuote('AAPL', {
      price: 90,
      requestStartedAt: lastTradeAt - 1
    });
    expect(store.getState().positions.AAPL.currentPrice).toBe(100);

    store.updateLiveQuote('AAPL', {
      price: 101,
      requestStartedAt: lastTradeAt + 1
    });
    expect(store.getState().positions.AAPL.currentPrice).toBe(101);

    store.updatePrice('AAPL', 105);
    const manualPriceAt = store.getState().positions.AAPL.lastTradeAt || Date.now();
    store.updateLiveQuote('AAPL', {
      price: 92,
      requestStartedAt: manualPriceAt - 1
    });
    expect(store.getState().positions.AAPL.currentPrice).toBe(105);

    store.sellStock('AAPL', 'ALL', 101, '2026-10-16');
    store.updateLiveQuote('AAPL', { price: 99 });

    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().holdings.some((holding) => holding.ticker === 'AAPL')).toBe(false);
  });

  it('keeps the newest quote request for positions and cash holdings when responses finish out of order', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.buyStock('AAPL', 2, 100, '2026-10-15');
    store.addCashStock('MSFT', 3, 200);
    store.setState({ cashStocks: [{ ticker: 'MSFT', shares: 3, currentPrice: 200 }] });
    const requestBase = Date.now() + 1000;

    store.updateLiveQuote('AAPL', { price: 110, requestStartedAt: requestBase + 200, quoteSource: 'Provider B' });
    store.updateLiveQuote('AAPL', { price: 105, requestStartedAt: requestBase + 100, quoteSource: 'Provider A' });
    expect(store.getState().positions.AAPL.currentPrice).toBe(110);
    expect(store.getState().positions.AAPL.quoteSource).toBe('Provider B');

    store.updateLiveQuote('MSFT', { price: 220, requestStartedAt: requestBase + 200, quoteSource: 'Provider B' });
    store.updateLiveQuote('MSFT', { price: 205, requestStartedAt: requestBase + 100, quoteSource: 'Provider A' });
    expect(store.getState().cashStocks?.find((holding) => holding.ticker === 'MSFT')?.currentPrice).toBe(220);
    expect(store.getState().cashCushion.holdings.find((holding) => holding.ticker === 'MSFT')?.currentPrice).toBe(220);
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
