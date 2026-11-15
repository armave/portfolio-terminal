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

type WorkspaceNavigationIconName = 'margin' | 'portfolio' | 'balance' | 'trades' | 'lots' | 'settings';

function WorkspaceNavigationIcon({ name }: { name: WorkspaceNavigationIconName }) {
  const paths: Record<WorkspaceNavigationIconName, string> = {
    margin: 'M4 19V5 M9 19V10 M14 19V6 M19 19V3 M3 19H21',
    portfolio: 'M4 4H11V11H4Z M13 4H20V11H13Z M4 13H11V20H4Z M13 13H20V20H13Z',
    balance: 'M4 7.5H20A1.5 1.5 0 0 1 21.5 9V18A2 2 0 0 1 19.5 20H4.5A2.5 2.5 0 0 1 2 17.5V6A2 2 0 0 1 4 4H18 M2 8H21.5 M16 14H18',
    trades: 'M4 7H20 M16 3L20 7L16 11 M20 17H4 M8 13L4 17L8 21',
    lots: 'M12 3L21 8L12 13L3 8L12 3Z M3 12L12 17L21 12 M3 16L12 21L21 16',
    settings: 'M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5 M19.4 15A1.7 1.7 0 0 0 19.7 16.9L19.8 17L17 19.8L16.9 19.7A1.7 1.7 0 0 0 15 19.4A1.7 1.7 0 0 0 13.8 21H10.2A1.7 1.7 0 0 0 9 19.4A1.7 1.7 0 0 0 7.1 19.7L7 19.8L4.2 17L4.3 16.9A1.7 1.7 0 0 0 4.6 15A1.7 1.7 0 0 0 3 13.8V10.2A1.7 1.7 0 0 0 4.6 9A1.7 1.7 0 0 0 4.3 7.1L4.2 7L7 4.2L7.1 4.3A1.7 1.7 0 0 0 9 4.6A1.7 1.7 0 0 0 10.2 3H13.8A1.7 1.7 0 0 0 15 4.6A1.7 1.7 0 0 0 16.9 4.3L17 4.2L19.8 7L19.7 7.1A1.7 1.7 0 0 0 19.4 9A1.7 1.7 0 0 0 21 10.2V13.8A1.7 1.7 0 0 0 19.4 15Z'
  };
  return <svg class="workspace-nav-button__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

function workspaceNavigationButtonClass(active: boolean, ticker = false): string {
  return 'workspace-nav-button' +
    (active ? ' workspace-nav-button--active' : '') +
    (ticker ? ' workspace-nav-button--ticker' : '');
}

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
    const refreshQuotes = shouldRefreshQuotesOnNavigation(activeView, view, isAdmin);
    emitUiEvent('portfolio:set-active-view', { view });
    if (refreshQuotes) void handleRefreshQuotes();
  };

  const isCushionActive = activeView === 'CASH_CUSHION' || activeView === 'BALANCE';
  const isClosedHistoryActive = activeView === 'CLOSED_HISTORY';
  const isGuestHistoryActive = activeView === 'GUEST_HISTORY';
  const isSettingsActive = activeView === 'SETTINGS';
  const isMarginDeskActive = isMarginDeskView(activeView, isAdmin);

  // Margin requests active orders only when entering the Margin workspace.
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
    await new Promise<void>((resolve) => {
      emitUiEvent('portfolio:refresh-live-prices', { resolve });
    });
  };

  return (
    <>
      {isAdmin && tickers.length > 1 && (
        <div class="workspace-nav-ticker-list" role="group" aria-label={translateText('MARGIN DESK', getAppLanguage())}>
          <button
            type="button"
            onClick={() => selectView('COMBINED')}
            aria-label={translateText('COMBINED PORTFOLIO', getAppLanguage())}
            aria-pressed={activeView === 'COMBINED'}
            class={workspaceNavigationButtonClass(activeView === 'COMBINED' && isMarginDeskActive)}
            data-nav-tab="true"
            data-nav-kind="portfolio"
            data-nav-index={0}
            ref={(element) => { tabButtonRefs.current[0] = element; }}
            onKeyDown={handleTabKeyDown}
            title={translateText('COMBINED PORTFOLIO', getAppLanguage())}
          >
            <WorkspaceNavigationIcon name="portfolio" />
            <span class="workspace-nav-button__label workspace-nav-label--desktop">{translateText('COMBINED PORTFOLIO', getAppLanguage())}</span>
            <span class="workspace-nav-button__label workspace-nav-label--mobile">{translateText('Portfolio', getAppLanguage())}</span>
          </button>
          {tickers.map((ticker, index) => (
            <button
              key={ticker}
              type="button"
              onClick={() => selectView(ticker)}
              aria-label={`${translateText('Margin', getAppLanguage())}: ${ticker}`}
              aria-pressed={activeView === ticker}
              class={workspaceNavigationButtonClass(activeView === ticker && isMarginDeskActive, true)}
              data-nav-tab="true"
              data-nav-kind="margin-ticker"
              data-nav-index={index + 1}
              ref={(element) => { tabButtonRefs.current[index + 1] = element; }}
              onKeyDown={handleTabKeyDown}
              title={`${translateText('Margin', getAppLanguage())}: ${ticker}`}
            >
              <WorkspaceNavigationIcon name="margin" />
              <span class="workspace-nav-button__label">{ticker}</span>
            </button>
          ))}
        </div>
      )}

      {isAdmin && tickers.length === 1 && (
        <button
          type="button"
          onClick={() => selectView(tickers[0])}
          aria-label={`${translateText('Margin', getAppLanguage())}: ${tickers[0]}`}
          aria-pressed={activeView === tickers[0]}
          class={workspaceNavigationButtonClass(activeView === tickers[0] && isMarginDeskActive, true)}
          data-nav-tab="true"
          data-nav-kind="margin-ticker"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          title={`${translateText('Margin', getAppLanguage())}: ${tickers[0]}`}
        >
          <WorkspaceNavigationIcon name="margin" />
          <span class="workspace-nav-button__label"><span class="workspace-nav-button__context">{translateText('Margin', getAppLanguage())}: </span>{tickers[0]}</span>
        </button>
      )}

      {isAdmin && tickers.length === 0 && (
        <button
          type="button"
          data-nav-tab="true"
          data-nav-kind="margin"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          onClick={() => selectView('COMBINED')}
          aria-label={translateText('COMBINED PORTFOLIO', getAppLanguage())}
          aria-pressed={isMarginDeskActive}
          class={workspaceNavigationButtonClass(isMarginDeskActive)}
          title={translateText('MARGIN DESK', getAppLanguage())}
        >
          <WorkspaceNavigationIcon name="margin" />
          <span class="workspace-nav-button__label">{translateText('MARGIN DESK', getAppLanguage())}</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => selectView('BALANCE')}
        aria-label={translateText('Balance', getAppLanguage())}
        aria-pressed={isCushionActive}
        class={workspaceNavigationButtonClass(isCushionActive)}
        data-nav-tab="true"
        data-nav-kind="balance"
        data-nav-index={balanceNavIndex}
        ref={(element) => { tabButtonRefs.current[balanceNavIndex] = element; }}
        onKeyDown={handleTabKeyDown}
        title={translateText('Balance', getAppLanguage())}
      >
        <WorkspaceNavigationIcon name="balance" />
        <span class="workspace-nav-button__label">{translateText('Balance', getAppLanguage())}</span>
        <BalanceEquityBadge isAdmin={isAdmin} userId={userId} />
      </button>

      {canViewGuestHistory && (
        <button
          type="button"
          onClick={() => selectView('GUEST_HISTORY')}
          aria-label={translateText('Lots', getAppLanguage())}
          aria-pressed={isGuestHistoryActive}
          class={workspaceNavigationButtonClass(isGuestHistoryActive)}
          data-nav-tab="true"
          data-nav-kind="lots"
          data-nav-index={guestHistoryNavIndex}
          ref={(element) => { tabButtonRefs.current[guestHistoryNavIndex] = element; }}
          onKeyDown={handleTabKeyDown}
          title={translateText('Lots', getAppLanguage())}
        >
          <WorkspaceNavigationIcon name="lots" />
          <span class="workspace-nav-button__label">{translateText('LOTS', getAppLanguage())}</span>
        </button>
      )}

      {isAdmin && (
        <button
          type="button"
          onClick={() => selectView('CLOSED_HISTORY')}
          aria-label={translateText('Trades', getAppLanguage())}
          aria-pressed={isClosedHistoryActive}
          class={workspaceNavigationButtonClass(isClosedHistoryActive)}
          data-nav-tab="true"
          data-nav-kind="trades"
          data-nav-index={balanceNavIndex + 1}
          ref={(element) => { tabButtonRefs.current[balanceNavIndex + 1] = element; }}
          onKeyDown={handleTabKeyDown}
          title={translateText('Trades', getAppLanguage())}
        >
          <WorkspaceNavigationIcon name="trades" />
          <span class="workspace-nav-button__label">{translateText('TRADES', getAppLanguage())}</span>
        </button>
      )}

      <button
        id="settingsBtn"
        type="button"
        aria-pressed={isSettingsActive}
        onClick={() => selectView('SETTINGS')}
        class={workspaceNavigationButtonClass(isSettingsActive)}
        data-nav-tab="true"
        data-nav-kind="settings"
        data-nav-index={settingsNavIndex}
        ref={(element) => { tabButtonRefs.current[settingsNavIndex] = element; }}
        onKeyDown={handleTabKeyDown}
        aria-label={translateText('Settings', getAppLanguage())}
        title={translateText('Settings', getAppLanguage())}
      >
        <WorkspaceNavigationIcon name="settings" />
        <span class="workspace-nav-button__label">{translateText('Settings', getAppLanguage())}</span>
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
      class="min-h-11 min-w-11 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
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
  userId
}: {
  isAdmin: boolean;
  userId?: string;
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
      class={'workspace-nav-equity-badge' + (isAdmin ? ' workspace-nav-equity-badge--admin' : '')}
    >
      {equityBadgeText}
    </span>
  );
});
