import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioStore } from './portfolioStore';
import {
  subscribeToActiveView,
  subscribeToPortfolioSelector,
  subscribeToPortfolioState
} from './portfolioSubscriptions';


const testStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => testStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { testStorage.set(key, String(value)); },
  removeItem: (key: string) => { testStorage.delete(key); },
  key: (index: number) => Array.from(testStorage.keys())[index] ?? null,
  get length() { return testStorage.size; }
};

beforeEach(() => {
  testStorage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('portfolio subscription adapters', () => {
  it('replays the current snapshot and streams updates until unsubscribed', () => {
    const store = new PortfolioStore();
    store.setState({ brokerExecutedTrades: [{ id: 'existing' }] as any });
    const listener = vi.fn();

    const unsubscribe = subscribeToPortfolioState(listener, store);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith(store.getState());

    store.setState({ balance: 125 });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].balance).toBe(125);

    unsubscribe();
    store.setState({ balance: 250 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies selectors only when the selected value changes', () => {
    const store = new PortfolioStore();
    const listener = vi.fn();
    const selectTickers = (state: ReturnType<typeof store.getState>) =>
      Object.keys(state.positions || {});
    const sameTickers = (previous: string[], next: string[]) =>
      previous.length === next.length && previous.every((ticker, index) => ticker === next[index]);

    const unsubscribe = subscribeToPortfolioSelector(selectTickers, listener, store, sameTickers);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith([]);

    store.setState({ balance: 100 });
    expect(listener).toHaveBeenCalledTimes(1);

    store.setState({
      positions: {
        AAPL: {
          ticker: 'AAPL',
          shares: 1,
          currentPrice: 100,
          pt: 110,
          commBuy: 0,
          tranches: [{ qty: 1, price: 90, date: '2026-10-01' }]
        }
      }
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(['AAPL']);

    unsubscribe();
  });

  it('replays and streams device-local active-desk changes independently', () => {
    const store = new PortfolioStore();
    const listener = vi.fn();

    const unsubscribe = subscribeToActiveView(listener, store);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenLastCalledWith('COMBINED');

    store.setActiveView('BALANCE');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith('BALANCE');

    unsubscribe();
    store.setActiveView('SETTINGS');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
