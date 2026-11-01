import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDailyQuoteRange } from './CashCushionDesk';
import { mergeBrokerExecutionHistory } from '../domain/closedHistoryFees';

describe('cash holdings daily quote range', () => {
  it('formats the actual high and low prices instead of placeholder text', () => {
    expect(formatDailyQuoteRange({ high: 123.45, low: 120 })).toBe('H 123.45 / L 120.00');
  });
});

describe('Balance cache-first history retention', () => {
  it('keeps all cached executions when a refresh returns only one newer row', () => {
    const cached = Array.from({ length: 77 }, (_, index) => ({
      id: 'balance-trade-' + index,
      ticker: 'T' + index,
      side: 'buy',
      executedAt: '2026-10-01T10:00:00Z'
    }));
    const refreshed = [{
      id: 'balance-trade-76',
      ticker: 'T76',
      side: 'buy',
      executedAt: '2026-10-29T10:00:00Z',
      price: 125
    }];

    const merged = mergeBrokerExecutionHistory(cached, refreshed);

    expect(merged).toHaveLength(77);
    expect(merged.find((trade) => trade.id === 'balance-trade-0')).toBeDefined();
    expect(merged.find((trade) => trade.id === 'balance-trade-76')).toMatchObject({ price: 125 });
  });
});

describe('Balance cache-first rendering wiring', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

  it('uses the saved broker snapshot before showing a blocking first-load state', () => {
    expect(deskSource).toContain('createBalanceSyncState(Boolean(state.brokerAccountInfo?.loaded), isAdmin)');
    expect(deskSource).toContain("if (isAdmin && balanceSync.status === 'loading' && !balanceSync.hasSnapshot)");
    expect(deskSource).not.toContain('if (executedTradesLoading || guestUsersLoading)');
    expect(deskSource).toContain("emitBrokerEvent('broker:request-account-info')");
  });

  it('merges saved and in-memory executions instead of choosing only one cache', () => {
    expect(deskSource).toContain('mergeBrokerExecutionHistory(\n        savedTrades,');
    expect(deskSource).toContain('brokerExecutionHistoryRef.current.trades');
  });

  it('refreshes the full Balance snapshot without a date cursor', () => {
    const accountLoaderStart = appSource.indexOf('const loadFreedomAccount');
    const tradesLoaderStart = appSource.indexOf('const loadExecutedTrades', accountLoaderStart);
    const accountLoader = appSource.slice(accountLoaderStart, tradesLoaderStart);
    expect(accountLoader).toContain('fetchFreedomTradeNetPositions()');
    expect(accountLoader).not.toContain('fromDate');
    expect(accountLoader).not.toContain('beginDate');
    expect(accountLoader).not.toContain('endDate');
  });
});
