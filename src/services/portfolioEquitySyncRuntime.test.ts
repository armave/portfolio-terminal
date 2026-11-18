import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioStore } from '../store/portfolioStore';
import { createPortfolioEquitySyncRuntime } from './portfolioEquitySyncRuntime';

const stored = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, String(value)); },
  removeItem: (key: string) => { stored.delete(key); }
};

beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portfolio equity synchronization', () => {
  it('keeps 100 live quote updates in memory without local persistence or cloud writes', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 1,
          currentPrice: 100,
          pt: 120,
          commBuy: 0,
          tranches: [{ qty: 1, price: 90, date: '2026-10-01' }]
        }
      },
      portfolioEquity: 100,
      balance: 0,
      cashCushion: { freeCash: 0, holdings: [] }
    });

    const persistedBeforeQuotes = stored.get('margin_portfolio_state_dynamic_v2');
    const sources: string[] = [];
    const pushStateToCloud = vi.fn();
    const runtime = createPortfolioEquitySyncRuntime({
      subscribe: (listener) => store.subscribe((state, source) => {
        sources.push(source);
        listener(state, source);
      }),
      getState: () => store.getState(),
      calculateEquity: (state) => Object.values(state.positions).reduce(
        (total, position) => total + position.currentPrice * position.shares,
        Number(state.balance || 0) + Number(state.cashCushion?.freeCash || 0)
      ),
      setDerivedEquity: (equity, updatedAt, persist) => {
        store.setDerivedState({ portfolioEquity: equity, portfolioEquityUpdatedAt: updatedAt }, persist);
      },
      onDurableEquityChanged: pushStateToCloud,
      now: () => 1_800_000_000_000
    });

    for (let index = 1; index <= 100; index += 1) {
      expect(store.updateLiveQuote('AAPL', {
        price: 100 + index,
        quoteUpdatedAt: 1_800_000_000_000 + index,
        requestStartedAt: 1_800_000_000_000 + index,
        quoteDetails: { transport: 'websocket', receivedAt: 1_800_000_000_000 + index }
      })).toBe(true);
    }

    expect(store.getState().positions.AAPL.currentPrice).toBe(200);
    expect(store.getState().portfolioEquity).toBe(200);
    expect(sources).toContain('live-quote');
    expect(sources).toContain('derived');
    expect(pushStateToCloud).not.toHaveBeenCalled();
    expect(stored.get('margin_portfolio_state_dynamic_v2')).toBe(persistedBeforeQuotes);

    expect(store.setState({ balance: 50 })).toBe(true);
    expect(store.getState().portfolioEquity).toBe(250);
    expect(pushStateToCloud).toHaveBeenCalledTimes(1);
    const persistedAfterDurableEdit = JSON.parse(stored.get('margin_portfolio_state_dynamic_v2') || '{}');
    expect(persistedAfterDurableEdit.portfolioEquity).toBe(250);

    runtime.dispose();
  });
  it('records live performance observations without pushing each quote to cloud', async () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {
        AAPL: {
          ticker: 'AAPL', shares: 1, currentPrice: 100, pt: 120, commBuy: 0,
          tranches: [{ qty: 1, price: 90, date: '2026-10-01' }]
        }
      },
      portfolioEquity: 100,
      balance: 0,
      cashCushion: { freeCash: 0, holdings: [] }
    });

    const recordPerformanceSnapshot = vi.fn(async () => true);
    const onPerformanceSnapshotChanged = vi.fn();
    const onDurableEquityChanged = vi.fn();
    const runtime = createPortfolioEquitySyncRuntime({
      subscribe: (listener) => store.subscribe(listener),
      getState: () => store.getState(),
      calculateEquity: (state) => Object.values(state.positions).reduce(
        (total, position) => total + position.currentPrice * position.shares,
        Number(state.balance || 0) + Number(state.cashCushion?.freeCash || 0)
      ),
      setDerivedEquity: (equity, updatedAt, persist) => {
        store.setDerivedState({ portfolioEquity: equity, portfolioEquityUpdatedAt: updatedAt }, persist);
      },
      onDurableEquityChanged,
      recordPerformanceSnapshot,
      onPerformanceSnapshotChanged,
      now: () => 1_800_000_000_000
    });
    await Promise.resolve();

    expect(recordPerformanceSnapshot).toHaveBeenCalledTimes(1);
    expect(onPerformanceSnapshotChanged).toHaveBeenCalledTimes(1);

    store.updateLiveQuote('AAPL', {
      price: 100,
      quoteUpdatedAt: 1_800_000_000_001,
      requestStartedAt: 1_800_000_000_001,
      quoteDetails: { currency: 'USD', freshness: 'fresh', sourceTimestamp: 1_800_000_000_001 }
    });
    await Promise.resolve();
    expect(recordPerformanceSnapshot).toHaveBeenCalledTimes(2);
    // Live quote ticks still update the same-day valuation, but do not schedule
    // one cloud write per quote. The normal scheduled checkpoint persists them.
    expect(onPerformanceSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(onDurableEquityChanged).not.toHaveBeenCalled();

    store.setDerivedState({ portfolioEquityUpdatedAt: 1_800_000_000_002 });
    expect(recordPerformanceSnapshot).toHaveBeenCalledTimes(2);

    expect(store.setState({ balance: 50 })).toBe(true);
    await Promise.resolve();
    expect(recordPerformanceSnapshot).toHaveBeenCalledTimes(3);
    expect(onPerformanceSnapshotChanged).toHaveBeenCalledTimes(2);
    expect(onDurableEquityChanged).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it('defers performance capture until the workspace pull settles and flushes the latest state once', () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {},
      balance: 0,
      portfolioEquity: 0,
      cashCushion: { freeCash: 0, holdings: [] },
      activeView: 'BALANCE'
    });

    let workspaceReady = false;
    const capturedBalances: number[] = [];
    const onPerformanceSnapshotChanged = vi.fn();
    const runtime = createPortfolioEquitySyncRuntime({
      subscribe: (listener) => store.subscribe(listener),
      getState: () => store.getState(),
      calculateEquity: () => 0,
      setDerivedEquity: () => {},
      onDurableEquityChanged: vi.fn(),
      recordPerformanceSnapshot: (state) => {
        capturedBalances.push(state.balance);
        return true;
      },
      onPerformanceSnapshotChanged,
      isPerformanceSnapshotReady: () => workspaceReady,
      now: () => 1_800_000_000_000
    });

    expect(capturedBalances).toEqual([]);
    expect(onPerformanceSnapshotChanged).not.toHaveBeenCalled();

    expect(store.setState({ balance: 500 })).toBe(true);
    expect(capturedBalances).toEqual([]);

    runtime.flushDeferredPerformanceSnapshot();
    expect(capturedBalances).toEqual([]);

    workspaceReady = true;
    runtime.flushDeferredPerformanceSnapshot();
    expect(capturedBalances).toEqual([500]);
    expect(onPerformanceSnapshotChanged).toHaveBeenCalledTimes(1);

    runtime.flushDeferredPerformanceSnapshot();
    expect(capturedBalances).toEqual([500]);
    runtime.dispose();
  });


  it('re-defers an in-flight capture when workspace readiness closes before it completes', async () => {
    const store = new PortfolioStore();
    store.importState({
      positions: {},
      balance: 0,
      portfolioEquity: 0,
      cashCushion: { freeCash: 0, holdings: [] },
      activeView: 'BALANCE'
    });

    let workspaceReady = true;
    let resolveFirstCapture!: (changed: boolean) => void;
    const recordPerformanceSnapshot = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveFirstCapture = resolve;
      }))
      .mockImplementationOnce(() => true);
    const onPerformanceSnapshotChanged = vi.fn();
    const runtime = createPortfolioEquitySyncRuntime({
      subscribe: (listener) => store.subscribe(listener),
      getState: () => store.getState(),
      calculateEquity: () => 0,
      setDerivedEquity: () => {},
      onDurableEquityChanged: vi.fn(),
      recordPerformanceSnapshot,
      onPerformanceSnapshotChanged,
      isPerformanceSnapshotReady: () => workspaceReady,
      now: () => 1_800_000_000_000
    });

    expect(recordPerformanceSnapshot).toHaveBeenCalledTimes(1);
    workspaceReady = false;
    resolveFirstCapture(true);
    await Promise.resolve();
    expect(onPerformanceSnapshotChanged).not.toHaveBeenCalled();

    workspaceReady = true;
    runtime.flushDeferredPerformanceSnapshot();
    expect(recordPerformanceSnapshot).toHaveBeenCalledTimes(2);
    expect(onPerformanceSnapshotChanged).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

});
