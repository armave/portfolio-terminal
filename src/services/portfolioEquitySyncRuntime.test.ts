import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioStore } from '../store/portfolioStore';
import { createPortfolioEquitySyncRuntime } from './portfolioEquitySyncRuntime';

const stored = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, String(value)); },
  removeItem: (key: string) => { stored.delete(key); },
  key: (index: number) => Array.from(stored.keys())[index] ?? null,
  get length() { return stored.size; }
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
});
