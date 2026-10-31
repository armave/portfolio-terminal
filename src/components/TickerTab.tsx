import { useEffect, useRef, useState } from 'preact/hooks';
import { isMarginDeskView, resolveTabNavigationIndex, shouldRefreshQuotesOnNavigation } from '../ui/tabNavigation';
import { usePortfolio } from '../store/portfolioStore';
import { calculatePortfolioValuation } from '../domain/portfolioValuation';
import { emitBrokerEvent } from '../services/brokerEventBus';
import { emitUiEvent } from '../ui/uiEventBus';
import { calculateGuestPersonalEquity, getGuestAssignedCashHoldings, getGuestHoldingValuation } from '../domain/guestPortfolio';
import { getAppLanguage } from '../services/i18n';

export function TickerTabs({
  isAdmin = false,
  userId,
  onDeskLoadingChange
}: {
  isAdmin?: boolean;
  userId?: string;
  onDeskLoadingChange?: (view: string, isLoading: boolean) => void;
} = {}) {
  const state = usePortfolio();
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState(false);
  const quoteRefreshPromise = useRef<Promise<void> | null>(null);
  const selectView = (view: string) => {
    if (!isAdmin && view !== 'BALANCE' && view !== 'SETTINGS' && !(userId && view === 'GUEST_HISTORY')) return;
    // Persist at the actual navigation click site as well as through the store,
    // so a view change is durable even if a later render/hydration races it.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', view);
    } catch {
      // Continue navigation when storage is unavailable.
    }
    // Refresh the portfolio once when returning to the Margin desk. Switching
    // between its ticker tabs does not require another all-symbol quote batch.
    const refreshQuotes = shouldRefreshQuotesOnNavigation(state.activeView, view, isAdmin);
    if (refreshQuotes) onDeskLoadingChange?.(view, true);
    emitUiEvent('portfolio:set-active-view', { view });
    if (refreshQuotes) {
      void handleRefreshQuotes().finally(() => onDeskLoadingChange?.(view, false));
    }
  };

  const isCushionActive =
    state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isClosedHistoryActive = state.activeView === 'CLOSED_HISTORY';
  const isGuestHistoryActive = state.activeView === 'GUEST_HISTORY';
  const isSettingsActive = state.activeView === 'SETTINGS';
  const isMarginDeskActive = isMarginDeskView(state.activeView, isAdmin);

  // The Margin desk depends on open broker orders. Request them only when the
  // user enters this workspace, not whenever they switch between ticker tabs.
  useEffect(() => {
    if (isMarginDeskActive) emitBrokerEvent('broker:request-active-orders');
  }, [isMarginDeskActive]);

  const tickers = Object.keys(state.positions || {});
  const marginDeskViews = tickers.length === 0
    ? ['COMBINED']
    : tickers.length === 1
      ? [tickers[0]]
      : ['COMBINED', ...tickers];
  const canViewGuestHistory = !isAdmin && Boolean(userId);
  const navigationViews = isAdmin
    ? [...marginDeskViews, 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS']
    : canViewGuestHistory ? ['BALANCE', 'GUEST_HISTORY', 'SETTINGS'] : ['BALANCE', 'SETTINGS'];
  const balanceNavIndex = isAdmin ? marginDeskViews.length : 0;
  const guestHistoryNavIndex = balanceNavIndex + 1;
  const settingsNavIndex = balanceNavIndex + (isAdmin || canViewGuestHistory ? 2 : 1);
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const portfolioValuation = calculatePortfolioValuation({
    signedAccountBalance: state.balance,
    freeCash: state.cashCushion?.freeCash,
    marginPositions: Object.values(state.positions || {}),
    cashHoldings: state.cashCushion?.holdings || []
  });
  const guestTranches = state.guestPortfolioSnapshot?.tranches || [];
  const guestAssignments = userId
    ? Object.fromEntries(guestTranches.map((tranche) => [tranche.id, userId]))
    : {};
  const guestTypes = Object.fromEntries(guestTranches.map((tranche) => [tranche.id, 'cash' as const]));
  const guestHoldings = !isAdmin && userId
    ? getGuestAssignedCashHoldings({
      guestId: userId,
      activeTranches: guestTranches,
      assignments: guestAssignments,
      types: guestTypes,
      cashHoldings: state.cashCushion?.holdings || []
    })
    : [];
  const guestEquity = calculateGuestPersonalEquity(guestHoldings);
  const displayedEquity = isAdmin ? portfolioValuation.equity : guestEquity;
  const hasUnpricedGuestHoldings = guestHoldings.some((holding) => getGuestHoldingValuation(holding).currentPrice === null);
  const hasPricedGuestHoldings = guestHoldings.some((holding) => getGuestHoldingValuation(holding).currentPrice !== null);
  const equityBadgeText = !isAdmin && userId
    ? guestHoldings.length === 0 ? '$0'
      : !hasPricedGuestHoldings ? '—'
        : (hasUnpricedGuestHoldings ? '≥$' : '+$') + Math.abs(displayedEquity).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 })
    : (displayedEquity >= 0 ? '+$' : '−$') + Math.abs(displayedEquity).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 0 });
  const equityBadgeTitle = !isAdmin && hasUnpricedGuestHoldings
    ? 'Partial value: holdings without a valid market quote are excluded.'
    : 'Current market value of your assigned cash-funded stocks.';

  const handleTabKeyDown = (event: KeyboardEvent) => {
    const currentButton = event.currentTarget as HTMLButtonElement;
    const currentIndex = Number(currentButton.dataset.navIndex);
    const nextIndex = resolveTabNavigationIndex(currentIndex, navigationViews.length, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    tabButtonRefs.current[nextIndex]?.focus();
    selectView(navigationViews[nextIndex]);
  };

  const handleRefreshQuotes = async (): Promise<void> => {
    if (quoteRefreshPromise.current) return quoteRefreshPromise.current;

    setIsRefreshingQuotes(true);
    const request = new Promise<void>((resolve) => {
      emitUiEvent('portfolio:refresh-live-prices', { resolve });
    });
    quoteRefreshPromise.current = request;
    try {
      await request;
    } finally {
      if (quoteRefreshPromise.current === request) quoteRefreshPromise.current = null;
      setIsRefreshingQuotes(false);
    }
  };

  return (
    <>
      {((isAdmin && tickers.length > 0) || (!isAdmin && Boolean(userId) && guestHoldings.length > 0)) && (
        <button
          id="refreshQuotesButton"
          type="button"
          title="Update quotes"
          aria-label="Refresh live quotes"
          aria-busy={isRefreshingQuotes}
          disabled={isRefreshingQuotes}
          onClick={handleRefreshQuotes}
          class="h-8 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
        >
          <span class={isRefreshingQuotes ? 'animate-spin' : ''}>↻</span>
        </button>
      )}

      {isAdmin && tickers.length === 0 && (
        <button
          type="button"
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          onClick={() => selectView('COMBINED')}
          aria-pressed={isMarginDeskActive}
          class={`px-3 py-1 rounded text-xs font-bold transition ${isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
        >
          MARGIN DESK
        </button>
      )}

      {isAdmin && tickers.length === 1 && (
        <button
          type="button"
          onClick={() => selectView(tickers[0])}
          aria-pressed={state.activeView === tickers[0]}
          class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0] && isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
        >
          MARGIN: {tickers[0]}
        </button>
      )}

      {isAdmin && tickers.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => selectView('COMBINED')}
            aria-pressed={state.activeView === 'COMBINED'}
            class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === 'COMBINED' && isMarginDeskActive
              ? 'bg-emerald-600 text-black'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          >
            COMBINED PORTFOLIO
          </button>

          {tickers.map((t, index) => (
            <button
              key={t}
              type="button"
              onClick={() => selectView(t)}
              aria-pressed={state.activeView === t}
              class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t && isMarginDeskActive
                ? 'bg-emerald-600 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
          data-nav-tab="true"
          data-nav-index={index + 1}
          ref={(element) => { tabButtonRefs.current[index + 1] = element; }}
          onKeyDown={handleTabKeyDown}
            >
              {t}
            </button>
          ))}
        </>
      )}

      <button
        type="button"
        onClick={() => selectView('BALANCE')}
        aria-pressed={isCushionActive}
        class={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${isCushionActive
          ? 'bg-cyan-500 text-black'
          : 'bg-slate-900 border border-cyan-800/60 text-cyan-400 hover:bg-slate-800'
          }`}
          data-nav-tab="true"
          data-nav-index={balanceNavIndex}
          ref={(element) => { tabButtonRefs.current[balanceNavIndex] = element; }}
          onKeyDown={handleTabKeyDown}
      >
        <span>🛡️ BALANCE</span>
        <span title={equityBadgeTitle} aria-label={`Assigned stock value: ${equityBadgeText}`}
          class={`text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'
            }`}
        >
          {equityBadgeText}
        </span>
      </button>

      {canViewGuestHistory && <button
        type="button"
        onClick={() => selectView('GUEST_HISTORY')}
        aria-pressed={isGuestHistoryActive}
        class={`px-3 py-1 rounded text-xs font-bold transition ${isGuestHistoryActive
          ? 'bg-indigo-500 text-white'
          : 'bg-slate-900 border border-indigo-800/60 text-indigo-300 hover:bg-slate-800'
          }`}
        data-nav-tab="true"
        data-nav-index={guestHistoryNavIndex}
        ref={(element) => { tabButtonRefs.current[guestHistoryNavIndex] = element; }}
        onKeyDown={handleTabKeyDown}
      >
        LOTS
      </button>}

      {isAdmin && <button
        type="button"
        onClick={() => selectView('CLOSED_HISTORY')}
        aria-pressed={isClosedHistoryActive}
        class={`px-3 py-1 rounded text-xs font-bold transition ${isClosedHistoryActive
          ? 'bg-purple-500 text-black'
          : 'bg-slate-900 border border-purple-800/60 text-purple-300 hover:bg-slate-800'
          }`}
          data-nav-tab="true"
          data-nav-index={balanceNavIndex + 1}
          ref={(element) => { tabButtonRefs.current[balanceNavIndex + 1] = element; }}
          onKeyDown={handleTabKeyDown}
      >
        TRADES
      </button>}

      <button
        id="settingsBtn"
        type="button"
        aria-pressed={isSettingsActive}
        onClick={() => selectView('SETTINGS')}
        class={
          isSettingsActive
            ? 'px-3 py-1.5 rounded text-xs font-bold bg-blue-600 text-white transition'
            : 'px-3 py-1.5 rounded text-xs font-bold border-blue-600 text-white border border-slate-700 hover:bg-slate-800 transition'
        }
          data-nav-tab="true"
          data-nav-index={settingsNavIndex}
          ref={(element) => { tabButtonRefs.current[settingsNavIndex] = element; }}
          onKeyDown={handleTabKeyDown}
        aria-label="Settings"
        title="Settings"
      >
        <span aria-hidden="true">⚙️</span>
      </button>
    </>
  );
}
