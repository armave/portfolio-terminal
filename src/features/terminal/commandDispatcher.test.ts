import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from './commandDispatcher';
import { portfolioStore } from '../../store/portfolioStore';

describe('terminal command validation and cash routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes cash commands to free cash without calling the margin-balance setter', () => {
    const setFreeCash = vi.spyOn(portfolioStore, 'setFreeCash').mockImplementation(() => {});
    const setCashBalance = vi.spyOn(portfolioStore, 'setCashBalance').mockImplementation(() => {});
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...portfolioStore.getState(),
      balance: -587.81
    });

    const result = CommandDispatcher.execute('cash 2500');

    expect(result.type).toBe('res');
    expect(setFreeCash).toHaveBeenCalledWith(2500);
    expect(setCashBalance).not.toHaveBeenCalled();
    expect(result.text).toContain('Margin Debt unchanged: $587.81');
  });

  it('routes explicit balance and debt commands through the balance setter', () => {
    const setFreeCash = vi.spyOn(portfolioStore, 'setFreeCash').mockImplementation(() => {});
    const setCashBalance = vi.spyOn(portfolioStore, 'setCashBalance').mockImplementation(() => {});

    expect(CommandDispatcher.execute('balance 2500').type).toBe('res');
    expect(setCashBalance).toHaveBeenCalledWith(2500);
    expect(CommandDispatcher.execute('debt 500').type).toBe('res');
    expect(setCashBalance).toHaveBeenCalledWith(-500);
    expect(setFreeCash).not.toHaveBeenCalled();
  });

  it('rejects malformed numeric arguments rather than partially parsing them', () => {
    const result = CommandDispatcher.execute('cash 1.2.3');
    expect(result.type).toBe('err');
    expect(result.text).toContain('valid finite amount');
  });

  it('prompts for unresolved required quick-action placeholders', () => {
    const result = CommandDispatcher.execute('bought [shares] [TICKER] for [price]');
    expect(result.type).toBe('err');
    expect(result.text).toContain('replace [shares]');
  });

  it('removes an untouched optional target placeholder from a buy template', () => {
    const buyStock = vi.spyOn(portfolioStore, 'buyStock').mockImplementation(() => {});
    const result = CommandDispatcher.execute('bought 2 AAPL for 100, pt [target]');
    expect(result.type).toBe('res');
    expect(buyStock).toHaveBeenCalledWith('AAPL', 2, 100, expect.any(String), undefined);
  });

  it('dispatches a live quote request as a visible side effect', () => {
    const result = CommandDispatcher.execute('quote AAPL');

    expect(result.type).toBe('cmd');
    expect(result.text).toContain('Fetching live quote for AAPL');
    expect(result.sideEffect).toEqual({ type: 'FETCH_QUOTE', ticker: 'AAPL' });
  });

  it('applies manual quote commands to the store and requests cloud sync', () => {
    const updatePrice = vi.spyOn(portfolioStore, 'updatePrice').mockImplementation(() => {});
    const result = CommandDispatcher.execute('quote AAPL 195.50');

    expect(result.type).toBe('res');
    expect(updatePrice).toHaveBeenCalledWith('AAPL', 195.5);
    expect(result.sideEffect).toEqual({ type: 'SYNC_CLOUD' });
  });

  it('returns validation failures as errors for the command runner to display', () => {
    const result = CommandDispatcher.execute('bought 2 AAPL for 1.2.3');
    expect(result.type).toBe('err');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.sideEffect).toBeUndefined();
  });

  it('adds cash holdings and requests cloud sync when a manual price is supplied', () => {
    const addCashStock = vi.spyOn(portfolioStore, 'addCashStock').mockImplementation(() => {});
    const result = CommandDispatcher.execute('cash add 10 MSFT for 420');

    expect(result.type).toBe('res');
    expect(addCashStock).toHaveBeenCalledWith('MSFT', 10, 420);
    expect(result.sideEffect).toEqual({ type: 'SYNC_CLOUD' });
  });

  it('requests a live quote when a cash holding is added without a price', () => {
    const addCashStock = vi.spyOn(portfolioStore, 'addCashStock').mockImplementation(() => {});
    const result = CommandDispatcher.execute('add cash 10 MSFT');

    expect(result.type).toBe('res');
    expect(addCashStock).toHaveBeenCalledWith('MSFT', 10, 0);
    expect(result.sideEffect).toEqual({ type: 'FETCH_QUOTE', ticker: 'MSFT' });
  });

  it('removes a cash holding and requests cloud sync', () => {
    const removeCashStock = vi.spyOn(portfolioStore, 'removeCashStock').mockImplementation(() => {});
    const result = CommandDispatcher.execute('cash remove MSFT');

    expect(result.type).toBe('res');
    expect(removeCashStock).toHaveBeenCalledWith('MSFT');
    expect(result.sideEffect).toEqual({ type: 'SYNC_CLOUD' });
  });

  it('routes sold-all commands to the store using the full current share count', () => {
    const sellStock = vi.spyOn(portfolioStore, 'sellStock').mockImplementation(() => {});
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      positions: {
        ...state.positions,
        AAPL: {
          ticker: 'AAPL',
          shares: 7,
          currentPrice: 100,
          pt: 110,
          commBuy: 0,
          startDate: '2026-10-01',
          tranches: [{ qty: 7, price: 100, date: '2026-10-01', buyCommission: 0 }]
        }
      }
    });

    const result = CommandDispatcher.execute('sold all AAPL for 120');

    expect(result.type).toBe('res');
    expect(sellStock).toHaveBeenCalledWith('AAPL', 7, 120, expect.any(String));
    expect(result.sideEffect).toEqual({ type: 'SYNC_CLOUD' });
  });

  it('preserves an explicit backdated purchase date in the buy command', () => {
    const buyStock = vi.spyOn(portfolioStore, 'buyStock').mockImplementation(() => {});
    const result = CommandDispatcher.execute('bought 30 WDC for 345 on 2026-10-19');

    expect(result.type).toBe('res');
    expect(buyStock).toHaveBeenCalledWith('WDC', 30, 345, '2026-10-19', undefined);
    expect(result.text).toContain('Date: 2026-10-19');
    expect(result.sideEffect).toEqual({ type: 'FETCH_QUOTE', ticker: 'WDC' });
  });

});
