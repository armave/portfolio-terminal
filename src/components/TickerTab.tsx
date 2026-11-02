import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isMarginDeskView, resolveTabNavigationIndex, shouldRefreshQuotesOnNavigation } from '../ui/tabNavigation';
import { useActiveView, usePortfolio } from '../store/portfolioStore';
import { calculatePortfolioValuation } from '../domain/portfolioValuation';
import { emitBrokerEvent } from '../services/brokerEventBus';
import { emitUiEvent } from '../ui/uiEventBus';
import { calculateGuestPersonalEquity, getGuestAssignedCashHoldings, getGuestHoldingValuation } from '../domain/guestPortfolio';
import { getAppLanguage, translateText } from '../services/i18n';
import { formatPortfolioEquityBadge } from '../ui/portfolioEquityBadge';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';

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

    const request = new Promise<void>((resolve) => {
      emitUiEvent('portfolio:refresh-live-prices', { resolve });
    });
    quoteRefreshPromise.current = request;
    try {
      await request;
    } finally {
      if (quoteRefreshPromise.current === request) quoteRefreshPromise.current = null;
    }
  };

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
    <>
      {(isAdmin || Boolean(userId)) && (
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
      )}

      {isAdmin && tickers.length === 0 && (
        <button
          type="button"
          data-nav-tab="true"
          data-nav-index={0}
          ref={(element) => { tabButtonRefs.current[0] = element; }}
          onKeyDown={handleTabKeyDown}
          onClick={() => selectView('COMBINED')}
          aria-label="Combined portfolio"
          aria-pressed={isMarginDeskActive}
          class={`px-3 py-1 rounded text-xs font-bold transition ${isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
        >
          <span class="workspace-nav-label--desktop">MARGIN DESK</span>
          <span class="workspace-nav-label--mobile">COMBINED</span>
        </button>
      )}

      {isAdmin && tickers.length === 1 && (
        <button
          type="button"
          onClick={() => selectView(tickers[0])}
          aria-label={`Margin: ${tickers[0]}`}
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
          <span class="workspace-nav-label--desktop">MARGIN: {tickers[0]}</span>
          <span class="workspace-nav-label--mobile">{tickers[0]}</span>
        </button>
      )}

      {isAdmin && tickers.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => selectView('COMBINED')}
            aria-label="Combined portfolio"
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
            <span class="workspace-nav-label--desktop">COMBINED PORTFOLIO</span>
            <span class="workspace-nav-label--mobile">COMBINED</span>
          </button>

          {tickers.map((t, index) => (
            <button
              key={t}
              type="button"
              onClick={() => selectView(t)}
              aria-label={`Margin: ${t}`}
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

      <button
        type="button"
        onClick={() => selectView('BALANCE')}
        aria-label={translateText('Balance', getAppLanguage())}
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
        <span>BALANCE</span>
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
        LOTS
      </button>}

      {isAdmin && <button
        type="button"
        onClick={() => selectView('CLOSED_HISTORY')}
        aria-label="Trades"
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
});
