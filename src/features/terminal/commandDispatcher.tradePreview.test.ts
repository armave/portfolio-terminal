import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandDispatcher } from './commandDispatcher';
import { portfolioStore } from '../../store/portfolioStore';

function withPosition(shares = 5) {
  const state = portfolioStore.getState();
  vi.spyOn(portfolioStore, 'getState').mockReturnValue({
    ...state,
    activeView: 'AAPL',
    positions: {
      ...state.positions,
      AAPL: {
        ticker: 'AAPL',
        shares,
        currentPrice: 100,
        pt: 120,
        commBuy: 0,
        startDate: '2026-10-01',
        tranches: [{ qty: shares, price: 100, date: '2026-10-01', buyCommission: 0 }]
      }
    }
  } as any);
}

describe('terminal trade command preview and execution boundaries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('previews a buy with its target and purchase date without mutating the portfolio', () => {
    const buyStock = vi.spyOn(portfolioStore, 'buyStock');

    const preview = CommandDispatcher.previewTradeAction(
      'bought 2 aapl for $100, pt 150 on 2026-10-10'
    );

    expect(preview).toEqual({
      action: 'buy',
      ticker: 'AAPL',
      shares: 2,
      price: 100,
      pt: 150,
      date: '2026-10-10'
    });
    expect(buyStock).not.toHaveBeenCalled();
  });

  it('previews partial and full exits without changing position state', () => {
    withPosition(5);
    const sellStock = vi.spyOn(portfolioStore, 'sellStock');

    expect(CommandDispatcher.previewTradeAction('sold 2 AAPL for 120')).toEqual({
      action: 'sell',
      ticker: 'AAPL',
      shares: 2,
      price: 120
    });
    expect(CommandDispatcher.previewTradeAction('sold all AAPL for 120')).toEqual({
      action: 'sell',
      ticker: 'AAPL',
      shares: null,
      price: 120
    });
    expect(sellStock).not.toHaveBeenCalled();
  });

  it('does not preview an oversized exit', () => {
    withPosition(5);

    expect(CommandDispatcher.previewTradeAction('sold 6 AAPL for 120')).toBeNull();
  });

  it('rejects an oversized terminal sale instead of clamping it to the available shares', () => {
    withPosition(5);
    const sellStock = vi.spyOn(portfolioStore, 'sellStock');

    const result = CommandDispatcher.execute('sold 6 AAPL for 120');

    expect(result.type).toBe('err');
    expect(result.text).toContain('only 5 shares are available');
    expect(result.sideEffect).toBeUndefined();
    expect(sellStock).not.toHaveBeenCalled();
  });

  it('executes the requested partial quantity exactly once after command dispatch', () => {
    withPosition(5);
    const sellStock = vi.spyOn(portfolioStore, 'sellStock').mockReturnValue(true);

    const result = CommandDispatcher.execute('sold 2 AAPL for 120');

    expect(result.type).toBe('res');
    expect(sellStock).toHaveBeenCalledOnce();
    expect(sellStock).toHaveBeenCalledWith('AAPL', 2, 120, expect.any(String));
    expect(result.sideEffect).toEqual({ type: 'SYNC_CLOUD' });
  });

  it('rejects a buy whose order value overflows before reaching the store', () => {
    const buyStock = vi.spyOn(portfolioStore, 'buyStock');
    const oversizedPrice = '9'.repeat(400);

    const result = CommandDispatcher.execute(`bought 2 AAPL for ${oversizedPrice}`);

    expect(result.type).toBe('err');
    expect(result.text).toContain('Usage: bought');
    expect(buyStock).not.toHaveBeenCalled();
  });

  it('rejects a sale whose price is non-finite before reaching the store', () => {
    withPosition(5);
    const sellStock = vi.spyOn(portfolioStore, 'sellStock');
    const oversizedPrice = '9'.repeat(400);

    const result = CommandDispatcher.execute(`sold 5 AAPL for ${oversizedPrice}`);

    expect(result.type).toBe('err');
    expect(result.text).toContain('Usage: sold');
    expect(sellStock).not.toHaveBeenCalled();
  });
});
