import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { getWorkspaceNavigationViews, isMarginDeskView, resolveTabNavigationIndex, shouldRefreshQuotesOnNavigation } from '../ui/tabNavigation';
import { useActiveView, usePortfolioSelector } from '../store/portfolioStore';
import { calculatePortfolioValuation } from '../domain/portfolioValuation';
import { emitBrokerEvent } from '../services/brokerEventBus';
import { emitUiEvent } from '../ui/uiEventBus';
import { calculateGuestPersonalEquity, getGuestAssignedCashHoldings, getGuestHoldingValuation } from '../domain/guestPortfolio';
import { getAppLanguage, translateText } from '../services/i18n';
import { formatPortfolioEquityBadge } from '../ui/portfolioEquityBadge';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';
import type { PortfolioState } from '../types/portfolio';

export const TickerTabs = memo(function TickerTabs({
  isAdmin = false,
  userId
}: {
  isAdmin?: boolean;
  userId?: string;
} = {}) {
  const tickers = usePortfolioSelector(selectPositionTickers, areTickerListsEqual);
  const activeView = useActiveView();
  const selectView = (view: string) => {
    if (!isAdmin && view !== 'BALANCE' && view !== 'SETTINGS' && !(userId && view === 'GUEST_HISTORY')) return;
    // Refresh the latest portfolio quotes whenever a different Margin section
    // is selected; same-section clicks and non-Margin routes do not start a batch.
    const refreshQuotes = shouldRefreshQuotesOnNavigation(activeView, view, isAdmin);
    emitUiEvent('portfolio:set-active-view', { view });
    // Show the selected desk immediately; refresh existing prices in the background.
    if (refreshQuotes) void handleRefreshQuotes();
  };

  const isCushionActive =
    activeView === 'CASH_CUSHION' || activeView === 'BALANCE';
  const isClosedHistoryActive = activeView === 'CLOSED_HISTORY';
  const isGuestHistoryActive = activeView === 'GUEST_HISTORY';
  const isSettingsActive = activeView === 'SETTINGS';
  const isMarginDeskActive = isMarginDeskView(activeView, isAdmin);

  // The Margin desk depends on open broker orders. Request them only when the
  // user enters this workspace, not whenever they switch between ticker tabs.
  useEffect(() => {
    if (isMarginDeskActive) emitBrokerEvent('broker:request-active-orders');
  }, [isMarginDeskActive]);

  const canViewGuestHistory = !isAdmin && Boolean(userId);
  const navigationViews = getWorkspaceNavigationViews(tickers, isAdmin, canViewGuestHistory);
  const balanceNavIndex = isAdmin ? navigationViews.length - 3 : 0;
  const guestHistoryNavIndex = balanceNavIndex + 1;
  const settingsNavIndex = navigationViews.length - 1;
  const tabButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleTabKeyDown = (event: KeyboardEvent) => {
    const currentButton = event.currentTarget as HTMLButtonElement;
    const currentIndex = Number(currentButton.dataset.navIndex);
    const nextIndex = resolveTabNavigationIndex(currentIndex, navigationViews.length, event.key);
    if (nextIndex === null) return;

    event.preventDefault();
    const nextButton = tabButtonRefs.current[nextIndex];
    nextButton?.focus({ preventScroll: true });
    nextButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    selectView(navigationViews[nextIndex]);
  };

  const handleRefreshQuotes = async (): Promise<void> => {
    // Every section change reaches the app coordinator. It coalesces duplicate
    // queued triggers without losing a latest-state follow-up behind an active batch.
    await new Promise<void>((resolve) => {
      emitUiEvent('portfolio:refresh-live-prices', { resolve });
    });
  };

  return (
    <>
      {isAdmin && (
        <div
          class="workspace-nav-ticker-list"
          role="group"
          aria-label={translateText('Margin ticker navigation', getAppLanguage())}
        >
      {isAdmin && tickers.length === 0 && (
        <button
          type="button"
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          onClick={() => selectView('COMBINED')}
          aria-label={translateText('COMBINED PORTFOLIO', getAppLanguage())}
          aria-pressed={isMarginDeskActive}
          class={`px-3 py-1 rounded text-xs font-bold transition ${isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
        >
          <span class="workspace-nav-label--desktop">{translateText('MARGIN DESK', getAppLanguage())}</span>
          <span class="workspace-nav-label--mobile">{translateText('COMBINED PORTFOLIO', getAppLanguage())}</span>
        </button>
      )}

      {isAdmin && tickers.length === 1 && (
        <button
          type="button"
          onClick={() => selectView(tickers[0])}
          aria-label={`${translateText('Margin', getAppLanguage())}: ${tickers[0]}`}
          aria-pressed={activeView === tickers[0]}
          class={`px-3 py-1 rounded text-xs font-bold transition ${activeView === tickers[0] && isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
        >
          <span class="workspace-nav-label--desktop">{translateText('MARGIN', getAppLanguage())}: {tickers[0]}</span>
          <span class="workspace-nav-label--mobile">{tickers[0]}</span>
        </button>
      )}

      {isAdmin && tickers.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => selectView('COMBINED')}
            aria-label={translateText('COMBINED PORTFOLIO', getAppLanguage())}
            aria-pressed={activeView === 'COMBINED'}
            class={`px-3 py-1 rounded text-xs font-bold transition ${activeView === 'COMBINED' && isMarginDeskActive
              ? 'bg-emerald-600 text-black'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          >
            <span class="workspace-nav-label--desktop">{translateText('COMBINED PORTFOLIO', getAppLanguage())}</span>
            <span class="workspace-nav-label--mobile">{translateText('COMBINED PORTFOLIO', getAppLanguage())}</span>
          </button>

          {tickers.map((t, index) => (
            <button
              key={t}
              type="button"
              onClick={() => selectView(t)}
              aria-label={`${translateText('Margin', getAppLanguage())}: ${t}`}
              aria-pressed={activeView === t}
              class={`px-3 py-1 rounded text-xs font-bold transition ${activeView === t && isMarginDeskActive
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

        </div>
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
        <span>{translateText('BALANCE', getAppLanguage())}</span>
        <BalanceEquityBadge isAdmin={isAdmin} userId={userId} isActive={isCushionActive} />
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
        {translateText('LOTS', getAppLanguage())}
      </button>}

      {isAdmin && <button
        type="button"
        onClick={() => selectView('CLOSED_HISTORY')}
        aria-label={translateText('Trades', getAppLanguage())}
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
        {translateText('TRADES', getAppLanguage())}
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
        aria-label={translateText('Settings', getAppLanguage())}
        title={translateText('Settings', getAppLanguage())}
      >
        <span aria-hidden="true">⚙️</span>
      </button>
    </>
  );
});


/** Portfolio synchronization is an action, not a workspace destination. */
export function PortfolioSyncButton({
  isAdmin = false,
  userId
}: {
  isAdmin?: boolean;
  userId?: string;
}) {
  const [isSyncingPortfolio, setIsSyncingPortfolio] = useState(false);
  const portfolioSyncPromise = useRef<Promise<ManualPortfolioSyncResult> | null>(null);

  if (!isAdmin && !userId) return null;

  const handleSyncPortfolio = async (): Promise<void> => {
    if (portfolioSyncPromise.current) {
      await portfolioSyncPromise.current;
      return;
    }

    setIsSyncingPortfolio(true);
    const request = new Promise<ManualPortfolioSyncResult>((resolve) => {
      emitUiEvent('portfolio:sync-request', { resolve });
    });
    portfolioSyncPromise.current = request;
    try {
      await request;
    } finally {
      if (portfolioSyncPromise.current === request) portfolioSyncPromise.current = null;
      setIsSyncingPortfolio(false);
    }
  };

  return (
    <button
      id="syncPortfolioButton"
      type="button"
      title={translateText('Sync portfolio', getAppLanguage())}
      aria-label={translateText('Sync portfolio', getAppLanguage())}
      aria-busy={isSyncingPortfolio}
      disabled={isSyncingPortfolio}
      onClick={handleSyncPortfolio}
      class="h-8 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
    >
      <span class={isSyncingPortfolio ? 'animate-spin' : ''} aria-hidden="true">↻</span>
    </button>
  );
}


type BalanceBadgeSnapshot = Pick<
  PortfolioState,
  'positions' | 'balance' | 'cashCushion' | 'guestPortfolioSnapshot'
>;

function selectBalanceBadgeSnapshot(state: PortfolioState): BalanceBadgeSnapshot {
  return {
    positions: state.positions,
    balance: state.balance,
    cashCushion: state.cashCushion,
    guestPortfolioSnapshot: state.guestPortfolioSnapshot
  };
}

function areBalanceBadgeSnapshotsEqual(previous: BalanceBadgeSnapshot, next: BalanceBadgeSnapshot): boolean {
  return previous.positions === next.positions &&
    previous.balance === next.balance &&
    previous.cashCushion === next.cashCushion &&
    previous.guestPortfolioSnapshot === next.guestPortfolioSnapshot;
}

function selectPositionTickers(state: PortfolioState): string[] {
  return Object.keys(state.positions || {});
}

function areTickerListsEqual(previous: string[], next: string[]): boolean {
  return previous.length === next.length && previous.every((ticker, index) => ticker === next[index]);
}

/** Isolate live valuation updates from the navigation buttons themselves. */
const BalanceEquityBadge = memo(function BalanceEquityBadge({
  isAdmin,
  userId,
  isActive
}: {
  isAdmin: boolean;
  userId?: string;
  isActive: boolean;
}) {
  const state = usePortfolioSelector(selectBalanceBadgeSnapshot, areBalanceBadgeSnapshotsEqual);
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
  const hasUnpricedPortfolioHoldings = portfolioValuation.unpricedHoldings > 0;
  const hasPricedPortfolioHoldings = portfolioValuation.pricedHoldings > 0;
  const hasUnpricedGuestHoldings = guestHoldings.some((holding) => getGuestHoldingValuation(holding).currentPrice === null);
  const hasPricedGuestHoldings = guestHoldings.some((holding) => getGuestHoldingValuation(holding).currentPrice !== null);
  const equityBadgeText = formatPortfolioEquityBadge({
    equity: displayedEquity,
    locale: getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US',
    hasUnpricedHoldings: isAdmin ? hasUnpricedPortfolioHoldings : hasUnpricedGuestHoldings,
    hasPricedHoldings: isAdmin ? hasPricedPortfolioHoldings : hasPricedGuestHoldings,
    empty: !isAdmin && Boolean(userId) && guestHoldings.length === 0
  });
  const hasPartialEquity = isAdmin ? hasUnpricedPortfolioHoldings : hasUnpricedGuestHoldings;
  const equityBadgeTitle = translateText(
    hasPartialEquity
      ? 'Partial value: holdings without a valid market quote are excluded.'
      : isAdmin
        ? 'Current portfolio equity from available market quotes and broker cash balance.'
        : 'Current market value of your assigned cash-funded stocks.',
    getAppLanguage()
  );

  return (
    <span
      title={equityBadgeTitle}
      aria-label={`${translateText('Balance', getAppLanguage())}: ${equityBadgeText}. ${equityBadgeTitle}`}
      class={`workspace-nav-equity-badge ${isAdmin ? 'workspace-nav-equity-badge--admin' : ''} text-[10px] px-1.5 py-0.2 rounded ${isActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'}`}
    >
      {equityBadgeText}
    </span>
  );
});
