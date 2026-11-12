import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHoldingsProjection,
  migrateLegacyHoldingsToPositions,
  migrateLegacyCloudHoldingsToPositions,
  PortfolioStore,
  subscribeToPortfolioState,
  subscribeToPortfolioSelector,
  subscribeToActiveView
} from './portfolioStore';
import type { Holding, PositionRecord } from '../types/portfolio';
import { createPortfolioTransactionEvent, inspectPortfolioTransactionJournalReplayCoverage, verifyPortfolioTransactionParity } from '../domain/portfolioTransactionJournal';
import { replayPortfolioTransactionLots, verifyPortfolioTransactionLotParity } from '../domain/portfolioLotJournal';
import { normalizeFinnhubStockSplits } from '../services/corporateActions';
import { createMarketHistoryCorrectionEvent } from '../services/marketHistoryCorrections';
import type { PortfolioState } from '../types/portfolio';
import { flushSavedHistoryPersistence } from '../services/storage';

const sharedTestStorage = new Map<string, string>();
const sharedLocalStorage = {
  getItem: (key: string) => sharedTestStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { sharedTestStorage.set(key, String(value)); },
  removeItem: (key: string) => { sharedTestStorage.delete(key); }
};

beforeEach(() => {
  sharedTestStorage.clear();
  vi.stubGlobal('localStorage', sharedLocalStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});


describe('portfolio selector subscriptions', () => {
  it('replays selected values and ignores unrelated portfolio and quote updates', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 2,
          currentPrice: 100,
          pt: 120,
          commBuy: 0,
          tranches: [{ qty: 2, price: 90, date: '2026-10-01' }]
        }
      }
    });

    const selectTickers = (state: ReturnType<typeof store.getState>) => Object.keys(state.positions || {});
    const areSameTickers = (previous: string[], next: string[]) =>
      previous.length === next.length && previous.every((ticker, index) => ticker === next[index]);
    const listener = vi.fn();
    const unsubscribe = subscribeToPortfolioSelector(selectTickers, listener, areSameTickers, store);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(['AAPL']);

    store.setState({ balance: 123 });
    store.setState({
      positions: {
        AAPL: {
          ...store.getState().positions.AAPL,
          currentPrice: 105
        }
      }
    });

    expect(listener).toHaveBeenCalledTimes(1);

    store.setState({
      positions: {
        ...store.getState().positions,
        MSFT: {
          ticker: 'MSFT',
          shares: 1,
          currentPrice: 200,
          pt: 220,
          commBuy: 0,
          tranches: [{ qty: 1, price: 180, date: '2026-10-02' }]
        }
      }
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(['AAPL', 'MSFT']);

    unsubscribe();
    store.setState({ balance: 456 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('supports primitive selectors for app-shell visibility flags', () => {
    const store = new PortfolioStore();
    const selectHasPositions = (state: ReturnType<typeof store.getState>) =>
      Object.keys(state.positions || {}).length > 0;
    const listener = vi.fn();
    const unsubscribe = subscribeToPortfolioSelector(selectHasPositions, listener, Object.is, store);

    expect(listener).toHaveBeenLastCalledWith(false);
    store.setState({ balance: 500 });
    expect(listener).toHaveBeenCalledTimes(1);

    store.setState({
      positions: {
        GOOGL: {
          ticker: 'GOOGL',
          shares: 1,
          currentPrice: 300,
          pt: 350,
          commBuy: 0,
          tranches: [{ qty: 1, price: 250, date: '2026-10-01' }]
        }
      }
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(true);
    unsubscribe();
  });
});

describe('portfolio store snapshot subscriptions', () => {
  it('delivers the latest snapshot immediately and continues streaming updates', () => {
    const store = new PortfolioStore();
    store.setState({
      brokerExecutedTrades: [{ id: 'startup-trade', ticker: 'GOOGL', side: 'BUY' }] as any
    });
    const listener = vi.fn();
    const unsubscribe = subscribeToPortfolioState(listener, store);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(store.getState());
    expect(listener.mock.calls[0][0].brokerExecutedTrades).toEqual([
      expect.objectContaining({ id: 'startup-trade' })
    ]);

    store.setState({
      brokerExecutedTrades: [
        { id: 'startup-trade', ticker: 'GOOGL', side: 'BUY' },
        { id: 'startup-sell', ticker: 'GOOGL', side: 'SELL' }
      ] as any
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].brokerExecutedTrades).toHaveLength(2);

    unsubscribe();
    store.setState({ balance: 123 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});


describe('device-local desk navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates the selected desk without normalizing or notifying portfolio subscribers', () => {
    const stored = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => stored.set(key, String(value)));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem,
      removeItem: (key: string) => stored.delete(key)
    });

    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 2,
          currentPrice: 190,
          pt: 210,
          commBuy: 0,
          tranches: [{ qty: 2, price: 180, date: '2026-10-01' }]
        }
      },
      activeView: 'COMBINED'
    });

    const portfolioListener = vi.fn();
    const activeViewListener = vi.fn();
    const unsubscribePortfolio = store.subscribe(portfolioListener);
    const unsubscribeActiveView = store.subscribeActiveView(activeViewListener);
    const before = store.getState();
    setItem.mockClear();

    store.setActiveView('AAPL');

    expect(store.getState().activeView).toBe('AAPL');
    expect(store.getState().selectedTicker).toBe('AAPL');
    expect(store.getState().positions).toBe(before.positions);
    expect(store.getState().brokerAssumptions).toBe(before.brokerAssumptions);
    expect(portfolioListener).not.toHaveBeenCalled();
    expect(activeViewListener).toHaveBeenCalledTimes(1);
    expect(activeViewListener).toHaveBeenLastCalledWith('AAPL');
    expect(setItem.mock.calls).toEqual([['portfolio_active_view', 'AAPL']]);

    unsubscribePortfolio();
    unsubscribeActiveView();
  });

  it('replays the current desk and reports later normalized view changes', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        MSFT: {
          ticker: 'MSFT',
          shares: 1,
          currentPrice: 400,
          pt: 440,
          commBuy: 0,
          tranches: [{ qty: 1, price: 400, date: '2026-10-01' }]
        }
      },
      activeView: 'MSFT'
    });

    const listener = vi.fn();
    const unsubscribe = subscribeToActiveView(listener, store);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('MSFT');

    store.importState({ positions: {}, activeView: 'MSFT' });
    expect(listener.mock.calls.map(([view]) => view)).toEqual(['MSFT', 'COMBINED']);

    unsubscribe();
  });
});

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

  it('normalizes legacy ticker metadata and preserves the first matching row', () => {
    const positions: Record<string, PositionRecord> = {
      AAPL: { ticker: 'AAPL', shares: 2, currentPrice: 190, pt: 210, commBuy: 0, tranches: [] },
      MSFT: { ticker: 'MSFT', shares: 3, currentPrice: 420, pt: 450, commBuy: 0, tranches: [] }
    };
    const legacy: Holding[] = [
      { ticker: ' aapl ', isMargin: false, notes: 'First AAPL row', tranches: [] },
      { ticker: 'AAPL', isMargin: true, notes: 'Duplicate AAPL row', tranches: [] },
      { ticker: 'msft', isMargin: false, notes: 'MSFT metadata', tranches: [] }
    ];

    const projection = buildHoldingsProjection(positions, legacy, '2026-10-16');

    expect(projection.map(({ ticker, notes, isMargin }) => ({ ticker, notes, isMargin }))).toEqual([
      { ticker: 'AAPL', notes: 'First AAPL row', isMargin: true },
      { ticker: 'MSFT', notes: 'MSFT metadata', isMargin: true }
    ]);
  });

  it('does not create compatibility holdings for an empty canonical positions map', () => {
    expect(buildHoldingsProjection({}, [], '2026-10-16')).toEqual([]);
  });
});


