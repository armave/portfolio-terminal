import { describe, expect, it } from 'vitest';
import {
  resolveAccountStreamHealthState,
  resolvePortfolioQuoteHealthState,
  resolveTradeHistoryHealthState
} from './portfolioHealthStatus';

describe('Portfolio Health Center status classification', () => {
  it('keeps missing and incomplete quote coverage distinct from current data', () => {
    expect(resolvePortfolioQuoteHealthState({
      total: 0, fresh: 0, stale: 0, delayed: 0, unknown: 0, unavailable: 0
    })).toBe('unknown');
    expect(resolvePortfolioQuoteHealthState({
      total: 2, fresh: 2, stale: 0, delayed: 0, unknown: 0, unavailable: 0
    })).toBe('current');
    expect(resolvePortfolioQuoteHealthState({
      total: 2, fresh: 1, stale: 0, delayed: 1, unknown: 0, unavailable: 0
    })).toBe('delayed');
    expect(resolvePortfolioQuoteHealthState({
      total: 2, fresh: 1, stale: 0, delayed: 0, unknown: 1, unavailable: 0
    })).toBe('attention');
    expect(resolvePortfolioQuoteHealthState({
      total: 2, fresh: 1, stale: 1, delayed: 0, unknown: 0, unavailable: 0
    })).toBe('attention');
  });

  it('requires both validated TradeNet channels before calling the stream live', () => {
    expect(resolveAccountStreamHealthState({
      connected: true, connectionStatus: 'connected', portfolioReceived: true, ordersReceived: true
    })).toBe('live');
    expect(resolveAccountStreamHealthState({
      connected: true, connectionStatus: 'connected', portfolioReceived: true, ordersReceived: false
    })).toBe('waiting');
    expect(resolveAccountStreamHealthState({
      connected: false, connectionStatus: 'connecting', portfolioReceived: false, ordersReceived: false
    })).toBe('connecting');
    expect(resolveAccountStreamHealthState({
      connected: false, connectionStatus: 'disconnected', portfolioReceived: false, ordersReceived: false
    })).toBe('fallback');
  });

  it('does not promote cached executions into provider-confirmed history', () => {
    expect(resolveTradeHistoryHealthState(1_800_000_000_000, 0)).toBe('confirmed');
    expect(resolveTradeHistoryHealthState(null, 12)).toBe('cached');
    expect(resolveTradeHistoryHealthState(null, 0)).toBe('unknown');
    expect(resolveTradeHistoryHealthState(0, 12)).toBe('cached');
  });
});
