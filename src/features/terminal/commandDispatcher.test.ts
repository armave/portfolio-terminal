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
  it('returns validation failures as errors for the command runner to display', () => {
    const result = CommandDispatcher.execute('bought 2 AAPL for 1.2.3');
    expect(result.type).toBe('err');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.sideEffect).toBeUndefined();
  });

});
