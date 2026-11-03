import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPortfolioAutoRefreshScheduler,
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  DEFAULT_GUEST_REFRESH_INTERVAL_MS,
  normalizeQuoteRefreshInterval
} from './portfolioAutoRefresh';

describe('portfolio automatic refresh policy', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('enforces a supported non-zero role default for legacy or invalid values', () => {
    expect(normalizeQuoteRefreshInterval('15000')).toBe(15_000);
    expect(normalizeQuoteRefreshInterval('0', DEFAULT_GUEST_REFRESH_INTERVAL_MS)).toBe(DEFAULT_GUEST_REFRESH_INTERVAL_MS);
    expect(normalizeQuoteRefreshInterval(0, DEFAULT_ADMIN_REFRESH_INTERVAL_MS)).toBe(DEFAULT_ADMIN_REFRESH_INTERVAL_MS);
    expect(normalizeQuoteRefreshInterval('20000', DEFAULT_GUEST_REFRESH_INTERVAL_MS)).toBe(15_000);
    expect(normalizeQuoteRefreshInterval('', DEFAULT_GUEST_REFRESH_INTERVAL_MS)).toBe(15_000);
    expect(normalizeQuoteRefreshInterval('invalid', DEFAULT_ADMIN_REFRESH_INTERVAL_MS)).toBe(60_000);
    expect(DEFAULT_ADMIN_REFRESH_INTERVAL_MS).toBe(60_000);
    expect(DEFAULT_GUEST_REFRESH_INTERVAL_MS).toBe(15_000);
  });

  it.each(['admin', 'guest'] as const)(
    'runs the complete %s sync on every selected interval',
    async (role) => {
      vi.useFakeTimers();
      const refreshQuotes = vi.fn();
      const refreshSupplemental = vi.fn();
      const syncState = vi.fn();
      const syncHistory = vi.fn();
      const scheduler = createPortfolioAutoRefreshScheduler({
        getRole: () => role,
        isVisible: () => true,
        refreshQuotes,
        refreshSupplemental,
        syncState,
        syncHistory
      });

      scheduler.configure(15_000, role);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshSupplemental).toHaveBeenCalledTimes(4);
      if (role === 'admin') {
        expect(refreshQuotes).toHaveBeenCalledTimes(4);
        expect(syncHistory).toHaveBeenCalledTimes(4);
        expect(syncState).toHaveBeenCalled();
      } else {
        // Guest refreshSupplemental performs snapshot hydration then quotes the new assigned tickers.
        expect(refreshQuotes).not.toHaveBeenCalled();
        expect(syncState).not.toHaveBeenCalled();
        expect(syncHistory).not.toHaveBeenCalled();
      }
      scheduler.stop();
    }
  );

  it('runs guest hydration before quoting the newly assigned holdings on manual refresh', async () => {
    const sequence: string[] = [];
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'guest',
      isVisible: () => true,
      refreshQuotes: () => { sequence.push('generic quotes'); },
      refreshSupplemental: async () => {
        sequence.push('guest snapshot and LOTS ledger');
        sequence.push('quotes for updated assignments');
      }
    });

    scheduler.configure(30_000, 'guest');
    await expect(scheduler.refreshNow()).resolves.toBe(true);
    expect(sequence).toEqual(['guest snapshot and LOTS ledger', 'quotes for updated assignments']);
    scheduler.stop();
  });

  it('refreshes all admin sources on manual refresh', async () => {
    const completed: string[] = [];
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'admin',
      isVisible: () => true,
      refreshQuotes: async () => { completed.push('quotes'); },
      refreshSupplemental: async () => { completed.push('broker fallback, trades and orders'); },
      syncState: async () => { completed.push('portfolio cloud state'); },
      syncHistory: async () => { completed.push('closed history and cashflows'); }
    });

    scheduler.configure(60_000, 'admin');
    await expect(scheduler.refreshNow()).resolves.toBe(true);
    expect(completed).toContain('quotes');
    expect(completed).toContain('broker fallback, trades and orders');
    expect(completed).toContain('closed history and cashflows');
    expect(completed).toContain('portfolio cloud state');
    scheduler.stop();
  });

  it('refreshes both roles immediately after a hidden tab becomes visible', async () => {
    vi.useFakeTimers();
    let visible = false;
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    const syncState = vi.fn();
    const syncHistory = vi.fn();
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'admin',
      isVisible: () => visible,
      refreshQuotes,
      refreshSupplemental,
      syncState,
      syncHistory
    });

    scheduler.configure(15_000, 'admin');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshQuotes).not.toHaveBeenCalled();
    expect(refreshSupplemental).not.toHaveBeenCalled();
    expect(syncState).not.toHaveBeenCalled();
    expect(syncHistory).not.toHaveBeenCalled();

    visible = true;
    await scheduler.onVisibilityChange();
    expect(refreshQuotes).toHaveBeenCalledTimes(1);
    expect(refreshSupplemental).toHaveBeenCalledTimes(1);
    expect(syncHistory).toHaveBeenCalledTimes(1);
    expect(syncState).toHaveBeenCalled();
    scheduler.stop();
  });

  it('keeps automatic sync enabled when a legacy Off value is loaded', async () => {
    vi.useFakeTimers();
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'guest',
      isVisible: () => true,
      refreshQuotes,
      refreshSupplemental
    });

    expect(scheduler.configure(0, 'guest')).toBe(DEFAULT_GUEST_REFRESH_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(DEFAULT_GUEST_REFRESH_INTERVAL_MS);
    expect(refreshSupplemental).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does no automatic work when no account role is active', async () => {
    vi.useFakeTimers();
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => null,
      isVisible: () => true,
      refreshQuotes,
      refreshSupplemental
    });

    scheduler.configure(15_000, null);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await scheduler.refreshNow()).toBe(false);
    expect(refreshQuotes).not.toHaveBeenCalled();
    expect(refreshSupplemental).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('replaces role timers and never runs the previous role after account switching', async () => {
    vi.useFakeTimers();
    let role: 'admin' | 'guest' = 'admin';
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    const syncState = vi.fn();
    const syncHistory = vi.fn();
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => role,
      isVisible: () => true,
      refreshQuotes,
      refreshSupplemental,
      syncState,
      syncHistory
    });

    scheduler.configure(15_000, 'admin');
    role = 'guest';
    scheduler.configure(30_000, 'guest');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(refreshSupplemental).toHaveBeenCalledTimes(1);
    expect(refreshQuotes).not.toHaveBeenCalled();
    expect(syncState).not.toHaveBeenCalled();
    expect(syncHistory).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('coalesces overlapping complete cycles and reports task errors', async () => {
    let resolveSupplemental: (() => void) | undefined;
    const refreshSupplemental = vi.fn(() => new Promise<void>((resolve) => { resolveSupplemental = resolve; }));
    const errors: unknown[] = [];
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'guest',
      isVisible: () => true,
      refreshQuotes: vi.fn(),
      refreshSupplemental,
      onError: (_source, error) => errors.push(error)
    });

    scheduler.configure(15_000, 'guest');
    const first = scheduler.refreshNow();
    const second = scheduler.refreshNow();
    await Promise.resolve();
    expect(refreshSupplemental).toHaveBeenCalledTimes(1);
    resolveSupplemental?.();
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(errors).toHaveLength(0);
    scheduler.stop();
  });
});
