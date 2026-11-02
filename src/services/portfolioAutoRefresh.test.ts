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

  it('uses safe role defaults and rejects unsupported persisted intervals', () => {
    expect(normalizeQuoteRefreshInterval('15000')).toBe(15_000);
    expect(normalizeQuoteRefreshInterval('0', DEFAULT_GUEST_REFRESH_INTERVAL_MS)).toBe(0);
    expect(normalizeQuoteRefreshInterval('20000', DEFAULT_GUEST_REFRESH_INTERVAL_MS)).toBe(15_000);
    expect(normalizeQuoteRefreshInterval('', DEFAULT_GUEST_REFRESH_INTERVAL_MS)).toBe(15_000);
    expect(normalizeQuoteRefreshInterval('invalid', DEFAULT_ADMIN_REFRESH_INTERVAL_MS)).toBe(60_000);
    expect(DEFAULT_ADMIN_REFRESH_INTERVAL_MS).toBe(60_000);
    expect(DEFAULT_GUEST_REFRESH_INTERVAL_MS).toBe(15_000);
  });

  it.each(['admin', 'guest'] as const)(
    'runs live quotes at the selected cadence and supplemental data once a minute for %s accounts',
    async (role) => {
      vi.useFakeTimers();
      const refreshQuotes = vi.fn();
      const refreshSupplemental = vi.fn();
      const scheduler = createPortfolioAutoRefreshScheduler({
        getRole: () => role,
        isVisible: () => true,
        refreshQuotes,
        refreshSupplemental
      });

      scheduler.configure(15_000, role);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(refreshQuotes).toHaveBeenCalledTimes(4);
      expect(refreshSupplemental).toHaveBeenCalledTimes(1);
      scheduler.stop();
    }
  );

  it('runs a guest refresh as one snapshot-first operation when requested immediately', async () => {
    const sequence: string[] = [];
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'guest',
      isVisible: () => true,
      refreshQuotes: () => { sequence.push('quotes'); },
      refreshSupplemental: async () => {
        sequence.push('guest snapshot and LOTS ledger');
        sequence.push('quotes for the updated assignment set');
      }
    });

    scheduler.configure(30_000, 'guest');
    await expect(scheduler.refreshNow()).resolves.toBe(true);
    expect(sequence).toEqual(['guest snapshot and LOTS ledger', 'quotes for the updated assignment set']);
    scheduler.stop();
  });

  it('refreshes both admin sources immediately when enabled', async () => {
    const completed: string[] = [];
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'admin',
      isVisible: () => true,
      refreshQuotes: async () => { completed.push('quotes'); },
      refreshSupplemental: async () => { completed.push('broker balances, trades and orders'); }
    });

    scheduler.configure(60_000, 'admin');
    await expect(scheduler.refreshNow()).resolves.toBe(true);
    expect(completed).toHaveLength(2);
    expect(completed).toContain('quotes');
    expect(completed).toContain('broker balances, trades and orders');
    scheduler.stop();
  });

  it('pauses hidden-tab requests and refreshes after the tab becomes visible', async () => {
    vi.useFakeTimers();
    let visible = false;
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'admin',
      isVisible: () => visible,
      refreshQuotes,
      refreshSupplemental
    });

    scheduler.configure(15_000, 'admin');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshQuotes).not.toHaveBeenCalled();
    expect(refreshSupplemental).not.toHaveBeenCalled();

    visible = true;
    await scheduler.onVisibilityChange();
    expect(refreshQuotes).toHaveBeenCalledTimes(1);
    expect(refreshSupplemental).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does no automatic work when disabled or when no role is active', async () => {
    vi.useFakeTimers();
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    let role: 'admin' | 'guest' | null = 'admin';
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => role,
      isVisible: () => true,
      refreshQuotes,
      refreshSupplemental
    });

    scheduler.configure(0, 'admin');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await scheduler.refreshNow()).toBe(false);
    role = null;
    scheduler.configure(15_000, null);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refreshQuotes).not.toHaveBeenCalled();
    expect(refreshSupplemental).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('replaces old role timers and ignores callbacks after an account-role change', async () => {
    vi.useFakeTimers();
    let role: 'admin' | 'guest' = 'admin';
    const refreshQuotes = vi.fn();
    const refreshSupplemental = vi.fn();
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => role,
      isVisible: () => true,
      refreshQuotes,
      refreshSupplemental
    });

    scheduler.configure(15_000, 'admin');
    role = 'guest';
    scheduler.configure(30_000, 'guest');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(refreshQuotes).toHaveBeenCalledTimes(1);
    expect(refreshSupplemental).toHaveBeenCalledTimes(0);
    scheduler.stop();
  });

  it('coalesces overlapping refresh work and reports task errors without unhandled rejections', async () => {
    let resolveQuote: (() => void) | undefined;
    const refreshQuotes = vi.fn(() => new Promise<void>((resolve) => { resolveQuote = resolve; }));
    const errors: unknown[] = [];
    const scheduler = createPortfolioAutoRefreshScheduler({
      getRole: () => 'admin',
      isVisible: () => true,
      refreshQuotes,
      refreshSupplemental: async () => { throw new Error('Broker unavailable'); },
      onError: (_source, error) => errors.push(error)
    });

    scheduler.configure(15_000, 'admin');
    const first = scheduler.refreshNow();
    const second = scheduler.refreshNow();
    await Promise.resolve();
    expect(refreshQuotes).toHaveBeenCalledTimes(1);
    resolveQuote?.();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(errors).toHaveLength(1);
    scheduler.stop();
  });
});