describe('legacy cloud snapshot migration safety', () => {
  it('normalizes prototype-sensitive legacy ticker keys without mutating object prototypes', () => {
    const store = new PortfolioStore();
    const importedPositions = JSON.parse(`{
      "__proto__": {
        "ticker": "__proto__", "shares": 1, "currentPrice": 10, "pt": 12, "commBuy": 0,
        "tranches": [{ "qty": 1, "price": 9, "date": "2026-10-01" }]
      },
      "constructor": {
        "ticker": "constructor", "shares": 2, "currentPrice": 20, "pt": 22, "commBuy": 0,
        "tranches": [{ "qty": 2, "price": 19, "date": "2026-10-02" }]
      }
    }`);

    expect(store.importState({ positions: importedPositions })).toBe(true);
    const positions = store.getState().positions;

    expect(Object.getPrototypeOf(positions)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(positions, '__PROTO__')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(positions, 'CONSTRUCTOR')).toBe(true);
    expect(positions.__PROTO__.ticker).toBe('__PROTO__');
    expect(positions.CONSTRUCTOR.ticker).toBe('CONSTRUCTOR');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
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

  it('compares legacy rebuy dates against the latest normalized local close per ticker', () => {
    const reopenedAfterOlderExit = {
      ...legacyHolding,
      tranches: [{
        id: 'legacy-rebuy-too-early',
        shares: 2,
        entryPrice: 115,
        purchaseDate: '2026-10-11'
      }]
    };
    const reopenedAfterLatestExit = {
      ...legacyHolding,
      ticker: ' msft ',
      tranches: [{
        id: 'legacy-rebuy-after-latest-exit',
        shares: 3,
        entryPrice: 415,
        purchaseDate: '2026-10-14'
      }]
    };
    const result = migrateLegacyCloudHoldingsToPositions(
      { holdings: [reopenedAfterOlderExit, reopenedAfterLatestExit] },
      {
        positions: {},
        closedTrades: [
          { ticker: 'AAPL', shares: 5, exitDate: '2026-10-10', netProfit: 100 },
          { ticker: ' aapl ', shares: 2, closedAt: '2026-10-12T12:00:00Z', netProfit: 20 },
          { ticker: 'MSFT', shares: 1, sellDate: '2026-10-13', netProfit: 10 }
        ]
      },
      '2026-10-16'
    );

    expect(result.positions?.AAPL).toBeUndefined();
    expect(result.positions?.MSFT?.shares).toBe(3);
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

  it('restores a cached TradeNet account snapshot, including legacy records without status metadata', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const brokerAccountInfo = {
      loaded: true,
      balances: [{
        currency: 'USD',
        amount: 1250,
        forecastIn: 0,
        forecastOut: 0,
        t2In: 0,
        t2Out: 0
      }],
      positions: [{
        ticker: 'AAPL',
        name: 'Apple',
        quantity: 3,
        currency: 'USD',
        marketPrice: 190,
        marketValue: 570,
        averagePrice: 180,
        profitClose: 30,
        accountPositionId: 1
      }],
      receivedAt: 1761930000000
    };
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      positions: {},
      brokerAccountInfo,
      balance: 1250,
      cashCushion: { freeCash: 1250, holdings: [] }
    }));

    const state = new PortfolioStore().getState();

    expect(state.brokerAccountInfo).toEqual(brokerAccountInfo);
    expect(state.balance).toBe(1250);
    expect(state.cashCushion.freeCash).toBe(1250);
  });

  it('normalizes malformed persisted position and cash-holding records safely', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      positions: {
        AAPL: null,
        MSFT: { ticker: 'MSFT', shares: 'not-a-number', currentPrice: 420 },
        NVDA: {
          ticker: 'nvda',
          shares: 2,
          currentPrice: 'invalid',
          pt: 'invalid',
          commBuy: 'invalid',
          tranches: 'not-an-array'
        }
      },
      cashCushion: {
        freeCash: 'invalid',
        holdings: [
          null,
          { ticker: '', shares: 2 },
          { ticker: 'TSLA', shares: 'invalid', currentPrice: 300 },
          { ticker: 'AMD', shares: 1, currentPrice: 100 }
        ]
      },
      balance: 'Infinity',
      realizedMarginCharged: 'NaN'
    }));

    const state = new PortfolioStore().getState();

    expect(state.balance).toBe(0);
    expect(state.realizedMarginCharged).toBe(0);
    expect(state.positions.AAPL).toBeUndefined();
    expect(state.positions.MSFT).toBeUndefined();
    expect(state.positions.NVDA).toMatchObject({
      ticker: 'NVDA',
      shares: 2,
      currentPrice: 0,
      pt: 0,
      commBuy: 0,
      tranches: []
    });
    expect(state.holdings.map((holding) => holding.ticker)).toEqual(['NVDA']);
    expect(state.cashCushion.freeCash).toBe(0);
    expect(state.cashCushion.holdings).toEqual([
      expect.objectContaining({ ticker: 'AMD', shares: 1 })
    ]);
  });

  it('keeps legacy tranche quantities when hydrating persisted canonical positions', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      positions: {
        GOOGL: {
          ticker: 'GOOGL',
          shares: 69,
          currentPrice: 423,
          pt: 353,
          commBuy: 0,
          tranches: [
            { id: 'legacy-shares', shares: 5, entryPrice: 282, purchaseDate: '2026-10-29' },
            { id: 'zero-qty-placeholder', qty: 0, shares: 14, price: 282, date: '2026-10-29' },
            { id: 'broker-quantity', quantity: 10, averagePrice: 328, entryDate: '2026-10-22' }
          ]
        }
      }
    }));

    const state = new PortfolioStore().getState();

    expect(state.positions.GOOGL.tranches).toMatchObject([
      { qty: 5, price: 282, date: '2026-10-29' },
      { qty: 14, price: 282, date: '2026-10-29' },
      { qty: 10, price: 328, date: '2026-10-22' }
    ]);
    expect(state.holdings[0].tranches.map((tranche) => tranche.shares)).toEqual([5, 14, 10]);
  });

  it('restores operation-level cash/margin classifications from persisted state', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      positions: {},
      activeTrancheTypes: {
        'AAPL:1767261600000:buy-1': 'margin',
        'MSFT:1767265200000:buy-2': 'cash',
        'GOOGL:1767268800000:buy-3': 'mix'
      },
      activeTrancheMixes: {
        'GOOGL:1767268800000:buy-3': { cash: 3, margin: 2 }
      },
      activeTrancheGuestAssignments: {
        'MSFT:1767265200000:buy-2': 'guest-account-id',
        'GOOGL:1767268800000:buy-3': 'guest-account-id'
      },
      activeTrancheGuestAssignmentDetails: {
        'MSFT:1767265200000:buy-2': {
          assignmentId: 'assignment-msft', guestId: 'guest-account-id',
          assignedAt: 1767265200000, assignedQuantity: 4
        }
      },
      guestTrancheLedger: [{
        assignmentId: 'assignment-msft', trancheId: 'MSFT:1767265200000:buy-2',
        ticker: 'MSFT', name: 'Microsoft', assignedQuantity: 4, openQuantity: 2,
        averagePrice: 300, purchasedAt: 1767265200000, assignedAt: 1767265200000,
        updatedAt: 1767265200000, endedAt: null, status: 'active'
      }],
      cashCushion: { freeCash: 0, holdings: [] }
    }));

    const store = new PortfolioStore();

    expect(store.getState().activeTrancheTypes).toEqual({
      'AAPL:1767261600000:buy-1': 'margin',
      'MSFT:1767265200000:buy-2': 'cash',
      'GOOGL:1767268800000:buy-3': 'mix'
    });
    expect(store.getState().activeTrancheMixes).toEqual({
      'GOOGL:1767268800000:buy-3': { cash: 3, margin: 2 }
    });
    expect(store.getState().activeTrancheGuestAssignments).toEqual({
      'MSFT:1767265200000:buy-2': 'guest-account-id',
      'GOOGL:1767268800000:buy-3': 'guest-account-id'
    });
    expect(store.getState().activeTrancheGuestAssignmentDetails).toMatchObject({
      'MSFT:1767265200000:buy-2': {
        assignmentId: 'assignment-msft', guestId: 'guest-account-id', assignedQuantity: 4
      }
    });
    expect(store.getState().guestTrancheLedger).toMatchObject([{
      assignmentId: 'assignment-msft', status: 'active', openQuantity: 2
    }]);
  });

  it('normalizes unsupported active views without relying on render-time mutation', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.importState({ activeView: 'MISSING_TICKER' });
    expect(store.getState().activeView).toBe('COMBINED');

    store.importState({
      activeView: 'AAPL',
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 1,
          currentPrice: 100,
          pt: 110,
          commBuy: 0,
          tranches: [{ qty: 1, price: 100, date: '2026-10-01' }]
        }
      }
    });
    expect(store.getState().activeView).toBe('AAPL');

    store.importState({ activeView: 'GUEST_HISTORY' });
    expect(store.getState().activeView).toBe('GUEST_HISTORY');
  });

  it('uses the same default broker assumptions as the application settings', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    expect(store.getState().brokerAssumptions).toMatchObject({
      annualBorrowRate: 0.15,
      dayCountBasis: 365,
      rolloverHour: 4,
      rolloverMinute: 0,
      commissionPerShare: 0.012,
      commissionRatePct: 0.0012,
      commissionMin: 1.2
    });
  });

  it('normalizes legacy broker settings and gives the saved rules record precedence over the portfolio snapshot', () => {
    stored.set('margin_portfolio_state_dynamic_v2', JSON.stringify({
      brokerAssumptions: {
        annualBorrowRate: 0.2, dayCountBasis: 365, maintenanceEquityRatio: 0.3,
        rolloverHour: 4, rolloverMinute: 0, rolloverTimeZone: 'Asia/Yerevan',
        commissionPerShare: 0.04, commissionRatePct: 0.004, commissionMin: 4, stopOutRatio: 0
      }
    }));
    stored.set('tradernet_rules_v1', JSON.stringify({
      annualBorrowRate: 0.3, annualRate: '0.12', dayCountBasis: '360',
      dailyRolloverCutoffArmenia: '05:45', maintenanceEquityRatio: 0.4,
      maintenanceMarginRatio: '0.2', stopOutRatio: '0.01', commissionPerShare: 0.04,
      commPerShare: '0.02', commissionRatePct: 0.004, commVolumePct: '0.002',
      commissionMin: 4, minCommOrder: '2'
    }));
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    expect(store.getState().brokerAssumptions).toEqual({
      broker: 'Freedom Broker Armenia (Tradernet)', annualBorrowRate: 0.12, dayCountBasis: 360,
      rolloverHour: 5, rolloverMinute: 45, rolloverTimeZone: 'Asia/Yerevan',
      maintenanceEquityRatio: 0.2, stopOutRatio: 0.01, commissionMin: 2,
      commissionPerShare: 0.02, commissionRatePct: 0.002
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
      annualBorrowRate: 0,
      maintenanceEquityRatio: 0
    });

    expect(store.getState().brokerAssumptions).toMatchObject({
      annualBorrowRate: 0,
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

  it('commits rollover debt and accounting timestamp in one store update', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.setMarginDebt(100);
    const listener = vi.fn();
    store.subscribe(listener);

    store.applyRollover(101, 1, Date.parse('2026-10-16T00:00:00.000Z'), true);

    expect(store.getState().balance).toBe(-101);
    expect(store.getState().realizedMarginCharged).toBe(1);
    expect(store.getState().lastRolloverTimestamp).toBe(Date.parse('2026-10-16T00:00:00.000Z'));
    expect(listener).toHaveBeenCalledTimes(1);

    store.applyRollover(102, 1, Date.parse('2026-10-17T00:00:00.000Z'), false);
    expect(store.getState().balance).toBe(-102);
    expect(store.getState().realizedMarginCharged).toBe(1);

    const rolloverEvents = store.getState().transactionEvents?.filter((event) => event.type === 'margin.interest') || [];
    expect(rolloverEvents).toMatchObject([
      { grossAmount: 1, marginDebtDelta: 1, realizedMarginChargeDelta: 1 },
      { grossAmount: 1, marginDebtDelta: 1, realizedMarginChargeDelta: 0 }
    ]);
    expect(verifyPortfolioTransactionParity(store.getState().transactionEvents || [], store.getState()).matches).toBe(true);
    expect(inspectPortfolioTransactionJournalReplayCoverage(store.getState().transactionEvents || []).status).toBe('complete');
  });

  it('sets free cash without changing existing margin debt', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.setMarginDebt(587.81);

    store.setFreeCash(2500);

    expect(store.getState().cashCushion.freeCash).toBe(2500);
    expect(store.getState().cashBalance).toBe(2500);
    expect(store.getState().balance).toBe(-587.81);
  });

  it('rejects negative or non-finite free-cash values without changing state', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.setMarginDebt(500);
    const before = store.getState();

    expect(() => store.setFreeCash(-1)).toThrow('Free cash must be a finite non-negative amount.');
    expect(() => store.setFreeCash(Number.NaN)).toThrow('Free cash must be a finite non-negative amount.');
    expect(store.getState().balance).toBe(before.balance);
    expect(store.getState().cashCushion.freeCash).toBe(before.cashCushion.freeCash);
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


  it('rejects non-finite cash-balance inputs without changing committed state or storage', () => {
    const store = new PortfolioStore();
    expect(store.setCashBalance(500)).toBe(true);
    const previousState = store.getState();
    const previousSnapshot = sharedTestStorage.get('margin_portfolio_state_dynamic_v2');
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.setCashBalance(Number.NaN)).toBe(false);
    expect(store.setCashBalance(Number.POSITIVE_INFINITY)).toBe(false);
    expect(store.setCashBalance(Number.NEGATIVE_INFINITY)).toBe(false);

    expect(store.getState()).toBe(previousState);
    expect(store.getState().cashCushion.freeCash).toBe(500);
    expect(sharedTestStorage.get('margin_portfolio_state_dynamic_v2')).toBe(previousSnapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores non-finite trade inputs without corrupting financial state', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({ commPerShare: 0, commVolumePct: 0, minCommOrder: 0, annualRate: 0, annualBorrowRate: 0 });
    store.setCashBalance(500);
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const before = store.getState();

    store.buyStock('MSFT', Number.POSITIVE_INFINITY, 100, '2026-10-15');
    store.buyStock('MSFT', 2, Number.NaN, '2026-10-15');
    store.sellStock('AAPL', 1, Number.POSITIVE_INFINITY, '2026-10-16');
    store.sellStock('AAPL', Number.NaN, 110, '2026-10-16');
    store.addCashStock('NVDA', Number.POSITIVE_INFINITY, 100);
    store.addCashStock('NVDA', 2, Number.NaN);
    store.updateTargetPrice('AAPL', Number.POSITIVE_INFINITY);

    expect(store.getState().positions).toEqual(before.positions);
    expect(store.getState().balance).toBe(before.balance);
    expect(store.getState().cashCushion).toEqual(before.cashCushion);
    expect(store.getState().closedTrades).toEqual(before.closedTrades);
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

  it('allocates a one-shot position margin charge proportionally and never carries it into a later exit', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commVolumePct: 0,
      minCommOrder: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.setCashBalance(1_000);
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    store.update((state) => {
      const position = state.positions.AAPL;
      if (!position) return state;
      return {
        ...state,
        positions: {
          ...state.positions,
          AAPL: { ...position, marginCharged: 10 }
        }
      };
    });

    store.sellStock('AAPL', 1, 110, '2026-10-16');

    expect(store.getState().closedTrades[0].marginInterest).toBe(5);
    expect(store.getState().positions.AAPL.marginCharged).toBeUndefined();
    expect(store.getState().realizedMarginCharged).toBe(5);

    store.sellStock('AAPL', 'ALL', 110, '2026-10-17');

    expect(store.getState().closedTrades[0].marginInterest).toBe(0);
    expect(store.getState().realizedMarginCharged).toBe(5);
  });

  it('reconciles fractional partial exits using per-record cent rounding', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commVolumePct: 0,
      minCommOrder: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.setCashBalance(100);
    store.buyStock('AAPL', 0.333, 10, '2026-10-15');

    store.sellStock('AAPL', 0.111, 12, '2026-10-16');

    expect(store.getState().closedTrades[0]).toMatchObject({
      shares: 0.111,
      grossProfit: 0.22,
      commissions: 0,
      marginInterest: 0,
      netProfit: 0.22
    });
    expect(store.getState().positions.AAPL.shares).toBeCloseTo(0.222, 10);
    expect(store.getState().positions.AAPL.tranches?.[0].qty).toBeCloseTo(0.222, 10);
    expect(store.getState().positions.AAPL.tranches?.[0].price).toBe(10);

    store.sellStock('AAPL', 'ALL', 12, '2026-10-17');

    expect(store.getState().closedTrades.map((trade) => trade.grossProfit)).toEqual([0.44, 0.22]);
    expect(store.getState().closedTrades.reduce((sum, trade) => sum + (trade.netProfit || 0), 0)).toBe(0.66);
    expect(store.getState().positions.AAPL).toBeUndefined();
  });

  it('applies proceeds from staged partial exits to margin debt before creating free cash', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commVolumePct: 0,
      minCommOrder: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.buyStock('AAPL', 2, 100, '2026-10-15');

    expect(store.getState().balance).toBe(-200);

    store.sellStock('AAPL', 1, 110, '2026-10-16');

    expect(store.getState().balance).toBe(-90);
    expect(store.getState().cashCushion.freeCash).toBe(0);
    expect(store.getState().closedTrades[0].netProfit).toBe(10);

    store.sellStock('AAPL', 'ALL', 110, '2026-10-17');

    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBe(20);
    expect(store.getState().closedTrades.reduce((sum, trade) => sum + (trade.netProfit || 0), 0)).toBe(20);
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

  it('refreshes guest LOTS tranche market values alongside Balance cash-holding quotes', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.importState({
      guestPortfolioSnapshot: {
        updatedAt: 1_000,
        tranches: [
          {
            id: 'AAPL:buy-1',
            ticker: 'AAPL',
            name: 'Apple',
            quantity: 2,
            marketPrice: 100,
            averagePrice: 90,
            marketValue: 200,
            purchasedAt: 100
          },
          {
            id: 'MSFT:buy-2',
            ticker: 'MSFT',
            name: 'Microsoft',
            quantity: 3,
            marketPrice: 200,
            averagePrice: 180,
            marketValue: 600,
            purchasedAt: 200
          }
        ]
      },
      cashCushion: {
        freeCash: 0,
        holdings: [{
          ticker: 'AAPL',
          shares: 2,
          price: 100,
          currentPrice: 100,
          averagePrice: 90,
          marketValue: 200
        }]
      }
    } as any);

    store.updateLiveQuote('AAPL', {
      price: 125,
      quoteSource: 'Yahoo',
      quoteUpdatedAt: 2_000,
      quoteDetails: { change: 5, changePercent: 4 },
      requestStartedAt: 1_900,
      requestSequence: 12
    });

    const state = store.getState();
    expect(state.cashCushion.holdings[0]).toMatchObject({
      ticker: 'AAPL',
      currentPrice: 125,
      price: 125,
      quoteDetails: { change: 5, changePercent: 4 }
    });
    expect(state.guestPortfolioSnapshot).toMatchObject({
      updatedAt: 1_000,
      tranches: [
        expect.objectContaining({
          id: 'AAPL:buy-1',
          marketPrice: 125,
          marketValue: 250,
          averagePrice: 90
        }),
        expect.objectContaining({
          id: 'MSFT:buy-2',
          marketPrice: 200,
          marketValue: 600
        })
      ]
    });
  });

  it('makes a new buy execution authoritative over an older live quote', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.buyStock('AAPL', 2, 100, '2026-10-15');
    store.updateLiveQuote('AAPL', {
      price: 110,
      quoteSource: 'Yahoo',
      quoteUpdatedAt: 123,
      quoteDetails: { change: 10 }
    });

    store.buyStock('AAPL', 1, 95, '2026-10-16');

    expect(store.getState().positions.AAPL).toMatchObject({
      shares: 3,
      currentPrice: 95,
      quoteSource: 'Trade input',
      quoteUpdatedAt: undefined,
      quoteDetails: undefined
    });

    const lastTradeAt = store.getState().positions.AAPL.lastTradeAt || Date.now();
    store.updateLiveQuote('AAPL', {
      price: 90,
      requestStartedAt: lastTradeAt - 1,
      quoteSource: 'Stale provider'
    });
    expect(store.getState().positions.AAPL.currentPrice).toBe(95);
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

  it('adds cash holdings atomically and preserves a live quote when no manual price is supplied', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    expect(store.addCashHolding('msft', 2, 100)).toEqual({
      ticker: 'MSFT',
      shares: 2,
      price: 100
    });
    store.updateLiveQuote('MSFT', { price: 125, quoteSource: 'Yahoo' });

    store.addCashHolding('MSFT', 3, 0);

    expect(store.getState().cashCushion.holdings).toEqual([
      expect.objectContaining({
        ticker: 'MSFT',
        shares: 5,
        price: 125,
        currentPrice: 125
      })
    ]);
  });

  it('removes cash holdings through the store with case-insensitive ticker matching', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.addCashStock('MSFT', 2, 100);
    const listener = vi.fn();
    store.subscribe(listener);

    store.removeCashStock('msft');

    expect(store.getState().cashCushion.holdings).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not commit invalid tranche, cash-holding, or closed-trade removals', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL', shares: 2, currentPrice: 110, pt: 125, commBuy: 0,
          tranches: [
            { qty: 1, price: 100, date: '2026-10-01' },
            { qty: 1, price: 105, date: '2026-10-02' }
          ]
        }
      },
      cashCushion: { freeCash: 0, holdings: [{ ticker: 'MSFT', shares: 1, price: 20 }] },
      closedTrades: [{ ticker: 'AAPL', shares: 1, netProfit: 10 }]
    });
    const previousState = store.getState();
    const previousSnapshot = sharedTestStorage.get('margin_portfolio_state_dynamic_v2');
    const listener = vi.fn();
    store.subscribe(listener);

    store.removeTranche('AAPL', 'MSFT-0');
    store.removeTranche('AAPL', 'AAPL-invalid');
    store.removeTranche('AAPL', 'AAPL-9');
    expect(store.removeCashStock('GOOG')).toBe(false);
    expect(store.removeCashStock(-1)).toBe(false);
    expect(store.removeCashStock(3)).toBe(false);
    store.deleteClosedTrade(-1);
    store.deleteClosedTrade(3);

    expect(store.getState()).toBe(previousState);
    expect(sharedTestStorage.get('margin_portfolio_state_dynamic_v2')).toBe(previousSnapshot);
    expect(listener).not.toHaveBeenCalled();

    store.removeTranche('AAPL', 'AAPL-0');
    expect(store.getState().positions.AAPL.shares).toBe(1);
    expect(store.getState().positions.AAPL.tranches).toHaveLength(1);

    store.deleteClosedTrade(0);
    expect(store.getState().closedTrades).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('sells cash-cushion shares atomically, paying debt before adding surplus cash', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.addCashStock('MSFT', 2, 100);
    store.updateAssumptions({ commPerShare: 0, commVolumePct: 0, minCommOrder: 1.2 });
    store.setMarginDebt(50);

    const result = store.sellCashHolding('msft', 1, 100);

    expect(result).toEqual({
      ticker: 'MSFT',
      sharesSold: 1,
      remainingShares: 1,
      netProceeds: 98.8,
      debtRepaid: 50,
      cashSurplus: 48.8
    });
    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBeCloseTo(48.8, 8);
    expect(store.getState().cashCushion.holdings).toEqual([
      expect.objectContaining({ ticker: 'MSFT', shares: 1 })
    ]);
    expect(store.getState().closedTrades).toHaveLength(0);
  });

  it('commits confirmed margin sales atomically while preserving closed-trade history', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commVolumePct: 0,
      minCommOrder: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.buyStock('AAPL', 5, 100, '2026-10-01');
    const beforeSale = store.getState();
    const beforePosition = beforeSale.positions.AAPL;
    const beforeTranches = beforePosition.tranches?.map((tranche) => ({ ...tranche }));

    const partial = store.sellMarginPosition('aapl', 2, 120, Date.parse('2026-10-10'));
    expect(beforeSale.positions.AAPL).toBe(beforePosition);
    expect(beforePosition.tranches).toEqual(beforeTranches);
    expect(store.getState()).not.toBe(beforeSale);
    expect(partial).toMatchObject({
      ticker: 'AAPL',
      sharesSold: 2,
      remainingShares: 3,
      netProceeds: 240,
      debtRepaid: 240,
      cashSurplus: 0
    });
    expect(store.getState().positions.AAPL.shares).toBe(3);
    expect(store.getState().balance).toBe(-260);
    expect(store.getState().closedTrades).toHaveLength(1);

    const full = store.sellMarginPosition('AAPL', 3, 110, Date.parse('2026-10-16'));
    expect(full).toMatchObject({
      ticker: 'AAPL',
      sharesSold: 3,
      remainingShares: 0,
      netProceeds: 330,
      debtRepaid: 260,
      cashSurplus: 70
    });
    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().balance).toBe(0);
    expect(store.getState().cashCushion.freeCash).toBe(70);
    expect(store.getState().closedTrades).toHaveLength(2);
  });

  it('keeps terminal and AI-confirmed sales financially equivalent', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const terminalStore = new PortfolioStore();
    const aiStore = new PortfolioStore();
    const assumptions = {
      commPerShare: 0.012,
      commVolumePct: 0.0012,
      minCommOrder: 1.2,
      annualRate: 0.15,
      annualBorrowRate: 0.15,
      dayCountBasis: 365 as const
    };
    for (const store of [terminalStore, aiStore]) {
      store.updateAssumptions(assumptions);
      store.buyStock('AAPL', 2, 100, '2026-10-01');
      store.setMarginDebt(210);
      const currentPosition = store.getState().positions.AAPL;
      store.setState({
        positions: {
          ...store.getState().positions,
          AAPL: { ...currentPosition, marginCharged: 10 }
        }
      });
    }

    const closedAt = Date.parse('2026-10-10T12:00:00.000Z');
    terminalStore.sellStock('AAPL', 1, 120, '2026-10-10');
    const aiResult = aiStore.sellMarginPosition('AAPL', 1, 120, closedAt);

    expect(aiResult).toMatchObject({
      ticker: 'AAPL',
      sharesSold: 1,
      remainingShares: 1,
      netProceeds: 118.8,
      debtRepaid: 118.8,
      cashSurplus: 0
    });
    expect(aiStore.getState().balance).toBe(terminalStore.getState().balance);
    expect(aiStore.getState().cashCushion.freeCash).toBe(terminalStore.getState().cashCushion.freeCash);
    expect(aiStore.getState().positions.AAPL).toMatchObject({
      shares: 1,
      currentPrice: 100,
      commBuy: 0.6,
      tranches: [expect.objectContaining({ qty: 1, price: 100, buyCommission: 0.6 })]
    });
    expect(aiStore.getState().realizedMarginCharged).toBe(terminalStore.getState().realizedMarginCharged);
    expect(aiStore.getState().realizedMarginCharged).toBe(5);
    expect(aiStore.getState().positions.AAPL).not.toHaveProperty('marginCharged');
    expect(aiStore.getState().closedTrades[0]).toMatchObject({
      ticker: terminalStore.getState().closedTrades[0].ticker,
      shares: terminalStore.getState().closedTrades[0].shares,
      feesAndCommissions: terminalStore.getState().closedTrades[0].feesAndCommissions,
      marginInterest: terminalStore.getState().closedTrades[0].marginInterest,
      netProfit: terminalStore.getState().closedTrades[0].netProfit
    });
  });

  it('allocates buy commission FIFO and keeps confirmed-sale net P&L consistent', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0.012,
      commVolumePct: 0.0012,
      minCommOrder: 1.2,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.buyStock('AAPL', 2, 100, '2026-10-01');
    store.setMarginDebt(0);

    const result = store.sellMarginPosition('AAPL', 1, 120, Date.parse('2026-10-10'));

    expect(result).toMatchObject({
      sharesSold: 1,
      remainingShares: 1,
      netProceeds: 118.8,
      debtRepaid: 0,
      cashSurplus: 118.8
    });
    expect(store.getState().closedTrades[0]).toMatchObject({
      ticker: 'AAPL',
      shares: 1,
      netProfit: 18.2
    });
    expect(store.getState().closedTrades[0].feesAndCommissions).toBeCloseTo(1.8, 8);
    expect(store.getState().positions.AAPL.tranches).toEqual([
      expect.objectContaining({ qty: 1, price: 100, buyCommission: 0.6 })
    ]);
    expect(store.getState().positions.AAPL.commBuy).toBeCloseTo(0.6, 8);
  });

  it('blocks terminal and AI-confirmed sales when acquisition lots are missing, without mutating financial state', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commVolumePct: 0,
      minCommOrder: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const position = store.getState().positions.AAPL;
    store.setState({
      positions: {
        ...store.getState().positions,
        AAPL: { ...position, currentPrice: 500, tranches: [] }
      }
    });

    const before = store.getState();
    const beforeSnapshot = structuredClone(before);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() => store.sellStock('AAPL', 'ALL', 120, '2026-10-16'))
      .toThrow('Position has no cost-basis tranches');
    expect(() => store.sellMarginPosition('AAPL', 1, 120, Date.parse('2026-10-16')))
      .toThrow('Position has no cost-basis tranches');

    expect(store.getState()).toBe(before);
    expect(store.getState()).toEqual(beforeSnapshot);
    expect(store.getState().balance).toBe(beforeSnapshot.balance);
    expect(store.getState().cashCushion).toEqual(beforeSnapshot.cashCushion);
    expect(store.getState().closedTrades).toEqual(beforeSnapshot.closedTrades);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    {
      tranches: [{ qty: 1, price: 100 }],
      message: 'Recorded open shares (2) do not match tranche total (1)'
    },
    {
      tranches: [{ qty: 3, price: 100 }],
      message: 'Position tranche total (3) exceeds recorded open shares (2)'
    }
  ])('rejects sale when FIFO lots do not match the recorded share quantity', ({ tranches, message }) => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const position = store.getState().positions.AAPL;
    store.setState({
      positions: {
        ...store.getState().positions,
        AAPL: { ...position, tranches }
      }
    });
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() => store.sellStock('AAPL', 1, 120, '2026-10-16')).toThrow(message);
    expect(store.getState()).toBe(before);
    expect(store.getState().positions.AAPL.shares).toBe(2);
    expect(store.getState().balance).toBe(before.balance);
    expect(store.getState().closedTrades).toEqual(before.closedTrades);
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects explicit lot commissions that exceed the recorded aggregate buy commission', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const position = store.getState().positions.AAPL;
    store.setState({
      positions: {
        ...store.getState().positions,
        AAPL: {
          ...position,
          commBuy: 0,
          tranches: [{ qty: 2, price: 100, buyCommission: 5 }]
        }
      }
    });
    const before = store.getState();

    expect(() => store.sellStock('AAPL', 1, 120, '2026-10-16'))
      .toThrow('Tranche entry commissions exceed the recorded position commission');
    expect(store.getState()).toBe(before);
    expect(store.getState().closedTrades).toHaveLength(0);
  });

  it('keeps legacy alias lots with trustworthy entry prices sellable', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const position = store.getState().positions.AAPL;
    store.setState({
      positions: {
        ...store.getState().positions,
        AAPL: {
          ...position,
          tranches: [{ shares: 2, entryPrice: 100, purchaseDate: '2026-10-15' } as any]
        }
      }
    });

    store.sellStock('AAPL', 1, 120, '2026-10-16');

    expect(store.getState().closedTrades[0]).toMatchObject({
      shares: 1,
      avgBuyPrice: 100,
      grossProfit: 20
    });
    expect(store.getState().positions.AAPL.tranches).toEqual([
      expect.objectContaining({ qty: 1, price: 100 })
    ]);
  });

  it('rejects invalid confirmed sale inputs without changing canonical state', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.sellMarginPosition('AAPL', 3, 120)).toBeNull();
    expect(store.sellMarginPosition('AAPL', 1, Number.NaN)).toBeNull();
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('does not notify subscribers when a stale quote is rejected as a no-op', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');

    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);

    store.updateLiveQuote('AAPL', {
      price: 90,
      requestStartedAt: (before.positions.AAPL.lastTradeAt || Date.now()) - 1
    });

    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
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
    expect(store.getState().cashCushion.holdings.find((holding) => holding.ticker === 'MSFT')?.currentPrice).toBe(220);
  });

  it('returns whether the store actually accepted a quote update', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const requestStartedAt = Date.now() + 1_000;

    expect(store.updateLiveQuote('AAPL', {
      price: 110,
      requestStartedAt,
      quoteDetails: { sourceTimestamp: requestStartedAt, freshness: 'fresh' }
    })).toBe(true);
    expect(store.updateLiveQuote('AAPL', {
      price: 105,
      requestStartedAt: requestStartedAt - 1,
      quoteDetails: { sourceTimestamp: requestStartedAt - 1, freshness: 'fresh' }
    })).toBe(false);
  });

  it('preserves and recalculates the daily move when a WebSocket tick omits change fields', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    store.addCashStock('AAPL', 1, 100);
    const firstReceivedAt = Date.now() + 1_000;
    store.setState({
      cashStocks: [{ ticker: 'AAPL', shares: 1, currentPrice: 100 }],
      guestPortfolioSnapshot: {
        updatedAt: firstReceivedAt,
        tranches: [{
          id: 'AAPL:cash-1',
          ticker: 'AAPL',
          name: 'Apple',
          quantity: 1,
          marketPrice: 100,
          averagePrice: 90,
          marketValue: 100,
          purchasedAt: firstReceivedAt
        }]
      }
    });

    expect(store.updateLiveQuote('AAPL', {
      price: 100,
      quoteSource: 'Freedom TradeNet',
      quoteUpdatedAt: firstReceivedAt,
      requestStartedAt: firstReceivedAt,
      requestSequence: 100,
      quoteDetails: {
        transport: 'websocket',
        price: 100,
        change: -2,
        changePercent: -1.9607843137254901,
        freshness: 'fresh',
        sourceTimestamp: firstReceivedAt
      }
    })).toBe(true);

    const secondReceivedAt = firstReceivedAt + 1_000;
    expect(store.updateLiveQuote('AAPL', {
      price: 101,
      quoteSource: 'Freedom TradeNet',
      quoteUpdatedAt: secondReceivedAt,
      requestStartedAt: secondReceivedAt,
      requestSequence: 101,
      quoteDetails: {
        transport: 'websocket',
        price: 101,
        freshness: 'unknown',
        receivedAt: secondReceivedAt
      }
    })).toBe(true);

    const state = store.getState();
    expect(state.positions.AAPL).toMatchObject({
      currentPrice: 101,
      quoteDetails: {
        transport: 'websocket',
        price: 101,
        freshness: 'unknown',
        receivedAt: secondReceivedAt,
        change: -1,
        changePercent: -0.9803921568627451
      }
    });
    expect(state.positions.AAPL.quoteDetails?.sourceTimestamp).toBeUndefined();
    expect(state.cashCushion.holdings[0]).toMatchObject({
      currentPrice: 101,
      price: 101,
      quoteDetails: { change: -1, changePercent: -0.9803921568627451 }
    });
    expect(state.cashStocks?.[0]).toMatchObject({
      currentPrice: 101,
      quoteDetails: { change: -1, changePercent: -0.9803921568627451 }
    });
    expect(state.guestPortfolioSnapshot?.tranches[0]).toMatchObject({
      marketPrice: 101,
      marketValue: 101,
      quoteDetails: { change: -1, changePercent: -0.9803921568627451 }
    });
  });

  it('rewrites the matching local ticker for every newly received WebSocket quote even when source time regresses', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();

    store.buyStock('AAPL', 2, 100, '2026-10-15');
    store.buyStock('MSFT', 3, 200, '2026-10-16');
    store.addCashStock('AAPL', 1, 100);
    store.setState({
      cashStocks: [
        { ticker: 'AAPL', shares: 1, currentPrice: 100 },
        { ticker: 'MSFT', shares: 2, currentPrice: 200 }
      ]
    });
    const listener = vi.fn();
    store.subscribe(listener);
    const firstReceivedAt = Date.now() + 1_000;
    const secondReceivedAt = firstReceivedAt + 1_000;

    expect(store.updateLiveQuote('AAPL', {
      price: 110,
      quoteSource: 'Freedom TradeNet',
      quoteUpdatedAt: firstReceivedAt,
      requestStartedAt: firstReceivedAt,
      requestSequence: 100,
      quoteDetails: {
        transport: 'websocket',
        sourceTimestamp: firstReceivedAt,
        freshness: 'fresh',
        bid: 109.9,
        ask: 110.1
      }
    })).toBe(true);

    // This q event arrived later, so its price and metadata must replace the
    // previously stored local quote even though its provider ltt regressed.
    expect(store.updateLiveQuote('AAPL', {
      price: 111.25,
      quoteSource: 'Freedom TradeNet',
      quoteUpdatedAt: secondReceivedAt,
      requestStartedAt: secondReceivedAt,
      requestSequence: 101,
      quoteDetails: {
        transport: 'websocket',
        sourceTimestamp: firstReceivedAt - 60_000,
        freshness: 'stale',
        bid: 111.2,
        ask: 111.3
      }
    })).toBe(true);

    const state = store.getState();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(state.positions.AAPL).toMatchObject({
      shares: 2,
      currentPrice: 111.25,
      quoteUpdatedAt: secondReceivedAt,
      quoteRequestStartedAt: secondReceivedAt,
      quoteRequestSequence: 101,
      quoteSource: 'Freedom TradeNet',
      tranches: [expect.objectContaining({ qty: 2, price: 100 })],
      quoteDetails: {
        transport: 'websocket',
        sourceTimestamp: firstReceivedAt - 60_000,
        freshness: 'stale',
        bid: 111.2,
        ask: 111.3
      }
    });
    expect(state.cashCushion.holdings.find((holding) => holding.ticker === 'AAPL'))
      .toMatchObject({ currentPrice: 111.25, price: 111.25 });
    expect(state.cashStocks?.find((holding) => holding.ticker === 'AAPL'))
      .toMatchObject({ currentPrice: 111.25, quoteUpdatedAt: secondReceivedAt });
    expect(state.positions.MSFT.currentPrice).toBe(200);
    expect(state.cashStocks?.find((holding) => holding.ticker === 'MSFT')?.currentPrice).toBe(200);
  });

  it('rejects an older market observation even when its request started later', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const requestStartedAt = Date.now() + 1_000;

    expect(store.updateLiveQuote('AAPL', {
      price: 110,
      requestStartedAt: requestStartedAt + 100,
      quoteDetails: { sourceTimestamp: requestStartedAt + 100, freshness: 'fresh' }
    })).toBe(true);
    const acceptedState = store.getState();

    expect(store.updateLiveQuote('AAPL', {
      price: 95,
      requestStartedAt: requestStartedAt + 200,
      quoteDetails: { sourceTimestamp: requestStartedAt + 50, freshness: 'stale' }
    })).toBe(false);
    expect(store.getState()).toBe(acceptedState);
    expect(store.getState().positions.AAPL).toMatchObject({
      currentPrice: 110,
      quoteDetails: { sourceTimestamp: requestStartedAt + 100 }
    });
  });

  it('accepts a later network quote even when its sequence is lower than a persisted sequence', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const requestBase = Date.now() + 1_000;

    store.updateLiveQuote('AAPL', {
      price: 110,
      requestStartedAt: requestBase + 200,
      requestSequence: 42,
      quoteSource: 'Older request'
    });
    store.updateLiveQuote('AAPL', {
      price: 115,
      requestStartedAt: requestBase + 300,
      requestSequence: 41,
      quoteSource: 'Newer request'
    });

    expect(store.getState().positions.AAPL).toMatchObject({
      currentPrice: 115,
      quoteSource: 'Newer request',
      quoteRequestStartedAt: requestBase + 300,
      quoteRequestSequence: 41
    });
  });

  it('rejects an earlier network quote even when its sequence is higher', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    const requestBase = Date.now() + 1_000;

    store.updateLiveQuote('AAPL', {
      price: 115,
      requestStartedAt: requestBase + 300,
      requestSequence: 41,
      quoteSource: 'Newer request'
    });
    store.updateLiveQuote('AAPL', {
      price: 110,
      requestStartedAt: requestBase + 200,
      requestSequence: 42,
      quoteSource: 'Older request'
    });

    expect(store.getState().positions.AAPL).toMatchObject({
      currentPrice: 115,
      quoteSource: 'Newer request',
      quoteRequestStartedAt: requestBase + 300,
      quoteRequestSequence: 41
    });
  });

  it('uses monotonic request sequence to reject out-of-order quotes started in the same millisecond', () => {
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.buyStock('AAPL', 2, 100, '2026-10-15');
    store.addCashStock('MSFT', 3, 200);
    const sameMillisecond = Date.now() + 5000;

    store.updateLiveQuote('AAPL', {
      price: 110,
      requestStartedAt: sameMillisecond,
      requestSequence: 42,
      quoteSource: 'Newer request'
    });
    store.updateLiveQuote('AAPL', {
      price: 105,
      requestStartedAt: sameMillisecond,
      requestSequence: 41,
      quoteSource: 'Older request'
    });
    expect(store.getState().positions.AAPL.currentPrice).toBe(110);
    expect(store.getState().positions.AAPL.quoteSource).toBe('Newer request');

    store.updateLiveQuote('MSFT', {
      price: 220,
      requestStartedAt: sameMillisecond,
      requestSequence: 42,
      quoteSource: 'Newer request'
    });
    store.updateLiveQuote('MSFT', {
      price: 205,
      requestStartedAt: sameMillisecond,
      requestSequence: 41,
      quoteSource: 'Older request'
    });
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
  it('can prepare a blank reset without persisting state before an atomic snapshot commit', () => {
    stored.set('portfolio_active_view', 'AAPL');
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    store.importState({ balance: -250, activeView: 'AAPL' });
    const previouslySavedState = stored.get('margin_portfolio_state_dynamic_v2');

    store.resetToBlankState(Date.parse('2026-10-31T00:00:00.000Z'), false);

    expect(store.getState().activeView).toBe('COMBINED');
    expect(store.getState().balance).toBe(0);
    expect(stored.get('portfolio_active_view')).toBe('COMBINED');
    expect(stored.get('margin_portfolio_state_dynamic_v2')).toBe(previouslySavedState);
  });

  it('resets portfolio-owned and broker-history state while retaining account settings', () => {
    stored.set('portfolio_active_view', 'AAPL');
    vi.stubGlobal('localStorage', localStorageMock);
    const store = new PortfolioStore();
    const originalRules = { ...store.getState().brokerAssumptions, annualBorrowRate: 0.12 };
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL', shares: 2, currentPrice: 110, pt: 125, commBuy: 1,
          tranches: [{ qty: 2, price: 100, date: '2026-10-01' }]
        }
      },
      balance: -250,
      cashCushion: { freeCash: 500, holdings: [{ ticker: 'MSFT', shares: 2, price: 20, currentPrice: 20 }] },
      closedTrades: [{ ticker: 'AAPL', shares: 1, netProfit: 10 }],
      brokerExecutedTrades: [{
        id: 'trade-1', ticker: 'AAPL', side: 'SELL', quantity: 1, price: 110,
        currency: 'USD', executedAt: '2026-10-10T10:00:00Z', tradeValue: 110,
        profit: 10, marginFee: null, commission: null, commissionCurrency: 'USD', raw: {}
      }],
      cashflows: [{ id: 'fee-1', date: '2026-10-01', type: 'interest', amount: -1 }],
      activeTrancheTypes: { AAPL: 'margin' } as any,
      activeTrancheMixes: { AAPL: { cashShares: 1, marginShares: 1 } } as any,
      activeTrancheGuestAssignments: { AAPL: 'guest-1' },
      guestPortfolioSnapshot: { updatedAt: 1, tranches: [] },
      brokerAccountInfo: { loaded: true, balances: [], positions: [], status: 'current', receivedAt: 1 },
      portfolioEquity: 250,
      portfolioEquityUpdatedAt: 1,
      cashStocks: [{ ticker: 'NVDA', shares: 1, price: 100 }] as any,
      tranches: [{ qty: 1, price: 100, date: '2026-10-01' }],
      closedHistory: [{ ticker: 'AAPL', shares: 1, netProfit: 10 }],
      selectedTicker: 'AAPL',
      apiKeys: { finnhub: 'keep-provider-setting' } as any,
      brokerAssumptions: originalRules,
      gatewaySecret: 'keep-active-session-secret'
    });
    expect(store.getState().activeView).toBe('AAPL');

    store.resetToBlankState(Date.parse('2026-10-31T00:00:00.000Z'));

    const state = store.getState();
    expect(state.activeView).toBe('COMBINED');
    expect(stored.get('portfolio_active_view')).toBe('COMBINED');
    expect(state.positions).toEqual({});
    expect(state.holdings).toEqual([]);
    expect(state.cashCushion).toEqual({ freeCash: 0, holdings: [] });
    expect(state.balance).toBe(0);
    expect(state.closedTrades).toEqual([]);
    expect(state.brokerExecutedTrades).toEqual([]);
    expect(state.cashflows).toEqual([]);
    expect(state.closedHistory).toEqual([]);
    expect(state.activeTrancheTypes).toEqual({});
    expect(state.activeTrancheMixes).toEqual({});
    expect(state.activeTrancheGuestAssignments).toEqual({});
    expect(state.guestPortfolioSnapshot).toBeUndefined();
    expect(state.brokerAccountInfo).toBeUndefined();
    expect(state.portfolioEquity).toBeUndefined();
    expect(state.portfolioEquityUpdatedAt).toBeUndefined();
    expect(state.cashStocks).toEqual([]);
    expect(state.tranches).toEqual([]);
    expect(state.selectedTicker).toBeNull();
    expect(state.apiKeys).toEqual({ finnhub: 'keep-provider-setting' });
    expect(state.brokerAssumptions.annualBorrowRate).toBe(0.12);
    expect(state.gatewaySecret).toBe('keep-active-session-secret');
  });
});


