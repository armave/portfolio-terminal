import { useState, useEffect, useReducer, useRef, useMemo } from 'preact/hooks';
import { portfolioStore, usePortfolioSelector } from '../store/portfolioStore';
import { formatUSD, formatQuoteMetadata, formatQuoteVolume } from '../utils/formatters';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';
import type { ActiveTrancheMix, ActiveTrancheType, QuoteDetails } from '../types/portfolio';
import { getActiveTranchesFromTrades, normalizeActiveTrancheMix, resolveActiveTrancheMixInput, FreedomExecutedTradeLike } from '../domain/freedomPortfolio';
import { addBrokerEventListener, emitBrokerEvent } from '../services/brokerEventBus';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { DEFAULT_ADMIN_REFRESH_INTERVAL_MS, DEFAULT_GUEST_REFRESH_INTERVAL_MS } from '../services/portfolioAutoRefresh';
import { getCachedUsers, listUsers, type AuthUser } from '../services/api';
import { brokerAdapterRegistry } from '../services/brokerAdapters/registry';
import { loadSavedHistory } from '../services/storage';
import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations } from '../domain/closedHistoryFees';
import { brokerExecutionHistoryReducer, createBrokerExecutionHistoryState } from '../domain/brokerExecutionHistoryState';
import { balanceSyncReducer, createBalanceSyncState } from '../domain/balanceSyncState';
import { createGuestDirectoryState, guestDirectoryReducer } from '../domain/guestDirectoryState';
import { getAssignableActiveTrancheCashQuantity } from '../domain/activeTrancheGuestAssignment';
import { getGuestAssignedCashHoldings, getGuestHoldingValuation } from '../domain/guestPortfolio';
import { getAppLanguage, translateText } from '../services/i18n';
import { emitUiEvent } from '../ui/uiEventBus';
import {
  areCashCushionPortfolioStatesEqual,
  buildCashHoldingDisplayGroups,
  formatDailyQuoteRange,
  getActiveTrancheMarketPrice,
  getActiveTrancheType,
  getCashHoldingDisplayMetrics,
  getReversibleBalanceAdjustmentEvents,
  selectCashCushionPortfolioState,
  shouldShowCashHoldingMarketDepth,
  summarizeCashHoldings
} from '../features/cash/cashCushionModel';
import { DeskLoading } from './DeskLoading';
import { TableScrollRegion } from './TableScrollRegion';
import { TablePagination } from './TablePagination';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';

const freedomBrokerAdapter = brokerAdapterRegistry.get('freedom-tradenet');

const BADGE_STYLES: Record<string, string> = {
  bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
  neutral: 'border-slate-700 bg-slate-900 text-slate-300',
  unknown: 'border-slate-800 bg-slate-950 text-slate-500'
};
const EMPTY_TRANCHE_MIXES: Record<string, ActiveTrancheMix> = {};
const EMPTY_TRANCHE_TYPES: Record<string, ActiveTrancheType> = {};
const EMPTY_GUEST_ASSIGNMENTS: Record<string, string> = {};

