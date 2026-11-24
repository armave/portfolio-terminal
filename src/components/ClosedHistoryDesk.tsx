import { logSafeDiagnostic } from '../services/safeDiagnostics';
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { usePortfolioSelector, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';
import { getAppLanguage, translateText } from '../services/i18n';
import { listUsers, type AuthUser } from '../services/api';
import { brokerAdapterRegistry } from '../services/brokerAdapters/registry';
import { loadSavedHistory } from '../services/storage';
import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations, resolveClosedTradeFeeBreakdown, resolveClosedTradeNetProfit } from '../domain/closedHistoryFees';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import { attributeClosedTradeExecutions } from '../domain/closedTradeAttribution';
import { resolveActiveTrancheMixInput } from '../domain/freedomPortfolio';
import { createFreedomMarginFeeAllocationInputKey } from '../domain/freedomMarginFees';
import { calculateBrokerExecutionMetrics } from '../domain/brokerExecutionMetrics';
import { DeskLoading } from './DeskLoading';
import { addBrokerEventListener, emitBrokerEvent, getLastExecutedTradesRefreshAt } from '../services/brokerEventBus';
import { TablePagination } from './TablePagination';
import { DeskPageHeader } from './DeskPageHeader';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import { brokerExecutionHistoryReducer, createBrokerExecutionHistoryState } from '../domain/brokerExecutionHistoryState';
import { getExecutionReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import type { PortfolioState } from '../types/portfolio';
import { buildClosedHistoryRows, filterClosedHistoryRows, sortClosedHistoryRows, summarizeClosedHistoryRows } from '../features/trades/closedHistoryRows';
import type {
  ClosedHistoryDateRange,
  ClosedHistoryFundingFilter,
  ClosedHistoryPerformanceFilter,
  ClosedHistorySortOrder
} from '../features/trades/closedHistoryRows';
import { useDelayedActivityVisibility, WORKSPACE_ACTIVITY_INDICATOR_SHOW_DELAY_MS } from '../ui/delayedActivityVisibility';
import { OperationActivityIndicator } from './OperationActivityIndicator';

const brokerAdapter = brokerAdapterRegistry.get('freedom-tradenet');
const normalizeBrokerExecutions = (value: unknown): FreedomExecutedTrade[] =>
  brokerAdapter.normalizeExecutions(value).data;

function selectTradesPortfolioState(state: PortfolioState) {
  return {
    brokerExecutedTrades: state.brokerExecutedTrades,
    positions: state.positions,
    cashCushion: state.cashCushion,
    brokerAccountInfo: state.brokerAccountInfo,
    cashflows: state.cashflows,
    transactionEvents: state.transactionEvents,
    closedTrades: state.closedTrades,
    activeTrancheTypes: state.activeTrancheTypes,
    activeTrancheMixes: state.activeTrancheMixes,
    activeTrancheGuestAssignments: state.activeTrancheGuestAssignments,
    activeTrancheGuestAssignmentDetails: state.activeTrancheGuestAssignmentDetails,
    closedTradeAllocations: state.closedTradeAllocations
  };
}

function areTradesPortfolioStatesEqual(
  previous: ReturnType<typeof selectTradesPortfolioState>,
  next: ReturnType<typeof selectTradesPortfolioState>
): boolean {
  return previous.brokerExecutedTrades === next.brokerExecutedTrades &&
    previous.positions === next.positions &&
    previous.cashCushion === next.cashCushion &&
    previous.brokerAccountInfo === next.brokerAccountInfo &&
    previous.cashflows === next.cashflows &&
    previous.transactionEvents === next.transactionEvents &&
    previous.closedTrades === next.closedTrades &&
    previous.activeTrancheTypes === next.activeTrancheTypes &&
    previous.activeTrancheMixes === next.activeTrancheMixes &&
    previous.activeTrancheGuestAssignments === next.activeTrancheGuestAssignments &&
    previous.activeTrancheGuestAssignmentDetails === next.activeTrancheGuestAssignmentDetails &&
    previous.closedTradeAllocations === next.closedTradeAllocations;
}

/** Restore the local execution snapshot synchronously before the first Trades render. */
function loadInitialBrokerExecutions(): FreedomExecutedTrade[] {
  const savedExecutions = normalizeBrokerExecutions(loadSavedHistory().brokerExecutedTrades);
  const currentExecutions = portfolioStore.getState().brokerExecutedTrades || [];
  return mergeBrokerExecutionHistory(
    savedExecutions,
    preservePersistedBrokerFeeAllocations(currentExecutions, savedExecutions)
  );
}


function getClosedTradeDate(trade: any): Date | null {
  const rawDate = trade?.exitDate || trade?.sellDate || trade?.closedAt || trade?.date;
  let closedDate: Date | null = null;
  if (typeof rawDate === 'number') closedDate = new Date(rawDate);
  else if (typeof rawDate === 'string') {
    const parsed = Date.parse(rawDate);
    if (!Number.isNaN(parsed)) closedDate = new Date(parsed);
  }
  return closedDate && !Number.isNaN(closedDate.getTime()) ? closedDate : null;
}

function getClosedTradeDurationDays(trade: any): number | null {
  const rawDuration = trade?.holdingDays ?? trade?.daysHeld;
  let durationDays = rawDuration == null ? null : Number(rawDuration);
  if (durationDays !== null && (!Number.isFinite(durationDays) || durationDays < 0)) durationDays = null;
  if (
    (durationDays === null || durationDays <= 0) &&
    (trade?.buyDate || trade?.purchaseDate) &&
    (trade?.sellDate || trade?.exitDate)
  ) {
    const buyTime = new Date(trade.buyDate || trade.purchaseDate).getTime();
    const sellTime = new Date(trade.sellDate || trade.exitDate).getTime();
    if (!Number.isNaN(buyTime) && !Number.isNaN(sellTime)) {
      durationDays = Math.max(0, (sellTime - buyTime) / 86_400_000);
    }
  }
  return durationDays;
}

function formatClosedTradeDuration(durationDays: number | null): string {
  if (durationDays === null) return '—';
  return durationDays < 1
    ? Math.round(durationDays * 24) + ' ' + translateText('hrs', getAppLanguage())
    : durationDays.toFixed(1) + ' ' + translateText('days', getAppLanguage());
}

function formatClosedTradeDate(date: Date | null): string {
  return date
    ? date.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit'
    })
    : translateText('Unknown', getAppLanguage());
}

