import { describe, expect, it, vi } from 'vitest';
import { createQuoteRefreshCoordinator } from './quoteRefreshCoordinator';

describe('quote refresh coordinator', () => {
  it('runs an explicit refresh after an older request using the latest ticker snapshot', async () => {
    let tickers = ['AAPL'];
    let releaseFirst: ((success: boolean) => void) | undefined;
    const executeRefresh = vi.fn(async (force: boolean) => {
      const snapshot = [...tickers];
      if (executeRefresh.mock.calls.length === 1) {
        return new Promise<boolean>((resolve) => {
          releaseFirst = resolve;
        });
      }
      expect(snapshot).toEqual(['AAPL', 'MSFT']);
      return force;
    });
    const coordinator = createQuoteRefreshCoordinator(executeRefresh);

    const first = coordinator.refresh();
    await Promise.resolve();
    expect(executeRefresh).toHaveBeenCalledTimes(1);

    tickers = ['AAPL', 'MSFT'];
    const explicit = coordinator.refresh(true);
    const duplicateExplicit = coordinator.refresh(true);
    expect(duplicateExplicit).toBe(explicit);
    expect(executeRefresh).toHaveBeenCalledTimes(1);

    releaseFirst?.(true);
    await expect(Promise.all([first, explicit])).resolves.toEqual([true, true]);
    expect(executeRefresh).toHaveBeenNthCalledWith(1, false);
    expect(executeRefresh).toHaveBeenNthCalledWith(2, true);
  });

  it('continues with the forced refresh even when the previous batch fails', async () => {
    const executeRefresh = vi.fn()
      .mockRejectedValueOnce(new Error('Old request failed'))
      .mockResolvedValueOnce(true);
    const coordinator = createQuoteRefreshCoordinator(executeRefresh);

    const first = coordinator.refresh();
    await Promise.resolve();
    const explicit = coordinator.refreshAfterCurrent(true);

    await expect(first).rejects.toThrow('Old request failed');
    await expect(explicit).resolves.toBe(true);
    expect(executeRefresh).toHaveBeenNthCalledWith(2, true);
  });

  it('coalesces ordinary polling with the active request and lets a queued force request upgrade', async () => {
    let releaseFirst: ((success: boolean) => void) | undefined;
    const executeRefresh = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { releaseFirst = resolve; }))
      .mockResolvedValueOnce(true);
    const coordinator = createQuoteRefreshCoordinator(executeRefresh);

    const first = coordinator.refresh();
    await Promise.resolve();
    const ordinary = coordinator.refresh();
    expect(ordinary).toBe(first);

    const queued = coordinator.refreshAfterCurrent(false);
    const upgraded = coordinator.refresh(true);
    expect(upgraded).toBe(queued);

    releaseFirst?.(true);
    await expect(Promise.all([first, queued])).resolves.toEqual([true, true]);
    expect(executeRefresh).toHaveBeenCalledTimes(2);
    expect(executeRefresh).toHaveBeenLastCalledWith(true);
  });
});