describe('atomic portfolio-store persistence', () => {
  const values = new Map<string, string>();
  const storageMock = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, String(value)); }),
    removeItem: vi.fn((key: string) => { values.delete(key); })
  };

  beforeEach(() => {
    values.clear();
    storageMock.getItem.mockClear();
    storageMock.setItem.mockClear();
    storageMock.removeItem.mockClear();
    storageMock.setItem.mockImplementation((key, value) => { values.set(key, String(value)); });
    vi.stubGlobal('localStorage', storageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retains the previous snapshot and suppresses subscribers when the state write fails', () => {
    const store = new PortfolioStore();
    store.setState({ balance: -100 }, false);
    const previous = store.getState();
    const portfolioListener = vi.fn();
    const activeViewListener = vi.fn();
    const persistenceErrorListener = vi.fn();
    store.subscribe(portfolioListener);
    store.subscribeActiveView(activeViewListener);
    store.subscribePersistenceErrors(persistenceErrorListener);

    storageMock.setItem.mockImplementation(() => { throw new Error('quota exceeded'); });

    expect(store.setState({ balance: -500, activeView: 'AAPL' })).toBe(false);
    expect(store.getState()).toBe(previous);
    expect(store.getState().balance).toBe(-100);
    expect(store.getState().activeView).not.toBe('AAPL');
    expect(portfolioListener).not.toHaveBeenCalled();
    expect(activeViewListener).not.toHaveBeenCalled();
    expect(persistenceErrorListener).toHaveBeenCalledTimes(1);
    expect(persistenceErrorListener).toHaveBeenCalledWith(
      'Could not save portfolio changes. The current portfolio remains open; export a backup before reloading.'
    );
  });

  it('writes the candidate snapshot before publishing it to subscribers', () => {
    const store = new PortfolioStore();
    const listener = vi.fn((state) => {
      const saved = JSON.parse(values.get('margin_portfolio_state_dynamic_v2') || '{}');
      expect(saved.balance).toBe(state.balance);
    });
    store.subscribe(listener);

    expect(store.setState({ balance: -725 })).toBe(true);
    expect(store.getState().balance).toBe(-725);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(values.has('margin_portfolio_state_dynamic_v2')).toBe(true);
  });

  it('continues to publish explicitly non-persistent updates without touching storage', () => {
    const store = new PortfolioStore();
    const listener = vi.fn();
    store.subscribe(listener);
    storageMock.setItem.mockClear();

    expect(store.setState({ balance: -250 }, false)).toBe(true);
    expect(store.getState().balance).toBe(-250);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storageMock.setItem).not.toHaveBeenCalled();
  });

  it('recovers cleanly after a failed storage commit', () => {
    const store = new PortfolioStore();
    const listener = vi.fn();
    store.subscribe(listener);

    storageMock.setItem.mockImplementation(() => {
      throw new Error('temporary quota failure');
    });
    expect(store.setState({ balance: -200 })).toBe(false);
    expect(store.getState().balance).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    storageMock.setItem.mockImplementation((key, value) => {
      values.set(key, String(value));
    });
    expect(store.setState({ balance: -300 })).toBe(true);
    expect(store.getState().balance).toBe(-300);
    expect(JSON.parse(values.get('margin_portfolio_state_dynamic_v2') || '{}').balance).toBe(-300);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns failed commits for debt, rollover, and broker-assumption mutations', () => {
    const store = new PortfolioStore();
    store.setState({
      balance: -100,
      lastRolloverTimestamp: Date.parse('2026-11-02T00:00:00.000Z')
    }, false);
    const previous = store.getState();
    storageMock.setItem.mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(store.setMarginDebt(500)).toBe(false);
    expect(store.setLastRolloverTimestamp(Date.now())).toBe(false);
    expect(store.applyRollover(550, 50, Date.now(), true)).toBe(false);
    expect(store.updateAssumptions({ annualBorrowRate: 0.2 })).toBe(false);
    expect(store.getState()).toBe(previous);
    expect(store.getState().balance).toBe(-100);
  });

  it('rolls back the portfolio snapshot when broker rules cannot be saved', () => {
    const store = new PortfolioStore();
    expect(store.updateAssumptions({ annualBorrowRate: 0.12 })).toBe(true);
    const previousState = store.getState();
    const previousPortfolioSnapshot = values.get('margin_portfolio_state_dynamic_v2');
    const previousBrokerRules = values.get('tradernet_rules_v1');
    const listener = vi.fn();
    const persistenceErrorListener = vi.fn();
    store.subscribe(listener);
    store.subscribePersistenceErrors(persistenceErrorListener);

    storageMock.setItem.mockImplementation((key, value) => {
      if (key === 'tradernet_rules_v1') throw new Error('broker rules quota exceeded');
      values.set(key, String(value));
    });

    expect(store.updateAssumptions({ annualBorrowRate: 0.2 })).toBe(false);
    expect(store.getState()).toBe(previousState);
    expect(values.get('margin_portfolio_state_dynamic_v2')).toBe(previousPortfolioSnapshot);
    expect(values.get('tradernet_rules_v1')).toBe(previousBrokerRules);
    expect(listener).not.toHaveBeenCalled();
    expect(persistenceErrorListener).toHaveBeenCalledTimes(1);
  });

  it('publishes compact portfolio state even when the legacy local history fallback is full', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = new PortfolioStore();
    store.setState({ balance: -100 }, false);
    const listener = vi.fn();
    const persistenceErrorListener = vi.fn();
    store.subscribe(listener);
    store.subscribePersistenceErrors(persistenceErrorListener);

    storageMock.setItem.mockImplementation((key, value) => {
      if (key === 'portfolio_closed_history_v1') throw new Error('history quota exceeded');
      values.set(key, String(value));
    });

    expect(store.setState({
      balance: -300,
      brokerExecutedTrades: [{ id: 'new-execution', ticker: 'AAPL', side: 'BUY' }] as any
    })).toBe(true);
    await flushSavedHistoryPersistence();

    expect(store.getState().balance).toBe(-300);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(persistenceErrorListener).not.toHaveBeenCalled();
    expect(JSON.parse(values.get('margin_portfolio_state_dynamic_v2')!).balance).toBe(-300);
    expect(values.has('portfolio_closed_history_v1')).toBe(false);
  });
});