function formatClosedTradePrice(value: unknown, currency: unknown): string {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '—';
  const formatted = numeric.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
  const currencyCode = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  return currencyCode ? `${formatted} ${currencyCode}` : formatted;
}

function ClosedTradeAllocationControls({
  row,
  rowIndex,
  guestUsers,
  guestNameById,
  savedAllocation,
  compact = false
}: {
  row: any;
  rowIndex: number;
  guestUsers: AuthUser[];
  guestNameById: Map<string, string>;
  savedAllocation?: any;
  compact?: boolean;
}) {
  const trade = row.trade || {};
  const allocationType = row.allocationType || 'margin';
  const assignedGuests: Array<{ guestId: string; quantity: number }> = row.guestAllocations || [];
  const allocationKey = String(row.allocationKey || ((row.source || 'trade') + ':' + String(trade.id || rowIndex)));
  const rowQuantity = Math.max(0, Number(trade.shares) || 0);
  const selectedGuestId = savedAllocation
    ? String(savedAllocation.guestId || '')
    : assignedGuests.length === 1 ? assignedGuests[0].guestId : '';
  const persistAllocation = (fundingType: 'cash' | 'margin' | 'mix', cashValue: number, guestId = selectedGuestId) => {
    const cashQuantity = fundingType === 'cash' ? rowQuantity
      : fundingType === 'margin' ? 0
        : Math.min(rowQuantity, Math.max(0, Number(cashValue) || 0));
    emitBrokerEvent('broker:set-closed-trade-allocation', {
      rowId: allocationKey,
      allocation: {
        fundingType,
        cashQuantity,
        marginQuantity: Math.max(0, rowQuantity - cashQuantity),
        guestId: fundingType === 'margin' ? '' : guestId
      }
    });
  };
  const updateMixCash = (value: string) => persistAllocation(
    'mix',
    resolveActiveTrancheMixInput(value, rowQuantity, row.cashQuantity)
  );
  const updateMixMargin = (value: string) => persistAllocation(
    'mix',
    rowQuantity - resolveActiveTrancheMixInput(value, rowQuantity, row.marginQuantity)
  );
  const ticker = String(trade.ticker || 'Trade');
  const buttonBase = compact
    ? 'inline-flex min-h-11 flex-1 items-center justify-center rounded px-2 py-1 text-[10px] font-bold'
    : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold';
  const groupClass = compact
    ? 'flex w-full rounded-md border border-slate-700 p-0.5'
    : 'inline-flex rounded-md border border-slate-700 p-0.5';

  return (
    <div class={`flex flex-col gap-1.5 ${compact ? 'items-stretch' : 'items-center'}`}>
      <div class={groupClass} role="group" aria-label={translateText('Funding type for trade', getAppLanguage()) + ' ' + ticker}>
        <button type="button" aria-pressed={allocationType === 'cash'} onClick={() => persistAllocation('cash', rowQuantity)} class={buttonBase + (allocationType === 'cash' ? ' bg-cyan-950 text-cyan-300' : ' text-slate-500 hover:text-slate-300')}>{translateText('Cash', getAppLanguage())}</button>
        <button type="button" aria-pressed={allocationType === 'margin'} onClick={() => persistAllocation('margin', 0, '')} class={buttonBase + (allocationType === 'margin' ? ' bg-amber-950 text-amber-300' : ' text-slate-500 hover:text-slate-300')}>{translateText('Margin', getAppLanguage())}</button>
        <button type="button" aria-pressed={allocationType === 'mix'} onClick={() => persistAllocation('mix', allocationType === 'cash' ? rowQuantity : row.cashQuantity)} class={buttonBase + (allocationType === 'mix' ? ' bg-violet-950 text-violet-300' : ' text-slate-500 hover:text-slate-300')}>{translateText('Mix', getAppLanguage())}</button>
      </div>
      {allocationType === 'mix' && (
        <div class={`flex items-center justify-center gap-2 rounded border border-slate-800 bg-slate-950/70 p-1.5 font-sans ${compact ? 'w-full flex-wrap' : ''}`}>
          <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-cyan-300">
            {translateText('Cash shares', getAppLanguage())}
            <input aria-label={ticker + ' ' + translateText('cash shares', getAppLanguage())} type="number" min="0" max={rowQuantity} step="any" value={row.cashQuantity} onBlur={(event) => updateMixCash((event.currentTarget as HTMLInputElement).value)} class="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100" />
          </label>
          <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-300">
            {translateText('Margin shares', getAppLanguage())}
            <input aria-label={ticker + ' ' + translateText('margin shares', getAppLanguage())} type="number" min="0" max={rowQuantity} step="any" value={row.marginQuantity} onBlur={(event) => updateMixMargin((event.currentTarget as HTMLInputElement).value)} class="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100" />
          </label>
        </div>
      )}
      {row.cashQuantity > 0 ? (
        <select aria-label={translateText('Guest for cash shares', getAppLanguage()) + ' ' + ticker} value={selectedGuestId} onChange={(event) => persistAllocation(allocationType, row.cashQuantity, (event.currentTarget as HTMLSelectElement).value)} class={`max-w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center text-[10px] text-slate-200 ${compact ? 'w-full' : 'max-w-[11rem]'}`}>
          <option value="">{translateText('Unassigned', getAppLanguage())}</option>
          {selectedGuestId && !guestUsers.some((user) => user.id === selectedGuestId) && <option value={selectedGuestId}>{translateText('Guest unavailable', getAppLanguage())}</option>}
          {guestUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      ) : <span class="text-[9px] text-slate-600">{translateText('No cash allocation', getAppLanguage())}</span>}
      {assignedGuests.length > 0 && !savedAllocation && assignedGuests.map((assignment) => (
        <span key={assignment.guestId} class="text-[9px] text-cyan-300">
          {guestNameById.get(assignment.guestId) || assignment.guestId.slice(0, 8)} · {Number(assignment.quantity).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 4 })}
        </span>
      ))}
    </div>
  );
}

