import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(new URL('./ClosedHistoryDesk.tsx', import.meta.url), 'utf8');
}

describe('Trades cache-first rendering', () => {
  it('hydrates saved executions synchronously before the first component effect', () => {
    const source = readSource();
    expect(source).toContain('function loadInitialBrokerExecutions(): FreedomExecutedTrade[]');
    expect(source).toContain('normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades)');
    expect(source).toContain('createBrokerExecutionHistoryState(loadInitialBrokerExecutions(), [], true)');
  });

  it('keeps the current snapshot available while a background refresh is running or fails', () => {
    const source = readSource();
    expect(source).toContain("dispatchBrokerExecutionHistory({ type: 'refresh' });");
    expect(source).toContain("dispatchBrokerExecutionHistory({ type: 'failure' });");
    expect(source).toContain("brokerExecutionHistory.status === 'refreshing'");
    expect(source).toContain("brokerExecutionHistory.status === 'stale'");
  });

  it('keeps the cashflow cursor anchored to the cached table before trades refresh', () => {
    const source = readSource();
    expect(source).toContain('const cashflowSyncStartDate = useRef(');
    expect(source).toContain('getLatestClosedTradeDate(brokerExecutionHistory.trades, state.closedTrades || [])');
    expect(source).toContain('fetchFreedomCashflows(cashflowSyncStartDate.current)');
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
