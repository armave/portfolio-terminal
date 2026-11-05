import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PortfolioStore } from './portfolioStore';

const saved = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => saved.get(key) ?? null,
  setItem: (key: string, value: string) => { saved.set(key, String(value)); },
  removeItem: (key: string) => { saved.delete(key); }
};

describe('portfolio trade mutation boundaries', () => {
  beforeEach(() => {
    saved.clear();
    vi.stubGlobal('localStorage', localStorageMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    saved.clear();
  });

  it('rejects a sale larger than the open position without committing or publishing state', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 5, 100, '2026-10-01')).toBe(true);
    const committedState = store.getState();
    const committedSnapshot = saved.get('margin_portfolio_state_dynamic_v2');
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    expect(store.sellStock('AAPL', 6, 120, '2026-10-10')).toBe(false);

    expect(store.getState()).toBe(committedState);
    expect(saved.get('margin_portfolio_state_dynamic_v2')).toBe(committedSnapshot);
    expect(store.getState().positions.AAPL.shares).toBe(5);
    expect(store.getState().closedTrades).toHaveLength(0);
    expect(subscriber).not.toHaveBeenCalled();
  });

  it('rejects a non-finite buy order value without changing the portfolio', () => {
    const store = new PortfolioStore();
    const committedState = store.getState();
    const committedSnapshot = saved.get('margin_portfolio_state_dynamic_v2');

    expect(store.buyStock('BIG', 1e200, 1e200)).toBe(false);

    expect(store.getState()).toBe(committedState);
    expect(saved.get('margin_portfolio_state_dynamic_v2')).toBe(committedSnapshot);
    expect(store.getState().positions.BIG).toBeUndefined();
  });

  it('rejects a non-finite sale order value without changing the portfolio', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 5, 100, '2026-10-01')).toBe(true);
    const committedState = store.getState();
    const committedSnapshot = saved.get('margin_portfolio_state_dynamic_v2');

    expect(store.sellStock('AAPL', 1e200, 1e200, '2026-10-10')).toBe(false);

    expect(store.getState()).toBe(committedState);
    expect(saved.get('margin_portfolio_state_dynamic_v2')).toBe(committedSnapshot);
    expect(store.getState().positions.AAPL.shares).toBe(5);
    expect(store.getState().closedTrades).toHaveLength(0);
  });

  it('accepts an exact full-position exit and preserves the closed-trade record', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 5, 100, '2026-10-01')).toBe(true);

    expect(store.sellStock('AAPL', 5, 120, '2026-10-10')).toBe(true);

    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().closedTrades).toHaveLength(1);
    expect(store.getState().closedTrades[0]).toMatchObject({ ticker: 'AAPL', shares: 5 });
  });

  it('never records more shares sold than the position when tolerating floating-point boundary noise', () => {
    const store = new PortfolioStore();
    expect(store.buyStock('AAPL', 5, 100, '2026-10-01')).toBe(true);

    expect(store.sellStock('AAPL', 5 + 5e-9, 120, '2026-10-10')).toBe(true);

    expect(store.getState().positions.AAPL).toBeUndefined();
    expect(store.getState().closedTrades[0]?.shares).toBe(5);
  });
});
