import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitUiEvent } from '../ui/uiEventBus';
import { bindPortfolioNavigationRuntime } from './portfolioNavigationRuntime';

describe('portfolio navigation runtime bindings', () => {
  let unbind: (() => void) | undefined;

  afterEach(() => {
    unbind?.();
    unbind = undefined;
  });

  it('checks the active role when navigation is requested', () => {
    let role: 'admin' | 'guest' | null = 'guest';
    let activeView = 'SETTINGS';
    const setActiveView = vi.fn((view: string) => { activeView = view; });
    const refreshLivePrices = vi.fn().mockResolvedValue(undefined);

    unbind = bindPortfolioNavigationRuntime({
      getAccountRole: () => role,
      getActiveView: () => activeView,
      setActiveView,
      refreshLivePrices
    });

    emitUiEvent('portfolio:set-active-view', { view: 'COMBINED' });
    expect(setActiveView).toHaveBeenLastCalledWith('BALANCE');
    expect(refreshLivePrices).toHaveBeenCalledTimes(1);

    role = 'admin';
    emitUiEvent('portfolio:set-active-view', { view: 'COMBINED' });
    expect(setActiveView).toHaveBeenLastCalledWith('COMBINED');
    expect(setActiveView).toHaveBeenCalledTimes(2);
  });

  it('resolves an explicit refresh request when the quote refresh finishes', async () => {
    const refreshLivePrices = vi.fn().mockResolvedValue(undefined);
    const resolve = vi.fn();

    unbind = bindPortfolioNavigationRuntime({
      getAccountRole: () => 'admin',
      getActiveView: () => 'SETTINGS',
      setActiveView: vi.fn(),
      refreshLivePrices
    });

    emitUiEvent('portfolio:refresh-live-prices', { resolve });

    expect(refreshLivePrices).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  });

  it('removes both event listeners when the runtime is disposed', () => {
    const setActiveView = vi.fn();
    const refreshLivePrices = vi.fn().mockResolvedValue(undefined);

    unbind = bindPortfolioNavigationRuntime({
      getAccountRole: () => 'admin',
      getActiveView: () => 'COMBINED',
      setActiveView,
      refreshLivePrices
    });
    unbind();
    unbind = undefined;

    emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' });
    emitUiEvent('portfolio:refresh-live-prices', { resolve: vi.fn() });

    expect(setActiveView).not.toHaveBeenCalled();
    expect(refreshLivePrices).not.toHaveBeenCalled();
  });

  it('refreshes automatically when the canonical navigation event enters Balance', () => {
    let activeView = 'AAPL';
    const setActiveView = vi.fn((view: string) => { activeView = view; });
    const refreshLivePrices = vi.fn().mockResolvedValue(true);
    unbind = bindPortfolioNavigationRuntime({
      getAccountRole: () => 'admin',
      getActiveView: () => activeView,
      setActiveView,
      refreshLivePrices
    });

    emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' });

    expect(setActiveView).toHaveBeenCalledWith('BALANCE');
    expect(activeView).toBe('BALANCE');
    expect(refreshLivePrices).toHaveBeenCalledTimes(1);
  });

  it.each(['BALANCE', 'CASH_CUSHION'])('does not re-refresh when already on Balance (%s)', (activeView) => {
    const refreshLivePrices = vi.fn().mockResolvedValue(true);
    unbind = bindPortfolioNavigationRuntime({
      getAccountRole: () => 'admin',
      getActiveView: () => activeView,
      setActiveView: vi.fn(),
      refreshLivePrices
    });

    emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' });

    expect(refreshLivePrices).not.toHaveBeenCalled();
  });
});