describe('portfolio store subscriber failure isolation', () => {
  it('publishes pending confirmation state as transient without writing a portfolio snapshot', () => {
    const setItem = vi.spyOn(sharedLocalStorage, 'setItem');
    const store = new PortfolioStore();
    const listener = vi.fn();
    store.subscribe(listener);
    setItem.mockClear();

    store.setPendingMutation(null);

    expect(setItem).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe('derived');
    setItem.mockRestore();
  });

  it('continues notifying state subscribers when an earlier subscriber throws', () => {
    const store = new PortfolioStore();
    const error = new Error('broken state subscriber');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const laterSubscriber = vi.fn();

    store.subscribe(() => {
      throw error;
    });
    store.subscribe(laterSubscriber);

    try {
      expect(store.setState({ balance: -125 })).toBe(true);
      expect(store.getState().balance).toBe(-125);
      expect(laterSubscriber).toHaveBeenCalledTimes(1);
      expect(laterSubscriber).toHaveBeenCalledWith(store.getState(), 'durable');
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to notify a portfolio state subscriber:',
        error
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('continues notifying active-view subscribers when an earlier subscriber throws', () => {
    const store = new PortfolioStore();
    const error = new Error('broken active-view subscriber');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const laterSubscriber = vi.fn();

    store.subscribeActiveView(() => {
      throw error;
    });
    store.subscribeActiveView(laterSubscriber);

    try {
      expect(() => store.setActiveView('SETTINGS')).not.toThrow();
      expect(store.getState().activeView).toBe('SETTINGS');
      expect(laterSubscriber).toHaveBeenCalledTimes(1);
      expect(laterSubscriber).toHaveBeenCalledWith('SETTINGS');
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to notify a portfolio active-view subscriber:',
        error
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('portfolio import boundary validation', () => {
  it('rejects malformed top-level containers without replacing the committed portfolio', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 2,
          currentPrice: 190,
          pt: 210,
          commBuy: 1,
          tranches: [{ qty: 2, price: 180, date: '2026-10-01' }]
        }
      },
      balance: -250,
      closedTrades: [{ ticker: 'MSFT', shares: 1, netProfit: 20 }]
    });

    const previousState = store.getState();
    const previousSnapshot = sharedTestStorage.get('margin_portfolio_state_dynamic_v2');
    const listener = vi.fn();
    store.subscribe(listener);

    const malformedImports: unknown[] = [
      null,
      [],
      { positions: null },
      { positions: [] },
      { positions: undefined },
      { cashCushion: null },
      { cashCushion: undefined },
      { closedTrades: undefined },
      { apiKeys: undefined },
      { brokerAssumptions: undefined },
      { cashCushion: { holdings: {} } },
      { closedTrades: {} },
      { brokerExecutedTrades: {} },
      { cashflows: {} },
      { apiKeys: [] },
      { guestPortfolioSnapshot: { updatedAt: 1, tranches: {} } },
      { brokerAccountInfo: { balances: {}, positions: [] } }
    ];

    for (const malformed of malformedImports) {
      expect(store.importState(malformed as Partial<import('../types/portfolio').PortfolioState>)).toBe(false);
      expect(store.getState()).toBe(previousState);
      expect(sharedTestStorage.get('margin_portfolio_state_dynamic_v2')).toBe(previousSnapshot);
    }

    expect(store.getState().positions.AAPL.shares).toBe(2);
    expect(store.getState().closedTrades).toEqual([
      { ticker: 'MSFT', shares: 1, netProfit: 20 }
    ]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('continues to support valid partial imports without clearing omitted portfolio fields', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        GOOGL: {
          ticker: 'GOOGL',
          shares: 3,
          currentPrice: 300,
          pt: 350,
          commBuy: 0,
          tranches: [{ qty: 3, price: 280, date: '2026-10-02' }]
        }
      },
      closedTrades: [{ ticker: 'AAPL', shares: 1, netProfit: 15 }]
    });

    expect(store.importState({ balance: -75 })).toBe(true);

    expect(store.getState().balance).toBe(-75);
    expect(store.getState().positions.GOOGL.shares).toBe(3);
    expect(store.getState().closedTrades).toEqual([
      { ticker: 'AAPL', shares: 1, netProfit: 15 }
    ]);
  });
});


describe('portfolio transaction journal integration', () => {
  beforeEach(() => {
    sharedTestStorage.clear();
    vi.stubGlobal('localStorage', sharedLocalStorage);
  });

  it('merges older backup and cloud journals without removing locally committed events', () => {
    const store = new PortfolioStore();
    const localEvent = createPortfolioTransactionEvent({
      type: 'portfolio.reset',
      effectiveAt: 2_000,
      note: 'Local reset'
    }, { eventId: 'local-reset-event', recordedAt: 2_001 });
    const olderRestoredEvent = createPortfolioTransactionEvent({
      type: 'portfolio.reset',
      effectiveAt: 1_000,
      note: 'Earlier backup reset'
    }, { eventId: 'backup-reset-event', recordedAt: 1_001 });

    // Keep financial fields unchanged so import normalization does not append
    // legitimate reconciliation events to this journal-merge-only fixture.
    expect(store.importState({ activeView: 'SETTINGS', transactionEvents: [localEvent] })).toBe(true);
    expect(store.importState({ activeView: 'COMBINED', transactionEvents: [olderRestoredEvent] })).toBe(true);
    expect(store.getState().activeView).toBe('COMBINED');
    expect(store.getState().transactionEvents?.map((event) => event.id)).toEqual([
      'backup-reset-event',
      'local-reset-event'
    ]);

    // Legacy backups without a journal may replace the snapshot, but never erase
    // financial events already committed on this device.
    expect(store.importState({ activeView: 'SETTINGS' })).toBe(true);
    const expectedIds = ['backup-reset-event', 'local-reset-event'];
    expect(store.getState().activeView).toBe('SETTINGS');
    expect(store.getState().transactionEvents?.map((event) => event.id)).toEqual(expectedIds);

    const persisted = JSON.parse(sharedTestStorage.get('margin_portfolio_state_dynamic_v2') || '{}');
    expect(persisted.transactionEvents.map((event: { id: string }) => event.id)).toEqual(expectedIds);
    const reloaded = new PortfolioStore();
    expect(reloaded.getState().activeView).toBe('SETTINGS');
    expect(reloaded.getState().transactionEvents?.map((event) => event.id)).toEqual(expectedIds);
  });

  it('rejects a conflicting restored event without replacing or persisting local state', () => {
    const store = new PortfolioStore();
    const committedEvent = createPortfolioTransactionEvent({
      type: 'portfolio.reset',
      effectiveAt: 3_000,
      note: 'Original event'
    }, { eventId: 'shared-reset-event', recordedAt: 3_001 });
    expect(store.importState({ balance: -200, transactionEvents: [committedEvent] })).toBe(true);

    const previousState = store.getState();
    const previousSnapshot = sharedTestStorage.get('margin_portfolio_state_dynamic_v2');
    const listener = vi.fn();
    store.subscribe(listener);

    const conflictingEvent = { ...committedEvent, note: 'Conflicting restored event' };
    expect(store.importState({
      balance: -900,
      transactionEvents: [conflictingEvent]
    })).toBe(false);

    expect(store.getState()).toBe(previousState);
    expect(store.getState().balance).toBe(-200);
    expect(sharedTestStorage.get('margin_portfolio_state_dynamic_v2')).toBe(previousSnapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it('retains the append-only transaction journal across reset and browser reload', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 1, 100, '2026-11-10')).toBe(true);
    const committedEvents = store.getState().transactionEvents || [];
    expect(committedEvents).toHaveLength(1);

    expect(store.resetToBlankState(Date.parse('2026-11-11T00:00:00.000Z'))).toBe(true);
    const resetState = store.getState();
    expect(resetState.positions).toEqual({});
    expect(resetState.transactionEvents?.slice(0, committedEvents.length)).toEqual(committedEvents);
    expect(resetState.transactionEvents?.at(-1)).toMatchObject({ type: 'portfolio.reset' });

    const reloaded = new PortfolioStore();
    expect(reloaded.getState().positions).toEqual({});
    expect(reloaded.getState().transactionEvents).toEqual(resetState.transactionEvents);
  });

  it('persists purchase events atomically with canonical positions and deduplicates retries after reload', () => {
    const store = new PortfolioStore();
    expect(store.getState().transactionEvents).toEqual([]);

    const context = {
      idempotencyKey: 'terminal-buy-2026-11-06-001',
      source: 'terminal' as const,
      actor: { type: 'user' as const, id: 'user-7' }
    };
    expect(store.buyStock('aapl', 2, 100, '2026-11-06', undefined, context)).toBe(true);

    const committed = store.getState();
    expect(committed.positions.AAPL.shares).toBe(2);
    expect(committed.transactionEvents).toHaveLength(1);
    expect(committed.transactionEvents?.[0]).toMatchObject({
      type: 'trade.buy',
      ticker: 'AAPL',
      quantity: 2,
      unitPrice: 100,
      grossAmount: 200,
      idempotencyKey: context.idempotencyKey,
      actor: { type: 'user', id: 'user-7' },
      source: 'terminal'
    });

    const saved = JSON.parse(sharedTestStorage.get('margin_portfolio_state_dynamic_v2') || '{}');
    expect(saved.positions.AAPL.shares).toBe(2);
    expect(saved.transactionEvents).toHaveLength(1);

    const reloaded = new PortfolioStore();
    const beforeRetry = reloaded.getState();
    expect(reloaded.buyStock('AAPL', 2, 100, '2026-11-06', undefined, context)).toBe(true);
    expect(reloaded.getState()).toBe(beforeRetry);
    expect(reloaded.getState().positions.AAPL.shares).toBe(2);
    expect(reloaded.getState().transactionEvents).toHaveLength(1);

    // Reusing a key for a different command must be rejected, not treated as a retry.
    expect(reloaded.buyStock('AAPL', 3, 100, '2026-11-06', undefined, context)).toBe(false);
    expect(reloaded.getState().positions.AAPL.shares).toBe(2);
    expect(reloaded.getState().transactionEvents).toHaveLength(1);
  });

  it('records AI-confirmed sale attribution and deduplicates a retry with a later wall-clock time', () => {
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commissionPerShare: 0,
      commVolumePct: 0,
      commissionRatePct: 0,
      minCommOrder: 0,
      commissionMin: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    expect(store.buyStock('AAPL', 2, 100, '2026-11-01')).toBe(true);

    const context = {
      idempotencyKey: 'ai-action:request-17',
      actor: { type: 'ai' as const },
      source: 'ai-confirmed'
    };
    const first = store.sellMarginPosition('AAPL', 1, 120, Date.parse('2026-11-06T09:00:00Z'), context);
    expect(first).not.toBeNull();
    const committedEventCount = store.getState().transactionEvents?.length ?? 0;

    const retry = store.sellMarginPosition('AAPL', 1, 120, Date.parse('2026-11-06T09:05:00Z'), context);

    expect(retry).toEqual(first);
    expect(store.getState().positions.AAPL.shares).toBe(1);
    expect(store.getState().transactionEvents).toHaveLength(committedEventCount);
    expect(store.getState().transactionEvents?.find((event) => event.idempotencyKey === context.idempotencyKey))
      .toMatchObject({
        type: 'trade.sell',
        actor: { type: 'ai' },
        source: 'ai-confirmed'
      });
  });

  it('records sale proceeds, commissions, financing allocation, and realized P&L', () => {
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commissionPerShare: 0,
      commVolumePct: 0,
      commissionRatePct: 0,
      minCommOrder: 0,
      commissionMin: 0,
      annualRate: 0,
      annualBorrowRate: 0
    });
    expect(store.setCashBalance(5_000)).toBe(true);
    expect(store.buyStock('AAPL', 2, 100, '2026-11-01')).toBe(true);
    const buyEvent = store.getState().transactionEvents?.find((item) => item.type === 'trade.buy');
    expect(buyEvent).toMatchObject({
      type: 'trade.buy',
      lotId: expect.any(String),
      acquisitionDate: '2026-11-01',
      quantity: 2,
      positionQuantityDelta: 2
    });
    expect(store.getState().positions.AAPL.tranches?.[0]?.lotId).toBe(buyEvent?.lotId);

    const saleContext = {
      idempotencyKey: 'terminal-sale-2026-11-06-001',
      source: 'terminal' as const
    };
    expect(store.sellStock('AAPL', 1, 120, '2026-11-06', saleContext)).toBe(true);

    const event = store.getState().transactionEvents?.find((item) =>
      item.idempotencyKey === saleContext.idempotencyKey
    );
    expect(event).toMatchObject({
      type: 'trade.sell',
      ticker: 'AAPL',
      quantity: 1,
      unitPrice: 120,
      grossAmount: 120,
      fees: 0,
      financingCost: 0,
      netAmount: 120,
      realizedPnl: 20,
      cashDelta: 120,
      marginDebtDelta: 0
    });
    expect(event).toMatchObject({
      lotAllocations: [{
        lotId: buyEvent?.lotId,
        identity: 'stable',
        quantity: 1,
        acquisitionPrice: 100,
        acquisitionDate: '2026-11-01',
        buyCommissionAllocated: 0,
        sellPrice: 120,
        sellCommissionAllocated: 0,
        financingCostAllocated: 0,
        realizedPnl: 20
      }]
    });
    expect(event?.realizedPnl).toBe(store.getState().closedTrades[0].netProfit);
    expect(store.getState().closedTrades[0].transactionEventId).toBe(event?.id);
    const restored = new PortfolioStore().getState();
    expect(restored.closedTrades?.[0]?.transactionEventId).toBe(event?.id);
    expect(store.getState().positions.AAPL.shares).toBe(1);
  });


  it('journals cash-holding additions and deduplicates a repeated command after reload', () => {
    const store = new PortfolioStore();
    const context = {
      idempotencyKey: 'cash-holding-add-001',
      source: 'terminal-cash-desk' as const
    };

    expect(store.addCashHolding('nvda', 3, 120, context)).toEqual({
      ticker: 'NVDA',
      shares: 3,
      price: 120
    });
    expect(store.getState().cashCushion.holdings).toEqual([
      expect.objectContaining({ ticker: 'NVDA', shares: 3, price: 120 })
    ]);
    expect(store.getState().transactionEvents).toHaveLength(1);
    expect(store.getState().transactionEvents?.[0]).toMatchObject({
      type: 'cash-holding.buy',
      ticker: 'NVDA',
      quantity: 3,
      unitPrice: 120,
      grossAmount: 360,
      cashDelta: 0,
      idempotencyKey: context.idempotencyKey
    });

    const reloaded = new PortfolioStore();
    expect(reloaded.addCashHolding('NVDA', 3, 120, context)).toEqual({
      ticker: 'NVDA',
      shares: 3,
      price: 120
    });
    expect(reloaded.getState().cashCushion.holdings[0].shares).toBe(3);
    expect(reloaded.getState().transactionEvents).toHaveLength(1);
    expect(reloaded.addCashHolding('NVDA', 4, 120, context)).toBeNull();
    expect(reloaded.getState().cashCushion.holdings[0].shares).toBe(3);
  });

  it('journals cash-holding sales with debt-first settlement and idempotent replay', () => {
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commissionPerShare: 0,
      commVolumePct: 0,
      commissionRatePct: 0,
      minCommOrder: 0,
      commissionMin: 0
    });
    expect(store.setMarginDebt(10)).toBe(true);
    expect(store.addCashHolding('NVDA', 3, 15)).not.toBeNull();

    const context = { idempotencyKey: 'cash-holding-sale-001' };
    const result = store.sellCashHolding('NVDA', 2, 20, context);
    expect(result).toEqual({
      ticker: 'NVDA',
      sharesSold: 2,
      remainingShares: 1,
      netProceeds: 40,
      debtRepaid: 10,
      cashSurplus: 30
    });
    const event = store.getState().transactionEvents?.find((item) =>
      item.idempotencyKey === context.idempotencyKey
    );
    expect(event).toMatchObject({
      type: 'cash-holding.sell',
      ticker: 'NVDA',
      quantity: 2,
      unitPrice: 20,
      grossAmount: 40,
      fees: 0,
      netAmount: 40,
      cashDelta: 30,
      marginDebtDelta: -10
    });

    const reloaded = new PortfolioStore();
    expect(reloaded.sellCashHolding('NVDA', 2, 20, context)).toEqual(result);
    expect(reloaded.getState().cashCushion.holdings[0].shares).toBe(1);
    expect(reloaded.getState().cashCushion.freeCash).toBe(30);
    expect(reloaded.getState().balance).toBe(0);
    expect(reloaded.getState().transactionEvents?.filter((item) => item.idempotencyKey === context.idempotencyKey)).toHaveLength(1);
    expect(reloaded.sellCashHolding('NVDA', 2, 21, context)).toBeNull();
  });


  it('weights app-recorded cash lots and realizes FIFO cost basis across partial sales', () => {
    const store = new PortfolioStore();
    store.updateAssumptions({
      commPerShare: 0,
      commissionPerShare: 0,
      commVolumePct: 0,
      commissionRatePct: 0,
      minCommOrder: 0,
      commissionMin: 0
    });
    const firstAt = Date.parse('2026-11-01T09:00:00.000Z');
    const secondAt = Date.parse('2026-11-02T09:00:00.000Z');
    expect(store.addCashHolding('NVDA', 2, 100, {
      eventId: 'cash-buy-one',
      effectiveAt: firstAt
    })).not.toBeNull();
    expect(store.addCashHolding('NVDA', 3, 120, {
      eventId: 'cash-buy-two',
      effectiveAt: secondAt
    })).not.toBeNull();
    expect(store.getState().cashCushion.holdings[0]).toMatchObject({
      ticker: 'NVDA',
      shares: 5,
      averagePrice: 112,
      lots: [
        { lotId: 'cash-lot-cash-buy-one', qty: 2, price: 100, buyCommission: 0 },
        { lotId: 'cash-lot-cash-buy-two', qty: 3, price: 120, buyCommission: 0 }
      ]
    });

    const result = store.sellCashHolding('NVDA', 3, 130, {
      eventId: 'cash-sale-partial',
      effectiveAt: Date.parse('2026-11-03T09:00:00.000Z')
    });
    expect(result).toMatchObject({ sharesSold: 3, remainingShares: 2, netProceeds: 390 });
    const sale = store.getState().transactionEvents?.find((event) => event.id === 'cash-sale-partial');
    expect(sale).toMatchObject({
      type: 'cash-holding.sell',
      quantity: 3,
      cashHoldingQuantityDelta: -3,
      realizedPnl: 70,
      lotAllocations: [
        expect.objectContaining({ lotId: 'cash-lot-cash-buy-one', quantity: 2, acquisitionPrice: 100, realizedPnl: 60 }),
        expect.objectContaining({ lotId: 'cash-lot-cash-buy-two', quantity: 1, acquisitionPrice: 120, realizedPnl: 10 })
      ]
    });

    const holding = store.getState().cashCushion.holdings[0];
    expect(holding).toMatchObject({
      ticker: 'NVDA',
      shares: 2,
      averagePrice: 120,
      lots: [{ lotId: 'cash-lot-cash-buy-two', qty: 2, price: 120 }]
    });
    const events = store.getState().transactionEvents || [];
    const replay = replayPortfolioTransactionLots(events);
    expect(replay.status).toBe('complete');
    expect(replay.cashHoldingOpenLots).toMatchObject([{ lotId: 'cash-lot-cash-buy-two', openQuantity: 2 }]);
    expect(replay.cashHoldingSales).toMatchObject([{ eventId: 'cash-sale-partial', soldCostBasis: 320, realizedPnl: 70 }]);
    expect(verifyPortfolioTransactionLotParity(events, { cashHoldings: [holding] }))
      .toMatchObject({ status: 'complete', matches: true, discrepancies: [], issues: [] });

    const restored = new PortfolioStore().getState();
    expect(restored.cashCushion.holdings[0]).toMatchObject({
      shares: 2,
      averagePrice: 120,
      lots: [{ lotId: 'cash-lot-cash-buy-two', qty: 2 }]
    });
  });

  it('does not treat a broker average price as app-owned lot cost basis when selling a legacy holding', () => {
    const store = new PortfolioStore();
    expect(store.importState({
      cashCushion: {
        freeCash: 0,
        holdings: [{ ticker: 'NVDA', shares: 3, price: 20, currentPrice: 20, averagePrice: 15 }]
      }
    })).toBe(true);
    store.updateAssumptions({
      commPerShare: 0,
      commissionPerShare: 0,
      commVolumePct: 0,
      commissionRatePct: 0,
      minCommOrder: 0,
      commissionMin: 0
    });

    const result = store.sellCashHolding('NVDA', 1, 20);
    expect(result).toMatchObject({ sharesSold: 1, remainingShares: 2, netProceeds: 20 });
    const sale = store.getState().transactionEvents?.find((event) => event.type === 'cash-holding.sell');
    expect(sale?.lotAllocations).toBeUndefined();
    expect(sale?.realizedPnl).toBeUndefined();
    expect(sale?.note).toContain('cost basis and realized P&L remain unavailable');
    expect(store.getState().cashCushion.holdings[0]).toMatchObject({
      ticker: 'NVDA',
      shares: 2,
      averagePrice: null
    });

    const replay = replayPortfolioTransactionLots(store.getState().transactionEvents || []);
    expect(replay.status).toBe('incomplete');
    expect(replay.cashHoldingOpenLots).toEqual([]);
    expect(replay.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: expect.stringContaining('Cash-holding quantity changed without exact') }),
      expect.objectContaining({ reason: expect.stringContaining('Sale event has no exact FIFO lot allocations') })
    ]));
  });

  it('deduplicates a confirmed cash-holding removal after the holding is gone', () => {
    const store = new PortfolioStore();
    expect(store.addCashHolding('NVDA', 3, 120)).not.toBeNull();
    const context = {
      idempotencyKey: 'ai-action:remove-cash-1',
      actor: { type: 'ai' as const },
      source: 'ai-confirmed'
    };

    expect(store.removeCashStock('NVDA', context)).toBe(true);
    expect(store.getState().cashCushion.holdings).toHaveLength(0);
    const eventCount = store.getState().transactionEvents?.length ?? 0;

    const reloaded = new PortfolioStore();
    expect(reloaded.removeCashStock('NVDA', context)).toBe(true);
    expect(reloaded.getState().cashCushion.holdings).toHaveLength(0);
    expect(reloaded.getState().transactionEvents).toHaveLength(eventCount);
    expect(reloaded.getState().transactionEvents?.find((event) => event.idempotencyKey === context.idempotencyKey))
      .toMatchObject({
        type: 'cash-holding.adjustment',
        actor: { type: 'ai' },
        source: 'ai-confirmed'
      });
    expect(reloaded.removeCashStock('NVDA', {
      ...context,
      idempotencyKey: context.idempotencyKey
    })).toBe(true);
  });

  it('journals tranche removal as a tracking correction without pretending it was a sale', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 2, 100, '2026-11-01')).toBe(true);
    const beforeEvents = store.getState().transactionEvents?.length || 0;

    expect(store.removeTranche('AAPL', 'AAPL-0')).toBe(true);
    expect(store.getState().positions.AAPL).toBeUndefined();
    const correction = store.getState().transactionEvents?.[beforeEvents];
    expect(correction).toMatchObject({
      type: 'position.adjustment',
      ticker: 'AAPL',
      quantity: 2,
      unitPrice: 100
    });
    expect(correction?.cashDelta).toBeUndefined();
    expect(correction?.netAmount).toBeUndefined();
    expect(correction?.note).toContain('no sale proceeds');
  });

  it('journals cash-holding removal without inventing proceeds', () => {
    const store = new PortfolioStore();
    expect(store.addCashHolding('NVDA', 4, 120)).not.toBeNull();
    const beforeEvents = store.getState().transactionEvents?.length || 0;

    expect(store.removeCashStock('NVDA')).toBe(true);
    expect(store.getState().cashCushion.holdings).toEqual([]);
    const correction = store.getState().transactionEvents?.[beforeEvents];
    expect(correction).toMatchObject({
      type: 'cash-holding.adjustment',
      ticker: 'NVDA',
      quantity: 4
    });
    expect(correction?.cashDelta).toBeUndefined();
    expect(correction?.netAmount).toBeUndefined();
  });

  it('preserves the append-only journal and records a reset marker', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 1, 100, '2026-11-01')).toBe(true);
    const previousEvents = store.getState().transactionEvents || [];
    const resetAt = Date.parse('2026-11-06T10:00:00.000Z');

    expect(store.resetToBlankState(resetAt)).toBe(true);
    expect(store.getState().positions).toEqual({});
    expect(store.getState().cashCushion.holdings).toEqual([]);
    expect(store.getState().transactionEvents).toHaveLength(previousEvents.length + 1);
    expect(store.getState().transactionEvents?.slice(0, previousEvents.length)).toEqual(previousEvents);
    expect(store.getState().transactionEvents?.at(-1)).toMatchObject({
      type: 'portfolio.reset',
      effectiveAt: resetAt,
      actor: { type: 'user' }
    });
    const saved = JSON.parse(sharedTestStorage.get('margin_portfolio_state_dynamic_v2') || '{}');
    expect(saved.transactionEvents).toHaveLength(previousEvents.length + 1);
  });

  it('does not infer an execution price from a quote when cash-holding shares are added without a manual price', () => {
    const store = new PortfolioStore();
    expect(store.addCashHolding('NVDA', 2, 120)).not.toBeNull();
    expect(store.addCashHolding('NVDA', 1)).not.toBeNull();

    const event = store.getState().transactionEvents?.at(-1);
    expect(event).toMatchObject({
      type: 'cash-holding.buy',
      ticker: 'NVDA',
      quantity: 1
    });
    expect(event?.unitPrice).toBeUndefined();
    expect(event?.grossAmount).toBeUndefined();
    expect(event?.note).toContain('without an execution price');
  });


  it('records deletion of closed-trade display history without deleting transaction evidence', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 2, 100, '2026-11-01')).toBe(true);
    expect(store.sellStock('AAPL', 'ALL', 120, '2026-11-06')).toBe(true);
    const originalEventCount = store.getState().transactionEvents?.length || 0;
    const closedTradeId = store.getState().closedTrades[0].id;

    expect(store.deleteClosedTrade(0)).toBe(true);
    expect(store.getState().closedTrades).toHaveLength(0);
    expect(store.getState().transactionEvents).toHaveLength(originalEventCount + 1);
    expect(store.getState().transactionEvents?.at(-1)).toMatchObject({
      type: 'history.correction',
      ticker: 'AAPL'
    });
    expect(store.getState().transactionEvents?.at(-1)?.note).toContain(String(closedTradeId));
    expect(store.getState().transactionEvents?.some((event) => event.type === 'trade.sell')).toBe(true);
    expect(store.getState().positions.AAPL).toBeUndefined();
  });


  it('records explicit actor and source for manual and confirmed cash/debt adjustments', () => {
    const store = new PortfolioStore();
    expect(store.setCashBalance(250)).toBe(true);
    expect(store.setMarginDebt(50, {
      actor: { type: 'ai' },
      source: 'ai-confirmed',
      idempotencyKey: 'ai-margin-adjustment-01'
    })).toBe(true);
    expect(store.setFreeCash(75)).toBe(true);

    const events = store.getState().transactionEvents || [];
    expect(events.filter((event) => event.type === 'cash.adjustment')).toMatchObject([
      { actor: { type: 'user' }, source: 'manual-cash-adjustment', cashDelta: 250 },
      { actor: { type: 'user' }, source: 'manual-cash-adjustment', cashDelta: -175 }
    ]);
    expect(events.find((event) => event.type === 'margin.adjustment')).toMatchObject({
      actor: { type: 'ai' },
      source: 'ai-confirmed',
      marginDebtDelta: 50,
      idempotencyKey: 'ai-margin-adjustment-01'
    });
    expect(verifyPortfolioTransactionParity(events, store.getState()).matches).toBe(true);
  });

  it('journals imported broker executions and cashflows without posting them twice, then reconciles canonical baselines', () => {
    const store = new PortfolioStore();
    const execution = {
      id: 'freedom-exec-500',
      ticker: 'GOOGL',
      side: 'BUY',
      quantity: 2,
      price: 100,
      currency: 'USD',
      executedAt: '2026-11-01T10:00:00.000Z',
      tradeValue: 200,
      commission: 1,
      profit: null,
      marginFee: null,
      commissionCurrency: 'USD',
      raw: {}
    };
    const cashflow = {
      id: 'freedom-dividend-500',
      date: '2026-11-02T10:00:00.000Z',
      type: 'Dividend',
      amount: 15,
      currency: 'USD',
      description: 'Quarterly dividend',
      raw: {}
    };
    const additionalCashflows = [
      { id: 'freedom-deposit-501', date: '2026-11-03', type: 'Deposit', amount: 100, currency: 'USD', description: 'External deposit' },
      { id: 'freedom-withdrawal-502', date: '2026-11-04', type: 'Withdrawal', amount: -20, currency: 'USD', description: 'External withdrawal' },
      { id: 'freedom-transfer-503', date: '2026-11-05', type: 'Transfer', amount: -30, currency: 'USD', description: 'Cash transfer' },
      { id: 'freedom-fee-504', date: '2026-11-06', type: 'Commission', amount: -1.5, currency: 'USD', description: 'Execution commission' },
      { id: 'freedom-interest-505', date: '2026-11-07', type: 'Margin Interest', amount: -2, currency: 'USD', description: 'Borrowing interest' },
      { id: 'freedom-action-506', date: '2026-11-08', type: 'Corporate Action', amount: 8, currency: 'USD', description: 'Cash in lieu stock split' }
    ];
    const imported = {
      positions: {
        GOOGL: {
          ticker: 'GOOGL',
          shares: 5,
          currentPrice: 110,
          pt: 120,
          commBuy: 0,
          tranches: [{ qty: 5, price: 100, date: '2026-10-01' }]
        }
      },
      balance: -75,
      cashCushion: {
        freeCash: 40,
        holdings: [{ ticker: 'MSFT', shares: 3, price: 50 }]
      },
      brokerExecutedTrades: [execution],
      cashflows: [cashflow, ...additionalCashflows]
    } as any;

    expect(store.importState(imported)).toBe(true);
    const events = store.getState().transactionEvents || [];
    const brokerExecution = events.find((event) => event.type === 'broker.execution');
    const brokerCashflow = events.find((event) => event.type === 'dividend');
    expect(brokerExecution).toMatchObject({
      externalReferenceId: execution.id,
      ticker: 'GOOGL',
      quantity: 2,
      unitPrice: 100,
      source: 'freedom-tradenet'
    });
    expect(brokerExecution?.positionQuantityDelta).toBeUndefined();
    expect(brokerCashflow).toMatchObject({
      externalReferenceId: cashflow.id,
      externalCashFlowAmount: 15,
      currency: 'USD'
    });
    expect(brokerCashflow?.cashDelta).toBeUndefined();
    const evidenceTypes = [
      'cash.deposit',
      'cash.withdrawal',
      'cash.transfer',
      'fee',
      'margin.interest',
      'corporate-action'
    ];
    const additionalEvents = additionalCashflows.map((row) =>
      events.find((event) => event.externalReferenceId === row.id)
    );
    expect(additionalEvents.map((event) => event?.type)).toEqual(evidenceTypes);
    expect(additionalEvents.map((event) => event?.externalCashFlowAmount)).toEqual([100, -20, -30, -1.5, -2, 8]);
    for (const event of additionalEvents) {
      expect(event).toMatchObject({ actor: { type: 'broker' }, source: 'freedom-tradenet-cashflow' });
      expect(event?.cashDelta).toBeUndefined();
      expect(event?.marginDebtDelta).toBeUndefined();
      expect(event?.positionQuantityDelta).toBeUndefined();
      expect(event?.realizedPnl).toBeUndefined();
    }
    expect(additionalEvents[3]?.fees).toBe(1.5);
    expect(additionalEvents[4]?.financingCost).toBe(2);

    // Imported broker flows are evidence only: they must not be applied on top
    // of the broker-refreshed canonical cash/debt snapshot.
    expect(store.getState().cashCushion?.freeCash).toBe(40);
    expect(store.getState().balance).toBe(-75);
    expect(store.getState().positions.GOOGL?.shares).toBe(5);
    expect(store.getState().transactionEvents?.filter((event) =>
      evidenceTypes.includes(event.type)
    )).toHaveLength(evidenceTypes.length);

    const reconciliation = events.filter((event) => event.type === 'portfolio.reconciliation');
    expect(reconciliation.length).toBeGreaterThanOrEqual(4);
    expect(verifyPortfolioTransactionParity(events, store.getState()).matches).toBe(true);

    const beforeReplay = events.length;
    expect(store.importState(imported)).toBe(true);
    expect(store.getState().transactionEvents).toHaveLength(beforeReplay);

    expect(store.importState({
      brokerExecutedTrades: [{ ...execution, commission: 1.5 }]
    })).toBe(true);
    const revisions = store.getState().transactionEvents?.filter((event) =>
      event.type === 'broker.execution' && event.externalReferenceId === execution.id
    ) || [];
    expect(revisions).toHaveLength(2);
    expect(revisions[1].relatedEventId).toBe(revisions[0].id);
    expect(revisions[1].fees).toBe(1.5);
    expect(verifyPortfolioTransactionParity(store.getState().transactionEvents || [], store.getState()).matches).toBe(true);
  });

  it('journals direct position, cash-holding, free-cash and debt edits as observed reconciliation deltas', () => {
    const store = new PortfolioStore();
    expect(store.setState({
      positions: {
        NVDA: {
          ticker: 'NVDA',
          shares: 4,
          currentPrice: 120,
          pt: 130,
          commBuy: 0,
          tranches: [{ qty: 4, price: 100, date: '2026-11-01' }]
        }
      },
      balance: -123,
      cashCushion: {
        freeCash: 45,
        holdings: [{ ticker: 'MSFT', shares: 2, price: 50 }]
      },
      realizedMarginCharged: 7
    })).toBe(true);

    const events = store.getState().transactionEvents || [];
    const reconciliations = events.filter((event) => event.type === 'portfolio.reconciliation');
    expect(reconciliations).toHaveLength(5);
    expect(reconciliations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: 'NVDA',
        positionQuantityDelta: 4,
        actor: { type: 'system' },
        source: 'canonical-snapshot-reconciliation'
      }),
      expect.objectContaining({
        ticker: 'MSFT',
        cashHoldingQuantityDelta: 2,
        actor: { type: 'system' },
        source: 'canonical-snapshot-reconciliation'
      }),
      expect.objectContaining({
        cashDelta: 45,
        actor: { type: 'system' },
        source: 'canonical-snapshot-reconciliation'
      }),
      expect.objectContaining({
        marginDebtDelta: 123,
        actor: { type: 'system' },
        source: 'canonical-snapshot-reconciliation'
      }),
      expect.objectContaining({
        realizedMarginChargeDelta: 7,
        actor: { type: 'system' },
        source: 'canonical-snapshot-reconciliation'
      })
    ]));
    for (const event of reconciliations) {
      expect(event.realizedPnl).toBeUndefined();
      expect(event.netAmount).toBeUndefined();
      expect(event.fees).toBeUndefined();
    }
    expect(verifyPortfolioTransactionParity(events, store.getState()).matches).toBe(true);
  });

  it('does not publish a financial mutation or append its event when persistence fails', () => {
    const failingStorage = {
      getItem: (key: string) => sharedTestStorage.get(key) ?? null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: (key: string) => { sharedTestStorage.delete(key); }
    };
    vi.stubGlobal('localStorage', failingStorage);

    const store = new PortfolioStore();
    store.setState({ balance: -25 }, false);
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.buyStock('MSFT', 1, 100, '2026-11-06', undefined, {
      idempotencyKey: 'failed-buy-1'
    })).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().positions.MSFT).toBeUndefined();
    expect(store.getState().transactionEvents).toEqual(before.transactionEvents);
    expect(listener).not.toHaveBeenCalled();
  });

  it('makes automatic rollover idempotent for the same timestamp', () => {
    const store = new PortfolioStore();
    const timestamp = Date.parse('2026-11-06T00:00:00.000Z');
    expect(store.applyRollover(105, 5, timestamp, true)).toBe(true);
    const afterFirst = store.getState();

    expect(store.applyRollover(105, 5, timestamp, true)).toBe(true);
    expect(store.getState()).toBe(afterFirst);
    expect(store.getState().transactionEvents?.filter((event) => event.type === 'margin.interest')).toHaveLength(1);

    expect(store.applyRollover(106, 6, timestamp, true)).toBe(false);
    expect(store.getState()).toBe(afterFirst);
  });


  it('prevents generic state patches and older backup imports from replacing committed audit history', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 1, 100, '2026-11-01')).toBe(true);
    const originalEvents = store.getState().transactionEvents || [];
    const originalState = store.getState();

    expect(store.setState({ transactionEvents: [] } as any)).toBe(false);
    expect(store.getState().transactionEvents).toEqual(originalEvents);

    expect(store.importState({ transactionEvents: [] })).toBe(true);
    expect(store.getState().transactionEvents).toEqual(originalEvents);

    const importedEvent = {
      ...originalEvents[0],
      id: 'imported-event-2',
      idempotencyKey: undefined,
      requestFingerprint: undefined,
      type: 'cash.adjustment' as const,
      lotId: undefined,
      acquisitionDate: undefined,
      lotAllocations: undefined,
      ticker: undefined,
      quantity: undefined,
      unitPrice: undefined,
      grossAmount: 25,
      fees: undefined,
      cashDelta: 25,
      marginDebtDelta: undefined,
      note: 'Imported cash adjustment'
    };
    expect(store.importState({ transactionEvents: [importedEvent] })).toBe(true);
    expect(store.getState().transactionEvents).toHaveLength(3);
    expect(store.getState().transactionEvents?.[0]).toEqual(originalEvents[0]);
    expect(store.getState().transactionEvents?.[1]).toMatchObject({
      id: 'imported-event-2',
      type: 'cash.adjustment',
      cashDelta: 25
    });
    expect(store.getState().transactionEvents?.[2]).toMatchObject({
      type: 'portfolio.reconciliation',
      cashDelta: -25
    });

    const committed = store.getState();
    expect(store.importState({
      transactionEvents: [{ ...originalEvents[0], quantity: 99 }]
    })).toBe(false);
    expect(store.getState()).toBe(committed);
    expect(store.getState()).not.toBe(originalState);
  });

  it('rejects malformed imported transaction events without replacing current state', () => {
    const store = new PortfolioStore();
    const before = store.getState();
    expect(store.importState({
      transactionEvents: [{ id: 'bad-event', schemaVersion: 9 }]
    } as any)).toBe(false);
    expect(store.getState()).toBe(before);
  });
  it('applies a verified split once, preserves basis, and restores the action journal', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 500,
          pt: 600,
          commBuy: 12,
          startDate: '2019-01-02',
          tranches: [{ qty: 10, price: 100, date: '2019-01-02', buyCommission: 12 }],
          quoteDetails: {
            price: 500,
            provider: 'FINNHUB',
            sourceTimestamp: Date.parse('2020-08-28T20:00:00Z'),
            receivedAt: Date.now(),
            freshness: 'fresh',
            dataQuality: 'complete',
            currency: 'USD'
          }
        }
      }
    });
    const action = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt: Date.now() }).events[0];
    const cashBefore = store.getState().cashCushion.freeCash;
    const balanceBefore = store.getState().balance;
    const recordedAt = Date.parse('2026-11-08T10:00:00Z');

    const applied = store.applyCorporateActionSplit(action, recordedAt);
    expect(applied).toMatchObject({ status: 'applied', sourceId: action.sourceId });
    const state = store.getState();
    expect(state.positions.AAPL).toMatchObject({
      shares: 40,
      currentPrice: 125,
      pt: 150,
      tranches: [{ qty: 40, price: 25, buyCommission: 12 }],
      quoteDetails: { freshness: 'stale', dataQuality: 'partial' }
    });
    expect(state.cashCushion.freeCash).toBe(cashBefore);
    expect(state.balance).toBe(balanceBefore);
    expect(state.transactionEvents?.filter(event => event.type === 'corporate-action')).toHaveLength(1);
    expect(state.corporateActionEvents).toHaveLength(1);
    expect(verifyPortfolioTransactionParity(state.transactionEvents || [], state).matches).toBe(true);

    const reloaded = new PortfolioStore();
    expect(reloaded.getState().corporateActionEvents).toEqual(state.corporateActionEvents);
    const duplicate = reloaded.applyCorporateActionSplit(action, recordedAt + 1);
    expect(duplicate?.status).toBe('applied');
    expect(reloaded.getState().positions.AAPL.shares).toBe(40);
    expect(reloaded.getState().transactionEvents?.filter(event => event.type === 'corporate-action')).toHaveLength(1);

    const conflictingRevision = {
      ...action,
      toFactor: 7,
      sharesAfterPerShareBefore: 7
    };
    expect(reloaded.applyCorporateActionSplit(conflictingRevision, recordedAt + 2)).toBeNull();
    expect(reloaded.getState().positions.AAPL.shares).toBe(40);
    expect(reloaded.getState().corporateActionEvents).toEqual(state.corporateActionEvents);
  });

  it('rejects changed evidence when a corporate-action source ID is reused', () => {
    const store = new PortfolioStore();
    const action = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt: Date.now() }).events[0];

    const recorded = store.recordCorporateActionEvidence(action);
    expect(recorded).toMatchObject({ status: 'review_required', sourceId: action.sourceId });
    const before = store.getState().corporateActionEvents;

    const conflictingRevision = {
      ...action,
      toFactor: 7,
      sharesAfterPerShareBefore: 7
    };
    expect(store.recordCorporateActionEvidence(conflictingRevision)).toBeNull();
    expect(store.getState().corporateActionEvents).toEqual(before);
  });

  it('withholds split adjustment while broker position integrity is unresolved', () => {
    const store = new PortfolioStore();
    const brokerSnapshot = {
      loaded: true,
      balances: [],
      positions: [],
      status: 'current',
      quality: 'partial',
      snapshotQuality: 'partial',
      positionIntegrityIssues: [{
        ticker: 'AAPL',
        code: 'short_position_side_unverified',
        source: 'account_snapshot'
      }],
      receivedAt: Date.now()
    } as unknown as NonNullable<PortfolioState['brokerAccountInfo']>;
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 500,
          pt: 600,
          commBuy: 0,
          tranches: [{ qty: 10, price: 100, date: '2019-01-02' }],
          quoteDetails: {
            price: 500,
            provider: 'FINNHUB',
            sourceTimestamp: Date.parse('2020-08-28T20:00:00Z'),
            receivedAt: Date.now(),
            freshness: 'fresh',
            dataQuality: 'complete',
            currency: 'USD'
          }
        }
      },
      brokerAccountInfo: brokerSnapshot
    });
    const before = store.getState().positions.AAPL;
    const action = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt: Date.now() }).events[0];

    expect(store.applyCorporateActionSplit(action)).toMatchObject({
      status: 'review_required',
      note: 'Broker position integrity is unresolved for this ticker. Resolve the position-side or execution discrepancy before applying a corporate action.'
    });
    expect(store.getState().positions.AAPL).toEqual(before);
    expect(store.getState().transactionEvents?.filter(event => event.type === 'corporate-action')).toHaveLength(0);
  });

  it('withholds split adjustment when the latest broker snapshot is stale', () => {
    const store = new PortfolioStore();
    const brokerSnapshot = {
      loaded: true,
      balances: [],
      positions: [],
      status: 'stale',
      quality: 'complete',
      snapshotQuality: 'complete',
      receivedAt: Date.now()
    } as unknown as NonNullable<PortfolioState['brokerAccountInfo']>;
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 500,
          pt: 600,
          commBuy: 0,
          tranches: [{ qty: 10, price: 100, date: '2019-01-02' }],
          quoteDetails: {
            price: 500,
            provider: 'FINNHUB',
            sourceTimestamp: Date.parse('2020-08-28T20:00:00Z'),
            receivedAt: Date.now(),
            freshness: 'fresh',
            dataQuality: 'complete',
            currency: 'USD'
          }
        }
      },
      brokerAccountInfo: brokerSnapshot
    });
    const before = store.getState().positions.AAPL;
    const action = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt: Date.now() }).events[0];

    expect(store.applyCorporateActionSplit(action)).toMatchObject({
      status: 'review_required',
      note: 'The latest broker position snapshot is stale or incomplete. Refresh and verify it before applying a corporate action.'
    });
    expect(store.getState().positions.AAPL).toEqual(before);
  });

  it('does not partially apply a split when matching cash holdings lack dated lots', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 500,
          pt: 600,
          commBuy: 0,
          tranches: [{ qty: 10, price: 100, date: '2019-01-02' }],
          quoteDetails: {
            price: 500,
            provider: 'FINNHUB',
            sourceTimestamp: Date.parse('2020-08-28T20:00:00Z'),
            receivedAt: Date.now(),
            freshness: 'fresh',
            dataQuality: 'complete',
            currency: 'USD'
          }
        }
      },
      cashCushion: {
        freeCash: 0,
        holdings: [{ ticker: 'AAPL', shares: 2, averagePrice: 90 }]
      }
    });
    const before = store.getState().positions.AAPL;
    const action = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt: Date.now() }).events[0];

    expect(store.applyCorporateActionSplit(action)).toMatchObject({
      status: 'review_required',
      note: 'A matching cash holding is also present. Its acquisition lots and effective-date eligibility are not modeled, so the split was not partially applied.'
    });
    expect(store.getState().positions.AAPL).toEqual(before);
    expect(store.getState().cashCushion.holdings).toHaveLength(1);
    expect(store.getState().transactionEvents?.filter(event => event.type === 'corporate-action')).toHaveLength(0);
  });

  it('persists a review-required action without changing a mixed pre/post-action position', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 100,
          pt: 120,
          commBuy: 0,
          tranches: [
            { qty: 5, price: 100, date: '2019-01-02' },
            { qty: 5, price: 100, date: '2021-01-02' }
          ]
        }
      }
    });
    const before = store.getState().positions.AAPL;
    const action = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt: Date.now() }).events[0];
    const recorded = store.applyCorporateActionSplit(action);
    expect(recorded).toMatchObject({ status: 'review_required' });
    expect(store.getState().positions.AAPL).toEqual(before);
    expect(store.getState().corporateActionEvents).toHaveLength(1);
    expect(store.getState().transactionEvents?.filter(event => event.type === 'corporate-action')).toHaveLength(0);
  });

  it('persists history correction before/after evidence and merges an older backup idempotently', () => {
    const timestamp = 1_793_966_400_000;
    const event = createMarketHistoryCorrectionEvent({
      symbol: 'AAPL',
      interval: '1D',
      timestamp,
      provider: 'FINNHUB',
      receivedAt: timestamp + 10,
      recordedAt: timestamp + 20,
      previous: { timestamp, price: 100 },
      corrected: { timestamp, price: 101 },
      reason: 'Verified closing-price correction.'
    });
    const store = new PortfolioStore();
    expect(store.recordMarketHistoryCorrection(event)).toEqual(event);
    const state = store.getState();
    expect(state.marketHistoryCorrections).toEqual([event]);

    const restored = new PortfolioStore();
    expect(restored.getState().marketHistoryCorrections).toEqual([event]);
    expect(restored.importState({ marketHistoryCorrections: [event] })).toBe(true);
    expect(restored.getState().marketHistoryCorrections).toHaveLength(1);
  });

});

