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
import { calculateFreedomMarginFeeAllocations } from '../domain/freedomMarginFees';
import { calculateBrokerExecutionMetrics } from '../domain/brokerExecutionMetrics';
import { DeskLoading } from './DeskLoading';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';
import { TableScrollRegion } from './TableScrollRegion';
import { TablePagination } from './TablePagination';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import { brokerExecutionHistoryReducer, createBrokerExecutionHistoryState } from '../domain/brokerExecutionHistoryState';
import { getLatestClosedTradeCheckpoint, getLatestClosedTradeDate } from '../domain/tradeHistorySync';
import { getExecutionReconciliationFeedStatus } from '../domain/brokerTransactionReconciliation';
import type { PortfolioState } from '../types/portfolio';
import { buildClosedHistoryRows, summarizeClosedHistoryRows } from '../features/trades/closedHistoryRows';

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

export function ClosedHistoryDesk({ accountId, isSessionCurrent = () => true }: { accountId: string; isSessionCurrent?: () => boolean }) {
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
  const [cashflowAllocationReady, setCashflowAllocationReady] = useState(false);
  const [guestUsers, setGuestUsers] = useState<AuthUser[]>([]);
  const lastRecalculationKey = useRef('');
  const historyHydrated = useRef(false);
  const cashflowSyncStarted = useRef(false);
  const latestBrokerFetch = useRef<FreedomExecutedTrade[] | null>(null);
  const retryBrokerTrades = () => {
    dispatchBrokerExecutionHistory({ type: 'refresh' });
    emitBrokerEvent('broker:request-executed-trades');
  };
  useEffect(() => {
    let active = true;
    void listUsers().then((users) => {
      if (active && isSessionCurrent()) setGuestUsers(users.filter((user) => user.role === 'guest'));
    }).catch((error) => {
      console.warn('Unable to load guest names for closed-trade attribution:', error);
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
        console.warn('Closed History encryption migration remains pending:', error.message);
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
          if (isSessionCurrent()) console.error('Unable to sync closed history:', error);
        }
        if (!active || !isSessionCurrent()) return;
      }
      if (active && isSessionCurrent()) setCashflowHistoryReady(true);
    }).catch(error => {
      if (!active || !isSessionCurrent()) return;
      console.error('Unable to load closed history from cloud:', error);
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
  // Recalculate once per distinct cashflow/execution snapshot. Excluding
  // calculated metadata prevents the allocation effect from re-entering.
  useEffect(() => {
    const cashflows = state.cashflows || [];
    if (!isSessionCurrent() || !cashflowHistoryReady || !cashflowSyncReady || brokerTradesLoading) return;
    const storedExecutions = portfolioStore.getState().brokerExecutedTrades || [];
    const executions = storedExecutions.length ? storedExecutions : brokerTrades;
    // Exclude calculated metadata from the input fingerprint; otherwise a
    // successful allocation changes its own key and triggers another pass.
    const calculatedFields = new Set(['marginFeeAllocations', 'marginFee', 'openMarginFeeAllocations', 'openMarginFee', 'feesAndCommissions', 'netProfit']);
    const sourceExecutions = executions.map((trade) =>
      Object.fromEntries(Object.entries(trade).filter(([field]) => !calculatedFields.has(field)))
    );
    const sourceAppTrades = (state.closedTrades || []).map((trade) =>
      Object.fromEntries(Object.entries(trade).filter(([field]) =>
        !['marginFee', 'marginInterest', 'feesAndCommissions', 'totalCommissions', 'netProfit', 'netRealizedGain'].includes(field)
      ))
    );
    const sourceAppPositions = Object.fromEntries(Object.entries(state.positions || {}).map(([key, position]) => [
      key,
      Object.fromEntries(Object.entries(position || {}).filter(([field]) =>
        !['brokerMarginFeeAllocations', 'brokerMarginFee'].includes(field)
      ))
    ]));
    const key = JSON.stringify({
      cashflows,
      executions: sourceExecutions,
      appTrades: sourceAppTrades,
      appPositions: sourceAppPositions,
      trancheTypes: state.activeTrancheTypes || {},
      trancheMixes: state.activeTrancheMixes || {}
    });
    if (key === lastRecalculationKey.current) {
      setCashflowAllocationReady(true);
      return;
    }
    setCashflowAllocationReady(false);
    let active = true;
    const isEffectCurrent = () => active && isSessionCurrent();
    void processCashflowRows(cashflows, false, isEffectCurrent).then((success) => {
      if (!isEffectCurrent()) return;
      if (success) lastRecalculationKey.current = key;
      setCashflowAllocationReady(true);
    });
    return () => {
      active = false;
    };
  }, [cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, state.cashflows, state.brokerExecutedTrades, state.closedTrades, state.positions, state.activeTrancheTypes, state.activeTrancheMixes, brokerTrades]);
  const processCashflowRows = async (
    cashflowRows: Array<Omit<NormalizedFreedomCashflow, 'raw'> & { raw?: Record<string, string> }>,
    requireCloudSync = false,
    isOperationActive: () => boolean = () => true
  ): Promise<boolean> => {
    const isOperationCurrent = () => isSessionCurrent() && isOperationActive();
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
      const openPositionFeeAllocations = brokerExecutions.length
        ? aggregateOpenBrokerMarginFeeAllocationsByTicker(brokerExecutions, brokerOpenAllocations)
        : appOpenAllocations;
      const updatedMarginPositions = applyCashflowAllocationsToMarginPositions(
        currentPortfolio.positions || state.positions || {},
        openPositionFeeAllocations
      );
      const changedBrokerRows = updatedExecutions.filter((trade, index) => trade !== brokerExecutions[index]).length;
      const changedAppRows = updatedTrades.filter((trade, index) => trade !== appTrades[index]).length;
      const changedMarginPositions = JSON.stringify(currentPortfolio.positions || {}) !== JSON.stringify(updatedMarginPositions);
      const updatedTradeCount = changedBrokerRows + changedAppRows;
      const currentCashflows = portfolioStore.getState().cashflows || [];
      const cashflowsChanged = JSON.stringify(currentCashflows) !== JSON.stringify(cashflowRows);
      // Persist the current broker cashflow snapshot even when no fee date
      // overlaps a closed trade yet. Later recalculation can retry from storage.
      const nextState: Record<string, unknown> = {};
      if (cashflowsChanged) nextState.cashflows = cashflowRows;
      // Compare the complete recalculated records before writing. This prevents
      // repeated post-load recalculation from causing redundant Worker syncs.
      if (changedBrokerRows && JSON.stringify(brokerExecutions) !== JSON.stringify(updatedExecutions)) {
        nextState.brokerExecutedTrades = updatedExecutions;
      }
      if (changedAppRows && JSON.stringify(appTrades) !== JSON.stringify(updatedTrades)) {
        nextState.closedTrades = updatedTrades;
      }
      if (changedMarginPositions) nextState.positions = updatedMarginPositions;
      if (!isOperationCurrent()) return false;
      const previousPortfolioState = portfolioStore.getState();
      if (Object.keys(nextState).length) portfolioStore.setState(nextState, false);
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
        portfolioStore.update(() => previousPortfolioState, false);
        const message = 'Closed history was recalculated but could not be saved on this device. Cloud synchronization was skipped.';
        setCashflowSyncMessage(message);
        console.error(message);
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
          console.error('Failed to sync closed-history cashflows and fees:', error);
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
      console.error('Unable to process saved closed-history cashflows:', detail);
      if (requireCloudSync) setCashflowSyncMessage(`Freedom cashflow processing failed: ${detail}`);
      return false;
    }
  };

  const syncCashflowsFromFreedom = async () => {
    if (!isSessionCurrent() || cashflowSyncStarted.current) return;
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
      console.warn('Automatic Freedom cashflow sync failed:', detail);
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
    if (!isSessionCurrent() || cashflowSyncStarted.current) return;
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
          console.warn('Closed History encryption migration remains pending:', error.message);
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
    if (!cashflowHistoryReady || brokerTradesLoading || brokerTradesRefreshing) return;
    void syncCashflowsFromFreedom();
  }, [cashflowHistoryReady, brokerTradesLoading, brokerTradesRefreshing, brokerTrades]);

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
            if (isSessionCurrent()) console.error('Unable to sync updated broker history:', error);
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
    emitBrokerEvent('broker:request-executed-trades');
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
  const pagination = useTablePagination('closed-history', trades.length, 10);
  const visibleTrades = sliceTablePage(trades, pagination.currentPage, pagination.pageSize);
  const tradeSummary = useMemo(
    () => summarizeClosedHistoryRows(trades),
    [trades]
  );
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
  const backgroundSyncPending = !cashflowHistoryReady || !cashflowSyncReady || !cashflowAllocationReady;
  const isBackgroundUpdating = backgroundSyncPending || brokerTradesRefreshing;

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
    <section class="rounded-xl border-card p-4 space-y-4" aria-label="Trades">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h1 class="flex items-center gap-2 text-base font-black uppercase tracking-wider text-purple-300">
            Trades
            {isBackgroundUpdating && (
              <span
                role="status"
                aria-label={translateText('Updating saved trade calculations in the background…')}
                title={translateText('Updating saved trade calculations in the background…')}
                class="inline-flex h-4 w-4 items-center justify-center text-purple-300"
              >
                <svg
                  viewBox="0 0 16 16"
                  class="h-4 w-4 flex-none animate-spin text-purple-300 motion-reduce:animate-none"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray="24 14"
                  />
                </svg>
              </span>
            )}
          </h1>
          <p class="text-xs text-slate-400">
            Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="text-xs font-mono text-slate-500">
            {trades.length} records
          </div>
        </div>
      </div>

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
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4 text-center" aria-label="Closed trade performance summary">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{hasUnknownProfit ? 'Known net P&L' : 'Realized net P&L'}</div>
          <div class={`mt-1 font-mono text-lg font-bold ${realizedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {realizedNet >= 0 ? '+' : '−'}${formatUSD(Math.abs(realizedNet))}
          </div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Win rate</div>
          <div class="mt-1 font-mono text-lg font-bold text-white">{winRate.toFixed(1)}%</div>
          <div class="text-[10px] text-slate-500">{translateText(`${winningTrades} of ${knownProfitCount} records with known profit profitable`, getAppLanguage())}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fees &amp; commissions</div>
          <div class="mt-1 font-mono text-lg font-bold text-slate-200">{hasIncompleteCommissions ? '≥' : ''}${formatUSD(totalFees)}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3 flex flex-col justify-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Avg. holding time</div>
          <div class="mt-1 font-mono text-lg font-bold text-slate-200">{averageHoldingDays === null ? '—' : averageHoldingDays.toFixed(1) + ' days'}</div>
        </div>
      </div>
      
      <div key={pagination.currentPage} class="closed-history-page-transition">
      <TableScrollRegion label="Closed trade history" className="border border-slate-800 bg-slate-950/60">
        <table class="w-full min-w-[900px] text-left text-xs font-mono">
          <caption class="sr-only">Closed trade history with funding type, guest assignment, ticker, closing date, quantity, duration, fees, commissions, and net profit.</caption>
          <thead class="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th scope="col" class="py-2.5 px-3">Ticker</th>
              <th scope="col" class="py-2.5 px-3">Date Closed</th>
              <th scope="col" class="py-2.5 px-3 text-right">Shares</th>
              <th scope="col" class="py-2.5 px-3 text-right">Duration</th>
              <th scope="col" class="py-2.5 px-3">Funding · guest · cash shares</th>
              <th scope="col" class="py-2.5 px-3 text-right">Fees</th>
              <th scope="col" class="py-2.5 px-3 text-right">Commissions</th>
              <th scope="col" class="py-2.5 px-3 text-right">Net Profit</th>
            </tr>
          </thead>
          <tbody id="closedTradesTableBody" class="divide-y divide-slate-800/60">
            {brokerTradesLoading && brokerTrades.length === 0 ? (
              <tr><td colSpan={8} class="py-8 text-center text-slate-400">
                <span class="inline-flex items-center gap-2"><span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-purple-400" aria-hidden="true" />Loading closed trade history…</span>
              </td></tr>
            ) : brokerTradesError && trades.length === 0 ? (
              <tr><td colSpan={8} class="py-8 text-center text-rose-400">
                <div class="flex flex-col items-center justify-center gap-2">
                  <span>Unable to load TradeNet history. Please retry.</span>
                  <button
                    type="button"
                    onClick={retryBrokerTrades}
                    disabled={brokerTradesRefreshing}
                    aria-label="Retry TradeNet history"
                    class="rounded border border-rose-800/70 px-3 py-1.5 font-semibold text-rose-200 transition hover:bg-rose-950/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >{brokerTradesRefreshing ? 'Retrying…' : 'Retry'}</button>
                </div>
              </td></tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={8} class="py-8 text-center text-slate-500 italic">
                  No closed trades recorded yet.
                </td>
              </tr>
            ) : (
              visibleTrades.map((row) => {
                const { trade, index, source, profit: rowProfit, profitIsUpperBound, fees: rowFees, commissions: rowCommissions, commissionsComplete } = row;
                const allocationType = row.allocationType || 'margin';
                const assignedGuests: Array<{ guestId: string; quantity: number }> = row.guestAllocations || [];
                const allocationKey = String(row.allocationKey || ((source || 'trade') + ':' + String((trade as any).id || index)));
                const savedAllocation = state.closedTradeAllocations?.[allocationKey];
                const rowQuantity = Math.max(0, Number((trade as any).shares) || 0);
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
                // 1. Resolve Exit Date
                const rawDate =
                  (trade as any).exitDate ||
                  (trade as any).sellDate ||
                  (trade as any).closedAt ||
                  (trade as any).date;

                let closedDate: Date | null = null;
                if (typeof rawDate === 'number') {
                  closedDate = new Date(rawDate);
                } else if (typeof rawDate === 'string') {
                  const parsed = Date.parse(rawDate);
                  if (!Number.isNaN(parsed)) closedDate = new Date(parsed);
                }

                const dateText =
                  closedDate && !Number.isNaN(closedDate.getTime())
                    ? closedDate.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: '2-digit'
                    })
                    : 'Unknown';

                // 2. Resolve Duration in Days
                const rawDuration = (trade as any).holdingDays ?? (trade as any).daysHeld;
                let durationDays = rawDuration == null ? null : Number(rawDuration);
                if (durationDays !== null && (!Number.isFinite(durationDays) || durationDays < 0)) durationDays = null;
                if (
                  (durationDays === null || durationDays <= 0) &&
                  ((trade as any).buyDate || (trade as any).purchaseDate) &&
                  ((trade as any).sellDate || (trade as any).exitDate)
                ) {
                  const bTime = new Date(
                    (trade as any).buyDate || (trade as any).purchaseDate
                  ).getTime();
                  const sTime = new Date(
                    (trade as any).sellDate || (trade as any).exitDate
                  ).getTime();
                  if (!Number.isNaN(bTime) && !Number.isNaN(sTime)) {
                    durationDays = Math.max(0, (sTime - bTime) / 86400000);
                  }
                }

                // 3. Resolve Fees & Commissions
                const fees = Number(rowFees ?? 0);

                // 4. Resolve Net Profit
                const netProfit = rowProfit === null ? null : Number(rowProfit ?? 0);

                const isPositive = (netProfit ?? 0) >= 0;
                const sign = isPositive ? '+' : '-';
                const profitTextPrefix = profitIsUpperBound === true ? '≤ ' : '';

                return (
                    <tr key={(trade as any).id || (source + "-" + index)} class="hover:bg-slate-900/40 text-slate-300">
                    <td class="py-2.5 px-3 font-bold text-white">{(trade as any).ticker?.replace('.US', '') || "—"}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                      <span>{dateText}</span>
                      {closedDate && !Number.isNaN(closedDate.getTime()) ? (
                        <span class="mt-0.5 block text-[10px] text-slate-500" title={dateText}>
                          {formatRelativeTime(closedDate)}
                        </span>
                      ) : null}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      {(trade as any).shares ?? "—"}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-400">
                      {durationDays === null ? '—' : durationDays < 1 ? Math.round(durationDays * 24) + ' hrs' : durationDays.toFixed(1) + ' days'}
                    </td>
                    <td data-label="Funding · guest · cash shares" class="py-2 px-3 whitespace-nowrap text-slate-300">
                      <div class="flex flex-col items-center gap-1.5">
                        <div class="inline-flex rounded-md border border-slate-700 p-0.5" role="group" aria-label={String((trade as any).ticker || 'Trade') + ' funding type'}>
                          <button type="button" aria-pressed={allocationType === 'cash'} onClick={() => persistAllocation('cash', rowQuantity)} class={allocationType === 'cash' ? 'inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-cyan-950 px-2 py-1 text-[10px] font-bold text-cyan-300' : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-300'}>Cash</button>
                          <button type="button" aria-pressed={allocationType === 'margin'} onClick={() => persistAllocation('margin', 0, '')} class={allocationType === 'margin' ? 'inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-amber-950 px-2 py-1 text-[10px] font-bold text-amber-300' : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-300'}>Margin</button>
                          <button type="button" aria-pressed={allocationType === 'mix'} onClick={() => persistAllocation('mix', allocationType === 'cash' ? rowQuantity : row.cashQuantity)} class={allocationType === 'mix' ? 'inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-violet-950 px-2 py-1 text-[10px] font-bold text-violet-300' : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-300'}>Mix</button>
                        </div>
                        {allocationType === 'mix' && (
                          <div class="flex items-center justify-center gap-2 rounded border border-slate-800 bg-slate-950/70 p-1.5 font-sans">
                            <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-cyan-300">Cash shares
                              <input aria-label={String((trade as any).ticker || 'Trade') + ' cash shares'} type="number" min="0" max={rowQuantity} step="any" value={row.cashQuantity} onBlur={(event) => updateMixCash((event.currentTarget as HTMLInputElement).value)} class="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100" />
                            </label>
                            <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-300">Margin shares
                              <input aria-label={String((trade as any).ticker || 'Trade') + ' margin shares'} type="number" min="0" max={rowQuantity} step="any" value={row.marginQuantity} onBlur={(event) => updateMixMargin((event.currentTarget as HTMLInputElement).value)} class="w-16 rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100" />
                            </label>
                          </div>
                        )}
                        {row.cashQuantity > 0 ? (
                          <select aria-label={'Guest for ' + String((trade as any).ticker || 'trade') + ' cash shares'} value={selectedGuestId} onChange={(event) => persistAllocation(allocationType, row.cashQuantity, (event.currentTarget as HTMLSelectElement).value)} class="max-w-[11rem] rounded border border-slate-700 text-center bg-slate-950 px-2 py-1 text-[10px] text-slate-200">
                            <option value="">Unassigned</option>
                            {selectedGuestId && !guestUsers.some((user) => user.id === selectedGuestId) && <option value={selectedGuestId} class="text-center">Guest unavailable</option>}
                            {guestUsers.map((user) => <option key={user.id} class="text-center" value={user.id}>{user.name}</option>)}
                          </select>
                        ) : <span class="text-[9px] text-slate-600">No cash allocation</span>}
                        {assignedGuests.length > 0 && !savedAllocation && assignedGuests.map((assignment) => (
                          <span key={assignment.guestId} class="text-[9px] text-cyan-300">
                            {guestNameById.get(assignment.guestId) || assignment.guestId.slice(0, 8)} · {Number(assignment.quantity).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 4 })}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-300 font-mono">
                      ${formatUSD(fees)}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-300 font-mono">
                      {commissionsComplete === false ? '≥' : ''}${formatUSD(Number(rowCommissions ?? 0))}
                    </td>
                    <td
                      class={`py-2.5 px-3 text-right font-bold whitespace-nowrap font-mono ${profitIsUpperBound === true ? 'text-amber-300' : isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      title={profitIsUpperBound === true ? translateText('Upper bound: missing commission inputs; actual net P&L may be lower.', getAppLanguage()) : undefined}
                    >
                      {netProfit === null ? "—" : profitTextPrefix + sign + "$" + formatUSD(Math.abs(netProfit))}
                    </td>
                    </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableScrollRegion>
      </div>
      <TablePagination
        tableLabel={translateText('Closed trade history', getAppLanguage())}
        page={pagination.currentPage}
        pageCount={pagination.pageCount}
        pageSize={pagination.pageSize}
        start={pagination.start}
        end={pagination.end}
        total={trades.length}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
        className="closed-history-pagination pt-2"
        controlsClassName="closed-history-pagination-controls"
        controlsId="closedTradesTableBody"
      />
    </section>
  );
}