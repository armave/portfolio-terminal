import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';
import { getAppLanguage, translateText } from '../services/i18n';
import { fetchFreedomCashflows, listUsers, normalizeFreedomTrades, pullCloudHistory, pushCloudHistory, type AuthUser } from '../services/api';
import {
  hasFreedomCashflowHistoryBaseline,
  loadSavedHistory,
  markFreedomCashflowHistoryBaseline,
  savePortfolioSnapshot
} from '../services/storage';
import { applyCashflowAllocationsToBrokerExecutions, applyCashflowAllocationsToClosedTrades, deduplicateClosedHistoryRows, mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations, resolveClosedTradeFeeBreakdown, resolveClosedTradeNetProfit } from '../domain/closedHistoryFees';
import { mergeFreedomCashflowRows, normalizeFreedomCashflowRows, normalizeSavedFreedomCashflows, type NormalizedFreedomCashflow } from '../domain/freedomCashflows';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import { attributeClosedTradeExecutions } from '../domain/closedTradeAttribution';
import { resolveActiveTrancheMixInput } from '../domain/freedomPortfolio';
import { resolveClosedTradeAllocation } from '../domain/closedTradeAllocation';
import { calculateFreedomMarginFeeAllocations } from '../domain/freedomMarginFees';
import { calculateBrokerExecutionMetrics, normalizeExecutionTicker } from '../domain/brokerExecutionMetrics';
import { DeskLoading } from './DeskLoading';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';
import { TableScrollRegion } from './TableScrollRegion';
import { brokerExecutionHistoryReducer, createBrokerExecutionHistoryState } from '../domain/brokerExecutionHistoryState';
import { getLatestClosedTradeDate } from '../domain/tradeHistorySync';

/** Restore the local execution snapshot synchronously before the first Trades render. */
function loadInitialBrokerExecutions(): FreedomExecutedTrade[] {
  const savedExecutions = normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades);
  const currentExecutions = portfolioStore.getState().brokerExecutedTrades || [];
  return mergeBrokerExecutionHistory(
    savedExecutions,
    preservePersistedBrokerFeeAllocations(currentExecutions, savedExecutions)
  );
}

