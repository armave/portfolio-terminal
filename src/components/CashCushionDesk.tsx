import { useState, useEffect, useReducer, useRef } from 'preact/hooks';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatQuoteMetadata } from '../utils/formatters';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';
import { QuoteDetails, ActiveTrancheType } from '../types/portfolio';
import { getActiveTranchesFromTrades, normalizeActiveTrancheMix, FreedomExecutedTradeLike } from '../domain/freedomPortfolio';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { listUsers, normalizeFreedomTrades, type AuthUser } from '../services/api';
import { loadSavedHistory } from '../services/storage';
import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations } from '../domain/closedHistoryFees';
import { brokerExecutionHistoryReducer, createBrokerExecutionHistoryState } from '../domain/brokerExecutionHistoryState';
import { balanceSyncReducer, createBalanceSyncState } from '../domain/balanceSyncState';
import { createGuestDirectoryState, guestDirectoryReducer } from '../domain/guestDirectoryState';
import { getAssignableActiveTrancheCashQuantity } from '../domain/activeTrancheGuestAssignment';
import { getGuestAssignedCashHoldings, getGuestHoldingValuation } from '../domain/guestPortfolio';
import { getAppLanguage, translateText } from '../services/i18n';
import { MarketDepthButton } from './MarketDepthButton';
import { DeskLoading } from './DeskLoading';
import { TableScrollRegion } from './TableScrollRegion';

const BADGE_STYLES: Record<string, string> = {
  bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
  neutral: 'border-slate-700 bg-slate-900 text-slate-300',
  unknown: 'border-slate-800 bg-slate-950 text-slate-500'
};

export function formatDailyQuoteRange(details: Pick<QuoteDetails, 'high' | 'low'>): string {
  return `H ${formatUSD(details.high)} / L ${formatUSD(details.low)}`;
}

