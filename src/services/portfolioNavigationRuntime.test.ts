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
    const setActiveView = vi.fn();
    const refreshLivePrices = vi.fn().mockResolvedValue(undefined);

    unbind = bindPortfolioNavigationRuntime({
      getAccountRole: () => role,
      setActiveView,
      refreshLivePrices
    });

    emitUiEvent('portfolio:set-active-view', { view: 'COMBINED' });
    expect(setActiveView).toHaveBeenLastCalledWith('BALANCE');

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
});
