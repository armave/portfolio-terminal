import { useEffect, useRef, useState } from 'preact/hooks';
import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';
import { getAppLanguage } from '../services/i18n';
import { fetchFreedomCashflows, pullCloudHistory, pushCloudHistory } from '../services/api';
import { loadSavedHistory, saveSavedHistory } from '../services/storage';
import { applyCashflowAllocationsToBrokerExecutions, applyCashflowAllocationsToClosedTrades, deduplicateClosedHistoryRows, preservePersistedBrokerFeeAllocations, resolveClosedTradeFeeBreakdown, resolveClosedTradeNetProfit } from '../domain/closedHistoryFees';
import { mergeFreedomCashflowRows, normalizeFreedomCashflowRows, type NormalizedFreedomCashflow } from '../domain/freedomCashflows';
import { calculateFreedomMarginFeeAllocations } from '../domain/freedomMarginFees';
import { calculateBrokerExecutionMetrics, normalizeExecutionTicker } from '../domain/brokerExecutionMetrics';
import { DeskLoading } from './DeskLoading';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';

export function ClosedHistoryDesk() {
  const state = usePortfolio();
  const [brokerTrades, setBrokerTrades] = useState<any[]>([]);
  const [brokerTradesLoading, setBrokerTradesLoading] = useState(true);
  const [brokerTradesError, setBrokerTradesError] = useState(false);
  const [cashflowSyncMessage, setCashflowSyncMessage] = useState('');
  const [cashflowHistoryReady, setCashflowHistoryReady] = useState(false);
  const [cashflowSyncReady, setCashflowSyncReady] = useState(false);
  const [cashflowAllocationReady, setCashflowAllocationReady] = useState(false);
  const [tradesPage, setTradesPage] = useState(1);
  const lastRecalculationKey = useRef('');
  const historyHydrated = useRef(false);
  const cashflowSyncStarted = useRef(false);
  // Load cloud history once. An existing cloud history record is authoritative;
  // local history is used only when no cloud record exists.
  useEffect(() => {
    let active = true;
    void pullCloudHistory().then(async history => {
      if (!active) return;
      const current = portfolioStore.getState();
      const saved = loadSavedHistory();
      const localCashflows = current.cashflows?.length ? current.cashflows : saved.cashflows;
      const currentExecutions = current.brokerExecutedTrades?.length ? current.brokerExecutedTrades : saved.brokerExecutedTrades;
      // Current memory may have just hydrated raw broker executions before this
      // cloud-history read completed. Enrich it from persisted calculated rows by
      // execution ID before deciding which copy is safe to restore.
      const localExecutions = preservePersistedBrokerFeeAllocations(
        currentExecutions,
        saved.brokerExecutedTrades
      );
      const cloud = history || { brokerExecutedTrades: [], cashflows: [] };
      historyHydrated.current = true;
      // Once the dedicated cloud history record exists, it is authoritative.
      // Prefer local snapshots only when the cloud record is absent; otherwise
      // stale local copies cause an immediate second POST after migration/load.
      const cloudExecutions = preservePersistedBrokerFeeAllocations(
        cloud.brokerExecutedTrades || [],
        [...saved.brokerExecutedTrades, ...localExecutions]
      );
      const resolved = history ? {
        brokerExecutedTrades: cloudExecutions,
        cashflows: cloud.cashflows || []
      } : {
        brokerExecutedTrades: localExecutions,
        cashflows: localCashflows
      };
      portfolioStore.setState(resolved);
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
        portfolioStore.setState({
          brokerExecutedTrades: current.brokerExecutedTrades?.length ? current.brokerExecutedTrades : saved.brokerExecutedTrades,
          cashflows: current.cashflows?.length ? current.cashflows : saved.cashflows
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
    const sourceExecutions = executions.map((trade: any) =>
      Object.fromEntries(Object.entries(trade).filter(([field]) => !calculatedFields.has(field)))
    );
    const key = JSON.stringify({ cashflows, executions: sourceExecutions });
    if (key === lastRecalculationKey.current) {
      setCashflowAllocationReady(true);
      return;
    }
    setCashflowAllocationReady(false);
    void processCashflowRows(cashflows).then((success) => {
      if (success) lastRecalculationKey.current = key;
      setCashflowAllocationReady(true);
    });
  }, [cashflowHistoryReady, cashflowSyncReady, brokerTradesLoading, state.cashflows, state.brokerExecutedTrades, brokerTrades]);
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
      const brokerExecutions = [...(storedBrokerExecutions.length ? storedBrokerExecutions : brokerTrades)] as any[];
      const appTrades = [...(state.closedTrades || [])] as any[];
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
      if (Object.keys(nextState).length) portfolioStore.setState(nextState);
      // Persist computed fee allocations immediately; navigation to Balance may
      // trigger unrelated portfolio saves and a fresh broker-history hydration.
      saveSavedHistory({
        brokerExecutedTrades: brokerExecutions.length ? updatedExecutions : (portfolioStore.getState().brokerExecutedTrades || []),
        cashflows: cashflowRows
      });
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
      if (updatedTradeCount > 0 && brokerExecutions.length) setBrokerTrades(updatedExecutions);
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
      const response = await fetchFreedomCashflows();
      const fetchedRows = normalizeFreedomCashflowRows(response);
      const existingRows = portfolioStore.getState().cashflows || [];
      const mergedRows = mergeFreedomCashflowRows(existingRows, fetchedRows);

      if (mergedRows.length > 0) {
        const saved = await processCashflowRows(mergedRows, true);
        if (!saved) return;
      }

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
    const persistBrokerTrades = (trades: any[]) => {
      const stored = portfolioStore.getState().brokerExecutedTrades || [];
      const storedById = new Map<string, any>(stored.map((trade: any) => [String(trade.id ?? ''), trade] as [string, any]));
      const normalizedRaw = trades.map((trade: any) => {
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
          netProfit: previous?.netProfit ?? trade?.netProfit
        };
      });
      // In-memory rows can contain explicit empty allocation objects from a
      // pre-hydration broker response. Restore real saved allocations by ID before
      // writing these rows into the canonical store or triggering cloud sync.
      const savedFeeRows = loadSavedHistory().brokerExecutedTrades;
      const normalized = preservePersistedBrokerFeeAllocations(
        normalizedRaw,
        [...savedFeeRows, ...stored]
      );
      setBrokerTrades(normalized);
      setBrokerTradesLoading(false);
      setBrokerTradesError(false);
      // Persist the normalized source rows in canonical state so they survive
      // refresh and can be reapplied after broker history has hydrated.
      const current = portfolioStore.getState().brokerExecutedTrades || [];
      // Compare the complete normalized execution history, not a subset of
      // display fields. Incoming closed-trade metadata must sync just like cashflows.
      const fingerprint = (rows: any[]) => JSON.stringify(rows);
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
      if (Array.isArray(saved) && saved.length) persistBrokerTrades(saved);
    };
    readCurrentTrades();
    // Trades requests a refresh on mount; the canonical cache remains in portfolioStore.
    const removeTradesListener = addBrokerEventListener('broker:executed-trades', (trades) => {
      persistBrokerTrades(trades);
    });
    const removeErrorListener = addBrokerEventListener('broker:executed-trades-error', () => {
      setBrokerTradesLoading(false);
      setBrokerTradesError(true);
    });
    emitBrokerEvent('broker:request-executed-trades');
    return () => {
      removeTradesListener();
      removeErrorListener();
    };
  }, []);
  const appTrades = (state.closedTrades || []).map((trade, index) => {
    const feeBreakdown = resolveClosedTradeFeeBreakdown(trade as any);
    const profit = resolveClosedTradeNetProfit(trade as any, feeBreakdown);
    return {
      trade: { ...(trade as any), source: 'app' as const }, index, source: 'app' as const,
      profit,
      commissionsComplete: feeBreakdown.commissionsKnown,
      ...feeBreakdown
    };
  });
  const brokerTradeMetrics = calculateBrokerExecutionMetrics(brokerTrades);
  const brokerRows = brokerTrades.filter((broker: any) => ['sell', 's', 'sale', 'sold', '2'].includes(String(broker.side ?? '').toLowerCase())).map((broker: any, index) => {
    const allocatedMarginFee = Object.values((broker.marginFeeAllocations || {}) as Record<string, number>)
      .reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    const marginFee = Number((broker.marginFeeAllocations && typeof broker.marginFeeAllocations === 'object')
      ? allocatedMarginFee
      : broker.marginFee ?? 0) || 0;
    const metrics = brokerTradeMetrics.get(broker);
    const rawSellCommission = broker.commission === null || broker.commission === undefined || broker.commission === ''
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
    return {
      trade: { id: broker.id ?? ('tradenet-' + index), ticker, shares: broker.quantity, exitDate: broker.executedAt, sellDate: broker.executedAt, holdingDays: metrics?.holdingDays ?? null, feesAndCommissions: totalFees, netProfit: profit, side: broker.side, price: broker.price, source: 'tradenet' as const },
      index: -1,
      source: 'tradenet' as const,
      profit,
      fees,
      commissions,
      commissionsComplete,
      feesTotal: totalFees
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
        (previous.trade as any).price = totalQty > 0 ? (Number((previous.trade as any).price ?? 0) * oldQty + Number((row.trade as any).price ?? 0) * newQty) / totalQty : (row.trade as any).price;
      } else {
        groups.push({ ...row, trade: { ...(row.trade as any) } });
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
  const trades = [...uniqueAppTrades, ...groupedBrokerRows].sort((a, b) => getExitTimestamp(b) - getExitTimestamp(a));
  const tradesPageSize = 10;
  const tradesPageCount = Math.max(1, Math.ceil(trades.length / tradesPageSize));
  const visibleTrades = trades.slice((tradesPage - 1) * tradesPageSize, tradesPage * tradesPageSize);
  useEffect(() => {
    if (tradesPage > tradesPageCount) setTradesPage(tradesPageCount);
  }, [tradesPage, tradesPageCount]);
  const realizedNet = trades.reduce((total, row) => total + (row.profit ?? 0), 0);
  const totalFees = trades.reduce((total, row) => total + (Number.isFinite(row.feesTotal) ? row.feesTotal : ((row.fees || 0) + (row.commissions || 0))), 0);
  const hasIncompleteCommissions = trades.some((row: any) => row.commissionsComplete === false);
  const profitKnownTrades = trades.filter((row) => row.profit !== null);
  const hasUnknownProfit = profitKnownTrades.length < trades.length;
  const winningTrades = profitKnownTrades.filter((row) => (row.profit ?? 0) > 0).length;
  const knownDurations = trades.map((row) => Number((row.trade as any).holdingDays ?? (row.trade as any).daysHeld)).filter((days) => Number.isFinite(days) && days >= 0);
  const averageHoldingDays = knownDurations.length ? knownDurations.reduce((total, days) => total + days, 0) / knownDurations.length : null;
  const winRate = profitKnownTrades.length ? (winningTrades / profitKnownTrades.length) * 100 : 0;

  if (brokerTradesLoading || !cashflowHistoryReady || !cashflowSyncReady || !cashflowAllocationReady) {
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
          <h2 class="text-base font-black uppercase tracking-wider text-purple-300">
            Trades
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
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Closed trade performance summary">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{hasUnknownProfit ? 'Known net P&amp;L' : 'Realized net P&amp;L'}</div>
          <div class={`mt-1 font-mono text-sm font-bold ${realizedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {realizedNet >= 0 ? '+' : '−'}${formatUSD(Math.abs(realizedNet))}
          </div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Win rate</div>
          <div class="mt-1 font-mono text-sm font-bold text-white">{winRate.toFixed(1)}%</div>
          <div class="text-[10px] text-slate-500">{winningTrades} of {profitKnownTrades.length} records with known profit profitable</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fees &amp; commissions</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">{hasIncompleteCommissions ? '≥' : ''}${formatUSD(totalFees)}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Avg. holding time</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">{averageHoldingDays === null ? '—' : averageHoldingDays.toFixed(1) + ' days'}</div>
        </div>
      </div>

      <div class="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table class="w-full text-left text-xs font-mono">
          <thead class="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th class="py-2.5 px-3">Ticker</th>
              <th class="py-2.5 px-3">Date Closed</th>
              <th class="py-2.5 px-3 text-right">Shares</th>
              <th class="py-2.5 px-3 text-right">Duration</th>
              <th class="py-2.5 px-3 text-right">Fees</th>
              <th class="py-2.5 px-3 text-right">Commissions</th>
              <th class="py-2.5 px-3 text-right">Net Profit</th>
            </tr>
          </thead>
          <tbody id="closedTradesTableBody" class="divide-y divide-slate-800/60">
            {brokerTradesLoading && brokerTrades.length === 0 ? (
              <tr><td colSpan={7} class="py-8 text-center text-slate-400">
                <span class="inline-flex items-center gap-2"><span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-purple-400" aria-hidden="true" />Loading closed trade history…</span>
              </td></tr>
            ) : brokerTradesError && trades.length === 0 ? (
              <tr><td colSpan={7} class="py-8 text-center text-rose-400">Unable to load TradeNet history. Please retry.</td></tr>
            ) : trades.length === 0 ? (
              <tr>
                <td colSpan={7} class="py-8 text-center text-slate-500 italic">
                  No closed trades recorded yet.
                </td>
              </tr>
            ) : (
              visibleTrades.map(({ trade, index, source, profit: rowProfit, fees: rowFees, commissions: rowCommissions, commissionsComplete }) => {
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
      </div>
      {trades.length > 0 && (
        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/70 px-1 pt-3 text-xs" aria-label="Closed history pagination">
          <span class="text-slate-500" aria-live="polite">
            Showing {(tradesPage - 1) * tradesPageSize + 1}–{Math.min(tradesPage * tradesPageSize, trades.length)} of {trades.length} trades
          </span>
          <div class="flex items-center gap-2">
            <button type="button" onClick={() => setTradesPage(page => Math.max(1, page - 1))} disabled={tradesPage <= 1} class="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-purple-700 hover:text-white disabled:cursor-not-allowed" aria-label="Previous closed history page">Previous</button>
            <span class="min-w-16 text-center font-mono text-slate-400">Page {tradesPage} / {tradesPageCount}</span>
            <button type="button" onClick={() => setTradesPage(page => Math.min(tradesPageCount, page + 1))} disabled={tradesPage >= tradesPageCount} class="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-purple-700 hover:text-white disabled:cursor-not-allowed" aria-label="Next closed history page">Next</button>
          </div>
        </div>
      )}
    </section>
  );
}