import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getTablePaginationRange } from '../ui/useTablePagination';

function readSource(): string {
  return readFileSync(new URL('./ClosedHistoryDesk.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readAppSource(): string {
  return readFileSync(new URL('../App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readRuntimeSource(): string {
  return readFileSync(new URL('../../app.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

function readBrokerRuntimeSource(): string {
  return readFileSync(new URL('../services/portfolioBrokerDataRuntime.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
}

describe('Trades USD amount formatting', () => {
  it('uses the shared currency formatter without adding duplicate dollar symbols', () => {
    const source = readSource();
    expect(source).toContain("{knownProfitCount === 0 ? '—' : (realizedNet >= 0 ? '+' : '−') + formatUSD(Math.abs(realizedNet))}");
    expect(source).toContain("{formatUSD(totalFees)}");
    expect(source).toContain("{formatUSD(Number(row.fees ?? 0))}");
    expect(source).toContain("formatUSD(Math.abs(profit))");
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

  it('waits for workspace hydration and delegates cashflow writes to the shared owner', () => {
    const app = readAppSource();
    const source = readSource();
    expect(app).toContain("addUiEventListener('app:initial-workspace-sync-settled', handleWorkspaceSyncSettled);");
    expect(app).toContain('setWorkspaceSyncReady(false);');
    expect(app).toContain('isWorkspaceSyncReady={workspaceSyncReady}');
    expect(source).toContain('isWorkspaceSyncReady: boolean');
    expect(source).toContain('!cashflowHistoryReady');
    expect(source).toContain("requestClosedHistorySync('refresh')");
    expect(source).toContain("emitBrokerEvent('broker:request-closed-history-sync-and-wait'");
    expect(source).not.toContain('processCashflowRows');
    expect(source).not.toContain('pushCloudHistory');
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
    expect(source).toContain('requestClosedHistorySync');
    expect(source).toContain("emitBrokerEvent('broker:request-closed-history-sync-and-wait'");
    expect(source).toContain('isSessionCurrent()');
  });

  it('rejects stale account-session work at the shared orchestration boundary', () => {
    const app = readRuntimeSource();
    const source = readSource();
    const coordinator = readFileSync(new URL('../services/tradesHistorySyncRuntime.ts', import.meta.url), 'utf8');
    expect(app).toContain('currentAccountSessionGuard.isCurrent(session)');
    expect(app).toContain('if (!isCurrentSession()) return false;');
    expect(coordinator).toContain('dependencies.getSessionKey() === sessionKey');
    expect(coordinator).toContain("status: 'stale'");
    expect(source).toContain('if (!isSessionCurrent()) return;');
  });

  it('routes scheduled, manual, desk and new-fill history work through one owner', () => {
    const app = readRuntimeSource();
    const source = readSource();
    const coordinator = readFileSync(new URL('../services/tradesHistorySyncRuntime.ts', import.meta.url), 'utf8');

    expect(app).toContain('createTradesHistorySyncRuntime({');
    expect(app).toContain("syncHistory: () => currentAccountRole === 'admin' ? syncAdminClosedHistory('scheduler') : undefined");
    expect(app).toContain("syncClosedHistory: () => currentAccountRole === 'admin' ? syncAdminClosedHistory('manual') : Promise.resolve(false)");
    expect(app).toContain("addBrokerEventListener('broker:request-closed-history-sync-and-wait'");
    expect(source).toContain("emitBrokerEvent('broker:request-closed-history-sync-and-wait'");
    expect(source).toContain("requestClosedHistorySync('refresh')");
    expect(source).not.toContain('pullCloudHistory');
    expect(source).not.toContain('pushCloudHistory');
    expect(source).not.toContain('fetchCashflows');
    expect(coordinator).toContain('activeBySession');
    expect(coordinator).toContain('diagnostics.coalesced += 1');
    expect(coordinator).toContain('diagnostics.queued += 1');
  });

  it('memoizes fee-allocation input serialization and ignores position changes when broker executions are authoritative', () => {
    const source = readSource();
    const start = source.indexOf('const allocationInputKey = useMemo(');
    const end = source.indexOf('\n\n  useEffect(() => {', start);
    const memo = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(memo).toContain('createFreedomMarginFeeAllocationInputKey(');
    expect(memo).toContain('state.cashflows,');
    expect(memo).toContain('allocationBrokerExecutions,');
    expect(memo).toContain('state.closedTrades,');
    expect(memo).toContain('state.activeTrancheTypes,');
    expect(memo).toContain('state.activeTrancheMixes,');
    expect(memo).toContain('allocationBrokerExecutions.length > 0 ? null : state.positions');
  });

  it('ignores shared-sync completion after the requesting Trades effect is disposed', () => {
    const source = readSource();
    const start = source.indexOf('const requestClosedHistorySync');
    const end = source.indexOf('const retryCloudHistoryMigration', start);
    const effects = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(effects).toContain('let active = true;');
    expect(effects).toContain('if (active && isSessionCurrent()) reportClosedHistorySync(success);');
    expect(effects).toContain('if (!active || !isSessionCurrent()) return;');
    expect(effects).toContain('return () => { active = false; };');
    expect(source).toContain("emitBrokerEvent('broker:request-closed-history-sync-and-wait'");
    expect(source).not.toContain('processCashflowRows');
  });

  it('allows retrying a failed shared history refresh without remounting Trades', () => {
    const source = readSource();
    const retryStart = source.indexOf('const retryCashflowSync =');
    const retryEnd = source.indexOf('const retryCloudHistoryMigration =', retryStart);
    const retry = source.slice(retryStart, retryEnd);
    expect(retry).toContain('cashflowSyncStarted.current = true');
    expect(retry).toContain("requestClosedHistorySync('refresh')");
    expect(retry).toContain('setCashflowSyncReady(false)');
    expect(source).toContain('onClick={retryCashflowSync}');
    expect(source).toContain("translateText('Retry cashflow sync')");
  });

  it('uses shared pagination and clamps the rendered Trades page after a shrinking refresh', () => {
    const source = readSource();
    expect(source).toContain("useTablePagination('closed-history', sortedTrades.length, 10)");
    expect(source).toContain('sliceTablePage(sortedTrades, pagination.currentPage, pagination.pageSize)');
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

  it('keeps cached mount catch-up quiet and reserves the header refresh state for explicit user requests', () => {
    const source = readSource();
    const mountEffectStart = source.indexOf('    readCurrentTrades();');
    const mountEffectEnd = source.indexOf('  }, []);', mountEffectStart);
    const mountEffect = source.slice(mountEffectStart, mountEffectEnd);
    const retryStart = source.indexOf('  const retryBrokerTrades =');
    const retryEnd = source.indexOf('  useEffect(() => addBrokerEventListener', retryStart);
    const explicitRefresh = source.slice(retryStart, retryEnd);

    expect(mountEffect).toContain("emitBrokerEvent('broker:request-executed-trades', { priority: 'interactive' });");
    expect(mountEffect).not.toContain("dispatchBrokerExecutionHistory({ type: 'refresh' });");
    expect(explicitRefresh).toContain("dispatchBrokerExecutionHistory({ type: 'refresh', requestId });");
    expect(explicitRefresh).toContain("emitBrokerEvent('broker:request-executed-trades-and-wait'");
    expect(source).toContain("dispatchBrokerExecutionHistory({ type: 'failure' });");
    expect(source).toContain("brokerExecutionHistory.status === 'refreshing'");
    expect(source).toContain("brokerExecutionHistory.status === 'stale'");
  });

  it('does not replace existing broker history with an incremental page and keeps a full cashflow baseline', () => {
    const source = readSource();
    const app = readRuntimeSource();
    expect(source).toContain('...savedFeeRows, ...stored, ...brokerTrades');
    expect(app).toContain('hasFreedomCashflowHistoryBaseline(accountId)');
    expect(app).toContain('const latestCashflowDate = hasCashflowBaseline');
    expect(app).toContain('shouldFetchCashflows');
    expect(app).toContain('markFreedomCashflowHistoryBaseline(accountId)');
    expect(app).toContain('markFreedomCashflowTradeCheckpoint(accountId, latestTradeCheckpoint)');
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

  it('rolls back a failed portfolio snapshot before any cloud-history write', () => {
    const app = readRuntimeSource();
    const start = app.indexOf('async function performAdminClosedHistorySync');
    const end = app.indexOf('const tradesHistorySyncRuntime', start);
    const pipeline = app.slice(start, end);
    const localSaveFailure = pipeline.indexOf('if (!persisted) {');
    const cloudHistoryWrite = pipeline.indexOf('const pushed = await pushCloudHistory');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(localSaveFailure).toBeGreaterThanOrEqual(0);
    expect(cloudHistoryWrite).toBeGreaterThan(localSaveFailure);
    expect(pipeline.slice(localSaveFailure, cloudHistoryWrite)).toContain('portfolioStore.restoreInMemorySnapshot(previousState)');
    expect(pipeline).toContain('if (!pushed) {');
    expect(pipeline).toContain('force: true');
  });

  it('advances the cashflow checkpoint only to the trade set included in the fetch window', () => {
    const app = readRuntimeSource();
    expect(app).toContain('getLatestClosedTradeDate(executionsWithFees, currentAtStart.closedTrades || [])');
    expect(app).toContain('const latestTradeCheckpoint = getLatestClosedTradeCheckpoint(');
    expect(app).toContain('freedomBrokerAdapter.fetchCashflows(latestCashflowDate)');
    expect(app).toContain('markFreedomCashflowTradeCheckpoint(accountId, latestTradeCheckpoint)');
  });

  it('refreshes cashflows only for a baseline, a changed fill checkpoint, or an explicit force request', () => {
    const source = readSource();
    const app = readRuntimeSource();
    expect(source).toContain('!cashflowHistoryReady');
    expect(source).toContain('brokerTradesRefreshing');
    expect(source).toContain("requestClosedHistorySync('refresh')");
    expect(app).toContain('latestTradeCheckpoint !== previousTradeCheckpoint');
    expect(app).toContain('forceRefresh ||');
    expect(app).toContain('!hasCashflowBaseline');
    expect(app).toContain('freedomBrokerAdapter.fetchCashflows(latestCashflowDate)');
  });

  it('waits only when there is no cached broker or app-owned trade data', () => {
    const source = readSource();
    expect(source).toContain('if (brokerTradesLoading && brokerTrades.length === 0 && appTrades.length === 0)');
    expect(source).not.toContain('if (brokerTradesLoading || !cashflowHistoryReady');
    expect(source).toContain("emitBrokerEvent('broker:request-executed-trades', { priority: 'interactive' });");
    expect(source).toContain('const showBrokerRefreshIndicator = useDelayedActivityVisibility(brokerTradesRefreshing, {');
    expect(source).toContain('showDelayMs: WORKSPACE_ACTIVITY_INDICATOR_SHOW_DELAY_MS');
    expect(source).toContain('<OperationActivityIndicator');
    expect(source).toContain('visible={showBrokerRefreshIndicator}');
    expect(source).toContain('Refreshing TradeNet execution history…');
    expect(source).not.toContain('backgroundSyncPending');
    expect(source).not.toContain('Updating saved trade calculations in the background…');
    expect(source).toContain('createFreedomMarginFeeAllocationInputKey(');
    expect(source).toContain('const allocationInputKey =');
    const allocationEffect = source.slice(
      source.indexOf('const requestClosedHistorySync'),
      source.indexOf('const retryCloudHistoryMigration')
    );
    expect(source).toContain('}, [isWorkspaceSyncReady, cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, allocationInputKey]);');
    expect(allocationEffect).toContain("requestClosedHistorySync('recalculate')");
    expect(source).not.toContain('<svg viewBox="0 0 16 16"');
    expect(source).not.toContain('strokeDasharray="24 14"');
    expect(source).not.toContain('backgroundSyncPending && trades.length > 0');
    expect(source).not.toContain('Refreshing TradeNet history…</p>');
  });
});


describe('Trades history UX', () => {
  it('filters before pagination and scopes the summary to the visible filter set', () => {
    const source = readSource();
    expect(source).toContain('filterClosedHistoryRows(trades, {');
    expect(source).toContain("useTablePagination('closed-history', sortedTrades.length, 10)");
    expect(source).toContain('sliceTablePage(sortedTrades, pagination.currentPage, pagination.pageSize)');
    expect(source).toContain('summarizeClosedHistoryRows(filteredTrades)');
    expect(source).toContain('Summary reflects current filters');
    expect(source).toContain('knownProfitCount === 0 ?');
  });

  it('uses one responsive entry-card list at every viewport and removes the legacy table', () => {
    const source = readSource();
    expect(source).toContain('id="closedTradesHistory" class="closed-history-page-transition grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"');
    expect(source).not.toContain('hidden lg:block');
    expect(source).not.toContain('<table');
    expect(source).not.toContain('TableScrollRegion');
    expect(source.match(/<ClosedTradeAllocationControls/g)?.length).toBe(1);
    expect(source).toContain('Funding and guest allocation');
    expect(source).toContain("translateText('Avg. entry'");
    expect(source).toContain("translateText('Avg. exit'");
    expect(source).toContain("translateText('Gross P&L'");
    expect(source).toContain('controlsId="closedTradesHistory"');
    expect(source).toContain('compact');
  });

  it('keeps the authenticated browser journey aligned with the responsive card list', () => {
    const browserSource = readFileSync(new URL('../../scripts/browser-smoke-operations.mjs', import.meta.url), 'utf8');
    expect(browserSource).toContain("#closedTradesHistory article");
    expect(browserSource).not.toContain("#closedTradesTableBody");
  });

  it('removes provenance from filters while preserving it on each trade entry', () => {
    const source = readSource();
    expect(source).not.toContain('sourceFilter');
    expect(source).not.toContain('ClosedHistorySourceFilter');
    expect(source).not.toContain('closedHistorySource');
    expect(source).toContain("row.source === 'tradenet'");
    expect(source).toContain('const sourceLabel = row.source ===');
  });

  it('delays only the broker refresh indicator instead of combining unrelated background tasks', () => {
    const source = readSource();
    expect(source).toContain('useDelayedActivityVisibility(brokerTradesRefreshing, {');
    expect(source).toContain('showDelayMs: WORKSPACE_ACTIVITY_INDICATOR_SHOW_DELAY_MS');
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
    const attributions = new Map<FreedomExecutedTrade, ClosedTradeAttribution>([
      [first, {
        fundingType: 'cash', cashQuantity: 2, marginQuantity: 0,
        guestAllocations: [], guestMetrics: {}, averagePrice: 80,
        purchasedAt: Date.parse('2026-10-01T10:00:00.000Z'), unmatchedQuantity: 0
      }],
      [second, {
        fundingType: 'cash', cashQuantity: 3, marginQuantity: 0,
        guestAllocations: [], guestMetrics: {}, averagePrice: 90,
        purchasedAt: Date.parse('2026-10-02T10:00:00.000Z'), unmatchedQuantity: 0
      }]
    ]);
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
      grossProfit: 50,
      entryPrice: 86,
      exitPrice: 106,
      priceCurrency: 'USD',
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

  it('exposes stored app entry, exit and gross values without deriving missing values', () => {
    const rows = buildClosedHistoryRows({
      brokerTrades: [],
      brokerTradeMetrics: new Map(),
      trancheAttributions: new Map(),
      appTrades: [{
        trade: {
          id: 'app-sale', ticker: 'MSFT', shares: 4,
          avgBuyPrice: 100, sellPrice: 115, grossProfit: 60,
          exitDate: '2026-11-10T10:00:00.000Z', currency: 'USD'
        },
        source: 'app',
        allocationType: 'unclassified',
        guestAllocations: []
      }]
    });

    expect(rows[0]).toMatchObject({
      source: 'app',
      entryPrice: 100,
      exitPrice: 115,
      grossProfit: 60,
      priceCurrency: 'USD'
    });
  });

  it('keeps a known FIFO entry price when the execution exit price is unavailable', () => {
    const sell = createSellExecution('sell-without-price', 2, 100, '2026-11-10T10:00:00.000Z', {
      price: null,
      tradeValue: 0,
      profit: null
    });
    const rows = buildClosedHistoryRows({
      brokerTrades: [sell],
      brokerTradeMetrics: new Map(),
      trancheAttributions: new Map([[sell, {
        fundingType: 'cash',
        cashQuantity: 2,
        marginQuantity: 0,
        guestAllocations: [],
        guestMetrics: {},
        averagePrice: 80,
        purchasedAt: Date.parse('2026-10-01T10:00:00.000Z'),
        unmatchedQuantity: 0
      }]]),
      appTrades: []
    });

    expect(rows[0]).toMatchObject({
      entryPrice: 80,
      exitPrice: null,
      grossProfit: null
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
  };

  it('searches ticker case-insensitively and combines funding filters', () => {
    expect(filterClosedHistoryRows(rows, { ...filters, query: 'aAp' }, now).map((row) => row.trade.ticker))
      .toEqual(['AAPL']);
    expect(filterClosedHistoryRows(rows, { ...filters, funding: 'mix' }, now).map((row) => row.trade.ticker))
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

  it('keeps all sources in the same result set because provenance is not a filter', () => {
    expect(filterClosedHistoryRows(rows, filters, now).map((row) => row.trade.ticker))
      .toEqual(['AAPL', 'MSFT', 'TSLA', 'NVDA', 'ORCL']);
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


describe('Trades freshness, sorting and transparency UX', () => {
  it('shows provider-confirmed freshness and uses a waitable provider catch-up action', () => {
    const source = readSource();
    expect(source).toContain('getLastExecutedTradesRefreshAt(`admin:${accountId}`)');
    expect(source).toContain('broker:executed-trades-refresh-complete');
    expect(source).toContain('broker:request-executed-trades-and-wait');
    expect(source).toContain("translateText('Refresh history'");
    expect(source).toContain("translateText('Last REST history refresh'");
    expect(source).toContain("translateText('Cashflow reconciliation'");
  });
  it('adds sorting without changing filter-scoped summary calculations', () => {
    const source = readSource();
    expect(source).toContain("useState<ClosedHistorySortOrder>('newest')");
    expect(source).toContain('sortClosedHistoryRows(filteredTrades, sortOrder)');
    expect(source).toContain('summarizeClosedHistoryRows(filteredTrades)');
    expect(source).toContain('id="closedHistorySort"');
  });
  it('explains incomplete net P&L and lower-bound cost totals', () => {
    const source = readSource();
    expect(source).toContain('Unknown or incomplete trade results are excluded from the net P&L total and win rate.');
    expect(source).toContain('Known fees and commissions are a lower bound; missing commission inputs may increase actual costs.');
    expect(source).toContain('Upper bound: missing commission inputs; actual net P&L may be lower.');
    expect(source).toContain('Net P&L unavailable because required trade or cost-basis data is incomplete.');
  });
});