describe('broker position integrity persistence', () => {
  it('retains signed broker evidence and integrity issues across local reload', () => {
    const store = new PortfolioStore();
    const brokerAccountInfo = {
      loaded: true,
      receivedAt: 1_800_000_000_000,
      status: 'stale',
      quality: 'partial',
      snapshotQuality: 'partial',
      balances: [],
      positions: [{
        ticker: 'GOOGL.US',
        name: 'Alphabet',
        quantity: -2,
        currency: 'USD',
        marketPrice: 290,
        marketValue: -580,
        averagePrice: 300,
        profitClose: null,
        accountPositionId: 42,
        direction: 'unknown',
        rawQuantity: -2,
        rawSide: 'S',
        instrumentId: 'security-42',
        raw: { i: 'GOOGL.US', q: -2, position_side: 'S' }
      }],
      positionIntegrityIssues: [{
        ticker: 'GOOGL',
        code: 'negative_quantity_sign_unverified',
        source: 'account_snapshot',
        rawQuantity: -2,
        rawSide: 'S',
        instrumentId: 'security-42',
        raw: { i: 'GOOGL.US', q: -2, position_side: 'S' }
      }]
    };

    expect(store.importState({ brokerAccountInfo } as any)).toBe(true);

    const reloaded = new PortfolioStore().getState().brokerAccountInfo;
    expect(reloaded).toMatchObject({
      quality: 'partial',
      snapshotQuality: 'partial',
      positions: [{ quantity: -2, direction: 'unknown', rawQuantity: -2, rawSide: 'S', instrumentId: 'security-42' }],
      positionIntegrityIssues: [{
        ticker: 'GOOGL',
        code: 'negative_quantity_sign_unverified',
        rawQuantity: -2,
        rawSide: 'S',
        instrumentId: 'security-42'
      }]
    });
  });
});