export function ClosedHistoryDesk({ accountId, isSessionCurrent = () => true, isWorkspaceSyncReady }: { accountId: string; isSessionCurrent?: () => boolean; isWorkspaceSyncReady: boolean }) {
  const state = usePortfolioSelector(selectTradesPortfolioState, areTradesPortfolioStatesEqual);
  const [brokerExecutionHistory, dispatchBrokerExecutionHistory] = useReducer(
    brokerExecutionHistoryReducer<FreedomExecutedTrade>,
    undefined,
    () => createBrokerExecutionHistoryState(loadInitialBrokerExecutions(), [], true)
  );
  const brokerTrades = brokerExecutionHistory.trades;
  const brokerTradesLoading = brokerExecutionHistory.status === 'loading';
  const brokerTradesRefreshing = brokerExecutionHistory.status === 'refreshing';
  const brokerTradesError = brokerExecutionHistory.status === 'stale' ||
    brokerExecutionHistory.status === 'error';
  const [lastBrokerRefreshAt, setLastBrokerRefreshAt] = useState(
    () => getLastExecutedTradesRefreshAt(`admin:${accountId}`)
  );
  const [brokerReconciliationOpen, setBrokerReconciliationOpen] = useState(false);
  const [BrokerReconciliationView, setBrokerReconciliationView] = useState<
    typeof import('./BrokerTransactionReconciliation').BrokerTransactionReconciliation | null
  >(null);
  const openBrokerReconciliation = async () => {
    setBrokerReconciliationOpen(true);
    if (BrokerReconciliationView) return;
    void import('./BrokerTransactionReconciliation')
      .then(module => setBrokerReconciliationView(() => module.BrokerTransactionReconciliation))
      .catch(() => setBrokerReconciliationOpen(false));
  };
  const [cashflowSyncMessage, setCashflowSyncMessage] = useState('');
  const [cloudHistoryWarning, setCloudHistoryWarning] = useState('');
  const [cloudHistoryRetrying, setCloudHistoryRetrying] = useState(false);
  const [cashflowHistoryReady, setCashflowHistoryReady] = useState(false);
  const [cashflowSyncReady, setCashflowSyncReady] = useState(false);
  const [guestUsers, setGuestUsers] = useState<AuthUser[]>([]);
  const lastRecalculationKey = useRef('');
  const workspaceHydrated = useRef(false);
  const cashflowSyncStarted = useRef(false);
  const brokerRefreshSequence = useRef(0);
  const retryBrokerTrades = () => {
    const requestId = `trades-refresh-${++brokerRefreshSequence.current}`;
    dispatchBrokerExecutionHistory({ type: 'refresh', requestId });
    emitBrokerEvent('broker:request-executed-trades-and-wait', {
      priority: 'interactive',
      resolve: (succeeded) => {
        if (!isSessionCurrent()) return;
        if (succeeded) {
          const currentTrades = portfolioStore.getState().brokerExecutedTrades;
          dispatchBrokerExecutionHistory({
            type: 'success',
            requestId,
            trades: Array.isArray(currentTrades) ? currentTrades : brokerTrades
          });
        } else {
          dispatchBrokerExecutionHistory({ type: 'failure', requestId });
        }
      }
    });
  };
  useEffect(() => addBrokerEventListener('broker:executed-trades-refresh-complete', (refresh) => {
    if (refresh.source === 'rest' && refresh.sessionIdentity === `admin:${accountId}` && isSessionCurrent()) {
      setLastBrokerRefreshAt(refresh.completedAt);
    }
  }), [accountId]);
  useEffect(() => {
    let active = true;
    void listUsers().then((users) => {
      if (active && isSessionCurrent()) setGuestUsers(users.filter((user) => user.role === 'guest'));
    }).catch((error) => {
      logSafeDiagnostic('warn', 'closed-history', error);
    });
    return () => { active = false; };
  }, []);
  // The app-owned coordinator hydrates cloud history and persists its merge.
  // This desk becomes ready only after the initial workspace pull has settled.
  useEffect(() => {
    if (!isWorkspaceSyncReady || !isSessionCurrent()) return;
    workspaceHydrated.current = true;
    setCashflowHistoryReady(true);
  }, [isWorkspaceSyncReady]);

  useEffect(() => addBrokerEventListener('broker:closed-history-encryption-migration-failed', () => {
    if (!isSessionCurrent()) return;
    setCloudHistoryWarning(translateText(
      'Closed History encryption upgrade could not be verified. Your saved history is still available; retry the migration.',
      getAppLanguage()
    ));
    logSafeDiagnostic('warn', 'closed-history');
  }), [accountId]);

  // The key projects the exact facts consumed by the fee allocator. Quote-only
  // position updates therefore do not invalidate an in-flight or completed pass.
  const allocationBrokerExecutions = state.brokerExecutedTrades?.length
    ? state.brokerExecutedTrades
    : brokerTrades;
  const allocationInputKey = useMemo(
    () => createFreedomMarginFeeAllocationInputKey(
      state.cashflows || [],
      allocationBrokerExecutions,
      state.closedTrades || [],
      {
        trancheTypes: state.activeTrancheTypes || {},
        trancheMixes: state.activeTrancheMixes || {},
        openAppPositions: state.positions || {}
      }
    ),
    [
      state.cashflows,
      allocationBrokerExecutions,
      state.closedTrades,
      state.activeTrancheTypes,
      state.activeTrancheMixes,
      // Broker executions supersede open app positions as the fee allocator's
      // exposure source. Ignore quote-only position replacement in that case.
      allocationBrokerExecutions.length > 0 ? null : state.positions
    ]
  );

  const requestClosedHistorySync = (mode: 'refresh' | 'recalculate', forceRefresh = false): Promise<boolean> =>
    new Promise((resolve) => {
      emitBrokerEvent('broker:request-closed-history-sync-and-wait', { mode, forceRefresh, resolve });
    });

  const applyLatestCanonicalExecutions = () => {
    if (!isSessionCurrent()) return;
    const currentTrades = portfolioStore.getState().brokerExecutedTrades;
    if (Array.isArray(currentTrades)) {
      // Reconciliation can improve visible data without settling another
      // request's foreground status in the operation-owned reducer.
      dispatchBrokerExecutionHistory({ type: 'success', trades: currentTrades });
    }
  };

  const reportClosedHistorySync = (success: boolean) => {
    if (!isSessionCurrent()) return;
    applyLatestCanonicalExecutions();
    if (success) {
      lastRecalculationKey.current = allocationInputKey;
      setCashflowSyncMessage('');
    } else {
      cashflowSyncStarted.current = false;
      setCashflowSyncMessage(translateText(
        'Closed History synchronization failed. Check the activity log and retry.',
        getAppLanguage()
      ));
    }
    setCashflowSyncReady(true);
  };

  // Initial Trades hydration calls the same service used by the scheduler
  // and Manual Sync; no cashflow fetching or persistence remains in this desk.
  useEffect(() => {
    if (
      !isWorkspaceSyncReady ||
      !isSessionCurrent() ||
      !cashflowHistoryReady ||
      brokerTradesLoading ||
      brokerTradesRefreshing ||
      cashflowSyncStarted.current
    ) return;
    cashflowSyncStarted.current = true;
    let active = true;
    setCashflowSyncReady(false);
    void requestClosedHistorySync('refresh').then((success) => {
      if (active && isSessionCurrent()) reportClosedHistorySync(success);
    });
    return () => { active = false; };
  }, [isWorkspaceSyncReady, cashflowHistoryReady, brokerTradesLoading, brokerTradesRefreshing, brokerTrades]);

  // Allocation-input changes are recalculated by the same owner with cached
  // source cashflows, preserving the single write/revision-conflict boundary.
  useEffect(() => {
    if (!isWorkspaceSyncReady || !isSessionCurrent() || !cashflowHistoryReady || !cashflowSyncReady || brokerTradesLoading) return;
    const key = allocationInputKey;
    if (key === lastRecalculationKey.current) return;
    let active = true;
    void requestClosedHistorySync('recalculate').then((success) => {
      if (!active || !isSessionCurrent()) return;
      applyLatestCanonicalExecutions();
      if (success) {
        lastRecalculationKey.current = key;
      } else {
        cashflowSyncStarted.current = false;
        setCashflowSyncMessage(translateText(
          'Closed History synchronization failed. Check the activity log and retry.',
          getAppLanguage()
        ));
      }
    });
    return () => { active = false; };
  }, [isWorkspaceSyncReady, cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, allocationInputKey]);

  const retryCashflowSync = () => {
    if (!isWorkspaceSyncReady || !isSessionCurrent() || cashflowSyncStarted.current) return;
    cashflowSyncStarted.current = true;
    setCashflowSyncMessage('');
    setCashflowSyncReady(false);
    void requestClosedHistorySync('refresh').then(reportClosedHistorySync);
  };

  const retryCloudHistoryMigration = async () => {
    if (!isSessionCurrent() || cloudHistoryRetrying) return;
    setCloudHistoryRetrying(true);
    setCloudHistoryWarning('');
    try {
      const succeeded = await requestClosedHistorySync('refresh', true);
      if (!succeeded && isSessionCurrent()) {
        setCloudHistoryWarning(translateText(
          'Closed History refresh could not be confirmed. Your saved history is still available; check the activity log and retry.',
          getAppLanguage()
        ));
      }
    } finally {
      if (isSessionCurrent()) setCloudHistoryRetrying(false);
    }
  };

  useEffect(() => {
    const persistBrokerTrades = (trades: FreedomExecutedTrade[]) => {
      if (!isSessionCurrent()) return;
      const stored = portfolioStore.getState().brokerExecutedTrades || [];
      const storedById = new Map<string, FreedomExecutedTrade>(stored.map((trade) => [String(trade.id ?? ''), trade]));
      const normalizedRaw: FreedomExecutedTrade[] = trades.map((trade) => {
        const previous = storedById.get(String(trade.id ?? ''));
        // Keep only the fields needed for closed-history rendering and fee matching.
        // TradeNet's raw response can be large and must not be copied into synced state.
        return {
          id: String(trade?.id ?? ''),
          ticker: String(trade?.ticker ?? ''),
          side: String(trade?.side ?? ''),
          quantity: trade?.quantity ?? null,
          price: trade?.price ?? null,
          currency: String(trade?.currency ?? ''),
          executedAt: trade?.executedAt ?? null,
          tradeValue: trade?.tradeValue ?? null,
          profit: trade?.profit ?? null,
          marginFee: previous?.marginFee ?? trade?.marginFee ?? null,
          commission: trade?.commission ?? null,
          commissionCurrency: String(trade?.commissionCurrency ?? ''),
          marginFeeAllocations: previous?.marginFeeAllocations ?? trade?.marginFeeAllocations,
          openMarginFeeAllocations: previous?.openMarginFeeAllocations ?? trade?.openMarginFeeAllocations,
          openMarginFee: previous?.openMarginFee ?? trade?.openMarginFee,
          feesAndCommissions: previous?.feesAndCommissions ?? trade?.feesAndCommissions,
          netProfit: previous?.netProfit ?? trade?.netProfit,
          raw: {}
        };
      });
      // In-memory rows can contain explicit empty allocation objects from a
      // pre-reconciliation broker response. Restore real saved allocations by ID
      // before writing these rows into the canonical store.
      const savedFeeRows = normalizeBrokerExecutions(loadSavedHistory().brokerExecutedTrades);
      const normalizedPage = preservePersistedBrokerFeeAllocations(
        normalizedRaw,
        [...savedFeeRows, ...stored]
      );
      // The API may return only the requested date range. Retain the complete
      // pre-refresh cache, including opening buys needed for FIFO matching.
      const normalized = mergeBrokerExecutionHistory([...savedFeeRows, ...stored, ...brokerTrades], normalizedPage);
      dispatchBrokerExecutionHistory({ type: 'success', trades: normalized });
      // Persist the normalized source rows in canonical state so they survive
      // refresh and can be reapplied after broker history has hydrated.
      const current = portfolioStore.getState().brokerExecutedTrades || [];
      // Compare the complete normalized execution history, not a subset of
      // display fields. Incoming closed-trade metadata must sync just like cashflows.
      const fingerprint = (rows: FreedomExecutedTrade[]) => JSON.stringify(rows);
      if (fingerprint(current) !== fingerprint(normalized)) {
        portfolioStore.setState({ brokerExecutedTrades: normalized.map((trade) => ({ ...trade })) });
        // Sync only when the authoritative broker history actually changes and
        // the authenticated workspace is ready. The shared owner pulls and merges
        // cloud history before persisting this broker update.
        if (workspaceHydrated.current) {
          // Broker-history changes are checkpointed by the shared owner too.
          void requestClosedHistorySync('refresh').then((success) => {
            if (!success && isSessionCurrent()) logSafeDiagnostic('warn', 'closed-history');
            applyLatestCanonicalExecutions();
          });
        }
      }
    };
    const readCurrentTrades = () => {
      const current = portfolioStore.getState().brokerExecutedTrades;
      if (Array.isArray(current) && current.length) {
        persistBrokerTrades(current);
        return;
      }
      const saved = loadSavedHistory().brokerExecutedTrades;
      if (Array.isArray(saved) && saved.length) persistBrokerTrades(normalizeBrokerExecutions(saved));
    };
    readCurrentTrades();
    // Trades requests a refresh on mount; the canonical cache remains in portfolioStore.
    const removeTradesListener = addBrokerEventListener('broker:executed-trades', (trades) => {
      persistBrokerTrades(trades);
    });
    const removeErrorListener = addBrokerEventListener('broker:executed-trades-error', () => {
      dispatchBrokerExecutionHistory({ type: 'failure' });
    });
    // A cache-backed desk is already ready. Run the mount catch-up quietly;
    // only the explicit Refresh history action should turn on the header spinner.
    // With no cached rows the initial loading state remains visible until this read settles.
    emitBrokerEvent('broker:request-executed-trades', { priority: 'interactive' });
    return () => {
      removeTradesListener();
      removeErrorListener();
    };
  }, []);
  const appTrades = useMemo(() => (state.closedTrades || []).map((trade, index) => {
    const feeBreakdown = resolveClosedTradeFeeBreakdown(trade);
    const profit = resolveClosedTradeNetProfit(trade, feeBreakdown);
    return {
      trade: { ...trade, source: 'app' as const }, index, source: 'app' as const,
      allocationKey: 'app:' + String(trade.id || `${String(trade.ticker || 'trade')}:${String(trade.closedAt ?? trade.exitDate ?? trade.date ?? index)}`),
      profit,
      commissionsComplete: feeBreakdown.commissionsKnown,
      allocationType: 'unclassified' as const,
      allocationTypes: ['unclassified' as const],
      guestAllocations: [] as Array<{ guestId: string; quantity: number }>,
      ...feeBreakdown
    };
  }), [state.closedTrades]);
  const brokerTradeMetrics = useMemo(
    () => calculateBrokerExecutionMetrics(brokerTrades),
    [brokerTrades]
  );
  const trancheAttributions = useMemo(() => attributeClosedTradeExecutions(brokerTrades, {
    trancheTypes: state.activeTrancheTypes,
    trancheMixes: state.activeTrancheMixes,
    guestAssignments: state.activeTrancheGuestAssignments,
    guestAssignmentDetails: state.activeTrancheGuestAssignmentDetails
  }), [
    brokerTrades,
    state.activeTrancheTypes,
    state.activeTrancheMixes,
    state.activeTrancheGuestAssignments,
    state.activeTrancheGuestAssignmentDetails
  ]);
  const guestNameById = useMemo(
    () => new Map(guestUsers.map((user) => [user.id, user.name])),
    [guestUsers]
  );
  const trades = useMemo(
    () => buildClosedHistoryRows({
      brokerTrades,
      brokerTradeMetrics,
      trancheAttributions,
      appTrades,
      closedTradeAllocations: state.closedTradeAllocations
    }),
    [brokerTrades, brokerTradeMetrics, trancheAttributions, appTrades, state.closedTradeAllocations]
  );
  const [tradeSearchQuery, setTradeSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<ClosedHistoryDateRange>('all');
  const [performanceFilter, setPerformanceFilter] = useState<ClosedHistoryPerformanceFilter>('all');
  const [fundingFilter, setFundingFilter] = useState<ClosedHistoryFundingFilter>('all');
  const filteredTrades = useMemo(
    () => filterClosedHistoryRows(trades, {
      query: tradeSearchQuery,
      dateRange,
      performance: performanceFilter,
      funding: fundingFilter
    }),
    [trades, tradeSearchQuery, dateRange, performanceFilter, fundingFilter]
  );
  const [sortOrder, setSortOrder] = useState<ClosedHistorySortOrder>('newest');
  const sortedTrades = useMemo(() => sortClosedHistoryRows(filteredTrades, sortOrder), [filteredTrades, sortOrder]);
  const pagination = useTablePagination('closed-history', sortedTrades.length, 10);
  const visibleTrades = sliceTablePage(sortedTrades, pagination.currentPage, pagination.pageSize);
  const tradeSummary = useMemo(
    () => summarizeClosedHistoryRows(filteredTrades),
    [filteredTrades]
  );
  const hasActiveTradeFilters = Boolean(
    tradeSearchQuery.trim() || dateRange !== 'all' || performanceFilter !== 'all' ||
    fundingFilter !== 'all'
  );
  const clearTradeFilters = () => {
    setTradeSearchQuery('');
    setDateRange('all');
    setPerformanceFilter('all');
    setFundingFilter('all');
    pagination.setPage(1);
  };
  const {
    realizedNet,
    totalFees,
    hasIncompleteCommissions,
    hasUnknownProfit,
    knownProfitCount,
    winningTrades,
    averageHoldingDays,
    winRate
  } = tradeSummary;
  // Only broker execution refreshes animate the header. Cloud-history hydration,
  // cashflow reconciliation and local fee calculation remain independent work.
  const showBrokerRefreshIndicator = useDelayedActivityVisibility(brokerTradesRefreshing, {
    showDelayMs: WORKSPACE_ACTIVITY_INDICATOR_SHOW_DELAY_MS,
    minimumVisibleMs: 650
  });
  const locale = getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
  const lastBrokerRefreshText = lastBrokerRefreshAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastBrokerRefreshAt))
    : translateText('No provider refresh confirmed yet', getAppLanguage());
  const brokerHistoryStatus = brokerTradesError ? 'Stale' : lastBrokerRefreshAt ? 'Updated' : brokerTrades.length > 0 ? 'Cached' : 'Not loaded';
  const cashflowStatus = cashflowSyncMessage ? 'Needs attention' : cashflowHistoryReady && cashflowSyncReady ? 'Complete' : 'Pending';

  // Only block the desk when there is nothing cached or app-owned to display.
  // Cloud reconciliation and fee refreshes continue independently in the background.
  if (brokerTradesLoading && brokerTrades.length === 0 && appTrades.length === 0) {
    return <DeskLoading
      title="Preparing trades"
      message="Restoring saved trade history and loading the latest Freedom activity…"
      accent="purple"
    />;
  }

  return (
    <section class="desk-page-content min-w-0 space-y-4" aria-label={translateText('Trades', getAppLanguage())}>
      <DeskPageHeader
        title={translateText('Trades', getAppLanguage())}
        description={translateText('Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.', getAppLanguage())}
        trailing={(
          <div class="flex min-w-0 flex-col items-center gap-2 text-xs sm:items-end">
            <div class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center sm:justify-end sm:text-right">
              <span class="inline-flex items-center gap-1.5">
                <span class="text-slate-400">{translateText('TradeNet history', getAppLanguage())}</span>
                <span class={brokerTradesError ? 'rounded border border-amber-700/70 px-1.5 py-0.5 font-semibold text-amber-200' : lastBrokerRefreshAt ? 'rounded border border-emerald-800/70 px-1.5 py-0.5 font-semibold text-emerald-300' : 'rounded border border-slate-700 px-1.5 py-0.5 font-semibold text-slate-300'}>{translateText(brokerHistoryStatus, getAppLanguage())}</span>
              </span>
              <span class="text-slate-400">{lastBrokerRefreshAt ? `${translateText('Last REST history refresh', getAppLanguage())}: ${lastBrokerRefreshText}` : lastBrokerRefreshText}</span>
              <span class="text-slate-400">{translateText('Cashflow reconciliation', getAppLanguage())}: {translateText(cashflowStatus, getAppLanguage())}</span>
<OperationActivityIndicator
                visible={showBrokerRefreshIndicator}
                label={translateText('Refreshing history…', getAppLanguage())}
                ariaLabel={translateText('Refreshing TradeNet execution history…', getAppLanguage())}
                tone="purple"
                size="inline"
              />
            </div>
            <button type="button" onClick={retryBrokerTrades} disabled={brokerTradesRefreshing}
              class="inline-flex min-h-10 items-center justify-center gap-2 rounded border border-slate-700 px-3 font-semibold text-slate-200 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={translateText('Refresh history', getAppLanguage())}>{translateText('Refresh history', getAppLanguage())}</button>
          </div>
        )}
      />

      <div class="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2">
        <button
          type="button"
          class="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
          aria-expanded={brokerReconciliationOpen}
          onClick={() => brokerReconciliationOpen
            ? setBrokerReconciliationOpen(false)
            : void openBrokerReconciliation()}
        >
          <span>{getAppLanguage() === 'ru' ? 'Сверить активность брокера' : 'Reconcile broker activity'}</span>
          <span class="text-xs text-slate-400">
            {getAppLanguage() === 'ru' ? (brokerReconciliationOpen ? 'Скрыть сверку' : 'Открыть сверку') : (brokerReconciliationOpen ? 'Hide reconciliation' : 'Open reconciliation')}
          </span>
        </button>
        {brokerReconciliationOpen && BrokerReconciliationView && (
          <div class="mt-3">
            <BrokerReconciliationView
              executions={brokerTrades}
              cashflows={(state.cashflows || []).map(row => ({ ...row, raw: row.raw || {} }))}
              appEvents={state.transactionEvents || []}
              executionStatus={getExecutionReconciliationFeedStatus(brokerExecutionHistory.status)}
              cashflowStatus={cashflowHistoryReady && cashflowSyncReady ? 'complete' : 'partial'}
              appHistoryStatus="partial"
              legacyClosedTrades={state.closedTrades || []}
              positions={state.positions || {}}
              cashHoldings={state.cashCushion?.holdings || []}
              onRecordReview={(section, findingId, findingType, subject, reason) =>
                isSessionCurrent() &&
                portfolioStore.recordReconciliationReview(section, findingId, findingType, subject, reason)
              }
              appQuotes={[
                ...Object.values(state.positions || {}).map(position => ({
                  ticker: position.ticker,
                  price: position.currentPrice,
                  quoteSource: position.quoteSource,
                  quoteUpdatedAt: position.quoteUpdatedAt,
                  quoteDetails: position.quoteDetails
                })),
                ...(state.cashCushion?.holdings || []).map(holding => ({
                  ticker: holding.ticker,
                  price: holding.currentPrice,
                  quoteSource: holding.quoteSource,
                  quoteUpdatedAt: holding.quoteUpdatedAt,
                  quoteDetails: holding.quoteDetails
                }))
              ]}
              brokerQuoteSnapshot={state.brokerAccountInfo ? {
                loaded: state.brokerAccountInfo.loaded,
                positions: state.brokerAccountInfo.positions || [],
                provider: state.brokerAccountInfo.provider,
                source: state.brokerAccountInfo.source,
                quality: state.brokerAccountInfo.quality ?? state.brokerAccountInfo.snapshotQuality ?? 'unknown',
                status: state.brokerAccountInfo.status,
                observedAt: state.brokerAccountInfo.observedAt,
                receivedAt: state.brokerAccountInfo.receivedAt,
                warnings: state.brokerAccountInfo.warnings || []
              } : null}
            />
          </div>
        )}
      </div>

      {cloudHistoryWarning && (
        <div role="alert" class="flex flex-col gap-2 rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{cloudHistoryWarning}</span>
          <button type="button" onClick={() => void retryCloudHistoryMigration()} disabled={cloudHistoryRetrying} class="self-start rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto">
            {cloudHistoryRetrying ? translateText('Migrating…', getAppLanguage()) : translateText('Retry encryption migration', getAppLanguage())}
          </button>
        </div>
      )}

      {cashflowSyncMessage && (
        <div role="alert" class="flex flex-col gap-2 rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{cashflowSyncMessage}</span>
          <button type="button" onClick={retryCashflowSync} disabled={cashflowSyncStarted.current} class="self-start rounded border border-rose-700/70 px-2.5 py-1.5 font-semibold text-rose-100 transition hover:bg-rose-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto">
            {cashflowSyncStarted.current ? translateText('Retrying…') : translateText('Retry cashflow sync')}
          </button>
        </div>
      )}

      {brokerTradesError && trades.length > 0 && (
        <div role="alert" class="flex flex-col gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{translateText('TradeNet refresh failed. Showing saved history, which may be out of date.', getAppLanguage())}</span>
          <button
            type="button"
            onClick={retryBrokerTrades}
            disabled={brokerTradesRefreshing}
            aria-label={translateText('Retry TradeNet history', getAppLanguage())}
            class="self-start rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
          >{translateText('Retry', getAppLanguage())}</button>
        </div>
      )}

      <section class="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-3" aria-label={translateText('Trade history filters', getAppLanguage())}>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Search ticker', getAppLanguage())}
            <input id="closedHistorySearch" type="search" value={tradeSearchQuery} onInput={(event) => { setTradeSearchQuery((event.currentTarget as HTMLInputElement).value); pagination.setPage(1); }} placeholder={translateText('Search ticker or symbol', getAppLanguage())} class="min-h-10 w-full rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400" />
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Date range', getAppLanguage())}
            <select id="closedHistoryDateRange" value={dateRange} onChange={(event) => { setDateRange((event.currentTarget as HTMLSelectElement).value as ClosedHistoryDateRange); pagination.setPage(1); }} class="min-h-10 w-full rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
              <option value="all">{translateText('All time', getAppLanguage())}</option>
              <option value="7d">{translateText('Last 7 days', getAppLanguage())}</option>
              <option value="30d">{translateText('Last 30 days', getAppLanguage())}</option>
              <option value="90d">{translateText('Last 90 days', getAppLanguage())}</option>
              <option value="year">{translateText('This year', getAppLanguage())}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Performance', getAppLanguage())}
            <select id="closedHistoryPerformance" value={performanceFilter} onChange={(event) => { setPerformanceFilter((event.currentTarget as HTMLSelectElement).value as ClosedHistoryPerformanceFilter); pagination.setPage(1); }} class="min-h-10 w-full rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
              <option value="all">{translateText('All performance', getAppLanguage())}</option>
              <option value="profitable">{translateText('Profitable', getAppLanguage())}</option>
              <option value="losing">{translateText('Losing', getAppLanguage())}</option>
              <option value="breakeven">{translateText('Breakeven', getAppLanguage())}</option>
              <option value="unknown">{translateText('Unknown P&L', getAppLanguage())}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Funding', getAppLanguage())}
            <select id="closedHistoryFunding" value={fundingFilter} onChange={(event) => { setFundingFilter((event.currentTarget as HTMLSelectElement).value as ClosedHistoryFundingFilter); pagination.setPage(1); }} class="min-h-10 w-full rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
              <option value="all">{translateText('All funding', getAppLanguage())}</option>
              <option value="cash">{translateText('Cash', getAppLanguage())}</option>
              <option value="margin">{translateText('Margin', getAppLanguage())}</option>
              <option value="mix">{translateText('Mix', getAppLanguage())}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Sort by', getAppLanguage())}
            <select id="closedHistorySort" value={sortOrder} onChange={(event) => { setSortOrder((event.currentTarget as HTMLSelectElement).value as ClosedHistorySortOrder); pagination.setPage(1); }} class="min-h-10 w-full rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
              <option value="newest">{translateText('Newest first', getAppLanguage())}</option>
              <option value="oldest">{translateText('Oldest first', getAppLanguage())}</option>
              <option value="profit-high">{translateText('Highest net P&L', getAppLanguage())}</option>
              <option value="profit-low">{translateText('Lowest net P&L', getAppLanguage())}</option>
              <option value="largest">{translateText('Largest position', getAppLanguage())}</option>
            </select>
          </label>
        </div>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <p class="text-slate-400">{translateText('Summary reflects current filters', getAppLanguage())}</p>
          <div class="flex items-center gap-3">
            <span class="font-mono tabular-nums text-slate-300">{filteredTrades.length} / {trades.length} {translateText('records', getAppLanguage())}</span>
            {hasActiveTradeFilters && (
              <button type="button" onClick={clearTradeFilters} class="min-h-9 rounded border border-slate-700 px-3 font-semibold text-slate-300 transition hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
                {translateText('Clear filters', getAppLanguage())}
              </button>
            )}
          </div>
        </div>
      </section>

      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4 text-center" aria-label={translateText('Closed trade performance summary', getAppLanguage())}>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{translateText(hasUnknownProfit ? 'Known net P&L' : 'Realized net P&L', getAppLanguage())}</div>
          <div class={`mt-1 font-mono text-lg font-bold ${realizedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {knownProfitCount === 0 ? '—' : (realizedNet >= 0 ? '+' : '−') + formatUSD(Math.abs(realizedNet))}
          </div>
          {hasUnknownProfit && <p class="mt-1 text-[10px] leading-relaxed text-slate-500">{translateText('Unknown or incomplete trade results are excluded from the net P&L total and win rate.', getAppLanguage())}</p>}
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{translateText('Win rate', getAppLanguage())}</div>
          <div class="mt-1 font-mono text-lg font-bold text-white">{knownProfitCount === 0 ? '—' : winRate.toFixed(1) + '%'}</div>
          <div class="text-[10px] text-slate-500">{translateText(`${winningTrades} of ${knownProfitCount} records with known profit profitable`, getAppLanguage())}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{translateText('Fees & commissions', getAppLanguage())}</div>
          <div class="mt-1 font-mono text-lg font-bold text-slate-200">{hasIncompleteCommissions ? '≥' : ''}{formatUSD(totalFees)}</div>
          {hasIncompleteCommissions && <p class="mt-1 text-[10px] leading-relaxed text-slate-500">{translateText('Known fees and commissions are a lower bound; missing commission inputs may increase actual costs.', getAppLanguage())}</p>}
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{translateText('Avg. holding time', getAppLanguage())}</div>
          <div class="mt-1 font-mono text-lg font-bold text-slate-200">{averageHoldingDays === null ? '—' : averageHoldingDays.toFixed(1) + ' days'}</div>
        </div>
      </div>
      

      <div key={pagination.currentPage} id="closedTradesHistory" class="closed-history-page-transition grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={translateText('Closed trade history', getAppLanguage())}>
        {visibleTrades.length === 0 ? (
          <p role="status" class="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-8 text-center text-sm text-slate-500">
            {trades.length > 0 ? translateText('No trades match the current filters', getAppLanguage()) : translateText('No closed trades recorded yet.', getAppLanguage())}
          </p>
        ) : visibleTrades.map((row, rowIndex) => {
          const trade = row.trade as any;
          const closedDate = getClosedTradeDate(trade);
          const durationDays = getClosedTradeDurationDays(trade);
          const profit = typeof row.profit === 'number' && Number.isFinite(row.profit) ? row.profit : null;
          const profitText = profit === null
            ? '—'
            : (row.profitIsUpperBound === true ? '≤ ' : '') + (profit >= 0 ? '+' : '−') + formatUSD(Math.abs(profit));
          const profitTone = profit === null || row.profitIsUpperBound === true
            ? 'text-amber-300'
            : profit >= 0 ? 'text-emerald-400' : 'text-rose-400';
          const grossProfit = typeof row.grossProfit === 'number' && Number.isFinite(row.grossProfit)
            ? row.grossProfit
            : null;
          const allocationKey = String(row.allocationKey || ((row.source || 'trade') + ':' + String(trade.id || rowIndex)));
          const sourceLabel = row.source === 'tradenet' ? 'TradeNet' : translateText('App records', getAppLanguage());
          return (
            <article key={allocationKey} class="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h2 class="font-semibold text-white">{String(trade.ticker || '—').replace('.US', '')}</h2>
                  <p class="mt-0.5 text-[10px] text-slate-500">{formatClosedTradeDate(closedDate)} · {sourceLabel}</p>
                  {closedDate && <p class="mt-0.5 text-[10px] text-slate-500">{formatRelativeTime(closedDate)}</p>}
                </div>
                <div class="shrink-0 text-right">
                  <p class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Net P&L', getAppLanguage())}</p>
                  <p class={`mt-0.5 font-mono text-base font-bold tabular-nums ${profitTone}`}>{profitText}</p>
                   {row.profitIsUpperBound === true
                     ? <p class="mt-1 max-w-56 text-[10px] leading-relaxed text-amber-300">{translateText('Upper bound: missing commission inputs; actual net P&L may be lower.', getAppLanguage())}</p>
                     : profit === null
                       ? <p class="mt-1 max-w-56 text-[10px] leading-relaxed text-slate-500">{translateText('Net P&L unavailable because required trade or cost-basis data is incomplete.', getAppLanguage())}</p>
                       : null}
                </div>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3 text-xs">
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Shares', getAppLanguage())}</p><p class="mt-0.5 font-mono text-slate-200">{trade.shares ?? '—'}</p></div>
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Duration', getAppLanguage())}</p><p class="mt-0.5 font-mono text-slate-200">{formatClosedTradeDuration(durationDays)}</p></div>
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Avg. entry', getAppLanguage())}</p><p class="mt-0.5 font-mono text-slate-200">{formatClosedTradePrice(row.entryPrice, row.priceCurrency)}</p></div>
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Avg. exit', getAppLanguage())}</p><p class="mt-0.5 font-mono text-slate-200">{formatClosedTradePrice(row.exitPrice, row.priceCurrency)}</p></div>
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Gross P&L', getAppLanguage())}</p><p class={grossProfit === null ? 'mt-0.5 font-mono text-slate-500' : grossProfit >= 0 ? 'mt-0.5 font-mono text-emerald-400' : 'mt-0.5 font-mono text-rose-400'}>{grossProfit === null ? '—' : (grossProfit >= 0 ? '+' : '−') + formatUSD(Math.abs(grossProfit))}</p></div>
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Fees', getAppLanguage())}</p><p class="mt-0.5 font-mono text-slate-200">{formatUSD(Number(row.fees ?? 0))}</p></div>
                <div><p class="text-[9px] uppercase tracking-wide text-slate-500">{translateText('Commissions', getAppLanguage())}</p><p class="mt-0.5 font-mono text-slate-200">{row.commissionsComplete === false ? '≥' : ''}{formatUSD(Number(row.commissions ?? 0))}</p></div>
              </div>
              <details class="mt-3 border-t border-slate-800 pt-2">
                <summary class="cursor-pointer list-none text-xs font-semibold text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400">
                  {translateText('Funding and guest allocation', getAppLanguage())}
                </summary>
                <div class="mt-2">
                  <ClosedTradeAllocationControls
                    row={row}
                    rowIndex={rowIndex}
                    guestUsers={guestUsers}
                    guestNameById={guestNameById}
                    savedAllocation={state.closedTradeAllocations?.[allocationKey]}
                    compact
                  />
                </div>
              </details>
            </article>
          );
        })}
      </div>

      <TablePagination
        tableLabel={translateText('Closed trade history', getAppLanguage())}
        page={pagination.currentPage}
        pageCount={pagination.pageCount}
        pageSize={pagination.pageSize}
        start={pagination.start}
        end={pagination.end}
        total={filteredTrades.length}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        className="closed-history-pagination pt-2"
        controlsClassName="closed-history-pagination-controls"
        controlsId="closedTradesHistory"
      />
    </section>
  );
}
