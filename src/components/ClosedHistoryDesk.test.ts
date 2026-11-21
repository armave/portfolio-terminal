import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTablePaginationRange } from '../ui/useTablePagination';

function readSource(): string {
  return readFileSync(new URL('./ClosedHistoryDesk.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readAppSource(): string {
  return readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readBrokerRuntimeSource(): string {
  return readFileSync(new URL('../services/portfolioBrokerDataRuntime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

describe('Trades USD amount formatting', () => {
  it('uses the shared currency formatter without adding duplicate dollar symbols', () => {
    const source = readSource();
    expect(source).toContain("{knownProfitCount === 0 ? '—' : (realizedNet >= 0 ? '+' : '−') + formatUSD(Math.abs(realizedNet))}");
    expect(source).toContain("{formatUSD(totalFees)}");
    expect(source).toContain("{formatUSD(fees)}");
    expect(source).toContain('profitTextPrefix + sign + formatUSD(Math.abs(netProfit))');
    expect(source).not.toContain('${formatUSD(');
    expect(source).not.toContain('"$" + formatUSD(');
  });
});


describe('Trades reconciliation audit review', () => {
  it('records reviewed findings through the audit-only PortfolioStore API', () => {
    const source = readSource();
    expect(source).toContain('onRecordReview={(section, findingId, findingType, subject, reason) =>');
    expect(source).toContain('isSessionCurrent() &&');
    expect(source).toContain('portfolioStore.recordReconciliationReview(section, findingId, findingType, subject, reason)');
  });
});

describe('Trades cache-first rendering', () => {
  it('starts lazy rendering in the navigation render instead of waiting for a passive effect', () => {
    const app = readAppSource();
    expect(app).toContain("const shouldRenderClosedHistory = hasOpenedClosedHistory || activeDeskView === 'CLOSED_HISTORY';");
    expect(app).toContain('{permissions.canViewClosedHistory && shouldRenderClosedHistory');
    expect(app).toContain(': null}');
  });

  it('defers cashflow and fee-allocation writes until the initial workspace pull settles', () => {
    const app = readAppSource();
    const source = readSource();
    expect(app).toContain("addUiEventListener('app:initial-workspace-sync-settled', handleWorkspaceSyncSettled);");
    expect(app).toContain('setWorkspaceSyncReady(false);');
    expect(app).toContain('isWorkspaceSyncReady={workspaceSyncReady}');
    expect(source).toContain('isWorkspaceSyncReady: boolean');
    expect(source).toContain('if (!isWorkspaceSyncReady || !isSessionCurrent() || cashflowSyncStarted.current) return;');
    expect(source).toContain('const isOperationCurrent = () => isWorkspaceSyncReady && isSessionCurrent() && isOperationActive();');
  });

  it('subscribes only to state used by Trades and memoizes derived history rows', () => {
    const source = readSource();
    expect(source).toContain('usePortfolioSelector(selectTradesPortfolioState, areTradesPortfolioStatesEqual)');
    expect(source).not.toContain('usePortfolio()');
    expect(source).toContain('const trades = useMemo(');
    expect(source).toContain('buildClosedHistoryRows({');
    expect(source).toContain('summarizeClosedHistoryRows(filteredTrades)');
    const model = readFileSync(new URL('../features/trades/closedHistoryRows.ts', import.meta.url), 'utf8');
    expect(model).toContain('time - previousTime <= 60 * 60 * 1000');
    expect(model).toContain('deduplicateClosedHistoryRows(appTrades, brokerRows)');
    expect(model).toContain('deduplicateClosedHistoryRows(appTradesWithoutFillDuplicates, groupedBrokerRows)');
    expect(model).toContain('resolveClosedTradeAllocation(');
  });

  it('binds the Trades desk to the active account session and remounts after an identity change', () => {
    const app = readAppSource();
    const source = readSource();
    expect(app).toContain('const accountSession = brokerSessionIdentityRef.current.capture()');
    expect(app).toContain('isSessionCurrent={isAccountSessionCurrent}');
    expect(app).toContain('key={`closed-history-${accountSession?.identity ?? \'none\'}-${accountSession?.generation ?? -1}`}');
    expect(source).toContain('isSessionCurrent = () => true');
    expect(source).toContain('if (!isWorkspaceSyncReady || !isSessionCurrent() || cashflowSyncStarted.current) return');
    expect(source).toContain('{ isCurrentSession: isSessionCurrent }');
  });

  it('discards delayed cloud-history and cashflow responses after the account session changes', () => {
    const source = readSource();
    expect(source).toContain('if (!active || !isSessionCurrent()) return');
    expect(source).toContain('if (!isSessionCurrent()) return;\n      const fetchedRows = brokerAdapter.normalizeCashflows(response).data');
    expect(source).toContain('if (!saved || !isSessionCurrent()) return');
    expect(source).toContain('const isOperationCurrent = () => isWorkspaceSyncReady && isSessionCurrent() && isOperationActive();');
    expect(source).toContain('if (!completed) cashflowSyncStarted.current = false');
    expect(source).toContain('if (isSessionCurrent()) {');
    expect(source).toContain('setCashflowSyncReady(true)');
  });

  it('ignores fee-allocation completion after its effect is disposed', () => {
    const source = readSource();
    const allocationEffect = source.slice(
      source.indexOf('const allocationInputKey ='),
      source.indexOf('const processCashflowRows')
    );

    expect(allocationEffect).toContain('let active = true;');
    expect(allocationEffect).toContain('const isEffectCurrent = () => active && isSessionCurrent();');
    expect(allocationEffect).toContain('processCashflowRows(cashflows, false, isEffectCurrent)');
    expect(allocationEffect).toContain('if (!isEffectCurrent()) return;');
    expect(allocationEffect).toContain('return () => {\n      active = false;\n    };');

    const processEffect = source.slice(
      source.indexOf('const processCashflowRows'),
      source.indexOf('const syncCashflowsFromFreedom')
    );
    expect(processEffect).toContain('const isOperationCurrent = () => isWorkspaceSyncReady && isSessionCurrent() && isOperationActive();');
    expect(processEffect).toContain('buildClosedHistoryFeeAuditUpdate(');
    expect(processEffect).toContain('portfolioStore.commitClosedHistoryFeeSync(');
    expect(processEffect).not.toContain('portfolioStore.setState(nextState, false)');
    expect(processEffect).toContain('feeAuditUpdate.transactionEvents');
    expect(processEffect).toContain('auditedClosedTrades');
    expect(processEffect).toContain('if (!isOperationCurrent()) return false;');
    expect(processEffect).toContain('{ isCurrentSession: isOperationCurrent }');
  });

  it('allows retrying a failed automatic cashflow refresh without remounting Trades', () => {
    const source = readSource();
    const retry = source.slice(source.indexOf('const syncCashflowsFromFreedom'), source.indexOf('useEffect(() => {', source.indexOf('const syncCashflowsFromFreedom')));
    expect(retry).toContain('if (!completed) cashflowSyncStarted.current = false');
    expect(retry).toContain('const retryCashflowSync = () =>');
    expect(retry).toContain('setCashflowSyncReady(false)');
    expect(source).toContain('onClick={retryCashflowSync}');
    expect(source).toContain("translateText('Retry cashflow sync')");
  });

  it('uses shared pagination and clamps the rendered Trades page after a shrinking refresh', () => {
    const source = readSource();
    expect(source).toContain("useTablePagination('closed-history', filteredTrades.length, 10)");
    expect(source).toContain('sliceTablePage(filteredTrades, pagination.currentPage, pagination.pageSize)');
    expect(source).toContain('<TablePagination');
    // A requested page beyond the shortened result is clamped before slicing.
    expect(getTablePaginationRange(78, 9, 10)).toEqual({
      pageCount: 8, page: 8, start: 71, end: 78
    });
  });

  it('preserves the last valid Mix quantity when a closed-trade input is blank or invalid', () => {
    const source = readSource();
    expect(source).toContain('resolveActiveTrancheMixInput(value, rowQuantity, row.cashQuantity)');
    expect(source).toContain('resolveActiveTrancheMixInput(value, rowQuantity, row.marginQuantity)');
    expect(source).not.toContain('Number(value) || 0');
  });

  it('hydrates saved executions synchronously before the first component effect', () => {
    const source = readSource();
    expect(source).toContain('function loadInitialBrokerExecutions(): FreedomExecutedTrade[]');
    expect(source).toContain('normalizeBrokerExecutions(loadSavedHistory().brokerExecutedTrades)');
    expect(source).toContain('createBrokerExecutionHistoryState(loadInitialBrokerExecutions(), [], true)');
  });

  it('keeps the current snapshot available while a background refresh is running or fails', () => {
    const source = readSource();
    expect(source).toContain("dispatchBrokerExecutionHistory({ type: 'refresh' });");
    expect(source).toContain("dispatchBrokerExecutionHistory({ type: 'failure' });");
    expect(source).toContain("brokerExecutionHistory.status === 'refreshing'");
    expect(source).toContain("brokerExecutionHistory.status === 'stale'");
  });

  it('does not replace pre-existing history with an incremental page and performs a one-time cashflow backfill', () => {
    const source = readSource();
    expect(source).toContain('...savedFeeRows, ...stored, ...brokerTrades');
    expect(source).toContain('hasFreedomCashflowHistoryBaseline(accountId)');
    expect(source).toContain('hasCompleteBaseline ? cashflowSyncStartDate.current : undefined');
    expect(source).toContain('markFreedomCashflowHistoryBaseline(accountId)');
  });

  it('performs a one-time full trades backfill before trusting a cached date cursor', () => {
    const source = readBrokerRuntimeSource();
    expect(source).toContain('hasHistoryBaseline(accountId)');
    expect(source).toContain('const fromDate = hasCompleteBaseline');
    expect(source).toContain('mergeBrokerExecutionHistory(');
    expect(source).toContain('persistedCount >= mergedTrades.length');
    expect(source).toContain('markHistoryBaseline(accountId)');
  });

  it('passes app-owned legacy closed sales to the read-only broker matcher', () => {
    const source = readSource();
    expect(source).toContain('legacyClosedTrades={state.closedTrades || []}');
  });

  it('advances the cashflow cursor from the completed broker trade refresh', () => {
    const source = readSource();
    expect(source).toContain('const cashflowSyncStartDate = useRef(');
    expect(source).toContain('getLatestClosedTradeDate(brokerExecutionHistory.trades, state.closedTrades || [])');
    expect(source).toContain('cashflowSyncStartDate.current = getLatestClosedTradeDate(brokerTrades, state.closedTrades || [])');
    expect(source).toContain('hasCompleteBaseline ? cashflowSyncStartDate.current : undefined');
    expect(source).toContain('brokerAdapter.fetchCashflows(fromDate)');
    expect(source).not.toContain('fetchFreedomCashflows(getLatestClosedTradeDate(brokerTrades');
  });

  it('requests cashflows only after the broker execution refresh and only for a changed latest-trade checkpoint', () => {
    const source = readSource();
    expect(source).toContain('if (!isWorkspaceSyncReady || !cashflowHistoryReady || brokerTradesLoading || brokerTradesRefreshing) return;');
    expect(source).toContain('getLatestClosedTradeCheckpoint(brokerTrades, state.closedTrades || []) || \'no-trades\'');
    expect(source).toContain('getFreedomCashflowTradeCheckpoint(accountId)');
    expect(source).toContain('if (hasCompleteBaseline && previousTradeCheckpoint === latestTradeCheckpoint)');
    expect(source).toContain('markFreedomCashflowTradeCheckpoint(accountId, latestTradeCheckpoint)');
  });

  it('waits only when there is no cached broker or app-owned trade data', () => {
    const source = readSource();
    expect(source).toContain('if (brokerTradesLoading && brokerTrades.length === 0 && appTrades.length === 0)');
    expect(source).not.toContain('if (brokerTradesLoading || !cashflowHistoryReady');
    expect(source).toContain("emitBrokerEvent('broker:request-executed-trades', { priority: 'interactive' });");
    expect(source).toContain('const showBrokerRefreshIndicator = useDelayedActivityVisibility(brokerTradesRefreshing, {');
    expect(source).toContain('showDelayMs: 700');
    expect(source).toContain('showBrokerRefreshIndicator && (');
    expect(source).toContain('Refreshing TradeNet execution history…');
    expect(source).not.toContain('backgroundSyncPending');
    expect(source).not.toContain('Updating saved trade calculations in the background…');
    expect(source).toContain('createFreedomMarginFeeAllocationInputKey(');
    expect(source).toContain('const allocationInputKey =');
    const allocationEffect = source.slice(
      source.indexOf('const allocationInputKey ='),
      source.indexOf('const processCashflowRows')
    );
    expect(allocationEffect).toContain('}, [isWorkspaceSyncReady, cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, allocationInputKey]);');
    expect(allocationEffect).not.toContain('state.positions,');
    expect(source).toContain('role="status"');
    expect(source).toContain('animate-spin');
    expect(source).toContain('strokeDasharray="24 14"');
    expect(source).toContain('strokeWidth="2"');
    expect(source).toContain('motion-reduce:animate-none');
    expect(source).not.toContain('backgroundSyncPending && trades.length > 0');
    expect(source).not.toContain('Refreshing TradeNet history…</p>');
  });
});


describe('Trades history UX', () => {
  it('filters before pagination and scopes the summary to the visible filter set', () => {
    const source = readSource();
    expect(source).toContain('filterClosedHistoryRows(trades, {');
    expect(source).toContain("useTablePagination('closed-history', filteredTrades.length, 10)");
    expect(source).toContain('sliceTablePage(filteredTrades, pagination.currentPage, pagination.pageSize)');
    expect(source).toContain('summarizeClosedHistoryRows(filteredTrades)');
    expect(source).toContain('Summary reflects current filters');
    expect(source).toContain('knownProfitCount === 0 ?');
  });

  it('keeps mobile cards and desktop table while exposing the same allocation controls', () => {
    const source = readSource();
    expect(source).toContain('class="space-y-2 lg:hidden"');
    expect(source).toContain('class="hidden lg:block closed-history-page-transition"');
    expect(source.match(/<ClosedTradeAllocationControls/g)?.length).toBe(2);
    expect(source).toContain('Funding and guest allocation');
    expect(source).toContain('compact');
  });

  it('delays only the broker refresh indicator instead of combining unrelated background tasks', () => {
    const source = readSource();
    expect(source).toContain('useDelayedActivityVisibility(brokerTradesRefreshing, {');
    expect(source).toContain('showDelayMs: 700');
    expect(source).not.toContain('backgroundSyncPending');
  });
});

describe('Trades broker quote reconciliation wiring', () => {
  it('passes current app quote provenance and broker snapshot metadata to the read-only review', () => {
    const source = readSource();
    expect(source).toContain('positions: state.positions');
    expect(source).toContain('cashCushion: state.cashCushion');
    expect(source).toContain('brokerAccountInfo: state.brokerAccountInfo');
    expect(source).toContain('appQuotes={[');
    expect(source).toContain('price: holding.currentPrice,');
    expect(source).not.toContain('price: holding.currentPrice ?? holding.price,');
    expect(source).toContain('brokerQuoteSnapshot={state.brokerAccountInfo ? {');
    expect(source).toContain('quality ?? state.brokerAccountInfo.snapshotQuality');
  });
});

import {
  buildClosedHistoryRows,
  filterClosedHistoryRows,
  summarizeClosedHistoryRows
} from '../features/trades/closedHistoryRows';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import type { BrokerExecutionMetrics } from '../domain/brokerExecutionMetrics';
import type { ClosedTradeAttribution } from '../domain/closedTradeAttribution';

const createSellExecution = (
  id: string,
  quantity: number,
  price: number,
  executedAt: string,
  overrides: Partial<FreedomExecutedTrade> = {}
): FreedomExecutedTrade => ({
  id,
  ticker: 'AAPL',
  side: 'sell',
  quantity,
  price,
  currency: 'USD',
  executedAt,
  tradeValue: quantity * price,
  profit: 20,
  marginFee: 1,
  commission: 1,
  commissionCurrency: 'USD',
  raw: {},
  ...overrides
});

describe('closed history row model', () => {
  it('groups adjacent same-ticker sells within one hour and preserves weighted metrics', () => {
    const first = createSellExecution('sell-1', 2, 100, '2026-11-10T10:00:00.000Z', { profit: 20 });
    const second = createSellExecution('sell-2', 3, 110, '2026-11-10T11:00:00.000Z', { profit: 30 });
    const metrics = new Map<FreedomExecutedTrade, BrokerExecutionMetrics>([
      [first, { buyCommission: 0.5, holdingDays: 10 }],
      [second, { buyCommission: 0.5, holdingDays: 20 }]
    ]);
    const attributions = new Map<FreedomExecutedTrade, ClosedTradeAttribution>();
    const rows = buildClosedHistoryRows({
      brokerTrades: [first, second],
      brokerTradeMetrics: metrics,
      trancheAttributions: attributions,
      appTrades: [],
      closedTradeAllocations: {
        'broker:sell-1': { fundingType: 'cash', cashQuantity: 5, marginQuantity: 0 }
      }
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: 'tradenet',
      allocationType: 'cash',
      cashQuantity: 5,
      marginQuantity: 0,
      commissionsComplete: true,
      fees: 2,
      commissions: 3,
      feesTotal: 5,
      profit: 45,
      allocationKey: 'broker:sell-1'
    });
    expect(rows[0].trade).toMatchObject({
      id: 'sell-1+sell-2',
      ticker: 'AAPL',
      shares: 5,
      price: 106,
      exitDate: '2026-11-10T11:00:00.000Z',
      holdingDays: 16
    });
  });

  it('starts a new row when the gap from the previous same-ticker sell exceeds one hour', () => {
    const first = createSellExecution('sell-1', 2, 100, '2026-11-10T10:00:00.000Z');
    const second = createSellExecution('sell-2', 3, 110, '2026-11-10T11:00:00.001Z');
    const rows = buildClosedHistoryRows({
      brokerTrades: [first, second],
      brokerTradeMetrics: new Map(),
      trancheAttributions: new Map(),
      appTrades: []
    });

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.trade.id)).toEqual(['sell-2', 'sell-1']);
  });

  it('prefers a broker row when it duplicates an app-owned sale while retaining other app trades', () => {
    const broker = createSellExecution('broker-sale', 5, 100, '2026-11-10T10:00:00.000Z');
    const appTrades = [
      {
        trade: { id: 'duplicate-app', ticker: 'AAPL', shares: 5, exitDate: '2026-11-10T10:30:00.000Z', sellPrice: 100 },
        allocationKey: 'app:duplicate-app',
        allocationType: 'unclassified',
        guestAllocations: [],
        profit: 50
      },
      {
        trade: { id: 'other-app', ticker: 'MSFT', shares: 2, exitDate: '2026-11-09T10:00:00.000Z' },
        allocationKey: 'app:other-app',
        allocationType: 'unclassified',
        guestAllocations: [],
        profit: 10
      }
    ];
    const rows = buildClosedHistoryRows({
      brokerTrades: [broker],
      brokerTradeMetrics: new Map([[broker, { buyCommission: 0.5, holdingDays: 3 }]]),
      trancheAttributions: new Map(),
      appTrades
    });

    expect(rows.map((row) => row.trade.id)).toEqual(['broker-sale', 'other-app']);
    expect(rows[0].source).toBe('tradenet');
  });
});

describe('closed history filters', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0, 0);
  const rows = [
    { trade: { ticker: 'AAPL', exitDate: '2026-11-20T12:00:00.000Z' }, source: 'tradenet', profit: 25, allocationType: 'cash' },
    { trade: { ticker: 'MSFT', exitDate: '2026-10-15T12:00:00.000Z' }, source: 'app', profit: -8, allocationType: 'margin' },
    { trade: { ticker: 'TSLA', exitDate: '2026-11-19T12:00:00.000Z' }, source: 'tradenet', profit: 6, profitIsUpperBound: true, allocationType: 'mix' },
    { trade: { ticker: 'NVDA', exitDate: '2026-01-01T12:00:00.000Z' }, source: 'app', profit: 0, allocationType: 'unclassified' },
    { trade: { ticker: 'ORCL' }, source: 'app', profit: null, allocationType: 'unclassified' }
  ];
  const filters = {
    query: '',
    dateRange: 'all' as const,
    performance: 'all' as const,
    funding: 'all' as const,
    source: 'all' as const
  };

  it('searches ticker case-insensitively and combines source and funding filters', () => {
    expect(filterClosedHistoryRows(rows, { ...filters, query: 'aAp' }, now).map((row) => row.trade.ticker))
      .toEqual(['AAPL']);
    expect(filterClosedHistoryRows(rows, { ...filters, source: 'tradenet', funding: 'mix' }, now).map((row) => row.trade.ticker))
      .toEqual(['TSLA']);
  });

  it('classifies only exact known P&L as profitable, losing or breakeven', () => {
    expect(filterClosedHistoryRows(rows, { ...filters, performance: 'profitable' }, now).map((row) => row.trade.ticker))
      .toEqual(['AAPL']);
    expect(filterClosedHistoryRows(rows, { ...filters, performance: 'losing' }, now).map((row) => row.trade.ticker))
      .toEqual(['MSFT']);
    expect(filterClosedHistoryRows(rows, { ...filters, performance: 'breakeven' }, now).map((row) => row.trade.ticker))
      .toEqual(['NVDA']);
    expect(filterClosedHistoryRows(rows, { ...filters, performance: 'unknown' }, now).map((row) => row.trade.ticker))
      .toEqual(['TSLA', 'ORCL']);
  });

  it('filters rolling windows and current year without admitting unknown or future dates', () => {
    expect(filterClosedHistoryRows(rows, { ...filters, dateRange: '7d' }, now).map((row) => row.trade.ticker))
      .toEqual(['AAPL', 'TSLA']);
    expect(filterClosedHistoryRows(rows, { ...filters, dateRange: 'year' }, now).map((row) => row.trade.ticker))
      .toEqual(['AAPL', 'MSFT', 'TSLA', 'NVDA']);
  });

  it('does not mutate or rewrite the source rows', () => {
    const filtered = filterClosedHistoryRows(rows, { ...filters, performance: 'unknown' }, now);
    expect(filtered[0]).toBe(rows[2]);
    expect(rows[2].profit).toBe(6);
    expect(rows[2].profitIsUpperBound).toBe(true);
  });
});

describe('closed history summary model', () => {
  it('keeps unknown profits out of win-rate denominators and aggregates fees', () => {
    expect(summarizeClosedHistoryRows([
      { profit: 10, feesTotal: 2, commissionsComplete: true, trade: { holdingDays: 2 } },
      { profit: null, fees: 3, commissions: 1, commissionsComplete: false, trade: { holdingDays: null } },
      { profit: -5, feesTotal: 4, commissionsComplete: true, trade: { daysHeld: 4 } }
    ])).toEqual({
      realizedNet: 5,
      totalFees: 10,
      hasIncompleteCommissions: true,
      hasUnknownProfit: true,
      knownProfitCount: 2,
      winningTrades: 1,
      averageHoldingDays: 3,
      winRate: 50
    });
  });

  it('returns safe empty-history defaults', () => {
    expect(summarizeClosedHistoryRows([])).toEqual({
      realizedNet: 0,
      totalFees: 0,
      hasIncompleteCommissions: false,
      hasUnknownProfit: false,
      knownProfitCount: 0,
      winningTrades: 0,
      averageHoldingDays: null,
      winRate: 0
    });
  });
});


describe('Trades lot and closed-history parity wiring', () => {
  it('passes canonical position lots, cash-holding lots and closed history to the read-only parity report', () => {
    const source = readSource();
    expect(source).toContain('legacyClosedTrades={state.closedTrades || []}');
    expect(source).toContain('positions={state.positions || {}}');
    expect(source).toContain('cashHoldings={state.cashCushion?.holdings || []}');
  });
});
