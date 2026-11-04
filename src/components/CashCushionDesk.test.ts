import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatDailyQuoteRange,
  getActiveTrancheMarketPrice,
  getAssignedGuestIds,
  getCashHoldingMarketPrice
} from './CashCushionDesk';
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

describe('Balance guest grouping', () => {
  it('uses stable assigned guest IDs rather than asynchronous directory order', () => {
    expect(getAssignedGuestIds({
      trancheC: 'guest-c',
      trancheA: 'guest-a',
      anotherTrancheA: 'guest-a',
      unassigned: ''
    })).toEqual(['guest-a', 'guest-c']);
    expect(getAssignedGuestIds(undefined)).toEqual([]);
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

describe('active tranche market price', () => {
  it('uses the newest timestamped quote across cash and margin records', () => {
    expect(getActiveTrancheMarketPrice({
      ticker: 'AAPL',
      marketPrice: 110
    }, [{
      ticker: 'AAPL',
      currentPrice: 120,
      quoteDetails: { sourceTimestamp: 1_000 }
    }], {
      AAPL: {
        currentPrice: 130,
        quoteDetails: { sourceTimestamp: 2_000 }
      }
    })).toBe(130);
  });

  it('prefers the latest WebSocket receive time when TradeNet ltt has no numeric timestamp', () => {
    expect(getActiveTrancheMarketPrice({
      ticker: 'GOOGL',
      marketPrice: 265
    }, [{
      ticker: 'GOOGL',
      currentPrice: 280.55,
      price: 280.55,
      quoteUpdatedAt: 1_800_000_000_000,
      quoteDetails: {
        transport: 'websocket',
        receivedAt: 1_800_000_000_000,
        freshness: 'unknown'
      }
    }], {
      GOOGL: {
        currentPrice: 279,
        quoteUpdatedAt: 1_799_999_000_000,
        quoteDetails: {
          transport: 'websocket',
          receivedAt: 1_799_999_000_000,
          freshness: 'unknown'
        }
      }
    })).toBe(280.55);
  });

  it('uses the stored margin position price before the untimestamped broker fallback', () => {
    expect(getActiveTrancheMarketPrice({
      ticker: 'MSFT',
      marketPrice: 400
    }, [], {
      MSFT: { currentPrice: 410 }
    })).toBe(410);
  });
});

describe('cash holdings daily quote range', () => {
  it('formats the actual high and low prices instead of placeholder text', () => {
    expect(formatDailyQuoteRange({ high: 123.45, low: 120 })).toBe('H 123.45 / L 120.00');
  });
});

describe('cash holdings quote context', () => {
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');

  it('shows provider volume and quote metadata on guest cards and admin holdings rows', () => {
    expect(deskSource).toContain('formatQuoteVolume(holding.quoteDetails?.volume)');
    expect(deskSource).toContain('formatQuoteVolume(h.quoteDetails?.volume)');
    expect(deskSource).toContain('formatQuoteMetadata(holding, refreshIntervalMs)');
    expect(deskSource).toContain('renderDailyQuoteSubtext(holding.quoteDetails)');
    expect(deskSource).toContain('Provider-reported volume; reporting period may vary by source.');
  });

  it('adds Market Depth only to administrator holdings table rows, not guest holding cards', () => {
    const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8');
    const marketDepthAction = deskSource.indexOf("emitUiEvent('terminal:market-depth-request'");
    const guestCards = deskSource.indexOf('guestHoldings.map((holding)');

    expect(marketDepthAction).toBeGreaterThan(-1);
    expect(deskSource).toMatch(/\{isAdmin && <button[\s\S]{0,500}emitUiEvent\('terminal:market-depth-request'/);
    expect(guestCards).toBeGreaterThan(-1);
    expect(deskSource.slice(guestCards, marketDepthAction)).not.toContain("emitUiEvent('terminal:market-depth-request'");
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
  const deskSource = readFileSync(new URL('./CashCushionDesk.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const brokerDataSource = readFileSync(new URL('../services/portfolioBrokerDataRuntime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

  it('uses the saved broker snapshot before showing a blocking first-load state', () => {
    expect(deskSource).toContain('createBalanceSyncState(Boolean(state.brokerAccountInfo?.loaded), isAdmin)');
    expect(deskSource).toContain("type: 'snapshot'");
    expect(deskSource).toContain('loaded: state.brokerAccountInfo?.loaded === true');
    expect(deskSource).toContain("if (isAdmin && balanceSync.status === 'loading' && !balanceSync.hasSnapshot)");
    expect(deskSource).not.toContain('if (executedTradesLoading || guestUsersLoading)');
    expect(deskSource).toContain("emitBrokerEvent('broker:request-account-info')");
  });

  it('clears the balance spinner when an already-current live stream completes the refresh', () => {
    expect(deskSource).toContain("'broker:account-info-refresh-complete'");
    expect(deskSource).toContain("removeRefreshCompleteListener()");
    const spinnerCondition = deskSource.slice(
      deskSource.indexOf('const balanceRefreshing ='),
      deskSource.indexOf(';', deskSource.indexOf('const balanceRefreshing ='))
    );
    expect(spinnerCondition).not.toContain('guestUsersLoading');
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

  it('isolates Balance reducer and warning state to the authenticated account session', () => {
    expect(appSource).toContain('const accountSession = brokerSessionIdentityRef.current.capture()');
    expect(appSource).toContain('key={`balance-${accountSession?.identity ?? \'none\'}-${accountSession?.generation ?? -1}`}');
    expect(deskSource).toContain('}, [shouldReadBrokerHistory]);');
    expect(deskSource).toContain('isAdmin && (balanceSync.status === \'stale\' || balanceSync.status === \'error\')');
    expect(deskSource).toContain('shouldReadBrokerHistory && (brokerExecutionHistory.status === \'stale\' || brokerExecutionHistory.status === \'error\')');
  });

  it('starts rendering Balance in the navigation render instead of waiting for a passive effect', () => {
    expect(appSource).toContain("const shouldRenderCashCushion = hasOpenedCashCushion ||");
    expect(appSource).toContain("activeDeskView === 'BALANCE';");
    expect(appSource).toContain('{shouldRenderCashCushion');
  });

  it('subscribes Balance only to portfolio slices it renders', () => {
    expect(deskSource).toContain('usePortfolioSelector(selectCashCushionPortfolioState, areCashCushionPortfolioStatesEqual)');
    expect(deskSource).not.toContain('const state = usePortfolio();');
    expect(deskSource).toContain('useMemo(() => activeTrancheSource.map');
  });

  it('refreshes the full Balance snapshot without a date cursor', () => {
    const accountLoaderStart = brokerDataSource.indexOf('const loadFreedomAccount');
    const tradesLoaderStart = brokerDataSource.indexOf('const refreshAccountInfo', accountLoaderStart);
    const accountLoader = brokerDataSource.slice(accountLoaderStart, tradesLoaderStart);
    expect(accountLoader).toContain('fetchAccountInfo()');
    expect(accountLoader).not.toContain('fromDate');
    expect(accountLoader).not.toContain('beginDate');
    expect(accountLoader).not.toContain('endDate');
  });
});
