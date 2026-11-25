import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  resolveAccountStreamHealthState,
  resolvePortfolioQuoteHealthState,
  resolveTradeHistoryHealthState
} from '../ui/portfolioHealthStatus';

function readSource(): string {
  return readFileSync(new URL('./PortfolioHealthCenter.tsx', import.meta.url), 'utf8');
}

describe('Portfolio Health Center', () => {
  it('classifies source health without conflating cached records and confirmed provider refreshes', () => {
    expect(resolvePortfolioQuoteHealthState({
      total: 1, fresh: 1, stale: 0, delayed: 0, unknown: 0, unavailable: 0
    })).toBe('current');
    expect(resolvePortfolioQuoteHealthState({
      total: 1, fresh: 0, stale: 0, delayed: 0, unknown: 1, unavailable: 0
    })).toBe('attention');
    expect(resolveAccountStreamHealthState({
      connected: true, connectionStatus: 'connected', portfolioReceived: false, ordersReceived: true
    })).toBe('waiting');
    expect(resolveTradeHistoryHealthState(null, 4)).toBe('cached');
    expect(resolveTradeHistoryHealthState(null, 0)).toBe('unknown');
  });

  it('keeps the four source cards and read-only reconciliation entry in the Combined workspace', () => {
    const source = readSource();
    for (const label of [
      'TradeNet account stream', 'Market quotes', 'Trade history', 'Cloud portfolio',
      'Broker reconciliation', 'Review broker activity'
    ]) {
      expect(source).toContain(label);
    }
    expect(source).toContain('getLastExecutedTradesRefreshAt(sessionKey)');
    expect(source).toContain('refresh.sessionIdentity === sessionKey');
    expect(source).toContain('resolveCloudSyncTone(cloudStatus, cloudSyncStatus)');
    expect(source).toContain('summarizeQuoteFreshness(quoteHoldings, Date.now(), refreshIntervalMs)');
  });
});
