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

  it('shows ladder exits with estimated margin costs and net return', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state,
      activeView: 'AAPL',
      balance: -1000,
      positions: {
        ...state.positions,
        AAPL: {
          ticker: 'AAPL',
          shares: 10,
          currentPrice: 100,
          pt: 120,
          commBuy: 2,
          startDate: '2026-10-01',
          tranches: [{ qty: 10, price: 100, date: '2026-10-01', buyCommission: 2 }]
        }
      },
      brokerAssumptions: {
        ...(state as any).brokerAssumptions,
        annualRate: 0.15,
        dayCountBasis: 365,
        commPerShare: 0.012,
        commVolumePct: 0.0012,
        minCommOrder: 1.2
      }
    } as any);

    const result = CommandDispatcher.execute('ladder AAPL 110, 120');

    expect(result.type).toBe('res');
    expect(result.text).toContain('[LADDER EXIT: AAPL]');
    expect(result.text).toContain('Estimated margin interest to date');
    expect(result.text).toContain('NET P&L after estimated costs');
    expect(result.text).toContain('on cost basis');
  });

  it('compares multiple user-specified exit dates without changing the portfolio', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state, activeView: 'AAPL', balance: -1000,
      positions: { ...state.positions, AAPL: {
        ticker: 'AAPL', shares: 10, currentPrice: 100, pt: 120, commBuy: 2,
        tranches: [{ qty: 10, price: 100, buyCommission: 2 }]
      } }
    } as any);
    const result = CommandDispatcher.execute('compare exits AAPL today at 110, tomorrow at 111, after 4 days at 113, in 2 weeks at 115, 7 days later at 116, after 1 month at 118, 2 months later at 120');
    expect(result.type).toBe('res');
    expect(result.text).toContain('[MULTI-DATE EXIT COMPARISON: AAPL]');
    expect(result.text).toContain('after 4 days');
    expect(result.text).toContain('in 2 weeks');
    expect(result.text).toContain('7 days later');
    expect(result.text).toContain('after 1 month');
    expect(result.text).toContain('2 months later');
    expect(result.text).toContain('BEST ESTIMATED EXIT');
  });

  it.each([
    ['sell GOOGL tomorrow for 333.10 vs sell 14 days later for 343.09', 'tomorrow', '14 days later'],
    ['sell GOOGL today for 333.10 vs sell 2 days later for 343.09', 'today', '2 days later'],
    ['sell GOOGL today for 333.10 vs sell after 2 weeks for 343.09', 'today', 'after 2 weeks'],
    ['sell GOOGL today for 333.10 vs sell in 2 weeks for 343.09', 'today', 'in 2 weeks']
  ])('parses natural-language exit comparison: %s', (command, firstDate, secondDate) => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state, activeView: 'GOOGL', balance: -1000,
      positions: { ...state.positions, GOOGL: {
        ticker: 'GOOGL', shares: 10, currentPrice: 330, pt: 350, commBuy: 2,
        tranches: [{ qty: 10, price: 320, buyCommission: 2 }]
      } }
    } as any);
    const result = CommandDispatcher.execute(command);
    expect(result.type).toBe('res');
    expect(result.text).toContain('[MULTI-DATE EXIT COMPARISON: GOOGL]');
    expect(result.text).toContain(firstDate);
    expect(result.text).toContain(secondDate);
    expect(result.text).toContain('BEST ESTIMATED EXIT');
  });

  it('simulates buying more shares without calling portfolio mutation methods', () => {
    const state = portfolioStore.getState();
    vi.spyOn(portfolioStore, 'getState').mockReturnValue({
      ...state, activeView: 'AAPL',
      positions: { ...state.positions, AAPL: {
        ticker: 'AAPL', shares: 10, currentPrice: 110, pt: 120, commBuy: 2,
        tranches: [{ qty: 10, price: 100, buyCommission: 2 }]
      } }
    } as any);
    const buyStock = vi.spyOn(portfolioStore, 'buyStock');
    const result = CommandDispatcher.execute('buy scenario 10 AAPL at 105');
    expect(result.type).toBe('res');
    expect(result.text).toContain('[HYPOTHETICAL BUY: AAPL]');
    expect(result.text).toContain('Daily margin fee:');
    expect(result.text).toContain('Average entry');
    expect(result.text).toContain('PROFIT / LOSS COMPARISON');
    expect(result.text).toContain('At current quote');
    expect(result.text).toContain('At target');
    expect(result.text).toContain('Return on cost at target');
    expect(result.text).toContain('At -10% from quote');
    expect(result.text).toContain('Break-even after adding shares');
    expect(result.text).toContain('Risk note');
    expect(buyStock).not.toHaveBeenCalled();
  });

});
