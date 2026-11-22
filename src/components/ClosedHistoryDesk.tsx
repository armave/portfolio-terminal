import { logSafeDiagnostic } from '../services/safeDiagnostics';
import { useEffect, useMemo, useReducer, useRef, useState } from 'preact/hooks';
import { usePortfolioSelector, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';
import { getAppLanguage, translateText } from '../services/i18n';
import { listUsers, pullCloudHistory, pushCloudHistory, type AuthUser } from '../services/api';
import { brokerAdapterRegistry } from '../services/brokerAdapters/registry';
import {
  hasFreedomCashflowHistoryBaseline,
  getFreedomCashflowTradeCheckpoint,
  loadSavedHistory,
  markFreedomCashflowHistoryBaseline,
  markFreedomCashflowTradeCheckpoint,
  savePortfolioSnapshot
} from '../services/storage';
import { aggregateOpenBrokerMarginFeeAllocationsByTicker, applyCashflowAllocationsToBrokerExecutions, applyCashflowAllocationsToClosedTrades, applyCashflowAllocationsToMarginPositions, mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations, resolveClosedTradeFeeBreakdown, resolveClosedTradeNetProfit } from '../domain/closedHistoryFees';
import { mergeFreedomCashflowRows, normalizeSavedFreedomCashflows, type NormalizedFreedomCashflow } from '../domain/freedomCashflows';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import { attributeClosedTradeExecutions } from '../domain/closedTradeAttribution';
import { resolveActiveTrancheMixInput } from '../domain/freedomPortfolio';
import { calculateFreedomMarginFeeAllocations, createFreedomMarginFeeAllocationInputKey } from '../domain/freedomMarginFees';
import { buildClosedHistoryFeeAuditUpdate } from '../domain/closedHistoryFeeAudit';
import { calculateBrokerExecutionMetrics } from '../domain/brokerExecutionMetrics';
import { DeskLoading } from './DeskLoading';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';
import { TablePagination } from './TablePagination';
import { DeskPageHeader } from './DeskPageHeader';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import { brokerExecutionHistoryReducer, createBrokerExecutionHistoryState } from '../domain/brokerExecutionHistoryState';
import { getLatestClosedTradeCheckpoint, getLatestClosedTradeDate } from '../domain/tradeHistorySync';
import { getExecutionReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import type { PortfolioState } from '../types/portfolio';
import { buildClosedHistoryRows, filterClosedHistoryRows, summarizeClosedHistoryRows } from '../features/trades/closedHistoryRows';
import type {
  ClosedHistoryDateRange,
  ClosedHistoryFundingFilter,
  ClosedHistoryPerformanceFilter
} from '../features/trades/closedHistoryRows';
import { useDelayedActivityVisibility } from '../ui/delayedActivityVisibility';

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
  // Seed the cursor from cached history for immediate rendering. Before a
  // cashflow request, it is recalculated from the completed broker refresh so
  // newly discovered sales are included in the incremental date range.
  const cashflowSyncStartDate = useRef(
    getLatestClosedTradeDate(brokerExecutionHistory.trades, state.closedTrades || [])
  );
  const [cashflowSyncMessage, setCashflowSyncMessage] = useState('');
  const [cloudHistoryWarning, setCloudHistoryWarning] = useState('');
  const [cloudHistoryRetrying, setCloudHistoryRetrying] = useState(false);
  const [cashflowHistoryReady, setCashflowHistoryReady] = useState(false);
  const [cashflowSyncReady, setCashflowSyncReady] = useState(false);
  const [guestUsers, setGuestUsers] = useState<AuthUser[]>([]);
  const lastRecalculationKey = useRef('');
  const historyHydrated = useRef(false);
  const cashflowSyncStarted = useRef(false);
  const latestBrokerFetch = useRef<FreedomExecutedTrade[] | null>(null);
  const retryBrokerTrades = () => {
    dispatchBrokerExecutionHistory({ type: 'refresh' });
    emitBrokerEvent('broker:request-executed-trades', { priority: 'interactive' });
  };
  useEffect(() => {
    let active = true;
    void listUsers().then((users) => {
      if (active && isSessionCurrent()) setGuestUsers(users.filter((user) => user.role === 'guest'));
    }).catch((error) => {
      logSafeDiagnostic('warn', 'closed-history', error);
    });
    return () => { active = false; };
  }, []);
  // Load cloud history once. An existing cloud history record is authoritative;
  // local history is used only when no cloud record exists.
  useEffect(() => {
    let active = true;
    void pullCloudHistory(undefined, {
      isCurrentSession: isSessionCurrent,
      onEncryptionMigrationFailure: (error) => {
        if (!active || !isSessionCurrent()) return;
        setCloudHistoryWarning(translateText(
          'Closed History encryption upgrade could not be verified. Your saved history is still available; retry the migration.',
          getAppLanguage()
        ));
        logSafeDiagnostic('warn', 'closed-history', error);
      }
    }).then(async history => {
      if (!active || !isSessionCurrent()) return;
      const current = portfolioStore.getState();
      const saved = loadSavedHistory();
      const savedExecutions = normalizeBrokerExecutions(saved.brokerExecutedTrades);
      const savedCashflows = normalizeSavedFreedomCashflows(saved.cashflows);
      const localCashflows = current.cashflows?.length ? current.cashflows : savedCashflows;
      const currentExecutions = current.brokerExecutedTrades?.length ? current.brokerExecutedTrades : savedExecutions;
      // Current memory may have just hydrated raw broker executions before this
      // cloud-history read completed. Enrich it from persisted calculated rows by
      // execution ID before deciding which copy is safe to restore.
      const localExecutions = mergeBrokerExecutionHistory(
        [...savedExecutions, ...brokerTrades],
        preservePersistedBrokerFeeAllocations(currentExecutions, savedExecutions)
      );
      const cloud = history || { brokerExecutedTrades: [], cashflows: [] };
      const cloudSourceExecutions = normalizeBrokerExecutions(cloud.brokerExecutedTrades);
      const cloudCashflows = normalizeSavedFreedomCashflows(cloud.cashflows);
      historyHydrated.current = true;
      // Cloud history is the durable baseline, but the just-fetched broker page
      // is fresher. Merge it instead of allowing a slow cloud pull to erase new
      // executions that arrived while this component was mounting.
      const cloudBaseline = mergeBrokerExecutionHistory(
        localExecutions,
        cloudSourceExecutions
      );
      const cloudExecutions = preservePersistedBrokerFeeAllocations(
        mergeBrokerExecutionHistory(cloudBaseline, latestBrokerFetch.current || []),
        [...saved.brokerExecutedTrades, ...localExecutions]
      );
      const resolved = history ? {
        brokerExecutedTrades: cloudExecutions,
        // Keep locally saved legacy rows when the cloud record exists but predates them.
        // Broker rows update matching IDs; unmatched historical rows are retained.
        cashflows: mergeFreedomCashflowRows(localCashflows, cloudCashflows)
      } : {
        brokerExecutedTrades: localExecutions,
        cashflows: localCashflows
      };
      portfolioStore.setState(resolved);
      // Calculate the next incremental cursor only after cloud history has been
      // reconciled with the device snapshot, so a stale one-row local cache does
      // not narrow the next cashflow request prematurely.
      cashflowSyncStartDate.current = getLatestClosedTradeDate(
        resolved.brokerExecutedTrades,
        current.closedTrades || []
      );
      if (JSON.stringify(resolved) !== JSON.stringify(cloud) && (resolved.brokerExecutedTrades.length || resolved.cashflows.length)) {
        if (!isSessionCurrent()) return;
        try { await pushCloudHistory(resolved, undefined, undefined, { isCurrentSession: isSessionCurrent }); }
        catch (error) {
          if (isSessionCurrent()) logSafeDiagnostic('error', 'closed-history', error);
        }
        if (!active || !isSessionCurrent()) return;
      }
      if (active && isSessionCurrent()) setCashflowHistoryReady(true);
    }).catch(error => {
      if (!active || !isSessionCurrent()) return;
      logSafeDiagnostic('error', 'closed-history', error);
      if (active && isSessionCurrent()) {
        const current = portfolioStore.getState();
        const saved = loadSavedHistory();
        const savedExecutions = normalizeBrokerExecutions(saved.brokerExecutedTrades);
        const savedCashflows = normalizeSavedFreedomCashflows(saved.cashflows);
        portfolioStore.setState({
          brokerExecutedTrades: mergeBrokerExecutionHistory(
            savedExecutions,
            current.brokerExecutedTrades || []
          ),
          cashflows: current.cashflows?.length ? current.cashflows : savedCashflows
        });
        setCashflowHistoryReady(true);
      }
    });
    return () => { active = false; };
  }, []);
  // The key projects the exact facts consumed by the fee allocator. Quote-only
  // position updates therefore do not invalidate an in-flight or completed pass.
  const allocationBrokerExecutions = state.brokerExecutedTrades?.length
    ? state.brokerExecutedTrades
    : brokerTrades;
  const allocationInputKey = createFreedomMarginFeeAllocationInputKey(
    state.cashflows || [],
    allocationBrokerExecutions,
    state.closedTrades || [],
    {
      trancheTypes: state.activeTrancheTypes || {},
      trancheMixes: state.activeTrancheMixes || {},
      openAppPositions: state.positions || {}
    }
  );

  useEffect(() => {
    const cashflows = state.cashflows || [];
    if (!isWorkspaceSyncReady || !isSessionCurrent() || !cashflowHistoryReady || !cashflowSyncReady || brokerTradesLoading) return;
    const key = allocationInputKey;
    if (key === lastRecalculationKey.current) {
      return;
    }
    let active = true;
    const isEffectCurrent = () => active && isSessionCurrent();
    void processCashflowRows(cashflows, false, isEffectCurrent).then((success) => {
      if (!isEffectCurrent()) return;
      if (success) lastRecalculationKey.current = key;
    });
    return () => {
      active = false;
    };
  }, [isWorkspaceSyncReady, cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, allocationInputKey]);
  const processCashflowRows = async (
    cashflowRows: Array<Omit<NormalizedFreedomCashflow, 'raw'> & { raw?: Record<string, string> }>,
    requireCloudSync = false,
    isOperationActive: () => boolean = () => true
  ): Promise<boolean> => {
    const isOperationCurrent = () => isWorkspaceSyncReady && isSessionCurrent() && isOperationActive();
    if (!isOperationCurrent()) return false;
    try {
      // An empty confirmed snapshot is still a calculation input: it must clear
      // any stale allocations left by older imports or a previously saved broker row.

      // Persist broker-normalized cashflow rows as the source of truth so fee
      // allocations can be recalculated after refresh without another API read.
      const currentPortfolio = portfolioStore.getState();
      const storedBrokerExecutions = currentPortfolio.brokerExecutedTrades || [];
      // The canonical store may be empty while the broker table has already
      // hydrated. Use the same visible execution set for allocation and display.
      const brokerExecutions = [...(storedBrokerExecutions.length ? storedBrokerExecutions : brokerTrades)];
      const appTrades = [...(currentPortfolio.closedTrades || state.closedTrades || [])];
      const { brokerAllocations, brokerOpenAllocations, appAllocations, appOpenAllocations } = calculateFreedomMarginFeeAllocations(
        cashflowRows,
        brokerExecutions,
        appTrades,
        {
          trancheTypes: currentPortfolio.activeTrancheTypes ?? state.activeTrancheTypes,
          trancheMixes: currentPortfolio.activeTrancheMixes ?? state.activeTrancheMixes,
          openAppPositions: currentPortfolio.positions || state.positions
        }
      );
      const updatedExecutions = applyCashflowAllocationsToBrokerExecutions(
        brokerExecutions,
        brokerAllocations,
        brokerOpenAllocations
      );
      const updatedTrades = applyCashflowAllocationsToClosedTrades(appTrades, appAllocations);
      const feeAuditUpdate = buildClosedHistoryFeeAuditUpdate(
        currentPortfolio.transactionEvents || [],
        appTrades,
        updatedTrades,
        cashflowRows
      );
      if (feeAuditUpdate.rejectedCount > 0) {
        logSafeDiagnostic('warn', 'closed-history');
      }
      const auditedClosedTrades = feeAuditUpdate.closedTrades;
      const openPositionFeeAllocations = brokerExecutions.length
        ? aggregateOpenBrokerMarginFeeAllocationsByTicker(brokerExecutions, brokerOpenAllocations)
        : appOpenAllocations;
      const updatedMarginPositions = applyCashflowAllocationsToMarginPositions(
        currentPortfolio.positions || state.positions || {},
        openPositionFeeAllocations
      );
      const changedBrokerRows = updatedExecutions.filter((trade, index) => trade !== brokerExecutions[index]).length;
      const changedAppRows = auditedClosedTrades.filter((trade, index) => trade !== appTrades[index]).length;
      const changedMarginPositions = JSON.stringify(currentPortfolio.positions || {}) !== JSON.stringify(updatedMarginPositions);
      const updatedTradeCount = changedBrokerRows + changedAppRows;
      const currentCashflows = portfolioStore.getState().cashflows || [];
      const cashflowsChanged = JSON.stringify(currentCashflows) !== JSON.stringify(cashflowRows);
      // Persist the current broker cashflow snapshot even when no fee date
      // overlaps a closed trade yet. Later recalculation can retry from storage.
      const nextState: Pick<Partial<PortfolioState>, 'brokerExecutedTrades' | 'positions' | 'cashflows'> = {};
      if (cashflowsChanged) nextState.cashflows = cashflowRows;
      // Compare the complete recalculated records before writing. This prevents
      // repeated post-load recalculation from causing redundant Worker syncs.
      if (changedBrokerRows && JSON.stringify(brokerExecutions) !== JSON.stringify(updatedExecutions)) {
        nextState.brokerExecutedTrades = updatedExecutions;
      }
      if (changedMarginPositions) nextState.positions = updatedMarginPositions;
      if (!isOperationCurrent()) return false;
      const previousPortfolioState = portfolioStore.getState();
      if (Object.keys(nextState).length || changedAppRows || feeAuditUpdate.appendedCount > 0) {
        const committed = portfolioStore.commitClosedHistoryFeeSync(
          nextState,
          auditedClosedTrades,
          feeAuditUpdate.transactionEvents,
          false
        );
        if (!committed) {
          setCashflowSyncMessage('Closed-history fee changes could not be linked to the transaction journal; the prior snapshot was preserved.');
          return false;
        }
      }
      // Keep canonical portfolio fields and the independently stored history
      // sidecar aligned. A failed write restores the prior in-memory snapshot
      // and must never be followed by a cloud history write.
      const historyPersisted = await savePortfolioSnapshot(portfolioStore.getState(), {
        brokerExecutedTrades: brokerExecutions.length
          ? updatedExecutions
          : (portfolioStore.getState().brokerExecutedTrades || []),
        cashflows: cashflowRows
      });
      if (!historyPersisted) {
        portfolioStore.restoreInMemorySnapshot(previousPortfolioState);
        const message = 'Closed history was recalculated but could not be saved on this device. Cloud synchronization was skipped.';
        setCashflowSyncMessage(message);
        logSafeDiagnostic('error', 'closed-history');
        return false;
      }
      // The closed-history collection lives in its own cloud record; saving the
      // portfolio snapshot alone does not upload updated fee allocations. Without
      // this write, the next section mount reloads stale cloud executions over the
      // freshly recalculated local rows.
      const brokerExecutionsChanged = brokerExecutions.length > 0 &&
        JSON.stringify(brokerExecutions) !== JSON.stringify(updatedExecutions);
      // Sync the history record when source cashflows or calculated execution
      // metadata changes so local and cloud history remain consistent.
      if (cashflowsChanged || brokerExecutionsChanged) {
        try {
          const synced = await pushCloudHistory({
            brokerExecutedTrades: brokerExecutionsChanged ? updatedExecutions : brokerExecutions,
            cashflows: cashflowRows
          }, undefined, undefined, { isCurrentSession: isOperationCurrent });
          if (!isOperationCurrent()) return false;
          if (!synced) throw new Error('Cloud history did not confirm the update.');
        } catch (error) {
          if (!isOperationCurrent()) return false;
          logSafeDiagnostic('error', 'closed-history', error);
          if (requireCloudSync) {
            setCashflowSyncMessage(`History was updated locally, but cloud sync failed: ${error instanceof Error ? error.message : 'unknown sync error'}.`);
            return false;
          }
        }
      }
      if (updatedTradeCount > 0 && brokerExecutions.length) {
        dispatchBrokerExecutionHistory({ type: 'success', trades: updatedExecutions });
      }
      return true;
    } catch (error) {
      if (!isOperationCurrent()) return false;
      const detail = error instanceof Error ? error.message : 'Unknown cashflow processing error.';
      logSafeDiagnostic('error', 'closed-history');
      if (requireCloudSync) setCashflowSyncMessage(`Freedom cashflow processing failed: ${detail}`);
      return false;
    }
  };

  const syncCashflowsFromFreedom = async () => {
    if (!isWorkspaceSyncReady || !isSessionCurrent() || cashflowSyncStarted.current) return;
    cashflowSyncStarted.current = true;
    let completed = false;
    try {
      const hasCompleteBaseline = hasFreedomCashflowHistoryBaseline(accountId);
      const latestTradeCheckpoint = getLatestClosedTradeCheckpoint(brokerTrades, state.closedTrades || []) || 'no-trades';
      const previousTradeCheckpoint = getFreedomCashflowTradeCheckpoint(accountId);

      // A full initial cashflow baseline is still required once. After that,
      // opening Trades is a read-only check unless a new latest-date execution
      // (including another fill on the same date) has appeared.
      if (hasCompleteBaseline && previousTradeCheckpoint === latestTradeCheckpoint) {
        setCashflowSyncReady(true);
        return;
      }

      // The trade history refresh completes before this function is called, so
      // the incremental cashflow cursor includes the newest visible closed sale.
      cashflowSyncStartDate.current = getLatestClosedTradeDate(brokerTrades, state.closedTrades || []);
      const fromDate = hasCompleteBaseline ? cashflowSyncStartDate.current : undefined;
      const response = await brokerAdapter.fetchCashflows(fromDate);
      if (!isSessionCurrent()) return;
      const fetchedRows = brokerAdapter.normalizeCashflows(response).data;
      const existingRows = portfolioStore.getState().cashflows || [];
      const mergedRows = mergeFreedomCashflowRows(existingRows, fetchedRows);

      // On the first upgraded session, backfill the complete ledger before
      // switching to date-bounded requests. Process empty snapshots as well.
      const saved = await processCashflowRows(mergedRows, true);
      if (!saved || !isSessionCurrent()) return;
      if (!hasCompleteBaseline && !markFreedomCashflowHistoryBaseline(accountId)) {
        throw new Error('Cashflow history baseline could not be recorded; the next Trades visit will retry.');
      }
      if (!markFreedomCashflowTradeCheckpoint(accountId, latestTradeCheckpoint)) {
        throw new Error('Latest trade checkpoint could not be saved; the next Trades visit will retry.');
      }
      completed = true;

    } catch (error) {
      if (!isSessionCurrent()) return;
      const detail = error instanceof Error ? error.message : 'Unknown broker API error.';
      setCashflowSyncMessage(`Automatic Freedom cashflow sync failed: ${detail}`);
      logSafeDiagnostic('warn', 'closed-history');
    } finally {
      if (isSessionCurrent()) {
        // A failed request or local/cloud persistence failure must be retryable
        // without leaving Trades or signing out and back in.
        if (!completed) cashflowSyncStarted.current = false;
        setCashflowSyncReady(true);
      }
    }
  };

  const retryCashflowSync = () => {
    if (!isWorkspaceSyncReady || !isSessionCurrent() || cashflowSyncStarted.current) return;
    setCashflowSyncMessage('');
    setCashflowSyncReady(false);
    void syncCashflowsFromFreedom();
  };

  const retryCloudHistoryMigration = async () => {
    if (!isSessionCurrent() || cloudHistoryRetrying) return;
    setCloudHistoryRetrying(true);
    setCloudHistoryWarning('');
    try {
      await pullCloudHistory(undefined, {
        isCurrentSession: isSessionCurrent,
        onEncryptionMigrationFailure: (error) => {
          if (!isSessionCurrent()) return;
          setCloudHistoryWarning(translateText(
            'Closed History encryption upgrade could not be verified. Your saved history is still available; retry the migration.',
            getAppLanguage()
          ));
          logSafeDiagnostic('warn', 'closed-history', error);
        }
      });
    } catch (error) {
      if (isSessionCurrent()) {
        setCloudHistoryWarning(error instanceof Error ? error.message : 'Could not verify the cloud history encryption upgrade.');
      }
    } finally {
      if (isSessionCurrent()) setCloudHistoryRetrying(false);
    }
  };

  useEffect(() => {
    if (!isWorkspaceSyncReady || !cashflowHistoryReady || brokerTradesLoading || brokerTradesRefreshing) return;
    void syncCashflowsFromFreedom();
  }, [isWorkspaceSyncReady, cashflowHistoryReady, brokerTradesLoading, brokerTradesRefreshing, brokerTrades]);

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
      // pre-hydration broker response. Restore real saved allocations by ID before
      // writing these rows into the canonical store or triggering cloud sync.
      const savedFeeRows = normalizeBrokerExecutions(loadSavedHistory().brokerExecutedTrades);
      const normalizedPage = preservePersistedBrokerFeeAllocations(
        normalizedRaw,
        [...savedFeeRows, ...stored]
      );
      latestBrokerFetch.current = normalizedPage;
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
        // Sync only when the authoritative broker history actually changes, and
        // only after initial cloud hydration. Initial reconciliation is handled by
        // the load effect above so it doesn't race a second save against that pull.
        if (historyHydrated.current) {
          void pushCloudHistory({
            brokerExecutedTrades: normalized,
            cashflows: portfolioStore.getState().cashflows || []
          }, undefined, undefined, { isCurrentSession: isSessionCurrent }).catch(error => {
            if (isSessionCurrent()) logSafeDiagnostic('error', 'closed-history', error);
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
    dispatchBrokerExecutionHistory({ type: 'refresh' });
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
  const pagination = useTablePagination('closed-history', filteredTrades.length, 10);
  const visibleTrades = sliceTablePage(filteredTrades, pagination.currentPage, pagination.pageSize);
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
    showDelayMs: 700,
    minimumVisibleMs: 650
  });

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
        title={(
          <>
            {translateText('Trades', getAppLanguage())}
            {showBrokerRefreshIndicator && (
              <span role="status" aria-label={translateText('Refreshing TradeNet execution history…', getAppLanguage())} title={translateText('Refreshing TradeNet execution history…', getAppLanguage())} class="inline-flex h-4 w-4 items-center justify-center text-purple-300">
                <svg viewBox="0 0 16 16" class="h-4 w-4 flex-none animate-spin text-purple-300 motion-reduce:animate-none" fill="none" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="24 14" />
                </svg>
              </span>
            )}
          </>
        )}
        description={translateText('Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.', getAppLanguage())}
        trailing={<div class="text-xs font-mono text-slate-500">{filteredTrades.length} / {trades.length} {translateText('records', getAppLanguage())}</div>}
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
          <span>TradeNet refresh failed. Showing saved history, which may be out of date.</span>
          <button
            type="button"
            onClick={retryBrokerTrades}
            disabled={brokerTradesRefreshing}
            aria-label="Retry TradeNet history"
            class="self-start rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
          >{brokerTradesRefreshing ? 'Retrying…' : 'Retry'}</button>
        </div>
      )}

      <section class="rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-3" aria-label={translateText('Trade history filters', getAppLanguage())}>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{hasUnknownProfit ? 'Known net P&L' : 'Realized net P&L'}</div>
          <div class={`mt-1 font-mono text-lg font-bold ${realizedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {knownProfitCount === 0 ? '—' : (realizedNet >= 0 ? '+' : '−') + formatUSD(Math.abs(realizedNet))}
          </div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Win rate</div>
          <div class="mt-1 font-mono text-lg font-bold text-white">{knownProfitCount === 0 ? '—' : winRate.toFixed(1) + '%'}</div>
          <div class="text-[10px] text-slate-500">{translateText(`${winningTrades} of ${knownProfitCount} records with known profit profitable`, getAppLanguage())}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fees &amp; commissions</div>
          <div class="mt-1 font-mono text-lg font-bold text-slate-200">{hasIncompleteCommissions ? '≥' : ''}{formatUSD(totalFees)}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Avg. holding time</div>
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