export function ClosedHistoryDesk({ accountId }: { accountId: string }) {
  const state = usePortfolio();
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
  // Keep the first cached range for both API requests. The broker trade refresh
  // may return newer sells before the cashflow request starts; that must not move
  // the cashflow cursor forward and skip fees for those newly fetched trades.
  const cashflowSyncStartDate = useRef(
    getLatestClosedTradeDate(brokerExecutionHistory.trades, state.closedTrades || [])
  );
  const [cashflowSyncMessage, setCashflowSyncMessage] = useState('');
  const [cashflowHistoryReady, setCashflowHistoryReady] = useState(false);
  const [cashflowSyncReady, setCashflowSyncReady] = useState(false);
  const [cashflowAllocationReady, setCashflowAllocationReady] = useState(false);
  const [tradesPage, setTradesPage] = useState(1);
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
      if (active) setGuestUsers(users.filter((user) => user.role === 'guest'));
    }).catch((error) => {
      console.warn('Unable to load guest names for closed-trade attribution:', error);
    });
    return () => { active = false; };
  }, []);
  // Load cloud history once. An existing cloud history record is authoritative;
  // local history is used only when no cloud record exists.
  useEffect(() => {
    let active = true;
    void pullCloudHistory().then(async history => {
      if (!active) return;
      const current = portfolioStore.getState();
      const saved = loadSavedHistory();
      const savedExecutions = normalizeFreedomTrades(saved.brokerExecutedTrades);
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
      const cloudSourceExecutions = normalizeFreedomTrades(cloud.brokerExecutedTrades);
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
        try { await pushCloudHistory(resolved); }
        catch (error) { console.error('Unable to sync closed history:', error); }
      }
      if (active) setCashflowHistoryReady(true);
    }).catch(error => {
      console.error('Unable to load closed history from cloud:', error);
      if (active) {
        const current = portfolioStore.getState();
        const saved = loadSavedHistory();
        const savedExecutions = normalizeFreedomTrades(saved.brokerExecutedTrades);
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
    if (!cashflowHistoryReady || !cashflowSyncReady || brokerTradesLoading) return;
    const storedExecutions = portfolioStore.getState().brokerExecutedTrades || [];
    const executions = storedExecutions.length ? storedExecutions : brokerTrades;
    // Exclude calculated metadata from the input fingerprint; otherwise a
    // successful allocation changes its own key and triggers another pass.
    const calculatedFields = new Set(['marginFeeAllocations', 'marginFee', 'feesAndCommissions', 'netProfit']);
    const sourceExecutions = executions.map((trade) =>
      Object.fromEntries(Object.entries(trade).filter(([field]) => !calculatedFields.has(field)))
    );
    const sourceAppTrades = (state.closedTrades || []).map((trade) =>
      Object.fromEntries(Object.entries(trade).filter(([field]) =>
        !['marginFee', 'marginInterest', 'feesAndCommissions', 'totalCommissions', 'netProfit', 'netRealizedGain'].includes(field)
      ))
    );
    const key = JSON.stringify({ cashflows, executions: sourceExecutions, appTrades: sourceAppTrades });
    if (key === lastRecalculationKey.current) {
      setCashflowAllocationReady(true);
      return;
    }
    setCashflowAllocationReady(false);
    void processCashflowRows(cashflows).then((success) => {
      if (success) lastRecalculationKey.current = key;
      setCashflowAllocationReady(true);
    });
  }, [cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, state.cashflows, state.brokerExecutedTrades, state.closedTrades, brokerTrades]);
  const processCashflowRows = async (
    cashflowRows: Array<Omit<NormalizedFreedomCashflow, 'raw'> & { raw?: Record<string, string> }>,
    requireCloudSync = false
  ): Promise<boolean> => {
    try {
      // An empty confirmed snapshot is still a calculation input: it must clear
      // any stale allocations left by older imports or a previously saved broker row.

      // Persist broker-normalized cashflow rows as the source of truth so fee
      // allocations can be recalculated after refresh without another API read.
      const storedBrokerExecutions = portfolioStore.getState().brokerExecutedTrades || [];
      // The canonical store may be empty while the broker table has already
      // hydrated. Use the same visible execution set for allocation and display.
      const brokerExecutions = [...(storedBrokerExecutions.length ? storedBrokerExecutions : brokerTrades)];
      const appTrades = [...(state.closedTrades || [])];
      const { brokerAllocations, appAllocations } = calculateFreedomMarginFeeAllocations(
        cashflowRows,
        brokerExecutions,
        appTrades
      );
      const updatedExecutions = applyCashflowAllocationsToBrokerExecutions(brokerExecutions, brokerAllocations);
      const updatedTrades = applyCashflowAllocationsToClosedTrades(appTrades, appAllocations);
      const changedBrokerRows = updatedExecutions.filter((trade, index) => trade !== brokerExecutions[index]).length;
      const changedAppRows = updatedTrades.filter((trade, index) => trade !== appTrades[index]).length;
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
      const previousPortfolioState = portfolioStore.getState();
      if (Object.keys(nextState).length) portfolioStore.setState(nextState, false);
      // Keep canonical portfolio fields and the independently stored history
      // sidecar aligned. A failed write restores the prior in-memory snapshot
      // and must never be followed by a cloud history write.
      const historyPersisted = savePortfolioSnapshot(portfolioStore.getState(), {
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
          });
          if (!synced) throw new Error('Cloud history did not confirm the update.');
        } catch (error) {
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
      const detail = error instanceof Error ? error.message : 'Unknown cashflow processing error.';
      console.error('Unable to process saved closed-history cashflows:', detail);
      if (requireCloudSync) setCashflowSyncMessage(`Freedom cashflow processing failed: ${detail}`);
      return false;
    }
  };

  const syncCashflowsFromFreedom = async () => {
    if (cashflowSyncStarted.current) return;
    cashflowSyncStarted.current = true;
    try {
      const hasCompleteBaseline = hasFreedomCashflowHistoryBaseline(accountId);
      const fromDate = hasCompleteBaseline ? cashflowSyncStartDate.current : undefined;
      const response = await fetchFreedomCashflows(fromDate);
      const fetchedRows = normalizeFreedomCashflowRows(response);
      const existingRows = portfolioStore.getState().cashflows || [];
      const mergedRows = mergeFreedomCashflowRows(existingRows, fetchedRows);

      // On the first upgraded session, backfill the complete ledger before
      // switching to date-bounded requests. Process empty snapshots as well.
      const saved = await processCashflowRows(mergedRows, true);
      if (!saved) return;
      if (!hasCompleteBaseline) markFreedomCashflowHistoryBaseline(accountId);

    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown broker API error.';
      setCashflowSyncMessage(`Automatic Freedom cashflow sync failed: ${detail}`);
      console.warn('Automatic Freedom cashflow sync failed:', detail);
    } finally {
      setCashflowSyncReady(true);
    }
  };

  useEffect(() => {
    if (!cashflowHistoryReady) return;
    void syncCashflowsFromFreedom();
  }, [cashflowHistoryReady]);

  useEffect(() => {
    const persistBrokerTrades = (trades: FreedomExecutedTrade[]) => {
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
          feesAndCommissions: previous?.feesAndCommissions ?? trade?.feesAndCommissions,
          netProfit: previous?.netProfit ?? trade?.netProfit,
          raw: {}
        };
      });
      // In-memory rows can contain explicit empty allocation objects from a
      // pre-hydration broker response. Restore real saved allocations by ID before
      // writing these rows into the canonical store or triggering cloud sync.
      const savedFeeRows = normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades);
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
          }).catch(error => console.error('Unable to sync updated broker history:', error));
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
      if (Array.isArray(saved) && saved.length) persistBrokerTrades(normalizeFreedomTrades(saved));
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
  const appTrades = (state.closedTrades || []).map((trade, index) => {
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
  });
  const brokerTradeMetrics = calculateBrokerExecutionMetrics(brokerTrades);
  const trancheAttributions = attributeClosedTradeExecutions(brokerTrades, {
    trancheTypes: state.activeTrancheTypes,
    trancheMixes: state.activeTrancheMixes,
    guestAssignments: state.activeTrancheGuestAssignments,
    guestAssignmentDetails: state.activeTrancheGuestAssignmentDetails
  });
  const guestNameById = new Map(guestUsers.map((user) => [user.id, user.name]));
  const brokerRows = brokerTrades.filter((broker) => ['sell', 's', 'sale', 'sold', '2'].includes(String(broker.side ?? '').toLowerCase() )).map((broker, index) => {
    const allocatedMarginFee = Object.values((broker.marginFeeAllocations || {}) as Record<string, number>)
      .reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    const marginFee = Number((broker.marginFeeAllocations && typeof broker.marginFeeAllocations === 'object')
      ? allocatedMarginFee
      : broker.marginFee ?? 0) || 0;
    const metrics = brokerTradeMetrics.get(broker);
    const sellCommissionCurrency = String(broker.commissionCurrency ?? broker.currency ?? '').trim().toUpperCase();
    const sellCommissionCurrencyIsUsd = sellCommissionCurrency === '' || sellCommissionCurrency === 'USD';
    const rawSellCommission = !sellCommissionCurrencyIsUsd || broker.commission === null || broker.commission === undefined
      ? NaN
      : Math.abs(Number(broker.commission));
    const sellCommission = Number.isFinite(rawSellCommission) ? rawSellCommission : null;
    const buyCommission = metrics?.buyCommission ?? null;
    const commissionsComplete = sellCommission !== null && buyCommission !== null;
    const commissions = Number(((sellCommission ?? 0) + (buyCommission ?? 0)).toFixed(2));
    const fees = Number(Math.abs(marginFee).toFixed(2));
    const totalFees = Number((commissions + fees).toFixed(2));
    const profit = broker.profit == null || !commissionsComplete
      ? null
      : Number((Number(broker.profit) - totalFees).toFixed(2));
    const ticker = normalizeExecutionTicker(broker.ticker);
    const attribution = trancheAttributions.get(broker);
    const allocationType = attribution?.fundingType || 'unclassified';
    return {
      trade: { id: broker.id ?? ('tradenet-' + index), ticker, shares: broker.quantity, exitDate: broker.executedAt, sellDate: broker.executedAt, holdingDays: metrics?.holdingDays ?? null, feesAndCommissions: totalFees, netProfit: profit, side: broker.side, price: broker.price, source: 'tradenet' as const },
      index: -1,
      source: 'tradenet' as const,
      allocationKey: 'broker:' + String(broker.id ?? ('tradenet-' + index)),
      profit,
      fees,
      commissions,
      commissionsComplete,
      feesTotal: totalFees,
      allocationType,
      allocationTypes: [allocationType],
      cashQuantity: attribution?.cashQuantity || 0,
      marginQuantity: attribution?.marginQuantity || 0,
      guestAllocations: attribution?.guestAllocations || [],
      unmatchedQuantity: attribution?.unmatchedQuantity || 0
    };
  });
  // Group same-ticker sell executions that occur within one hour into one closed-history row.
  // Keep separate groups when the gap from the previous execution exceeds one hour.
  const groupedBrokerRows = (() => {
    const sorted = [...brokerRows].sort((a, b) => Date.parse(String((a.trade as any).exitDate ?? '')) - Date.parse(String((b.trade as any).exitDate ?? '')));
    const groups: typeof brokerRows = [];
    for (const row of sorted) {
      const ticker = String((row.trade as any).ticker ?? '').trim().toUpperCase();
      const time = Date.parse(String((row.trade as any).exitDate ?? ''));
      const previous = groups[groups.length - 1];
      const previousTicker = previous ? String((previous.trade as any).ticker ?? '').trim().toUpperCase() : '';
      const previousTime = previous ? Date.parse(String((previous.trade as any).exitDate ?? '')) : NaN;
      if (previous && ticker && ticker === previousTicker && Number.isFinite(time) && Number.isFinite(previousTime) && time - previousTime <= 60 * 60 * 1000) {
        const oldQty = Number((previous.trade as any).shares ?? 0);
        const newQty = Number((row.trade as any).shares ?? 0);
        const oldProfit = previous.profit;
        const newProfit = row.profit;
        const oldDuration = (previous.trade as any).holdingDays;
        const newDuration = (row.trade as any).holdingDays;
        const totalQty = oldQty + newQty;
        (previous.trade as any).shares = totalQty;
        (previous.trade as any).exitDate = (row.trade as any).exitDate;
        (previous.trade as any).sellDate = (row.trade as any).exitDate;
        (previous.trade as any).id = String((previous.trade as any).id) + '+' + String((row.trade as any).id);
        (previous.trade as any).holdingDays = oldDuration != null && newDuration != null && totalQty > 0 ? (Number(oldDuration) * oldQty + Number(newDuration) * newQty) / totalQty : oldDuration ?? newDuration;
        previous.profit = oldProfit == null || newProfit == null ? null : oldProfit + newProfit;
        previous.fees = (previous.fees || 0) + (row.fees || 0);
        previous.commissions = (previous.commissions || 0) + (row.commissions || 0);
        previous.commissionsComplete = previous.commissionsComplete && row.commissionsComplete;
        previous.feesTotal = (previous.feesTotal || 0) + (row.feesTotal || 0);
        previous.cashQuantity = (previous.cashQuantity || 0) + (row.cashQuantity || 0);
        previous.marginQuantity = (previous.marginQuantity || 0) + (row.marginQuantity || 0);
        const allocationTypes = Array.from(new Set([
          ...(previous.allocationTypes || [previous.allocationType]),
          ...(row.allocationTypes || [row.allocationType])
        ]));
        const knownTypes = allocationTypes.filter((type) => type !== 'unclassified');
        previous.allocationTypes = allocationTypes;
        previous.allocationType = knownTypes.length > 1 || knownTypes.includes('mix')
          ? 'mix'
          : knownTypes[0] || 'unclassified';
        const guestTotals = new Map<string, number>();
        [...(previous.guestAllocations || []), ...(row.guestAllocations || [])].forEach((item) => {
          guestTotals.set(item.guestId, (guestTotals.get(item.guestId) || 0) + item.quantity);
        });
        previous.guestAllocations = Array.from(guestTotals.entries())
          .map(([guestId, quantity]) => ({ guestId, quantity }))
          .sort((a, b) => a.guestId.localeCompare(b.guestId));
        previous.unmatchedQuantity = (previous.unmatchedQuantity || 0) + (row.unmatchedQuantity || 0);
        (previous.trade as any).price = totalQty > 0 ? (Number((previous.trade as any).price ?? 0) * oldQty + Number((row.trade as any).price ?? 0) * newQty) / totalQty : (row.trade as any).price;
      } else {
        groups.push({
          ...row,
          trade: { ...(row.trade as any) },
          allocationTypes: [...(row.allocationTypes || [row.allocationType])],
          guestAllocations: [...(row.guestAllocations || [])]
        });
      }
    }
    return groups;
  })();
  // Broker executions are the canonical display source when the same sale
  // also exists as an app-owned closed trade.
  const uniqueAppTrades = deduplicateClosedHistoryRows(appTrades, groupedBrokerRows);
  const getExitTimestamp = (row: any): number => {
    const raw = row.trade?.exitDate ?? row.trade?.sellDate ?? row.trade?.closedAt ?? row.trade?.date;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (raw > 1e12) return raw;
      if (raw > 20000 && raw < 100000) return Date.UTC(1899, 11, 30) + raw * 86400000;
    }
    const parsed = Date.parse(String(raw ?? ''));
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };
  const trades = [...uniqueAppTrades, ...groupedBrokerRows].map((row: any) => {
    const allocation = resolveClosedTradeAllocation(
      row.trade?.shares,
      row.allocationType,
      row.guestAllocations || [],
      state.closedTradeAllocations?.[row.allocationKey],
      row.cashQuantity
    );
    return {
      ...row,
      ...allocation,
      allocationType: allocation.fundingType,
      allocationTypes: [allocation.fundingType]
    };
  }).sort((a, b) => getExitTimestamp(b) - getExitTimestamp(a));
  const tradesPageSize = 10;
  const tradesPageCount = Math.max(1, Math.ceil(trades.length / tradesPageSize));
  // Clamp during render so a shrinking refresh never paints an empty, out-of-range page.
  const safeTradesPage = Math.max(1, Math.min(tradesPage, tradesPageCount));
  const visibleTrades = trades.slice((safeTradesPage - 1) * tradesPageSize, safeTradesPage * tradesPageSize);
  useEffect(() => {
    if (tradesPage !== safeTradesPage) setTradesPage(safeTradesPage);
  }, [tradesPage, safeTradesPage]);
  const realizedNet = trades.reduce((total, row) => total + (row.profit ?? 0), 0);
  const totalFees = trades.reduce((total, row) => total + (Number.isFinite(row.feesTotal) ? row.feesTotal : ((row.fees || 0) + (row.commissions || 0))), 0);
  const hasIncompleteCommissions = trades.some((row: any) => row.commissionsComplete === false);
  const profitKnownTrades = trades.filter((row) => row.profit !== null);
  const hasUnknownProfit = profitKnownTrades.length < trades.length;
  const winningTrades = profitKnownTrades.filter((row) => (row.profit ?? 0) > 0).length;
  const knownDurations = trades.map((row) => Number((row.trade as any).holdingDays ?? (row.trade as any).daysHeld)).filter((days) => Number.isFinite(days) && days >= 0);
  const averageHoldingDays = knownDurations.length ? knownDurations.reduce((total, days) => total + days, 0) / knownDurations.length : null;
  const winRate = profitKnownTrades.length ? (winningTrades / profitKnownTrades.length) * 100 : 0;
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
    <section class="desk-content-reveal rounded-xl border-card p-4 space-y-4" aria-label="Trades">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 class="flex items-center gap-2 text-base font-black uppercase tracking-wider text-purple-300">
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
          </h2>
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

      {cashflowSyncMessage && <p role="alert" class="animate-in fade-in slide-in-from-top-2 duration-200 rounded border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-200 transition-all">{cashflowSyncMessage}</p>}

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
          <div class="text-[10px] text-slate-500">{winningTrades} of {profitKnownTrades.length} records with known profit profitable</div>
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
      
      <div key={tradesPage} class="closed-history-page-transition">
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
                const { trade, index, source, profit: rowProfit, fees: rowFees, commissions: rowCommissions, commissionsComplete } = row;
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
                          <button type="button" aria-pressed={allocationType === 'cash'} onClick={() => persistAllocation('cash', rowQuantity)} class={allocationType === 'cash' ? 'rounded bg-cyan-950 px-2 py-1 text-[10px] font-bold text-cyan-300' : 'rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-300'}>Cash</button>
                          <button type="button" aria-pressed={allocationType === 'margin'} onClick={() => persistAllocation('margin', 0, '')} class={allocationType === 'margin' ? 'rounded bg-amber-950 px-2 py-1 text-[10px] font-bold text-amber-300' : 'rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-300'}>Margin</button>
                          <button type="button" aria-pressed={allocationType === 'mix'} onClick={() => persistAllocation('mix', allocationType === 'cash' ? rowQuantity : row.cashQuantity)} class={allocationType === 'mix' ? 'rounded bg-violet-950 px-2 py-1 text-[10px] font-bold text-violet-300' : 'rounded px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-300'}>Mix</button>
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
                      class={`py-2.5 px-3 text-right font-bold whitespace-nowrap font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {netProfit === null ? "—" : sign + "$" + formatUSD(Math.abs(netProfit))}
                    </td>
                    </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableScrollRegion>
      </div>
      {trades.length > 0 && (
        <div class="closed-history-pagination flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 px-1 pt-3 text-xs" aria-label="Closed history pagination">
          <span class="text-slate-500" aria-live="polite">
            Showing {(safeTradesPage - 1) * tradesPageSize + 1}–{Math.min(safeTradesPage * tradesPageSize, trades.length)} of {trades.length} trades
          </span>
          <div class="closed-history-pagination-controls flex items-center gap-2">
            <button type="button" onClick={() => setTradesPage(Math.max(1, safeTradesPage - 1))} disabled={safeTradesPage <= 1} class="table-pagination-button rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-purple-700 hover:text-white disabled:cursor-not-allowed" aria-label="Previous closed history page" aria-controls="closedTradesTableBody">&lt;</button>
            <span class="table-pagination-current min-w-16 text-center font-mono text-slate-400" aria-current="page" aria-live="polite">Page {safeTradesPage} / {tradesPageCount}</span>
            <button type="button" onClick={() => setTradesPage(Math.min(tradesPageCount, safeTradesPage + 1))} disabled={safeTradesPage >= tradesPageCount} class="table-pagination-button rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-purple-700 hover:text-white disabled:cursor-not-allowed" aria-label="Next closed history page" aria-controls="closedTradesTableBody">&gt;</button>
          </div>
        </div>
      )}
    </section>
  );
}