import { useState, useEffect } from 'preact/hooks';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatQuoteMetadata } from '../utils/formatters';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';
import { QuoteDetails, ActiveTrancheType } from '../types/portfolio';
import { getActiveTranchesFromTrades, normalizeActiveTrancheMix, FreedomExecutedTradeLike } from '../domain/freedomPortfolio';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { listUsers, type AuthUser } from '../services/api';
import { getAssignableActiveTrancheCashQuantity } from '../domain/activeTrancheGuestAssignment';
import { getGuestAssignedCashHoldings } from '../domain/guestPortfolio';

const BADGE_STYLES: Record<string, string> = {
  bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
  neutral: 'border-slate-700 bg-slate-900 text-slate-300',
  unknown: 'border-slate-800 bg-slate-950 text-slate-500'
};

export function formatDailyQuoteRange(details: Pick<QuoteDetails, 'high' | 'low'>): string {
  return `H ${formatUSD(details.high)} / L ${formatUSD(details.low)}`;
}

function renderDailyQuoteSubtext(details?: QuoteDetails | null) {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const parts: string[] = [];
  let colorClass = 'text-slate-400';

  if (hasChange && details.change !== undefined && details.changePercent !== undefined) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(
      `${sign}${formatUSD(Math.abs(details.change))}`
    );
    colorClass =
      details.change > 0
        ? 'text-emerald-400'
        : details.change < 0
          ? 'text-rose-400'
          : 'text-slate-400';
  }

  if (hasRange) {
    parts.push(formatDailyQuoteRange(details));
  }

  return (
    <span class={`mt-0.5 block text-[9px] font-normal tabular-nums ${colorClass}`}>
      Day: {parts.join(' · ')}
    </span>
  );
}

