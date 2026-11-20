import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceDeskPrefetcher } from './workspaceDeskPrefetch';

describe('workspace desk prefetch', () => {
  it('maps administrator and guest destinations to only their permitted lazy modules', async () => {
    const loaders = {
      balance: vi.fn().mockResolvedValue(undefined),
      trades: vi.fn().mockResolvedValue(undefined),
      'guest-history': vi.fn().mockResolvedValue(undefined),
      settings: vi.fn().mockResolvedValue(undefined),
      margin: vi.fn().mockResolvedValue(undefined)
    };
    const prefetch = createWorkspaceDeskPrefetcher(loaders);

    await prefetch('BALANCE', true);
    await prefetch('CASH_CUSHION', true);
    await prefetch('CLOSED_HISTORY', true);
    await prefetch('SETTINGS', true);
    await prefetch('GUEST_HISTORY', true);
    await prefetch('COMBINED', true);
    await prefetch('AAPL', true);

    await prefetch('BALANCE', false);
    await prefetch('GUEST_HISTORY', false);
    await prefetch('CLOSED_HISTORY', false);
    await prefetch('AAPL', false);

    expect(loaders.balance).toHaveBeenCalledTimes(1);
    expect(loaders.trades).toHaveBeenCalledTimes(1);
    expect(loaders['guest-history']).toHaveBeenCalledTimes(1);
    expect(loaders.settings).toHaveBeenCalledTimes(1);
    expect(loaders.margin).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent and repeated intents for the same desk', async () => {
    let resolveLoad!: () => void;
    const balance = vi.fn(() => new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    const prefetch = createWorkspaceDeskPrefetcher({
      balance,
      trades: vi.fn().mockResolvedValue(undefined),
      'guest-history': vi.fn().mockResolvedValue(undefined),
      settings: vi.fn().mockResolvedValue(undefined),
      margin: vi.fn().mockResolvedValue(undefined)
    });

    const first = prefetch('BALANCE', true);
    const second = prefetch('CASH_CUSHION', true);
    expect(balance).toHaveBeenCalledTimes(1);
    resolveLoad();
    await first;
    expect(second).toBeUndefined();
  });

  it('allows another attempt after a failed lazy-module preload', async () => {
    const settings = vi.fn()
      .mockRejectedValueOnce(new Error('chunk unavailable'))
      .mockResolvedValueOnce(undefined);
    const prefetch = createWorkspaceDeskPrefetcher({
      balance: vi.fn().mockResolvedValue(undefined),
      trades: vi.fn().mockResolvedValue(undefined),
      'guest-history': vi.fn().mockResolvedValue(undefined),
      settings,
      margin: vi.fn().mockResolvedValue(undefined)
    });

    await prefetch('SETTINGS', true);
    await prefetch('SETTINGS', true);
    expect(settings).toHaveBeenCalledTimes(2);
  });
});