export function getCashHoldingMarketPrice(holding: { currentPrice?: unknown; price?: unknown }): number | null {
  const positivePrice = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  return positivePrice(holding.currentPrice) ?? positivePrice(holding.price);
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
  const refreshIntervalMs = useQuoteRefreshInterval(guestUserId ? 15_000 : 60_000, guestUserId ? 'guest' : 'admin');
  const shouldReadBrokerHistory = !guestUserId && (showActiveTranches || isAdmin);
  const [balanceSync, dispatchBalanceSync] = useReducer(
    balanceSyncReducer,
    undefined,
    () => createBalanceSyncState(Boolean(state.brokerAccountInfo?.loaded), isAdmin)
  );
  const [brokerExecutionHistory, dispatchBrokerExecutionHistory] = useReducer(
    brokerExecutionHistoryReducer<FreedomExecutedTradeLike>,
    undefined,
    () => {
      const savedTrades = shouldReadBrokerHistory
        ? normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades)
        : [];
      const currentTrades = shouldReadBrokerHistory && Array.isArray(state.brokerExecutedTrades)
        ? state.brokerExecutedTrades
        : [];
      const completeCachedHistory = mergeBrokerExecutionHistory(
        savedTrades,
        preservePersistedBrokerFeeAllocations(currentTrades, savedTrades)
      );
      return createBrokerExecutionHistoryState(
        completeCachedHistory,
        [],
        shouldReadBrokerHistory
      );
    }
  );
  const brokerExecutionHistoryRef = useRef(brokerExecutionHistory);
  brokerExecutionHistoryRef.current = brokerExecutionHistory;
  const executedTrades = brokerExecutionHistory.trades;
  const executedTradesLoading = brokerExecutionHistory.status === 'loading';
  const retryBalance = () => {
    dispatchBalanceSync({ type: 'refresh' });
    emitBrokerEvent('broker:request-account-info');
  };
  const retryExecutedTrades = () => {
    dispatchBrokerExecutionHistory({ type: 'refresh' });
    emitBrokerEvent('broker:request-executed-trades');
  };
  const [expandedMixTranches, setExpandedMixTranches] = useState<Set<string>>(() => new Set());
  const [guestDirectory, dispatchGuestDirectory] = useReducer(
    guestDirectoryReducer<AuthUser>,
    undefined,
    () => createGuestDirectoryState<AuthUser>(showActiveTranches)
  );
  const guestUsers = guestDirectory.users;
  const guestUsersLoading = guestDirectory.status === 'loading';
  const balanceRefreshing = balanceSync.status === 'refreshing' ||
    brokerExecutionHistory.status === 'refreshing' || executedTradesLoading || guestUsersLoading;
  const guestUsersRequestGeneration = useRef(0);
  const loadGuestUsers = () => {
    const requestId = ++guestUsersRequestGeneration.current;
    dispatchGuestDirectory({ type: 'request' });
    void listUsers()
      .then((users) => {
        if (guestUsersRequestGeneration.current !== requestId) return;
        dispatchGuestDirectory({
          type: 'success',
          users: users.filter((user) => user.role === 'guest')
        });
      })
      .catch((error) => {
        if (guestUsersRequestGeneration.current !== requestId) return;
        console.warn(
          'Unable to refresh guest account list:',
          error instanceof Error ? error.message : 'Unknown error'
        );
        dispatchGuestDirectory({
          type: 'failure',
          message: 'Could not load guest accounts.'
        });
      });
  };
  const retryGuestUsers = () => {
    if (guestDirectory.status === 'loading' || guestDirectory.status === 'refreshing') return;
    loadGuestUsers();
  };

  useEffect(() => {
    if (!isAdmin) return;
    dispatchBalanceSync({
      type: 'snapshot',
      loaded: state.brokerAccountInfo?.loaded === true,
      status: state.brokerAccountInfo?.status
    });
  }, [isAdmin, state.brokerAccountInfo?.loaded, state.brokerAccountInfo?.receivedAt, state.brokerAccountInfo?.status]);

  useEffect(() => {
    if (!isAdmin) return;
    const removeRefreshingListener = addBrokerEventListener('broker:account-info-refreshing', () => {
      dispatchBalanceSync({ type: 'refresh' });
    });
    const removeAccountListener = addBrokerEventListener('broker:account-info', () => {
      dispatchBalanceSync({ type: 'success' });
    });
    const removeAccountErrorListener = addBrokerEventListener('broker:account-info-error', () => {
      dispatchBalanceSync({ type: 'failure' });
    });
    dispatchBalanceSync({ type: 'refresh' });
    emitBrokerEvent('broker:request-account-info');
    return () => {
      removeRefreshingListener();
      removeAccountListener();
      removeAccountErrorListener();
    };
  }, [isAdmin]);

  useEffect(() => {
    // Guests use their assigned portfolio snapshot and must not subscribe to
    // account-wide broker execution events or restore the administrator's history.
    if (!shouldReadBrokerHistory) return;
    const removeTradesListener = addBrokerEventListener('broker:executed-trades', (trades) => {
      const mergedTrades = mergeBrokerExecutionHistory(
        brokerExecutionHistoryRef.current.trades,
        trades
      );
      dispatchBrokerExecutionHistory({ type: 'success', trades: mergedTrades });
    });
    const removeErrorListener = addBrokerEventListener('broker:executed-trades-error', () => {
      // Preserve the last good in-memory or saved snapshot; only mark it stale.
      dispatchBrokerExecutionHistory({ type: 'failure' });
    });
    dispatchBrokerExecutionHistory({ type: 'refresh' });
    emitBrokerEvent('broker:request-executed-trades');
    return () => {
      removeTradesListener();
      removeErrorListener();
    };
  }, []);

  // App startup may finish broker hydration before this lazily mounted desk has
  // installed its event listener. usePortfolio replays the current store snapshot
  // after subscribing; reconcile that snapshot into this reducer as well.
  useEffect(() => {
    if (!shouldReadBrokerHistory) return;
    const currentTrades = state.brokerExecutedTrades;
    if (Array.isArray(currentTrades) && currentTrades.length > 0) {
      dispatchBrokerExecutionHistory({
        type: 'success',
        trades: mergeBrokerExecutionHistory(
          brokerExecutionHistoryRef.current.trades,
          currentTrades
        )
      });
    }
  }, [state.brokerExecutedTrades, shouldReadBrokerHistory]);

  useEffect(() => {
    if (!showActiveTranches) return;
    loadGuestUsers();
    return () => {
      // Ignore a late response after the active-tranche desk unmounts.
      guestUsersRequestGeneration.current += 1;
    };
  }, [showActiveTranches]);

  const activeTrancheSource = guestUserId
    ? (state.guestPortfolioSnapshot?.tranches || [])
    : getActiveTranchesFromTrades(executedTrades, state.brokerAccountInfo);
  const activeTrancheGuestAssignments = guestUserId
    ? Object.fromEntries(activeTrancheSource.map((tranche) => [tranche.id, guestUserId]))
    : state.activeTrancheGuestAssignments;
  const activeTrancheTypes = guestUserId
    ? Object.fromEntries(activeTrancheSource.map((tranche) => [tranche.id, 'cash' as ActiveTrancheType]))
    : state.activeTrancheTypes;
  const activeTrancheMixes = guestUserId ? {} : state.activeTrancheMixes;
  const activeTranches = activeTrancheSource.map((tranche) => {
    const cashHolding = (state.cashCushion?.holdings || []).find(
      (holding) => String(holding.ticker || '').trim().toUpperCase() === tranche.ticker
    );
    const latestPrice = getCashHoldingMarketPrice(cashHolding || {}) ??
      getCashHoldingMarketPrice({ currentPrice: tranche.marketPrice });
    if (latestPrice === null || latestPrice === tranche.marketPrice) return tranche;
    return { ...tranche, marketPrice: latestPrice, marketValue: latestPrice * tranche.quantity };
  });
  const guestHoldings = guestUserId
    ? getGuestAssignedCashHoldings({
      guestId: guestUserId,
      activeTranches,
      assignments: activeTrancheGuestAssignments,
      types: activeTrancheTypes,
      mixes: activeTrancheMixes,
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

  const unpricedHoldingCount = holdings.filter((holding) =>
    Number(holding.shares) > 0 && getCashHoldingMarketPrice(holding) === null
  ).length;
  const pricedHoldingCount = holdings.filter((holding) =>
    Number(holding.shares) > 0 && getCashHoldingMarketPrice(holding) !== null
  ).length;
  const stocksTotal = holdings.reduce((sum, holding) => {
    const price = getCashHoldingMarketPrice(holding);
    const shares = Number(holding.shares);
    return price !== null && Number.isFinite(shares) && shares > 0 ? sum + shares * price : sum;
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
  const renderedMarketDepthTickers = new Set<string>();

  if (isAdmin && balanceSync.status === 'loading' && !balanceSync.hasSnapshot) {
    return <DeskLoading
      title="Preparing balance"
      message="Loading the latest broker account snapshot…"
      accent="cyan"
    />;
  }

  return (
    <div class="desk-content-reveal">
      <style>{`
        @keyframes guest-stock-card-enter {
          from { opacity: 0; transform: translateY(12px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .guest-stock-card-enter {
          animation: guest-stock-card-enter 420ms cubic-bezier(0.2, 0.75, 0.25, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .guest-stock-card-enter { animation: none; }
        }
      `}</style>
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-black text-cyan-400 tracking-wide">
              {guestUserId ? 'MY STOCKS' : isAdmin ? 'CASH & NON-MARGIN HOLDINGS' : 'BALANCE'}
            </h2>
            {balanceRefreshing && (
              <span role="status" aria-label={translateText('Refreshing balance…', getAppLanguage())} title={translateText('Refreshing balance…', getAppLanguage())} class="inline-flex items-center gap-1.5 text-[10px] font-semibold text-cyan-300">
                <svg viewBox="0 0 24 24" aria-hidden="true" class="h-3.5 w-3.5 animate-spin">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
                </svg>
                {translateText('Syncing…', getAppLanguage())}
              </span>
            )}
          </div>
        </div>
      </div>

      {(balanceSync.status === 'stale' || balanceSync.status === 'error') && (
        <div role="alert" aria-live="polite" class="flex flex-col gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{balanceSync.hasSnapshot
            ? translateText('Balance refresh failed. Showing the last saved broker snapshot.', getAppLanguage())
            : translateText('Unable to load the broker balance. Please retry.', getAppLanguage())}</span>
          <button type="button" onClick={retryBalance} aria-label={translateText('Retry balance refresh', getAppLanguage())} class="self-start rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 sm:self-auto">Retry</button>
        </div>
      )}

      {(brokerExecutionHistory.status === 'stale' || brokerExecutionHistory.status === 'error') && (
        <div
          role="alert"
          aria-live="polite"
          class="flex flex-col gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            {brokerExecutionHistory.status === 'stale'
              ? 'TradeNet refresh failed. Showing saved history, which may be out of date.'
              : 'Unable to load TradeNet history. Please retry.'}
          </span>
          <button
            type="button"
            onClick={retryExecutedTrades}
            aria-label="Retry TradeNet history"
            class="self-start rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 sm:self-auto"
          >Retry</button>
        </div>
      )}

      {isAdmin && unpricedHoldingCount > 0 && (
        <div role="status" class="flex flex-col gap-1 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span class="font-semibold">{translateText('Unpriced holdings', getAppLanguage())}: {unpricedHoldingCount}</span>
          <span>{translateText('Their market value and allocation are unavailable until a valid quote is received.', getAppLanguage())}</span>
        </div>
      )}

      <div class="space-y-2">
        {guestUserId ? (
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-2" aria-label="Your active stock cards">
            {guestHoldings.length === 0 ? (
              <div class="col-span-full rounded-lg border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400" role="status">
                <p class="font-semibold text-slate-200">No stocks are assigned to your account yet.</p>
                <p class="mt-2 text-xs leading-relaxed text-slate-500">Ask your administrator to assign the cash-funded portion of an active stock purchase. Your assigned stocks will appear here automatically.</p>
              </div>
            ) : guestHoldings.map((holding) => {
              const {
                shares,
                currentPrice: price,
                marketValue,
                averagePrice,
                unrealizedPnl: pnl,
                unrealizedPnlPercent: pnlPercent
              } = getGuestHoldingValuation(holding);
              const hasMarketPrice = price !== null;
              const hasCost = averagePrice !== null;
              const change = holding.quoteDetails?.changePercent;
              const relatedTranches = activeTranches
                .filter((tranche) => activeTrancheGuestAssignments?.[tranche.id] === guestUserId && tranche.ticker.toUpperCase() === holding.ticker)
                .map((tranche) => {
                  const trancheType = activeTrancheTypes?.[tranche.id] || activeTrancheTypes?.[holding.ticker] || 'cash';
                  const mix = normalizeActiveTrancheMix(
                    tranche.quantity,
                    activeTrancheMixes?.[tranche.id] || activeTrancheMixes?.[holding.ticker]
                  );
                  const assignedShares = getAssignableActiveTrancheCashQuantity(trancheType, tranche.quantity, mix);
                  return { ...tranche, trancheType, mix, assignedShares };
                })
                .filter((tranche) => tranche.assignedShares > 0)
                .sort((a, b) => (b.purchasedAt ?? 0) - (a.purchasedAt ?? 0));
              return (
                <article key={holding.ticker} class="guest-stock-card-enter rounded-xl border border-slate-800 bg-slate-950/60 p-4 shadow-sm">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="flex items-center gap-2">
                        <h3 class="text-lg font-black tracking-wide text-cyan-300">{holding.ticker}</h3>
                      </div>
                    </div>
                    {Number.isFinite(change) && <span class={`rounded-full border px-2 py-1 text-[10px] font-bold ${Number(change) >= 0 ? 'border-emerald-900 bg-emerald-950/40 text-emerald-300' : 'border-rose-900 bg-rose-950/40 text-rose-300'}`}>{Number(change) > 0 ? '+' : ''}{Number(change).toFixed(2)}%</span>}
                  </div>
                  <div class="mt-4">
                    <p class="text-[10px] uppercase tracking-wider text-slate-500">Current market value</p>
                    <p class="mt-1 text-2xl font-black tabular-nums text-white">{marketValue !== null ? formatUSD(marketValue) : '—'}</p>
                    {!hasMarketPrice && <p class="mt-1 text-[10px] leading-relaxed text-amber-300" role="status">Market quote unavailable. Market value and unrealized P/L will appear when a valid quote is received.</p>}
                  </div>
                  <div class="mt-4 grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
                    <div><p class="text-[10px] text-slate-500">Total shares</p><p class="mt-1 font-mono text-lg font-bold text-slate-200">{shares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })}</p></div>
                    <div><p class="text-[10px] text-slate-500">Price · share</p><p class="mt-1 font-mono text-sm font-bold text-emerald-300">{price !== null ? formatUSD(price) : '—'}</p></div>
                    <div><p class="text-[10px] text-slate-500">Avg. entry</p><p class="mt-1 font-mono text-sm text-slate-300">{hasCost ? formatUSD(averagePrice) : '—'}</p></div>
                    <div><p class="text-[10px] text-slate-500">Unrealized P/L</p><p class={`mt-1 font-mono text-sm font-bold ${pnl === null ? 'text-slate-500' : pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{pnl === null ? '—' : `${pnl >= 0 ? '+' : '−'}${formatUSD(Math.abs(pnl))}`}{pnlPercent !== null ? <span class="block text-[10px] font-normal">{pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%</span> : null}</p></div>
                  </div>
                  <div class="mt-4 border-t border-slate-800 pt-3">
                    <div class="mb-2 flex items-center justify-between gap-2">
                      <span class="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-semibold text-slate-300">{relatedTranches.length} {relatedTranches.length === 1 ? 'tranche' : 'tranches'}</span>
                    </div>
                    {relatedTranches.length === 0 ? (
                      <p class="text-[10px] text-slate-500">No active tranche details available.</p>
                    ) : (
                      <div class="space-y-2">
                        {relatedTranches.map((tranche) => {
                          const trancheDate = tranche.purchasedAt !== null
                            ? new Date(tranche.purchasedAt).toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')
                            : 'Date unavailable';
                          return (
                            <div key={tranche.id} class="rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5">
                              <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="text-[10px] font-semibold text-slate-200">{trancheDate}</span>
                              </div>
                              <div class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                                <div><p class="text-[9px] text-slate-500">Shares</p><p class="font-mono text-[11px] font-semibold text-slate-200">{tranche.assignedShares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })}</p></div>
                                <div><p class="text-[9px] text-slate-500">Entry price</p><p class="font-mono text-[11px] text-slate-200">{tranche.averagePrice !== null ? formatUSD(tranche.averagePrice) : '—'}</p></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <p class="mt-3 text-[9px] text-slate-500">{formatQuoteMetadata(holding, refreshIntervalMs)}</p>
                </article>
              );
            })}
          </div>
        ) : (
          <TableScrollRegion label="Cash-funded stock holdings" className="table-scroll-wrapper">
            <table class="cash-holdings-table w-full min-w-[960px] table-fixed text-left text-xs border-collapse">
              <caption class="sr-only">Cash-funded stock holdings</caption>
              <thead>
                <tr class="border-b border-slate-800 text-slate-400 font-medium">
                  <th scope="col" class="w-[12%] py-2 px-2">Ticker</th>
                  <th scope="col" class="w-[9%] py-2 px-2 text-right whitespace-nowrap">Q</th>
                  <th scope="col" class="w-[12%] py-2 px-2 text-right whitespace-nowrap">Mkt</th>
                  <th scope="col" class="w-[12%] py-2 px-2 text-right whitespace-nowrap">Avg B.</th>
                  <th scope="col" class="w-[16%] py-2 px-2 text-right whitespace-nowrap">Avg Val.</th>
                  <th scope="col" class="w-[16%] py-2 px-2 text-right whitespace-nowrap">Mkt Val.</th>
                  <th scope="col" class="w-[13%] py-2 px-2 text-right whitespace-nowrap">P/L</th>
                  <th scope="col" class="w-[10%] py-2 px-2 text-right whitespace-nowrap">Eq. Alloc</th>
                </tr>
              </thead>
              <tbody id="cashStocksTableBody" class="cash-holdings-body divide-y divide-slate-800/60 font-mono">
                {displayHoldings.length === 0 ? (
                  <tr class="cash-holding-empty-row">
                    <td colSpan={8} class="py-3 text-center text-slate-500 italic">
                      {!isAdmin && !guestUserId ? 'Verifying account access…' : guestUserId ? 'No active cash-funded stocks are linked to your account.' : 'No broker-reported cash holdings available.'}
                    </td>
                  </tr>
                ) : (
                  displayHoldings.map((h) => {
                    const shares = Number(h.shares) || 0;
                    const price = getCashHoldingMarketPrice(h);
                    const averagePrice = Number(h.averagePrice);
                    const hasAveragePrice = Number.isFinite(averagePrice) && averagePrice > 0;
                    const hasMarketComparison = hasAveragePrice && price !== null;
                    const averageValue = hasAveragePrice ? shares * averagePrice : null;
                    const val = price === null ? null : shares * price;
                    const totalDifference = hasMarketComparison && val !== null ? val - averageValue! : null;
                    const totalDifferencePercent = hasMarketComparison && averageValue! > 0 && totalDifference !== null
                      ? (totalDifference / averageValue!) * 100
                      : null;
                    const allocation = unpricedHoldingCount === 0 && stocksTotal > 0 && val !== null
                      ? (val / stocksTotal) * 100
                      : null;
                    const quoteMeta = formatQuoteMetadata(h, refreshIntervalMs);
                    const showMarketDepthButton = !renderedMarketDepthTickers.has(h.ticker);
                    renderedMarketDepthTickers.add(h.ticker);

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
                        {isAdmin && h.isGroupStart && <tr key={`group-${h.groupKey}`} class="cash-holding-group-row border-t border-slate-700 bg-slate-900/70">
                          <td colSpan={8} class="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cyan-300">{h.groupLabel}</td>
                        </tr>}
                        <tr key={`${h.groupKey}-${h.ticker}`} class="cash-holding-row hover:bg-slate-900/40">
                          <td data-label="Ticker" class="py-2 px-3 text-cyan-300 font-bold">
                            <div class="inline-flex items-center gap-1.5">
                              <span>{h.ticker}</span>
                              {isAdmin && showMarketDepthButton && <MarketDepthButton ticker={h.ticker} compact />}
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
                          <td data-label="Shares" class="py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap">
                            {shares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })}
                          </td>
                          <td data-label="Market price" class="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums whitespace-nowrap">
                            <span>{price !== null ? formatUSD(price) : '—'}</span>
                            {renderDailyQuoteSubtext(h.quoteDetails)}
                            <span class="mt-0.5 block text-[9px] font-normal text-slate-500">
                              {quoteMeta}
                            </span>
                          </td>
                          <td data-label="Average entry" class="py-2 px-3 text-right text-slate-200 font-semibold tabular-nums whitespace-nowrap">
                            {hasAveragePrice ? formatUSD(averagePrice) : '—'}
                          </td>
                          <td data-label="Average value" class="py-2 px-3 text-right text-slate-200 font-semibold tabular-nums whitespace-nowrap">
                            {averageValue !== null ? formatUSD(averageValue) : '—'}
                          </td>
                          <td data-label="Market value" class="py-2 px-3 text-right text-white font-semibold tabular-nums whitespace-nowrap">
                            {val !== null ? formatUSD(val) : '—'}
                          </td>
                          <td data-label="Unrealized P/L" class="py-2 px-3 text-right font-semibold tabular-nums whitespace-nowrap">
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
                          <td data-label="Allocation" class="py-2 px-3 text-right text-slate-300 tabular-nums">
                            {allocation !== null ? allocation.toFixed(1) + '%' : '—'}
                          </td>
                        </tr>
                      </>
                    );
                  })
                )}
              </tbody>
              <tfoot id="cashStocksTableFooter" class="cash-holdings-footer border-t border-slate-700 font-mono">
                {holdings.length > 0 && (
                  <tr>
                    <td data-label="Summary" class="py-2 px-3 text-slate-300 font-bold" colSpan={6}>
                      {holdings.length} holding{holdings.length === 1 ? '' : 's'} · {translateText('Priced market value', getAppLanguage())}
                    </td>
                    <td data-label="Priced market value" class="py-2 px-3 text-right text-white font-bold">
                      {pricedHoldingCount > 0 ? (unpricedHoldingCount > 0 ? '≥' : '') + formatUSD(stocksTotal) : '—'}
                    </td>
                    <td data-label="Allocation" class="py-2 px-3 text-right text-slate-300 font-bold">
                      {unpricedHoldingCount === 0 && stocksTotal > 0 ? '100.0%' : '—'}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </TableScrollRegion>
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
          {(guestDirectory.status === 'stale' || guestDirectory.status === 'error' || guestDirectory.status === 'refreshing') && (
            <div
              role={guestDirectory.status === 'refreshing' ? 'status' : 'alert'}
              aria-live="polite"
              class="flex flex-col gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between"
            >
              <span>
                {guestDirectory.status === 'refreshing'
                  ? 'Refreshing guest accounts…'
                  : guestDirectory.users.length > 0
                    ? 'Guest account refresh failed. Existing assignments are still shown.'
                    : 'Could not load guest accounts. Retry to restore guest assignments.'}
              </span>
              <button
                type="button"
                disabled={guestDirectory.status === 'refreshing'}
                onClick={retryGuestUsers}
                aria-label="Retry guest account list"
                class="self-start rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-wait disabled:opacity-60 sm:self-auto"
              >{guestDirectory.status === 'refreshing' ? 'Retrying…' : 'Retry'}</button>
            </div>
          )}
          <div
            id="activeTranchesPanel"
            class={`expandable-motion ${activeTranchesExpanded ? 'is-expanded' : ''}`}
            aria-hidden={!activeTranchesExpanded}
          >
            <div class="expandable-motion__inner">
              <TableScrollRegion label="Active tranches and guest assignments" className="table-scroll-wrapper" tabIndex={activeTranchesExpanded ? 0 : -1}>
                <table id="activeTranchesTable" class="active-tranches-table w-full min-w-[900px] text-left text-xs border-collapse">
                  <caption class="sr-only">Active tranches and guest assignments</caption>
                  <thead class="active-tranches-head">
                    <tr class="border-b border-slate-800 text-slate-500">
                      <th scope="col" class="py-2 px-2">Ticker</th>
                      <th scope="col" class="py-2 px-2">Purchase date</th>
                      <th scope="col" class="py-2 px-2 text-right">Shares</th>
                      <th scope="col" class="py-2 px-2 text-right">Avg. Cost</th>
                      <th scope="col" class="py-2 px-2 text-right">Value</th>
                      <th scope="col" class="py-2 px-2 text-center">Operation</th>
                      <th scope="col" class="py-2 px-2 text-center">Guest · cash shares</th>
                    </tr>
                  </thead>
                  <tbody class="active-tranches-body divide-y divide-slate-800/60 font-mono">
                    {activeTranches.length === 0 ? (
                      <tr class="active-tranche-empty-row"><td colSpan={7} class="py-4 px-2 text-center font-sans text-slate-500 italic">
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
                        <tr key={tranche.id} class="active-tranche-row hover:bg-slate-900/50">
                          <td data-label="Ticker" class="py-2 px-2 font-bold text-cyan-300">{tranche.ticker}</td>
                          <td data-label="Purchase date" class="py-2 px-2 text-slate-400 tabular-nums whitespace-nowrap">{tranche.purchasedAt !== null ? new Date(tranche.purchasedAt).toLocaleString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</td>
                          <td data-label="Shares" class="py-2 px-2 text-right text-slate-200 tabular-nums">{tranche.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                          <td data-label="Average cost" class="py-2 px-2 text-right text-slate-300 tabular-nums">{tranche.averagePrice !== null ? formatUSD(tranche.averagePrice) : '—'}</td>
                          <td data-label="Market value" class="py-2 px-2 text-right text-slate-200 tabular-nums">{tranche.marketValue !== null ? formatUSD(tranche.marketValue) : '—'}</td>
                          <td data-label="Operation" class="py-2 px-2 text-center">
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
                          <td data-label="Guest assignment" class="py-2 px-2 text-center">
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
                                {!guestUsersLoading && guestUsers.length === 0 && !guestDirectory.error && (
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
              </TableScrollRegion>
            </div>
          </div>
        </section>}
      </div>
    </div>
  );
}