export function CashCushionDesk({ showActiveTranches = false, isAdmin = false, guestUserId }: { showActiveTranches?: boolean; isAdmin?: boolean; guestUserId?: string } = {}) {
  const state = usePortfolio();
  const refreshIntervalMs = useQuoteRefreshInterval();
  const [executedTrades, setExecutedTrades] = useState<FreedomExecutedTradeLike[]>(() =>
    Array.isArray(state.brokerExecutedTrades) ? state.brokerExecutedTrades as FreedomExecutedTradeLike[] : []
  );
  const [expandedMixTranches, setExpandedMixTranches] = useState<Set<string>>(() => new Set());
  const [guestUsers, setGuestUsers] = useState<AuthUser[]>([]);
  const [guestUsersLoading, setGuestUsersLoading] = useState(showActiveTranches);
  const [guestUsersError, setGuestUsersError] = useState('');

  useEffect(() => {
    const removeTradesListener = addBrokerEventListener('broker:executed-trades', (trades) => {
      setExecutedTrades(trades as unknown as FreedomExecutedTradeLike[]);
    });
    const removeErrorListener = addBrokerEventListener('broker:executed-trades-error', () => setExecutedTrades([]));
    emitBrokerEvent('broker:request-executed-trades');
    return () => {
      removeTradesListener();
      removeErrorListener();
    };
  }, []);

  useEffect(() => {
    if (!showActiveTranches) return;
    let cancelled = false;
    setGuestUsersLoading(true);
    listUsers()
      .then((users) => {
        if (!cancelled) {
          setGuestUsers(users.filter((user) => user.role === 'guest'));
          setGuestUsersError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setGuestUsers([]);
          setGuestUsersError(error instanceof Error ? error.message : 'Could not load guest accounts.');
        }
      })
      .finally(() => {
        if (!cancelled) setGuestUsersLoading(false);
      });
    return () => { cancelled = true; };
  }, [showActiveTranches]);

  const activeTranches = getActiveTranchesFromTrades(executedTrades, state.brokerAccountInfo);
  const guestHoldings = guestUserId
    ? getGuestAssignedCashHoldings({
      guestId: guestUserId,
      activeTranches,
      assignments: state.activeTrancheGuestAssignments,
      types: state.activeTrancheTypes,
      mixes: state.activeTrancheMixes,
      cashHoldings: state.cashCushion?.holdings || []
    })
    : [];
  const holdings = isAdmin ? state.cashCushion?.holdings || [] : guestHoldings;
  const setActiveTrancheType = (
    ticker: string,
    type: ActiveTrancheType,
    mix?: { cash: number; margin: number }
  ) => {
    emitBrokerEvent('broker:set-active-tranche-type', {
      ticker, type, ...(mix ? { mix } : {})
    });
  };

  const [activeTranchesExpanded, setActiveTranchesExpanded] = useState(false);

  const stocksTotal = holdings.reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + (Number(h.shares) || 0) * price;
  }, 0);

  const adminHoldingGroups = isAdmin ? guestUsers.map((guest) => ({
    key: guest.id,
    label: guest.name || guest.id,
    holdings: getGuestAssignedCashHoldings({
      guestId: guest.id,
      activeTranches,
      assignments: state.activeTrancheGuestAssignments,
      types: state.activeTrancheTypes,
      mixes: state.activeTrancheMixes,
      cashHoldings: state.cashCushion?.holdings || []
    })
  })).filter((group) => group.holdings.length > 0) : [];

  const assignedByTicker = new Map<string, number>();
  adminHoldingGroups.forEach((group) => group.holdings.forEach((holding) => {
    assignedByTicker.set(holding.ticker, (assignedByTicker.get(holding.ticker) || 0) + holding.shares);
  }));
  const unassignedHoldings = isAdmin ? holdings.flatMap((holding) => {
    const shares = Math.max(0, Number(holding.shares || 0) - (assignedByTicker.get(holding.ticker) || 0));
    return shares > 1e-8 ? [{ ...holding, shares }] : [];
  }) : [];

  const displayHoldingGroups = isAdmin
    ? [
      ...adminHoldingGroups,
      ...(unassignedHoldings.length ? [{ key: 'unassigned', label: 'Unassigned · shared holdings', holdings: unassignedHoldings }] : [])
    ]
    : [{ key: 'guest', label: '', holdings }];
  const displayHoldings = displayHoldingGroups.flatMap((group) =>
    group.holdings.map((holding, index) => ({
      ...holding,
      groupKey: group.key,
      groupLabel: group.label,
      isGroupStart: index === 0
    }))
  );

  return (
    <>
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <h2 class="text-lg font-black text-cyan-400 tracking-wide">
            {guestUserId ? 'YOUR ASSIGNED STOCKS' : isAdmin ? 'CASH & NON-MARGIN HOLDINGS' : 'BALANCE'}
          </h2>
        </div>
      </div>

      <div class="space-y-2">
        {guestUserId ? (
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Your active stock cards">
            {guestHoldings.length === 0 ? (
              <div class="col-span-full rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">No active cash-funded stocks are linked to your account yet.</div>
            ) : guestHoldings.map((holding) => {
              const shares = Number(holding.shares) || 0;
              const price = Number(holding.currentPrice ?? holding.price) || 0;
              const marketValue = shares * price;
              const averagePrice = Number(holding.averagePrice);
              const hasCost = Number.isFinite(averagePrice) && averagePrice > 0;
              const costValue = hasCost ? shares * averagePrice : null;
              const pnl = costValue !== null ? marketValue - costValue : null;
              const pnlPercent = costValue && costValue > 0 ? pnl! / costValue * 100 : null;
              const change = holding.quoteDetails?.changePercent;
              return (
                <article key={holding.ticker} class="rounded-xl border border-slate-800 bg-slate-950/60 p-4 shadow-sm">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h3 class="text-lg font-black tracking-wide text-cyan-300">{holding.ticker}</h3>
                      <p class="mt-1 text-[10px] uppercase tracking-wider text-slate-500">Assigned active shares</p>
                    </div>
                    {Number.isFinite(change) && <span class={`rounded-full border px-2 py-1 text-[10px] font-bold ${Number(change) >= 0 ? 'border-emerald-900 bg-emerald-950/40 text-emerald-300' : 'border-rose-900 bg-rose-950/40 text-rose-300'}`}>{Number(change) > 0 ? '+' : ''}{Number(change).toFixed(2)}%</span>}
                  </div>
                  <div class="mt-4">
                    <p class="text-[10px] uppercase tracking-wider text-slate-500">Current market value</p>
                    <p class="mt-1 text-2xl font-black tabular-nums text-white">{formatUSD(marketValue)}</p>
                  </div>
                  <div class="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
                    <div><p class="text-[10px] text-slate-500">Assigned shares</p><p class="mt-1 font-mono text-sm font-bold text-slate-200">{shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}</p></div>
                    <div><p class="text-[10px] text-slate-500">Price · share</p><p class="mt-1 font-mono text-sm font-bold text-emerald-300">{price > 0 ? formatUSD(price) : '—'}</p></div>
                    <div><p class="text-[10px] text-slate-500">Avg. entry</p><p class="mt-1 font-mono text-sm text-slate-300">{hasCost ? formatUSD(averagePrice) : '—'}</p></div>
                    <div><p class="text-[10px] text-slate-500">Unrealized P/L</p><p class={`mt-1 font-mono text-sm font-bold ${pnl === null ? 'text-slate-500' : pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{pnl === null ? '—' : `${pnl >= 0 ? '+' : '−'}${formatUSD(Math.abs(pnl))}`}{pnlPercent !== null ? <span class="block text-[10px] font-normal">{pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%</span> : null}</p></div>
                  </div>
                  <p class="mt-3 text-[9px] text-slate-500">{formatQuoteMetadata(holding, refreshIntervalMs)}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <div class="table-scroll-wrapper overflow-x-auto">
            <table class="w-full min-w-[1040px] table-fixed text-left text-xs border-collapse">
              <thead>
                <tr class="border-b border-slate-800 text-slate-400 font-medium">
                  <th class="w-[12%] py-2 px-2">Ticker</th>
                  <th class="w-[9%] py-2 px-2 text-right whitespace-nowrap">Shares</th>
                  <th class="w-[12%] py-2 px-2 text-right whitespace-nowrap">Price · Mkt</th>
                  <th class="w-[12%] py-2 px-2 text-right whitespace-nowrap">Avg Bought</th>
                  <th class="w-[16%] py-2 px-2 text-right whitespace-nowrap">Avg Value</th>
                  <th class="w-[16%] py-2 px-2 text-right whitespace-nowrap">Mkt Value</th>
                  <th class="w-[13%] py-2 px-2 text-right whitespace-nowrap">P/L</th>
                  <th class="w-[10%] py-2 px-2 text-right whitespace-nowrap">Eq. Alloc</th>
                </tr>
              </thead>
              <tbody id="cashStocksTableBody" class="divide-y divide-slate-800/60 font-mono">
                {displayHoldings.length === 0 ? (
                  <tr>
                    <td colSpan={8} class="py-3 text-center text-slate-500 italic">
                      {!isAdmin && !guestUserId ? 'Verifying account access…' : guestUserId ? 'No active cash-funded stocks are linked to your account.' : 'No broker-reported cash holdings available.'}
                    </td>
                  </tr>
                ) : (
                  displayHoldings.map((h) => {
                    const shares = Number(h.shares) || 0;
                    const price = Number(h.currentPrice ?? h.price) || 0;
                    const averagePrice = Number(h.averagePrice);
                    const hasAveragePrice = Number.isFinite(averagePrice) && averagePrice > 0;
                    const hasMarketComparison = hasAveragePrice && price > 0;
                    const averageValue = hasAveragePrice ? shares * averagePrice : null;
                    const val = shares * price;
                    const totalDifference = hasMarketComparison ? val - averageValue! : null;
                    const totalDifferencePercent = hasMarketComparison && averageValue! > 0
                      ? (totalDifference! / averageValue!) * 100
                      : null;
                    const allocation = stocksTotal > 0 ? (val / stocksTotal) * 100 : 0;
                    const quoteMeta = formatQuoteMetadata(h, refreshIntervalMs);

                    const hasChange = Number.isFinite(h.quoteDetails?.change);
                    const direction: SentimentDirection = hasChange
                      ? h.quoteDetails!.change! > 0
                        ? 'bullish'
                        : h.quoteDetails!.change! < 0
                          ? 'bearish'
                          : 'neutral'
                      : 'unknown';
                    const badgeText =
                      hasChange && h.quoteDetails?.changePercent !== undefined
                        ? `${h.quoteDetails.changePercent.toFixed(2)}%`
                        : sentimentLabel(direction);

                    return (
                      <>
                        {isAdmin && h.isGroupStart && <tr key={`group-${h.groupKey}`} class="border-t border-slate-700 bg-slate-900/70">
                          <td colSpan={8} class="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cyan-300">{h.groupLabel}</td>
                        </tr>}
                        <tr key={`${h.groupKey}-${h.ticker}`} class="hover:bg-slate-900/40">
                          <td class="py-2 px-3 text-cyan-300 font-bold">
                            <div class="inline-flex items-center gap-1.5">
                              <span>{h.ticker}</span>
                              <span
                                data-sentiment={direction}
                                title={
                                  direction === 'unknown'
                                    ? 'The selected data source did not provide a sentiment signal.'
                                    : 'A directional marker based only on the provider values shown in this section.'
                                }
                                class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${BADGE_STYLES[direction] || BADGE_STYLES.unknown
                                  }`}
                              >
                                {badgeText}
                              </span>
                            </div>
                          </td>
                          <td class="py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap">
                            {shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                          </td>
                          <td class="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums whitespace-nowrap">
                            <span>{formatUSD(price)}</span>
                            {renderDailyQuoteSubtext(h.quoteDetails)}
                            <span class="mt-0.5 block text-[9px] font-normal text-slate-500">
                              {quoteMeta}
                            </span>
                          </td>
                          <td class="py-2 px-3 text-right text-slate-200 font-semibold tabular-nums whitespace-nowrap">
                            {hasAveragePrice ? formatUSD(averagePrice) : '—'}
                          </td>
                          <td class="py-2 px-3 text-right text-slate-200 font-semibold tabular-nums whitespace-nowrap">
                            {averageValue !== null ? formatUSD(averageValue) : '—'}
                          </td>
                          <td class="py-2 px-3 text-right text-white font-semibold tabular-nums whitespace-nowrap">
                            {formatUSD(val)}
                          </td>
                          <td class="py-2 px-3 text-right font-semibold tabular-nums whitespace-nowrap">
                            {hasMarketComparison ? (
                              <span
                                class={
                                  totalDifference! > 0
                                    ? 'text-emerald-400'
                                    : totalDifference! < 0
                                      ? 'text-rose-400'
                                      : 'text-slate-400'
                                }
                                title="Market value minus average purchase value"
                              >
                                {totalDifference! > 0 ? '+' : totalDifference! < 0 ? '−' : ''}
                                {formatUSD(Math.abs(totalDifference!))}
                                <span class="block text-[10px] font-normal">
                                  {totalDifferencePercent! > 0 ? '+' : ''}
                                  {totalDifferencePercent!.toFixed(2)}%
                                </span>
                              </span>
                            ) : (
                              <span class="text-slate-500">—</span>
                            )}
                          </td>
                          <td class="py-2 px-3 text-right text-slate-300 tabular-nums">
                            {allocation.toFixed(1)}%
                          </td>
                        </tr>
                      </>
                    );
                  })
                )}
              </tbody>
              <tfoot id="cashStocksTableFooter" class="border-t border-slate-700 font-mono">
                {holdings.length > 0 && (
                  <tr>
                    <td class="py-2 px-3 text-slate-300 font-bold" colSpan={6}>
                      {holdings.length} holding{holdings.length === 1 ? '' : 's'}
                    </td>
                    <td class="py-2 px-3 text-right text-white font-bold">
                      {formatUSD(stocksTotal)}
                    </td>
                    <td class="py-2 px-3 text-right text-slate-300 font-bold">
                      {stocksTotal > 0 ? '100.0%' : '—'}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}

        {showActiveTranches && <section class="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2" id="activeTranches" aria-labelledby="activeTranchesHeading">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h2 id="activeTranchesHeading" class="text-sm font-black uppercase tracking-wide text-cyan-300">Active Tranches ({activeTranches.length})</h2>
              <p class="mt-0.5 text-[10px] text-slate-500">Open purchases from Freedom trade history · new operations default to Cash</p>
            </div>
            <div class="flex items-center gap-2">
              <span class={`text-[10px] font-bold uppercase tracking-wide ${state.brokerAccountInfo?.status === 'stale' ? 'text-amber-400' : state.brokerAccountInfo?.loaded ? 'text-emerald-400' : 'text-slate-500'}`}>
                {state.brokerAccountInfo?.status === 'stale' ? 'Broker data stale' : executedTrades.length ? 'Trades synced' : 'Waiting for trade history'}
              </span>
              <button type="button" aria-expanded={activeTranchesExpanded} aria-controls="activeTranchesTable" onClick={() => setActiveTranchesExpanded((expanded) => !expanded)} class="rounded border border-slate-700 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-slate-900">
                {activeTranchesExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>
          <div
            id="activeTranchesPanel"
            class={`expandable-motion ${activeTranchesExpanded ? 'is-expanded' : ''}`}
            aria-hidden={!activeTranchesExpanded}
          >
            <div class="expandable-motion__inner">
              <div class="table-scroll-wrapper overflow-x-auto">
                <table id="activeTranchesTable" class="w-full min-w-[920px] text-left text-xs border-collapse">
                  <thead>
                    <tr class="border-b border-slate-800 text-slate-500">
                      <th class="py-2 px-2">Ticker</th>
                      <th class="py-2 px-2">Purchase date</th>
                      <th class="py-2 px-2 text-right">Shares</th>
                      <th class="py-2 px-2 text-right">Avg. Cost</th>
                      <th class="py-2 px-2 text-right">Value</th>
                      <th class="py-2 px-2 text-center">Operation</th>
                      <th class="py-2 px-2 text-center">Guest · cash shares</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800/60 font-mono">
                    {activeTranches.length === 0 ? (
                      <tr><td colSpan={7} class="py-4 px-2 text-center font-sans text-slate-500 italic">
                        {executedTrades.length ? 'No active purchase operations.' : 'Active purchase operations will appear after Freedom trade history loads.'}
                      </td></tr>
                    ) : activeTranches.map((tranche) => {
                      const type = state.activeTrancheTypes?.[tranche.id] || state.activeTrancheTypes?.[tranche.ticker] || 'cash';
                      const mix = normalizeActiveTrancheMix(
                        tranche.quantity,
                        state.activeTrancheMixes?.[tranche.id] || state.activeTrancheMixes?.[tranche.ticker]
                      );
                      const cashQuantity = getAssignableActiveTrancheCashQuantity(type, tranche.quantity, mix);
                      const assignedGuestId = state.activeTrancheGuestAssignments?.[tranche.id] || '';
                      const updateMixCash = (value: string) => {
                        const requestedCash = Number(value);
                        const cash = Number.isFinite(requestedCash)
                          ? Math.min(tranche.quantity, Math.max(0, requestedCash))
                          : 0;
                        setActiveTrancheType(tranche.id, 'mix', { cash, margin: tranche.quantity - cash });
                      };
                      const updateMixMargin = (value: string) => {
                        const requestedMargin = Number(value);
                        const margin = Number.isFinite(requestedMargin)
                          ? Math.min(tranche.quantity, Math.max(0, requestedMargin))
                          : 0;
                        setActiveTrancheType(tranche.id, 'mix', { cash: tranche.quantity - margin, margin });
                      };
                      const mixExpanded = expandedMixTranches.has(tranche.id);
                      const selectMix = () => {
                        if (type === 'mix') {
                          setExpandedMixTranches((current) => {
                            const next = new Set(current);
                            if (next.has(tranche.id)) next.delete(tranche.id);
                            else next.add(tranche.id);
                            return next;
                          });
                          return;
                        }
                        setActiveTrancheType(
                          tranche.id,
                          'mix',
                          type === 'margin'
                            ? { cash: 0, margin: tranche.quantity }
                            : { cash: tranche.quantity, margin: 0 }
                        );
                        setExpandedMixTranches((current) => new Set(current).add(tranche.id));
                      };
                      return (
                        <tr key={tranche.id} class="hover:bg-slate-900/50">
                          <td class="py-2 px-2 font-bold text-cyan-300">{tranche.ticker}</td>
                          <td class="py-2 px-2 text-slate-400 tabular-nums whitespace-nowrap">{tranche.purchasedAt !== null ? new Date(tranche.purchasedAt).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</td>
                          <td class="py-2 px-2 text-right text-slate-200 tabular-nums">{tranche.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                          <td class="py-2 px-2 text-right text-slate-300 tabular-nums">{tranche.averagePrice !== null ? formatUSD(tranche.averagePrice) : '—'}</td>
                          <td class="py-2 px-2 text-right text-slate-200 tabular-nums">{tranche.marketValue !== null ? formatUSD(tranche.marketValue) : '—'}</td>
                          <td class="py-2 px-2 text-center">
                            <div class="inline-flex rounded-md border border-slate-700 p-0.5" role="group" aria-label={tranche.ticker + ' operation type'}>
                              <button type="button" aria-pressed={type === 'cash'} onClick={() => setActiveTrancheType(tranche.id, 'cash')}
                                class={type === 'cash' ? 'rounded px-2 py-1 text-[10px] font-bold transition bg-cyan-950 text-cyan-300' : 'rounded px-2 py-1 text-[10px] font-bold transition text-slate-500 hover:text-slate-300'}>Cash</button>
                              <button type="button" aria-pressed={type === 'margin'} onClick={() => setActiveTrancheType(tranche.id, 'margin')}
                                class={type === 'margin' ? 'rounded px-2 py-1 text-[10px] font-bold transition bg-amber-950 text-amber-300' : 'rounded px-2 py-1 text-[10px] font-bold transition text-slate-500 hover:text-slate-300'}>Margin</button>
                              <button type="button" aria-pressed={type === 'mix'} aria-expanded={type === 'mix' && mixExpanded} title={type === 'mix' && mixExpanded ? 'Hide cash and margin quantities' : 'Edit cash and margin quantities'} onClick={selectMix}
                                class={type === 'mix' ? 'rounded px-2 py-1 text-[10px] font-bold transition bg-violet-950 text-violet-300' : 'rounded px-2 py-1 text-[10px] font-bold transition text-slate-500 hover:text-slate-300'}>Mix <span aria-hidden="true">{type === 'mix' && mixExpanded ? '−' : '+'}</span></button>
                            </div>
                            <div
                              aria-hidden={!(type === 'mix' && mixExpanded)}
                              class={`overflow-hidden motion-reduce:!transition-none ${type === 'mix' && mixExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                              style={{
                                maxHeight: type === 'mix' && mixExpanded ? '5rem' : '0px',
                                marginTop: type === 'mix' && mixExpanded ? '0.5rem' : '0px',
                                transition: 'max-height 280ms cubic-bezier(0.22, 1, 0.36, 1), margin-top 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease',
                                willChange: 'max-height, opacity, margin-top'
                              }}
                            >
                              <div>
                                {type === 'mix' && (
                                  <div class="flex items-center justify-center gap-2 rounded-md border border-slate-800 bg-slate-950/70 p-2 font-sans">
                                    <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-cyan-300">
                                      Cash
                                      <input
                                        aria-label={tranche.ticker + ' cash shares'}
                                        type="number"
                                        min="0"
                                        max={tranche.quantity}
                                        step="any"
                                        defaultValue={mix.cash}
                                        onBlur={(event) => updateMixCash((event.currentTarget as HTMLInputElement).value)}
                                        class="w-[4.25rem] rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100"
                                      />
                                    </label>
                                    <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-300">
                                      Margin
                                      <input
                                        aria-label={tranche.ticker + ' margin shares'}
                                        type="number"
                                        min="0"
                                        max={tranche.quantity}
                                        step="any"
                                        defaultValue={mix.margin}
                                        onBlur={(event) => updateMixMargin((event.currentTarget as HTMLInputElement).value)}
                                        class="w-[4.25rem] rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100"
                                      />
                                    </label>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td class="py-2 px-2 text-center">
                            {cashQuantity > 0 ? (
                              <div class="flex flex-col items-center gap-1">
                                <select
                                  aria-label={`Guest for ${tranche.ticker} cash tranche`}
                                  value={assignedGuestId}
                                  onChange={(event) => emitBrokerEvent('broker:assign-active-tranche-guest', {
                                    trancheId: tranche.id,
                                    guestId: (event.currentTarget as HTMLSelectElement).value
                                  })}
                                  class="max-w-[11rem] rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] text-slate-200"
                                >
                                  <option value="">Unassigned</option>
                                  {assignedGuestId && !guestUsers.some((user) => user.id === assignedGuestId) && (
                                    <option value={assignedGuestId}>Guest unavailable</option>
                                  )}
                                  {guestUsers.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
                                </select>
                                <span class="text-[9px] tabular-nums text-slate-500">
                                  {cashQuantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} cash shares
                                </span>
                                {guestUsersError && <span class="max-w-[12rem] text-[9px] text-amber-400">{guestUsersError}</span>}
                                {!guestUsersLoading && guestUsers.length === 0 && !guestUsersError && (
                                  <span class="text-[9px] text-slate-500">No guest accounts</span>
                                )}
                              </div>
                            ) : (
                              <span class="text-[10px] text-slate-600">No cash allocation</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {activeTranches.length > 0 && <tfoot class="border-t border-slate-700"><tr>
                    <td colSpan={7} class="px-2 py-2 text-[10px] text-slate-500">{activeTranches.length} active purchase operation{activeTranches.length === 1 ? '' : 's'} · same-ticker purchases within 5 minutes are grouped</td>
                  </tr></tfoot>}
                </table>
              </div>
            </div>
          </div>
        </section>}
      </div>
    </>
  );
}