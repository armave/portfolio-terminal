import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from './commandDispatcher';
import { loadBuyMorePreferences, saveBuyMorePreferences, type BuyMorePreferences } from './buyMorePreferences';
import { portfolioStore } from '../../store/portfolioStore';

afterEach(() => vi.restoreAllMocks());

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    values
  };
}
const validPreferences: BuyMorePreferences = {
  version: 1, ticker: 'AAPL', shares: '5', price: '105.25',
  lastResult: {
    savedAt: 100,
    columns: ['NOW Net', 'AFTER Net', 'NOW F&C', 'AFTER F&C', 'NOW M Fee', 'AFTER M Fee', 'NOW Balance', 'AFTER Balance'],
    rows: [{
      label: 'Tue, Nov 10 · TODAY',
      values: ['+$10.00', '+$12.00', '$1.00', '$1.50', '$0.10', '$0.12', '−$100.00', '−$200.00'],
      kind: 'result'
    }],
    note: 'Estimate only.',
    summary: '[BUY MORE: AAPL]'
  }
};
describe('Buy More preferences', () => {
  it('persists account-scoped inputs and the latest complete result', () => {
    const storage = createStorage();
    expect(saveBuyMorePreferences('buy-more:user-a', validPreferences, storage)).toBe(true);
    expect(loadBuyMorePreferences('buy-more:user-a', storage)).toEqual(validPreferences);
    expect(loadBuyMorePreferences('buy-more:user-b', storage)).toBeNull();
  });
  it('normalizes ticker casing and rejects malformed snapshots', () => {
    const storage = createStorage();
    expect(saveBuyMorePreferences('buy-more', { ...validPreferences, ticker: 'aapl' }, storage)).toBe(true);
    expect(loadBuyMorePreferences('buy-more', storage)?.ticker).toBe('AAPL');
    storage.setItem('invalid', JSON.stringify({
      ...validPreferences, lastResult: { ...validPreferences.lastResult, columns: ['only one'] }
    }));
    expect(loadBuyMorePreferences('invalid', storage)?.lastResult).toBeNull();
    storage.setItem('bad', JSON.stringify({ ...validPreferences, ticker: '../secret' }));
    expect(loadBuyMorePreferences('bad', storage)).toBeNull();
  });
  it('fails safely when browser storage is unavailable or throws', () => {
    expect(loadBuyMorePreferences('buy-more', null)).toBeNull();
    expect(saveBuyMorePreferences('buy-more', validPreferences, null)).toBe(false);
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); }
    };
    expect(loadBuyMorePreferences('buy-more', throwing)).toBeNull();
    expect(saveBuyMorePreferences('buy-more', validPreferences, throwing)).toBe(false);
  });
});
describe('Market Tools Buy More preview', () => {
  it('reuses the existing deterministic scenario engine without mutating the portfolio', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state, activeView: 'AAPL',
      positions: { ...state.positions, AAPL: {
        ticker: 'AAPL', shares: 10, currentPrice: 110, pt: 120, commBuy: 2,
        tranches: [{ qty: 10, price: 100, buyCommission: 2 }]
      } }
    } as any);
    const buyStock = vi.spyOn(portfolioStore, 'buyStock');
    const sellStock = vi.spyOn(portfolioStore, 'sellStock');
    const result = CommandDispatcher.previewBuyMoreScenario('aapl', 5, 105);
    expect(result.type).toBe('res');
    expect(result.modal?.kind).toBe('buy-more');
    expect(result.modal?.columns).toHaveLength(8);
    expect(result.modal?.rows.length).toBeGreaterThan(0);
    expect(result.modal?.rows.every(row => row.values.length === 8)).toBe(true);
    expect(buyStock).not.toHaveBeenCalled();
    expect(sellStock).not.toHaveBeenCalled();
    expect(CommandDispatcher.previewBuyMoreScenario('AAPL', 0, 105).type).toBe('err');
    expect(CommandDispatcher.previewBuyMoreScenario('AAPL', 5, 0).type).toBe('err');
    expect(CommandDispatcher.previewBuyMoreScenario('!!!', 5, 105).type).toBe('err');
  });
});