describe('audit-only broker reconciliation review records', () => {
  beforeEach(() => {
    sharedTestStorage.clear();
    vi.stubGlobal('localStorage', sharedLocalStorage);
  });

  it('appends an idempotent review event without changing financial state', () => {
    const store = new PortfolioStore();
    expect(store.setFreeCash(250)).toBe(true);
    expect(store.buyStock('AAPL', 1, 50, '2026-11-08')).toBe(true);
    const before = store.getState();
    const financialBefore = {
      positions: before.positions,
      cashBalance: before.cashBalance,
      balance: before.balance,
      cashCushion: before.cashCushion,
      closedTrades: before.closedTrades
    };

    expect(store.recordReconciliationReview(
      'activity',
      'finding-42',
      'execution_fee_mismatch',
      'AAPL',
      'Compared the broker fee reference with the saved execution evidence.'
    )).toBe(true);

    const after = store.getState();
    const review = after.transactionEvents?.at(-1);
    expect(review).toMatchObject({
      type: 'portfolio.reconciliation',
      actor: { type: 'user' },
      source: 'broker-reconciliation-review',
      idempotencyKey: 'reconciliation-review:activity:finding-42',
      note: 'Reviewed activity finding finding-42 (execution_fee_mismatch) for AAPL. Reason: Compared the broker fee reference with the saved execution evidence.'
    });
    expect(review?.positionQuantityDelta).toBeUndefined();
    expect(review?.cashHoldingQuantityDelta).toBeUndefined();
    expect(review?.cashDelta).toBeUndefined();
    expect(review?.marginDebtDelta).toBeUndefined();
    expect({
      positions: after.positions,
      cashBalance: after.cashBalance,
      balance: after.balance,
      cashCushion: after.cashCushion,
      closedTrades: after.closedTrades
    }).toEqual(financialBefore);
    const coverage = inspectPortfolioTransactionJournalReplayCoverage(after.transactionEvents || []);
    expect(coverage.status).toBe('complete');
    expect(coverage.auditOnlyCount).toBe(1);

    const eventCount = after.transactionEvents?.length ?? 0;
    expect(store.recordReconciliationReview(
      'activity',
      'finding-42',
      'execution_fee_mismatch',
      'AAPL',
      'Compared the broker fee reference with the saved execution evidence.'
    )).toBe(true);
    expect(store.getState().transactionEvents).toHaveLength(eventCount);

    // A finding's stable review key cannot be silently reused for a different reason.
    expect(store.recordReconciliationReview(
      'activity',
      'finding-42',
      'execution_fee_mismatch',
      'AAPL',
      'A different review reason.'
    )).toBe(false);
    expect(store.getState().transactionEvents).toHaveLength(eventCount);
    expect(store.recordReconciliationReview('quote', 'finding-42', 'price_mismatch', 'AAPL', 'Checked the quote.')).toBe(true);
  });

  it('rejects malformed or oversized review input without changing the journal', () => {
    const store = new PortfolioStore();
    const before = store.getState();
    expect(store.recordReconciliationReview('activity', '', 'mismatch', 'AAPL', 'Reason')).toBe(false);
    expect(store.recordReconciliationReview('activity', 'id', 'mismatch', 'AAPL', '     ')).toBe(false);
    expect(store.recordReconciliationReview('activity', 'id', 'mismatch', 'AAPL', 'x'.repeat(241))).toBe(false);
    expect(store.getState()).toBe(before);
  });
});