type MixInputDraft = {
  value: string;
  quantity: number;
  cash: number;
  margin: number;
};

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
  const state = usePortfolioSelector(selectCashCushionPortfolioState, areCashCushionPortfolioStatesEqual);
  const [balanceAdjustmentReasons, setBalanceAdjustmentReasons] = useState<Record<string, string>>({});
  const [balanceAdjustmentNotice, setBalanceAdjustmentNotice] = useState('');
  const [pendingBalanceAdjustmentId, setPendingBalanceAdjustmentId] = useState<string | null>(null);
  const reversibleBalanceAdjustments = useMemo(
    () => getReversibleBalanceAdjustmentEvents(state.transactionEvents),
    [state.transactionEvents]
  );
  const submitBalanceAdjustmentReversal = (eventId: string) => {
    const reason = (balanceAdjustmentReasons[eventId] || '').trim();
    if (!reason) {
      setBalanceAdjustmentNotice('Enter a reason to reverse this adjustment.');
      return;
    }
    const reversed = portfolioStore.reverseBalanceAdjustment(eventId, reason);
    setBalanceAdjustmentNotice(reversed
      ? 'Balance adjustment reversed.'
      : 'Balance adjustment could not be reversed. The balance may have changed since the original adjustment.');
    setPendingBalanceAdjustmentId(null);
    if (reversed) {
      setBalanceAdjustmentReasons((current) => ({ ...current, [eventId]: '' }));
    }
  };
  const refreshIntervalMs = useQuoteRefreshInterval(guestUserId ? DEFAULT_GUEST_REFRESH_INTERVAL_MS : DEFAULT_ADMIN_REFRESH_INTERVAL_MS, guestUserId ? 'guest' : 'admin');
  const shouldReadBrokerHistory = !guestUserId && (showActiveTranches || isAdmin);
  const [marketDepthAvailable, setMarketDepthAvailable] = useState(() => shouldShowCashHoldingMarketDepth());
  useEffect(() => {
    const refreshMarketSession = () => setMarketDepthAvailable(shouldShowCashHoldingMarketDepth());
    refreshMarketSession();
    const intervalId = window.setInterval(refreshMarketSession, 30_000);
    window.addEventListener('focus', refreshMarketSession);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshMarketSession);
    };
  }, []);
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
        ? freedomBrokerAdapter.normalizeExecutions(loadSavedHistory().brokerExecutedTrades, { source: 'cache' }).data
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
  // Preserve raw split-field input while the portfolio store rerenders.
  const [mixInputDrafts, setMixInputDrafts] = useState<Record<string, MixInputDraft>>({});
  const [guestDirectory, dispatchGuestDirectory] = useReducer(
    guestDirectoryReducer<AuthUser>,
    undefined,
    () => {
      // Reuse the auth runtime's in-memory token-scoped snapshot on navigation.
      // This avoids an empty-directory render when a previous desk has already
      // fetched guest names; a cold cache uses stable group placeholders below.
      const cachedUsers = getCachedUsers();
      return cachedUsers
        ? { users: cachedUsers.filter((user) => user.role === 'guest'), status: 'ready' as const, error: '' }
        : createGuestDirectoryState<AuthUser>(showActiveTranches);
    }
  );
  const guestUsers = guestDirectory.users;
  const guestUsersLoading = guestDirectory.status === 'loading';
  const balanceRefreshing =
    (isAdmin && balanceSync.status === 'refreshing') ||
    (shouldReadBrokerHistory && (brokerExecutionHistory.status === 'refreshing' || executedTradesLoading));
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
    const removeRefreshCompleteListener = addBrokerEventListener('broker:account-info-refresh-complete', () => {
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
      removeRefreshCompleteListener();
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
    const removeOrdersListener = addBrokerEventListener('broker:active-orders', () => {
      dispatchBrokerExecutionHistory({
        type: 'success',
        trades: brokerExecutionHistoryRef.current.trades
      });
    });
    dispatchBrokerExecutionHistory({ type: 'refresh' });
    emitBrokerEvent('broker:request-executed-trades');
    return () => {
      removeTradesListener();
      removeErrorListener();
      removeOrdersListener();
    };
  }, [shouldReadBrokerHistory]);

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

  const cashHoldings = state.cashHoldings || [];
  const positions = state.positions || {};
  const activeTrancheSource = useMemo(
    () => guestUserId
      ? state.guestPortfolioSnapshot?.tranches || []
      : getActiveTranchesFromTrades(executedTrades, state.brokerAccountInfo),
    [guestUserId, state.guestPortfolioSnapshot?.tranches, executedTrades, state.brokerAccountInfo]
  );
  const activeTrancheGuestAssignments = useMemo(
    () => guestUserId
      ? Object.fromEntries(activeTrancheSource.map((tranche) => [tranche.id, guestUserId]))
      : state.activeTrancheGuestAssignments || EMPTY_GUEST_ASSIGNMENTS,
    [guestUserId, activeTrancheSource, state.activeTrancheGuestAssignments]
  );
  const activeTrancheTypes = useMemo(
    () => guestUserId
      ? Object.fromEntries(activeTrancheSource.map((tranche) => [tranche.id, 'cash' as ActiveTrancheType]))
      : state.activeTrancheTypes || EMPTY_TRANCHE_TYPES,
    [guestUserId, activeTrancheSource, state.activeTrancheTypes]
  );
  const activeTrancheMixes = guestUserId ? EMPTY_TRANCHE_MIXES : state.activeTrancheMixes || EMPTY_TRANCHE_MIXES;
  const activeTranches = useMemo(() => activeTrancheSource.map((tranche) => {
    const latestPrice = getActiveTrancheMarketPrice(tranche, cashHoldings, positions);
    if (latestPrice === null || latestPrice === tranche.marketPrice) return tranche;
    return { ...tranche, marketPrice: latestPrice, marketValue: latestPrice * tranche.quantity };
  }), [activeTrancheSource, cashHoldings, positions]);
  const activeTranchePagination = useTablePagination('active-tranches', activeTranches.length, 10);
  const visibleActiveTranches = sliceTablePage(
    activeTranches,
    activeTranchePagination.currentPage,
    activeTranchePagination.pageSize
  );
  const guestHoldings = useMemo(() => guestUserId
    ? getGuestAssignedCashHoldings({
      guestId: guestUserId,
      activeTranches,
      assignments: activeTrancheGuestAssignments,
      types: activeTrancheTypes,
      mixes: activeTrancheMixes,
      cashHoldings
    })
    : [], [guestUserId, activeTranches, activeTrancheGuestAssignments, activeTrancheTypes, activeTrancheMixes, cashHoldings]);
  const holdings = isAdmin ? cashHoldings : guestHoldings;
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

  const positionIntegrityIssues = state.brokerAccountInfo?.positionIntegrityIssues?.length
    ? state.brokerAccountInfo.positionIntegrityIssues
    : state.brokerAccountInfo?.lastRefreshIssue?.positionIntegrityIssues || [];
  const positionIntegrityMessage = (code: string): string => {
    const messages: Record<string, string> = {
      negative_quantity_sign_unverified: 'Broker reported a negative position quantity; its long/short sign convention is unverified.',
      short_position_side_unverified: 'Broker position side indicates a short position; short valuation is not yet supported.',
      unrecognized_position_side: 'Broker position side is not recognized; the position was not applied.',
      short_execution_unsupported: 'A sell-short execution was detected; short positions are not yet supported.',
      short_cover_unsupported: 'A buy-to-cover execution was detected; short positions are not yet supported.',
      unmatched_sell_quantity: 'A sell execution exceeds the known long purchase history; short or incomplete history cannot be distinguished.',
      unknown_execution_side: 'An execution has an unknown side; its position effect cannot be safely classified.',
      invalid_execution: 'A broker execution has no verifiable instrument identifier.',
      invalid_broker_position: 'A broker position has invalid quantity or instrument details.'
    };
    return translateText(messages[code] || 'Some broker position data could not be classified safely.', getAppLanguage());
  };

  const { unpricedHoldingCount, pricedHoldingCount, stocksTotal } = useMemo(
    () => summarizeCashHoldings([...holdings]),
    [holdings]
  );

  const guestDirectoryPending = guestDirectory.status === 'loading' ||
    (guestDirectory.status === 'refreshing' && guestUsers.length === 0);
  const guestNames = useMemo(
    () => new Map(guestUsers.map((guest) => [guest.id, guest.name || ''])),
    [guestUsers]
  );
  const { displayHoldingGroups } = useMemo(
    () => buildCashHoldingDisplayGroups({
      isAdmin,
      guestNames,
      guestDirectoryPending,
      guestUnavailableLabel: translateText('Guest unavailable', getAppLanguage()),
      activeTranches,
      activeTrancheGuestAssignments,
      activeTrancheTypes,
      activeTrancheMixes,
      cashHoldings,
      holdings
    }),
    [isAdmin, guestNames, guestDirectoryPending, activeTranches, activeTrancheGuestAssignments,
      activeTrancheTypes, activeTrancheMixes, cashHoldings, holdings]
  );
  const displayHoldingRows = useMemo(
    () => displayHoldingGroups.flatMap((group) =>
      group.holdings.map((holding) => ({ group, holding }))
    ),
    [displayHoldingGroups]
  );
  const cashHoldingsPagination = useTablePagination('cash-holdings', displayHoldingRows.length, 10);
  const visibleDisplayTableRows = useMemo(() => {
    const pageRows = sliceTablePage(
      displayHoldingRows,
      cashHoldingsPagination.currentPage,
      cashHoldingsPagination.pageSize
    );
    return pageRows.flatMap((item, index) => {
      const previous = pageRows[index - 1];
      return [
        ...(isAdmin && (!previous || previous.group.key !== item.group.key)
          ? [{ type: 'group' as const, key: 'group-' + item.group.key, label: item.group.label }]
          : []),
        { type: 'holding' as const, key: 'holding-' + item.group.key + '-' + item.holding.ticker, holding: item.holding }
      ];
    });
  }, [displayHoldingRows, cashHoldingsPagination.currentPage, cashHoldingsPagination.pageSize, isAdmin]);

  if (isAdmin && balanceSync.status === 'loading' && !balanceSync.hasSnapshot) {
    return <DeskLoading
      title="Preparing balance"
      message="Loading the latest broker account snapshot…"
      accent="cyan"
    />;
  }

  return (
    <div>
      <style>{`
        @keyframes guest-stock-card-enter {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .guest-stock-card-enter {
          animation: guest-stock-card-enter 180ms ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .guest-stock-card-enter { animation: none; }
        }
      `}</style>
      <div class={`flex text-center md:text-left justify-center md:justify-between items-center border-b border-slate-800 pb-2 ${!isAdmin && 'hidden'}`}>
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-lg font-black text-cyan-400 tracking-wide">
              {guestUserId ? 'MY STOCKS' : isAdmin ? 'CASH & NON-MARGIN HOLDINGS' : 'BALANCE'}
            </h1>
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

      {isAdmin && (balanceSync.status === 'stale' || balanceSync.status === 'error') && (
        <div role="alert" aria-live="polite" class="flex flex-col gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span>{balanceSync.hasSnapshot
            ? translateText('Balance refresh failed. Showing the last saved broker snapshot.', getAppLanguage())
            : translateText('Unable to load the broker balance. Please retry.', getAppLanguage())}</span>
          <button type="button" onClick={retryBalance} aria-label={translateText('Retry balance refresh', getAppLanguage())} class="self-start inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 sm:self-auto">Retry</button>
        </div>
      )}

      {isAdmin && positionIntegrityIssues.length > 0 && (
        <div role="alert" aria-live="polite" class="flex flex-col gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          <div class="font-semibold">{translateText('Some broker positions need review', getAppLanguage())}</div>
          <p>{translateText('The app retained the last accepted tracked values and did not guess long/short direction from unverified broker data.', getAppLanguage())}</p>
          <ul class="list-disc space-y-1 pl-5">
            {positionIntegrityIssues.map((issue, index) => (
              <li key={`${issue.ticker}-${issue.code}-${issue.source}-${index}`}>
                <span class="font-semibold">{issue.ticker || translateText('Unknown instrument', getAppLanguage())}:</span> {positionIntegrityMessage(issue.code)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {shouldReadBrokerHistory && (brokerExecutionHistory.status === 'stale' || brokerExecutionHistory.status === 'error') && (
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
            class="self-start inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 sm:self-auto"
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

              const volume = formatQuoteVolume(holding.quoteDetails?.volume);
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
                    {renderDailyQuoteSubtext(holding.quoteDetails)}
                    <p class="mt-1 text-[10px] text-slate-500" title="Provider-reported volume; reporting period may vary by source.">
                      {translateText('Volume', getAppLanguage())} {volume ?? '—'} · {formatQuoteMetadata(holding, refreshIntervalMs)}
                    </p>
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
                </article>
              );
            })}
          </div>
        ) : (
          <>
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
                {displayHoldingRows.length === 0 ? (
                  <tr class="cash-holding-empty-row">
                    <td colSpan={8} class="py-3 text-center text-slate-500 italic">
                      {!isAdmin && !guestUserId ? 'Verifying account access…' : guestUserId ? 'No active cash-funded stocks are linked to your account.' : 'No broker-reported cash holdings available.'}
                    </td>
                  </tr>
                ) : (
                  visibleDisplayTableRows.map((row) => {
                    if (row.type === 'group') {
                      return (
                        <tr key={row.key} class="cash-holding-group-row border-t border-slate-700 bg-slate-900/70">
                          <td colSpan={8} class="px-3 py-2 text-[10px] font-black uppercase tracking-wider text-cyan-300 text-center" style={{ textAlign: 'center' }}>
                            {row.label || (
                              <>
                                <span aria-hidden="true" class="mx-auto block h-2.5 w-16 rounded-full bg-slate-700/80" />
                                <span class="sr-only">{translateText('Loading guest name', getAppLanguage())}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    const h = row.holding;
                    const {
                      shares,
                      price,
                      averagePrice,
                      averageValue,
                      marketValue: val,
                      unrealizedPnl: totalDifference,
                      unrealizedPnlPercent: totalDifferencePercent,
                      allocation
                    } = getCashHoldingDisplayMetrics(h, stocksTotal, unpricedHoldingCount);
                    const hasAveragePrice = averagePrice !== null;
                    const hasMarketComparison = totalDifference !== null && totalDifferencePercent !== null;
                    const quoteMeta = formatQuoteMetadata(h, refreshIntervalMs);

                    const hasChange = typeof h.quoteDetails?.change === 'number' && Number.isFinite(h.quoteDetails.change);
                    const hasChangePercent = typeof h.quoteDetails?.changePercent === 'number' &&
                      Number.isFinite(h.quoteDetails?.changePercent);
                    const direction: SentimentDirection = hasChange
                      ? h.quoteDetails!.change! > 0
                        ? 'bullish'
                        : h.quoteDetails!.change! < 0
                          ? 'bearish'
                          : 'neutral'
                      : 'unknown';
                    const badgeText =
                      hasChange && hasChangePercent
                        ? `${h.quoteDetails!.changePercent!.toFixed(2)}%`
                        : sentimentLabel(direction);

                    const volume = formatQuoteVolume(h.quoteDetails?.volume)

                    return (
                        <tr key={row.key} class="cash-holding-row hover:bg-slate-900/40">
                          <td data-label="Ticker" class="py-2 px-3 text-cyan-300 font-bold">
                            <div class="inline-flex flex-wrap items-center gap-1.5">
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
                              {isAdmin && marketDepthAvailable && <button
                                type="button"
                                title={`View live market depth for ${h.ticker}`}
                                aria-label={`Market Depth for ${h.ticker}`}
                                onClick={() => emitUiEvent('market:depth-request', { ticker: h.ticker })}
                                class="rounded border border-emerald-800/70 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 hover:bg-emerald-950/40"
                              >Depth</button>}
                            </div>
                          </td>
                          <td data-label="Shares" class="py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap">
                            {shares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })}
                          </td>
                          <td data-label="Market price" class="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums whitespace-nowrap">
                            <span>{price !== null ? formatUSD(price) : '—'}</span>
                            {renderDailyQuoteSubtext(h.quoteDetails)}
                            <span class="mt-0.5 block text-[9px] font-normal text-slate-500" title="Provider-reported volume; reporting period may vary by source.">
                              {translateText('Volume', getAppLanguage())} {volume ?? '—'}
                            </span>
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
          <TablePagination
            tableLabel={translateText('Cash-funded stock holdings', getAppLanguage())}
            page={cashHoldingsPagination.currentPage}
            pageCount={cashHoldingsPagination.pageCount}
            pageSize={cashHoldingsPagination.pageSize}
            start={cashHoldingsPagination.start}
            end={cashHoldingsPagination.end}
            total={displayHoldingRows.length}
            onPageChange={cashHoldingsPagination.setPage}
            onPageSizeChange={cashHoldingsPagination.setPageSize}
            controlsId="cashStocksTableBody"
          />
          </>
        )}

        {isAdmin && !guestUserId && (reversibleBalanceAdjustments.length > 0 || balanceAdjustmentNotice) && (
          <section
            class="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3"
            aria-labelledby="balanceAdjustmentHistoryHeading"
          >
            <div class="space-y-1">
              <h3 id="balanceAdjustmentHistoryHeading" class="text-sm font-black uppercase tracking-wide text-cyan-300">
                {translateText('Recent balance adjustments', getAppLanguage())}
              </h3>
              <p class="text-[11px] text-slate-400">
                {translateText('Review and reverse eligible manual cash or margin adjustments.', getAppLanguage())}
              </p>
              <p class="text-[10px] text-slate-500">
                {translateText('A reversal appends an immutable correction event. It is blocked when available cash or debt has already been used.', getAppLanguage())}
              </p>
            </div>
            {balanceAdjustmentNotice && (
              <p role="status" aria-live="polite" class="rounded border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-cyan-200">
                {translateText(balanceAdjustmentNotice, getAppLanguage())}
              </p>
            )}
            {reversibleBalanceAdjustments.map((event) => {
              const label = event.type === 'cash.adjustment' ? 'Cash adjustment' : 'Margin adjustment';
              const cashDelta = typeof event.cashDelta === 'number' ? event.cashDelta : null;
              const debtDelta = typeof event.marginDebtDelta === 'number' ? event.marginDebtDelta : null;
              const recordedAt = new Date(event.recordedAt).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US');
              const reasonId = `balance-adjustment-reason-${event.id}`;
              return (
                <article
                  key={event.id}
                  data-balance-adjustment-event-id={event.id}
                  class="space-y-2 rounded border border-slate-800 px-3 py-2"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <strong class="text-xs text-slate-200">{translateText(label, getAppLanguage())}</strong>
                    <span class="text-[10px] text-slate-500">{recordedAt}</span>
                  </div>
                  <div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-300">
                    {cashDelta !== null && (
                      <span>{translateText('Cash change', getAppLanguage())}: {formatUSD(cashDelta)}</span>
                    )}
                    {debtDelta !== null && (
                      <span>{translateText('Margin debt change', getAppLanguage())}: {formatUSD(debtDelta)}</span>
                    )}
                  </div>
                  {event.note && <p class="text-[10px] text-slate-500">{event.note}</p>}
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <label class="flex-1 space-y-1 text-[10px] text-slate-400" for={reasonId}>
                      <span>{translateText('Reason for reversal', getAppLanguage())}</span>
                      <input
                        id={reasonId}
                        type="text"
                        maxLength={500}
                        value={balanceAdjustmentReasons[event.id] || ''}
                        onInput={(inputEvent) => setBalanceAdjustmentReasons((current) => ({
                          ...current,
                          [event.id]: inputEvent.currentTarget.value
                        }))}
                        placeholder={translateText('Enter why this adjustment should be reversed', getAppLanguage())}
                        class="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                      />
                    </label>
                    {pendingBalanceAdjustmentId === event.id ? (
                      <div class="flex flex-col gap-2 rounded border border-amber-800/50 bg-amber-950/20 p-2 sm:flex-row sm:items-center" role="group" aria-label={translateText('Confirm balance reversal', getAppLanguage())}>
                        <span class="flex-1 text-[10px] text-amber-100">
                          {translateText('Confirm this balance change. The original event remains in history.', getAppLanguage())}
                        </span>
                        <button
                          type="button"
                          onClick={() => submitBalanceAdjustmentReversal(event.id)}
                          class="rounded border border-amber-700 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
                        >
                          {translateText('Confirm reversal', getAppLanguage())}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingBalanceAdjustmentId(null)}
                          class="rounded border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-300"
                        >
                          {translateText('Cancel', getAppLanguage())}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!(balanceAdjustmentReasons[event.id] || '').trim()}
                        onClick={() => setPendingBalanceAdjustmentId(event.id)}
                        class="rounded border border-amber-800/70 px-3 py-2 text-xs font-bold text-amber-200 hover:bg-amber-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {translateText('Review reversal', getAppLanguage())}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        )}

        {showActiveTranches && <section class="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2" id="activeTranches" aria-labelledby="activeTranchesHeading">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h2 id="activeTranchesHeading" class="text-sm font-black uppercase tracking-wide text-cyan-300">Active Tranches ({activeTranches.length})</h2>
              <p class="mt-0.5 text-[10px] text-slate-500">Open purchases from Freedom trade history · new operations default to Margin</p>
            </div>
            <div class="flex items-center gap-2">
              <span class={`text-[10px] font-bold uppercase tracking-wide ${state.brokerAccountInfo?.status === 'stale' ? 'text-amber-400' : state.brokerAccountInfo?.loaded ? 'text-emerald-400' : 'text-slate-500'}`}>
                {state.brokerAccountInfo?.status === 'stale' ? 'Broker data stale' : executedTrades.length ? 'Trades synced' : 'Waiting for trade history'}
              </span>
              <button type="button" aria-expanded={activeTranchesExpanded} aria-controls="activeTranchesTable" onClick={() => setActiveTranchesExpanded((expanded) => !expanded)} class="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-700 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
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
                class="self-start inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-amber-700/70 px-2.5 py-1.5 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:cursor-wait disabled:opacity-60 sm:self-auto"
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
                  <tbody id="activeTranchesTableBody" class="active-tranches-body divide-y divide-slate-800/60 font-mono">
                    {activeTranches.length === 0 ? (
                      <tr class="active-tranche-empty-row"><td colSpan={7} class="py-4 px-2 text-center font-sans text-slate-500 italic">
                        {executedTrades.length ? 'No active purchase operations.' : 'Active purchase operations will appear after Freedom trade history loads.'}
                      </td></tr>
                    ) : visibleActiveTranches.map((tranche) => {
                      const type = getActiveTrancheType(activeTrancheTypes, tranche.id, tranche.ticker);
                      const mix = normalizeActiveTrancheMix(
                        tranche.quantity,
                        activeTrancheMixes[tranche.id] || activeTrancheMixes[tranche.ticker]
                      );
                      const cashQuantity = getAssignableActiveTrancheCashQuantity(type, tranche.quantity, mix);
                      const assignedGuestId = activeTrancheGuestAssignments[tranche.id] || '';
                      const cashInputDraft = mixInputDrafts[tranche.id + ':cash'];
                      const marginInputDraft = mixInputDrafts[tranche.id + ':margin'];
                      const cashInputValue = cashInputDraft && cashInputDraft.quantity === tranche.quantity &&
                        cashInputDraft.cash === mix.cash && cashInputDraft.margin === mix.margin
                        ? cashInputDraft.value : mix.cash;
                      const marginInputValue = marginInputDraft && marginInputDraft.quantity === tranche.quantity &&
                        marginInputDraft.cash === mix.cash && marginInputDraft.margin === mix.margin
                        ? marginInputDraft.value : mix.margin;
                      const updateMixCash = (value: string) => {
                        const cash = resolveActiveTrancheMixInput(value, tranche.quantity, mix.cash);
                        const margin = tranche.quantity - cash;
                        setActiveTrancheType(tranche.id, 'mix', { cash, margin });
                        setMixInputDrafts((current) => {
                          const next = { ...current };
                          delete next[tranche.id + ':cash'];
                          return next;
                        });
                      };
                      const updateMixMargin = (value: string) => {
                        const margin = resolveActiveTrancheMixInput(value, tranche.quantity, mix.margin);
                        const cash = tranche.quantity - margin;
                        setActiveTrancheType(tranche.id, 'mix', { cash, margin });
                        setMixInputDrafts((current) => {
                          const next = { ...current };
                          delete next[tranche.id + ':margin'];
                          return next;
                        });
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
                            <div class="inline-flex rounded-md border border-slate-700 p-0.5" role="group" aria-label={translateText('Operation type', getAppLanguage()) + ': ' + tranche.ticker}>
                              <button type="button" aria-pressed={type === 'cash'} onClick={() => setActiveTrancheType(tranche.id, 'cash')}
                                class={type === 'cash' ? 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition bg-cyan-950 text-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400' : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400'}>Cash</button>
                              <button type="button" aria-pressed={type === 'margin'} onClick={() => setActiveTrancheType(tranche.id, 'margin')}
                                class={type === 'margin' ? 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition bg-amber-950 text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400' : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400'}>Margin</button>
                              <button type="button" aria-pressed={type === 'mix'} aria-expanded={type === 'mix' && mixExpanded} title={type === 'mix' && mixExpanded ? 'Hide cash and margin quantities' : 'Edit cash and margin quantities'} onClick={selectMix}
                                class={type === 'mix' ? 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition bg-violet-950 text-violet-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400' : 'inline-flex min-h-11 min-w-11 items-center justify-center rounded px-2 py-1 text-[10px] font-bold transition text-slate-500 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400'}>Mix <span aria-hidden="true">{type === 'mix' && mixExpanded ? '−' : '+'}</span></button>
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
                                        aria-label={translateText('Cash shares', getAppLanguage()) + ': ' + tranche.ticker}
                                        type="number"
                                        min="0"
                                        max={tranche.quantity}
                                        step="any"
                                        value={cashInputValue}
                                        onInput={(inputEvent) => setMixInputDrafts((current) => ({
                                          ...current,
                                          [tranche.id + ':cash']: {
                                            value: (inputEvent.currentTarget as HTMLInputElement).value,
                                            quantity: tranche.quantity,
                                            cash: mix.cash,
                                            margin: mix.margin
                                          }
                                        }))}
                                        onBlur={(event) => updateMixCash((event.currentTarget as HTMLInputElement).value)}
                                        class="min-h-11 w-[4.25rem] rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
                                      />
                                    </label>
                                    <label class="inline-flex items-center gap-1 text-[9px] font-semibold text-amber-300">
                                      Margin
                                      <input
                                        aria-label={translateText('Margin shares', getAppLanguage()) + ': ' + tranche.ticker}
                                        type="number"
                                        min="0"
                                        max={tranche.quantity}
                                        step="any"
                                        value={marginInputValue}
                                        onInput={(inputEvent) => setMixInputDrafts((current) => ({
                                          ...current,
                                          [tranche.id + ':margin']: {
                                            value: (inputEvent.currentTarget as HTMLInputElement).value,
                                            quantity: tranche.quantity,
                                            cash: mix.cash,
                                            margin: mix.margin
                                          }
                                        }))}
                                        onBlur={(event) => updateMixMargin((event.currentTarget as HTMLInputElement).value)}
                                        class="min-h-11 w-[4.25rem] rounded border border-slate-700 bg-slate-950 px-1 py-1 text-right text-[10px] text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400"
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
                                  aria-label={translateText('Guest assignment', getAppLanguage()) + ': ' + tranche.ticker}
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
              <TablePagination
                tableLabel={translateText('Active tranches and guest assignments', getAppLanguage())}
                page={activeTranchePagination.currentPage}
                pageCount={activeTranchePagination.pageCount}
                pageSize={activeTranchePagination.pageSize}
                start={activeTranchePagination.start}
                end={activeTranchePagination.end}
                total={activeTranches.length}
                onPageChange={activeTranchePagination.setPage}
                onPageSizeChange={activeTranchePagination.setPageSize}
                controlsId="activeTranchesTableBody"
              />
            </div>
          </div>
        </section>}
      </div>
    </div>
  );
}