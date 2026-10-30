import { useEffect, useRef, useState } from 'preact/hooks';
import { resolveTabNavigationIndex } from '../ui/tabNavigation';
import { usePortfolio } from '../store/portfolioStore';
import { calculatePortfolioValuation } from '../domain/portfolioValuation';
import { emitBrokerEvent } from '../services/brokerEventBus';
import { emitUiEvent } from '../ui/uiEventBus';
import { getActiveTranchesFromTrades } from '../domain/freedomPortfolio';
import { calculateGuestPersonalEquity, getGuestAssignedCashHoldings } from '../domain/guestPortfolio';

export function TickerTabs({ isAdmin = false, userId }: { isAdmin?: boolean; userId?: string } = {}) {
  const state = usePortfolio();
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState(false);
  const selectView = (view: string) => {
    if (!isAdmin && view !== 'BALANCE' && view !== 'SETTINGS') return;
    // Persist at the actual navigation click site as well as through the store,
    // so a view change is durable even if a later render/hydration races it.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', view);
    } catch {
      // Continue navigation when storage is unavailable.
    }
    emitUiEvent('portfolio:set-active-view', { view });
    // Entering or switching within the Margin workspace should pull fresh
    // quotes immediately instead of waiting for the polling interval.
    if (!['CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS'].includes(view)) {
      void handleRefreshQuotes();
    }
  };

  const isCushionActive =
    state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isClosedHistoryActive = state.activeView === 'CLOSED_HISTORY';
  const isSettingsActive = state.activeView === 'SETTINGS';
  const isMarginDeskActive =
    isAdmin && !isCushionActive && !isClosedHistoryActive && !isSettingsActive;

  // The Margin desk is the surface whose targets depend on open broker orders.
  // Refresh on first mount and whenever navigation returns to that desk, rather
  // than relying on a user clicking a ticker tab.
  useEffect(() => {
    if (isMarginDeskActive) emitBrokerEvent('broker:request-active-orders');
  }, [isMarginDeskActive, state.activeView]);

  const tickers = Object.keys(state.positions || {});
  const marginDeskViews = tickers.length === 0
    ? ['COMBINED']
    : tickers.length === 1
      ? [tickers[0]]
      : ['COMBINED', ...tickers];
  const navigationViews = isAdmin
    ? [...marginDeskViews, 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS']
    : ['BALANCE', 'SETTINGS'];
  const balanceNavIndex = isAdmin ? marginDeskViews.length : 0;
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const portfolioValuation = calculatePortfolioValuation({
    signedAccountBalance: state.balance,
    freeCash: state.cashCushion?.freeCash,
    marginPositions: Object.values(state.positions || {}),
    cashHoldings: state.cashCushion?.holdings || []
  });
  const guestEquity = !isAdmin && userId
    ? calculateGuestPersonalEquity(getGuestAssignedCashHoldings({
      guestId: userId,
      activeTranches: getActiveTranchesFromTrades(
        state.brokerExecutedTrades as any,
        state.brokerAccountInfo
      ),
      assignments: state.activeTrancheGuestAssignments,
      types: state.activeTrancheTypes,
      mixes: state.activeTrancheMixes,
      cashHoldings: state.cashCushion?.holdings || []
    }))
    : 0;
  const displayedEquity = isAdmin ? portfolioValuation.equity : guestEquity;
  const equityCurrencyPrefix = displayedEquity >= 0 ? '+' + '

  const handleTabKeyDown = (event: KeyboardEvent) => {
    const currentButton = event.currentTarget as HTMLButtonElement;
    const currentIndex = Number(currentButton.dataset.navIndex);
    const nextIndex = resolveTabNavigationIndex(currentIndex, navigationViews.length, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    tabButtonRefs.current[nextIndex]?.focus();
    selectView(navigationViews[nextIndex]);
  };

  const handleRefreshQuotes = async () => {
    if (isRefreshingQuotes) return;

    setIsRefreshingQuotes(true);
    try {
      await new Promise<void>((resolve) => {
        emitUiEvent('portfolio:refresh-live-prices', { resolve });
      });
    } finally {
      setIsRefreshingQuotes(false);
    }
  };

  return (
    <>
      {isAdmin && tickers.length > 0 && (
        <button
          id="refreshQuotesButton"
          type="button"
          title="Update quotes"
          aria-label="Refresh live quotes"
          disabled={isRefreshingQuotes}
          onClick={handleRefreshQuotes}
          class="h-8 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
        >
          <span>↻</span>
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
        <span
          class={`text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'
            }`}
        >
          {equityBadgeText}
        </span>
      </button>

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
        CLOSED HISTORY
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
          data-nav-index={balanceNavIndex + (isAdmin ? 2 : 1)}
          ref={(element) => { tabButtonRefs.current[balanceNavIndex + (isAdmin ? 2 : 1)] = element; }}
          onKeyDown={handleTabKeyDown}
      >
        <span>⚙️ SETTINGS</span>
      </button>
    </>
  );
}
 : '−' + '

  const handleTabKeyDown = (event: KeyboardEvent) => {
    const currentButton = event.currentTarget as HTMLButtonElement;
    const currentIndex = Number(currentButton.dataset.navIndex);
    const nextIndex = resolveTabNavigationIndex(currentIndex, navigationViews.length, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    tabButtonRefs.current[nextIndex]?.focus();
    selectView(navigationViews[nextIndex]);
  };

  const handleRefreshQuotes = async () => {
    if (isRefreshingQuotes) return;

    setIsRefreshingQuotes(true);
    try {
      await new Promise<void>((resolve) => {
        emitUiEvent('portfolio:refresh-live-prices', { resolve });
      });
    } finally {
      setIsRefreshingQuotes(false);
    }
  };

  return (
    <>
      {tickers.length > 0 && (
        <button
          id="refreshQuotesButton"
          type="button"
          title="Update quotes"
          aria-label="Refresh live quotes"
          disabled={isRefreshingQuotes}
          onClick={handleRefreshQuotes}
          class="h-8 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
        >
          <span>↻</span>
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
        <span
          class={`text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'
            }`}
        >
          {equityBadgeText}
        </span>
      </button>

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
        CLOSED HISTORY
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
          data-nav-index={balanceNavIndex + (isAdmin ? 2 : 1)}
          ref={(element) => { tabButtonRefs.current[balanceNavIndex + (isAdmin ? 2 : 1)] = element; }}
          onKeyDown={handleTabKeyDown}
      >
        <span>⚙️ SETTINGS</span>
      </button>
    </>
  );
}
;
  const equityBadgeText = equityCurrencyPrefix + Math.abs(displayedEquity).toLocaleString('en-US', { maximumFractionDigits: 0 });

  const handleTabKeyDown = (event: KeyboardEvent) => {
    const currentButton = event.currentTarget as HTMLButtonElement;
    const currentIndex = Number(currentButton.dataset.navIndex);
    const nextIndex = resolveTabNavigationIndex(currentIndex, navigationViews.length, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    tabButtonRefs.current[nextIndex]?.focus();
    selectView(navigationViews[nextIndex]);
  };

  const handleRefreshQuotes = async () => {
    if (isRefreshingQuotes) return;

    setIsRefreshingQuotes(true);
    try {
      await new Promise<void>((resolve) => {
        emitUiEvent('portfolio:refresh-live-prices', { resolve });
      });
    } finally {
      setIsRefreshingQuotes(false);
    }
  };

  return (
    <>
      {tickers.length > 0 && (
        <button
          id="refreshQuotesButton"
          type="button"
          title="Update quotes"
          aria-label="Refresh live quotes"
          disabled={isRefreshingQuotes}
          onClick={handleRefreshQuotes}
          class="h-8 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
        >
          <span>↻</span>
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
        <span
          class={`text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'
            }`}
        >
          {equityBadgeText}
        </span>
      </button>

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
        CLOSED HISTORY
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
          data-nav-index={balanceNavIndex + (isAdmin ? 2 : 1)}
          ref={(element) => { tabButtonRefs.current[balanceNavIndex + (isAdmin ? 2 : 1)] = element; }}
          onKeyDown={handleTabKeyDown}
      >
        <span>⚙️ SETTINGS</span>
      </button>
    </>
  );
}