describe('auditable balance adjustment reversals', () => {
  beforeEach(() => {
    sharedTestStorage.clear();
    vi.stubGlobal('localStorage', sharedLocalStorage);
  });

  it('reverses a free-cash adjustment with one immutable linked correction event', () => {
    const store = new PortfolioStore();
    expect(store.setFreeCash(500)).toBe(true);
    const original = store.getState().transactionEvents?.at(-1);
    expect(original).toMatchObject({ type: 'cash.adjustment', cashDelta: 500 });
    const originalCount = store.getState().transactionEvents?.length;

    expect(store.reverseBalanceAdjustment(original!.id, 'Duplicate manual cash entry')).toBe(true);
    const afterReversal = store.getState();
    const reversal = afterReversal.transactionEvents?.at(-1);

    expect(afterReversal.cashCushion.freeCash).toBe(0);
    expect(afterReversal.cashBalance).toBe(0);
    expect(reversal).toMatchObject({
      type: 'correction',
      relatedEventId: original!.id,
      cashDelta: -500,
      note: `Reversal of balance adjustment ${original!.id}: Duplicate manual cash entry`,
      actor: { type: 'user' },
      source: 'transaction-reversal'
    });
    expect(afterReversal.transactionEvents).toHaveLength((originalCount || 0) + 1);
    expect(inspectPortfolioTransactionJournalReplayCoverage(afterReversal.transactionEvents || []).status).toBe('complete');
    expect(verifyPortfolioTransactionParity(afterReversal.transactionEvents || [], afterReversal))
      .toEqual({ matches: true, discrepancies: [] });

    // A repeat is idempotent and does not append a second correction or notify
    // listeners with a new snapshot.
    expect(store.reverseBalanceAdjustment(original!.id, 'Duplicate manual cash entry')).toBe(true);
    expect(store.getState()).toBe(afterReversal);
    expect(store.getState().transactionEvents).toHaveLength((originalCount || 0) + 1);
    expect(store.reverseBalanceAdjustment(original!.id, 'Different reason')).toBe(false);
  });

  it('reverses margin-debt adjustments and preserves the signed balance convention', () => {
    const store = new PortfolioStore();
    expect(store.setMarginDebt(75)).toBe(true);
    const original = store.getState().transactionEvents?.at(-1);

    expect(store.reverseBalanceAdjustment(original!.id, 'Incorrect debt entry')).toBe(true);
    expect(store.getState().balance).toBe(0);
    expect(store.getState().transactionEvents?.at(-1)).toMatchObject({
      type: 'correction',
      relatedEventId: original!.id,
      marginDebtDelta: -75
    });
    expect(verifyPortfolioTransactionParity(store.getState().transactionEvents || [], store.getState()))
      .toEqual({ matches: true, discrepancies: [] });
  });

  it('rejects unsupported trade reversals and prevents a reversal from creating negative cash', () => {
    const tradeStore = new PortfolioStore();
    expect(tradeStore.buyStock('AAPL', 1, 100, '2026-11-08')).toBe(true);
    const tradeEvent = tradeStore.getState().transactionEvents?.at(-1);
    const tradeSnapshot = tradeStore.getState();
    expect(tradeStore.reverseBalanceAdjustment(tradeEvent!.id, 'Incorrect trade')).toBe(false);
    expect(tradeStore.getState()).toBe(tradeSnapshot);

    // Use an isolated persisted snapshot for the cash scenario; PortfolioStore
    // intentionally reloads the previous instance's committed local snapshot.
    sharedTestStorage.clear();
    const cashStore = new PortfolioStore();
    expect(cashStore.setFreeCash(100)).toBe(true);
    const originalCashEvent = cashStore.getState().transactionEvents?.at(-1);
    expect(cashStore.setFreeCash(20)).toBe(true);
    const beforeRejectedReversal = cashStore.getState();

    // The original +100 entry has since been mostly consumed. Reversing it
    // would take free cash below zero, so no state or journal write is allowed.
    expect(cashStore.reverseBalanceAdjustment(originalCashEvent!.id, 'Undo original cash funding')).toBe(false);
    expect(cashStore.getState()).toBe(beforeRejectedReversal);
    expect(cashStore.getState().transactionEvents).toHaveLength(2);
  });

  it('does not publish or append a reversal when the snapshot commit fails', () => {
    const store = new PortfolioStore();
    expect(store.setFreeCash(500)).toBe(true);
    const original = store.getState().transactionEvents?.at(-1);
    const before = store.getState();
    const failingStorage = {
      getItem: (key: string) => sharedTestStorage.get(key) ?? null,
      setItem: () => { throw new Error('quota exceeded'); },
      removeItem: (key: string) => { sharedTestStorage.delete(key); }
    };
    const listener = vi.fn();
    store.subscribe(listener);
    vi.stubGlobal('localStorage', failingStorage);

    expect(store.reverseBalanceAdjustment(original!.id, 'Cannot commit reversal')).toBe(false);
    expect(store.getState()).toBe(before);
    expect(store.getState().cashCushion.freeCash).toBe(500);
    expect(store.getState().transactionEvents).toEqual(before.transactionEvents);
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects missing originals, unsupported history corrections and invalid reasons', () => {
    const store = new PortfolioStore();
    expect(store.reverseBalanceAdjustment('missing-event', 'A valid reason')).toBe(false);
    expect(store.reverseBalanceAdjustment('missing-event', '   ')).toBe(false);
    expect(store.reverseBalanceAdjustment('missing-event', 'x'.repeat(501))).toBe(false);
    expect(store.buyStock('AAPL', 1, 100, '2026-11-08')).toBe(true);
    const tradeId = store.getState().transactionEvents?.at(-1)?.id;
    expect(store.reverseBalanceAdjustment(tradeId!, 'Trade reversal is not supported')).toBe(false);
  });
});
