import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDailyQuoteRange, getCashHoldingMarketPrice } from './CashCushionDesk';
import { mergeBrokerExecutionHistory } from '../domain/closedHistoryFees';

describe('cash/margin mix inputs', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('keeps both visible split fields synchronized with the saved normalized mix', () => {
    expect(deskSource).toContain('value={mix.cash}');
    expect(deskSource).toContain('value={mix.margin}');
    expect(deskSource).toContain('resolveActiveTrancheMixInput(value, tranche.quantity, mix.cash)');
    expect(deskSource).toContain('resolveActiveTrancheMixInput(value, tranche.quantity, mix.margin)');
    expect(deskSource).not.toContain('defaultValue={mix.cash}');
    expect(deskSource).not.toContain('defaultValue={mix.margin}');
  });
});

describe('cash holding market price', () => {
  it('prefers a valid current quote and falls back to the stored price', () => {
    expect(getCashHoldingMarketPrice({ currentPrice: 125, price: 120 })).toBe(125);
    expect(getCashHoldingMarketPrice({ currentPrice: 0, price: 120 })).toBe(120);
    expect(getCashHoldingMarketPrice({ currentPrice: null, price: '120.5' })).toBe(120.5);
  });

  it('does not turn missing, invalid, zero, or negative prices into a zero quote', () => {
    expect(getCashHoldingMarketPrice({})).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: '', price: undefined })).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: 'not-a-price', price: Number.NaN })).toBeNull();
    expect(getCashHoldingMarketPrice({ currentPrice: -1, price: 0 })).toBeNull();
  });
});

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
    expect(deskSource).toContain("type: 'snapshot'");
    expect(deskSource).toContain('loaded: state.brokerAccountInfo?.loaded === true');
    expect(deskSource).toContain("if (isAdmin && balanceSync.status === 'loading' && !balanceSync.hasSnapshot)");
    expect(deskSource).not.toContain('if (executedTradesLoading || guestUsersLoading)');
    expect(deskSource).toContain("emitBrokerEvent('broker:request-account-info')");
  });

  it('shows unpriced admin holdings as unavailable instead of zero-valued assets', () => {
    expect(deskSource).toContain('getCashHoldingMarketPrice(h)');
    expect(deskSource).toContain("{price !== null ? formatUSD(price) : '—'}");
    expect(deskSource).toContain("{val !== null ? formatUSD(val) : '—'}");
    expect(deskSource).toContain("allocation !== null ? allocation.toFixed(1) + '%' : '—'");
    expect(deskSource).toContain("unpricedHoldingCount === 0 && stocksTotal > 0");
    expect(deskSource).toContain("translateText('Unpriced holdings', getAppLanguage())");
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
