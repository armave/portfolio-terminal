import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(new URL('./ClosedHistoryDesk.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readAppSource(): string {
  return readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readBrokerRuntimeSource(): string {
  return readFileSync(new URL('../services/portfolioBrokerDataRuntime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

describe('Trades cache-first rendering', () => {
  it('starts lazy rendering in the navigation render instead of waiting for a passive effect', () => {
    const app = readAppSource();
    expect(app).toContain("const shouldRenderClosedHistory = hasOpenedClosedHistory || activeDeskView === 'CLOSED_HISTORY';");
    expect(app).toContain('{permissions.canViewClosedHistory && shouldRenderClosedHistory');
    expect(app).toContain(': null}');
  });

  it('subscribes only to state used by Trades and memoizes derived history rows', () => {
    const source = readSource();
    expect(source).toContain('usePortfolioSelector(selectTradesPortfolioState, areTradesPortfolioStatesEqual)');
    expect(source).not.toContain('usePortfolio()');
    expect(source).toContain('const trades = useMemo(() => {');
    expect(source).toContain('const tradeSummary = useMemo(() => {');
  });

  it('binds the Trades desk to the active account session and remounts after an identity change', () => {
    const app = readAppSource();
    const source = readSource();
    expect(app).toContain('const accountSession = brokerSessionIdentityRef.current.capture()');
    expect(app).toContain('isSessionCurrent={isAccountSessionCurrent}');
    expect(app).toContain('key={`closed-history-${accountSession?.identity ?? \'none\'}-${accountSession?.generation ?? -1}`}');
    expect(source).toContain('isSessionCurrent = () => true');
    expect(source).toContain('if (!isSessionCurrent() || cashflowSyncStarted.current) return');
    expect(source).toContain('{ isCurrentSession: isSessionCurrent }');
  });

  it('discards delayed cloud-history and cashflow responses after the account session changes', () => {
    const source = readSource();
    expect(source).toContain('if (!active || !isSessionCurrent()) return');
    expect(source).toContain('if (!isSessionCurrent()) return;\n      const fetchedRows = brokerAdapter.normalizeCashflows(response).data');
    expect(source).toContain('if (!saved || !isSessionCurrent()) return');
    expect(source).toContain('const isOperationCurrent = () => isSessionCurrent() && isOperationActive();');
    expect(source).toContain('if (!completed) cashflowSyncStarted.current = false');
    expect(source).toContain('if (isSessionCurrent()) {');
    expect(source).toContain('setCashflowSyncReady(true)');
  });

  it('ignores fee-allocation completion after its effect is disposed', () => {
    const source = readSource();
    const allocationEffect = source.slice(
      source.indexOf('// Recalculate once per distinct cashflow/execution snapshot.'),
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
    expect(processEffect).toContain('const isOperationCurrent = () => isSessionCurrent() && isOperationActive();');
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

  it('clamps the rendered Trades page before a shrinking refresh can show an empty range', () => {
    const source = readSource();
    expect(source).toContain('const safeTradesPage = Math.max(1, Math.min(tradesPage, tradesPageCount))');
    expect(source).toContain('trades.slice((safeTradesPage - 1) * tradesPageSize, safeTradesPage * tradesPageSize)');
    expect(source).toContain('if (tradesPage !== safeTradesPage) setTradesPage(safeTradesPage)');
    expect(source).toContain("translateText(`Showing ${(safeTradesPage - 1) * tradesPageSize + 1}");
    expect(source).toContain('Page {safeTradesPage} / {tradesPageCount}');
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

  it('keeps the cashflow cursor anchored to the cached table before trades refresh', () => {
    const source = readSource();
    expect(source).toContain('const cashflowSyncStartDate = useRef(');
    expect(source).toContain('getLatestClosedTradeDate(brokerExecutionHistory.trades, state.closedTrades || [])');
    expect(source).toContain('hasCompleteBaseline ? cashflowSyncStartDate.current : undefined');
    expect(source).toContain('brokerAdapter.fetchCashflows(fromDate)');
    expect(source).not.toContain('fetchFreedomCashflows(getLatestClosedTradeDate(brokerTrades');
  });

  it('waits only when there is no cached broker or app-owned trade data', () => {
    const source = readSource();
    expect(source).toContain('if (brokerTradesLoading && brokerTrades.length === 0 && appTrades.length === 0)');
    expect(source).not.toContain('if (brokerTradesLoading || !cashflowHistoryReady');
    expect(source).toContain('const isBackgroundUpdating = backgroundSyncPending || brokerTradesRefreshing;');
    expect(source).toContain('role="status"');
    expect(source).toContain('animate-spin');
    expect(source).toContain('strokeDasharray="24 14"');
    expect(source).toContain('strokeWidth="2"');
    expect(source).toContain('motion-reduce:animate-none');
    expect(source).not.toContain('backgroundSyncPending && trades.length > 0');
    expect(source).not.toContain('Refreshing TradeNet history…</p>');
  });
});
