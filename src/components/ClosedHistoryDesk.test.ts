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

  it('subscribes only to state used by Trades and memoizes derived history rows', () => {
    const source = readSource();
    expect(source).toContain('usePortfolioSelector(selectTradesPortfolioState, areTradesPortfolioStatesEqual)');
    expect(source).not.toContain('usePortfolio()');
    expect(source).toContain('const trades = useMemo(');
    expect(source).toContain('buildClosedHistoryRows({');
    expect(source).toContain('summarizeClosedHistoryRows(trades)');
    const model = readFileSync(new URL('../features/trades/closedHistoryRows.ts', import.meta.url), 'utf8');
    expect(model).toContain('time - previousTime <= 60 * 60 * 1000');
    expect(model).toContain('deduplicateClosedHistoryRows(appTrades, groupedBrokerRows)');
    expect(model).toContain('resolveClosedTradeAllocation(');
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
    expect(source).toContain('if (!cashflowHistoryReady || brokerTradesLoading || brokerTradesRefreshing) return;');
    expect(source).toContain('getLatestClosedTradeCheckpoint(brokerTrades, state.closedTrades || []) || \'no-trades\'');
    expect(source).toContain('getFreedomCashflowTradeCheckpoint(accountId)');
    expect(source).toContain('if (hasCompleteBaseline && previousTradeCheckpoint === latestTradeCheckpoint)');
    expect(source).toContain('markFreedomCashflowTradeCheckpoint(accountId, latestTradeCheckpoint)');
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
        'broker:sell-1+sell-2': { fundingType: 'cash', cashQuantity: 5, marginQuantity: 0 }
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
      allocationKey: 'broker:sell-1+sell-2'
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
        trade: { id: 'duplicate-app', ticker: 'AAPL', shares: 5, exitDate: '2026-11-10T10:30:00.000Z' },
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
