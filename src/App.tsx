import { useEffect, useState } from 'preact/hooks';
import { AuthModal } from './components/AuthModal';
import { ClosedHistoryDesk } from './components/ClosedHistoryDesk';
import { CashCushionDesk, type CashCushionDeskProps } from './components/CashCushionDesk';
import { fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, normalizeFreedomPortfolio, normalizeFreedomTrades } from './services/api';
import { restoreGatewaySecret } from './services/storage';

let tradesRequest: Promise<void> | null = null;
let accountRequest: Promise<void> | null = null;

interface AppProps {
  onToggleMarketInsights: () => void;
  onSaveGatewaySecret: (secret: string) => Promise<boolean>;
}

export function App({ onSaveGatewaySecret }: AppProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [activeDeskView, setActiveDeskView] = useState('COMBINED');
  const [hasOpenedClosedHistory, setHasOpenedClosedHistory] = useState(false);
  const [hasOpenedCashCushion, setHasOpenedCashCushion] = useState(false);
  const [cashCushionProps, setCashCushionProps] = useState<CashCushionDeskProps>({});

  useEffect(() => {
    const handleAuthVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ isOpen?: boolean }>).detail;
      setAuthOpen(Boolean(detail?.isOpen));
    };
    const handleDeskView = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      if (detail?.view) {
        setActiveDeskView(detail.view);
        if (detail.view === 'CLOSED_HISTORY') setHasOpenedClosedHistory(true);
        if (detail.view === 'CASH_CUSHION' || detail.view === 'BALANCE') setHasOpenedCashCushion(true);
      }
    };
    window.addEventListener('terminal:auth-visibility', handleAuthVisibility);
    const handleCashCushionProps = (event: Event) => {
      const detail = (event as CustomEvent<CashCushionDeskProps>).detail;
      if (detail) setCashCushionProps(detail);
    };
    window.addEventListener('terminal:active-view', handleDeskView);
    window.addEventListener('terminal:cash-cushion-props', handleCashCushionProps);
    return () => {
      window.removeEventListener('terminal:auth-visibility', handleAuthVisibility);
      window.removeEventListener('terminal:active-view', handleDeskView);
      window.removeEventListener('terminal:cash-cushion-props', handleCashCushionProps);
    };
  }, []);

  // Closed History asks for trade history when mounted; do not also fetch from
  // a global navigation click listener, which caused duplicate broker requests.
  useEffect(() => {
    // Load broker executions so margin commissions can use Freedom-reported fees
    // when present; local commission rules remain the fallback.
    void loadExecutedTrades();
    const onRequest = () => { void loadExecutedTrades(); };
    window.addEventListener('tradenet:request-executed-trades', onRequest);
    return () => window.removeEventListener('tradenet:request-executed-trades', onRequest);
  }, []);

  const loadFreedomAccount = async () => {
    if (accountRequest) return accountRequest;
    accountRequest = (async () => {
      const secret = await restoreGatewaySecret();
      if (!secret.trim()) throw new Error('Gateway Secret is not available.');
      const response = await fetchFreedomTradeNetPositions();
      const snapshot = normalizeFreedomPortfolio(response);
      (window as any).__tradenetAccountInfo = snapshot;
      window.dispatchEvent(new CustomEvent('tradenet:account-info', { detail: snapshot }));
    })();
    try { await accountRequest; } finally { accountRequest = null; }
  };

  const loadExecutedTrades = async () => {
    if (tradesRequest) return tradesRequest;
    tradesRequest = (async () => {
    try {
      // The saved Gateway Secret is encrypted and restored asynchronously from IndexedDB.
      // Never issue the startup request until restoration has completed.
      const secret = await restoreGatewaySecret();
      if (!secret.trim()) {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tradenet:executed-trades-error'));
        return;
      }
      const response = await fetchFreedomTradeNetTrades();
      const normalizedTrades = normalizeFreedomTrades(response);
      // Keep broker executions separate from app-owned ClosedTrade records.
      // ClosedHistoryDesk subscribes to this event and renders the broker data.
      if (typeof window !== 'undefined') {
        (window as any).__tradenetExecutedTrades = normalizedTrades;
        window.dispatchEvent(new CustomEvent('tradenet:executed-trades', { detail: normalizedTrades }));
        // Account snapshots are emitted only after a successful account API
        // request. Re-emitting the cached global here would falsely refresh its
        // timestamp and could mark stale broker data as current.
      }
    } catch (error) {
      console.error('Unable to load TradeNet executed trades:', error);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tradenet:executed-trades-error'));
    } finally {
    }
    })();
    try { await tradesRequest; } finally { tradesRequest = null; }
  };

  // Load account/balance/position data first on startup. Trade history is fetched
  // only when Closed History opens.
  useEffect(() => {
    void loadFreedomAccount().catch(() => {
      // Keep the saved portfolio intact, but notify the app shell so stale
      // broker data is never mistaken for a successful current snapshot.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tradenet:account-info-error'));
      }
    });
  }, []);



  return (
    <>
      {/* Active Position Header Panel */}
      <main
        id="mainTerminalView"
        aria-label="Portfolio workspace"
        class="border-card p-4 sm:p-6 rounded-xl space-y-2 max-w-6xl mx-auto"
      >
        {/* Asset View Tabs */}
        <div
          id="boardHeaderBanner"
          class="board-header-banner border-b border-slate-800 pb-3"
        >
          <div class="flex flex-wrap items-center gap-2" id="tickerTabs" role="group" aria-label="Portfolio assets"></div>
          <div
            class="text-sm font-semibold text-emerald-400 font-mono tracking-tight shrink-0"
            id="daysToBreakeven"
          >
            Combined Breakeven: 0 days
          </div>
        </div>

        {/* Desk content and terminal share a responsive grid. It creates two columns only when both can fit. */}
        <div id="tradingWorkspaceGrid" class="trading-workspace-grid">
          {/* Main Board Content */}
          <div id="mainDeskContainer" class={"space-y-4 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}>
            <div
              id="emptyStatePanel"
              class="hidden border border-dashed border-slate-700 bg-slate-900/40 rounded-lg p-4"
            ></div>

            <div
              id="boardTitleRow"
              class="board-title-row flex flex-wrap items-center justify-between gap-2"
            >
              <div class="min-w-0 flex-1 text-lg font-bold text-white" id="boardTitle">
                COMBINED PORTFOLIO
              </div>
            </div>



            <div
              id="boardTitleActions"
              class="board-title-actions flex flex-wrap items-center gap-2"
            >
              <div id="boardDailyMove" class="hidden"></div>
              <div id="boardAnalystConsensus" class="hidden"></div>
              <div id="boardExternalLinks" class="flex items-center gap-2"></div>
            </div>

            <div
              id="portfolioMetricsGrid"
              aria-label="Portfolio summary metrics"
              class="portfolio-metrics-grid gap-2 text-xs text-slate-300"
            ></div>

            {/* Projection Table */}
            <div
              class="table-scroll-wrapper overflow-x-auto pt-2 max-w-2xl mx-auto w-full lg:max-w-none"
              id="projectionTableContainer"
            >
              <table aria-label="Portfolio projection by date" class="w-full min-w-[300px] text-xs border-collapse">
                <caption class="sr-only">Projected portfolio net value, fees and commissions, margin fee, and balance by date.</caption>
                <thead>
                  <tr class="border-b border-slate-800 text-slate-400">
                    <th scope="col" class="py-2 px-3 text-left">Date</th>
                    <th scope="col" class="py-2 px-3 text-right">Net</th>
                    <th scope="col" class="py-2 px-3 text-right">F&amp;C</th>
                    <th scope="col" class="py-2 px-3 text-right">M Fee</th>
                    <th scope="col" class="py-2 px-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody
                  id="projectionTableBody"
                  class="divide-y divide-slate-800/60 font-mono"
                ></tbody>
              </table>
            </div>
          </div>

          {/* Cash Cushion Management Panel */}
          <div id="cashCushionContainer" class={"space-y-3 " + (["CASH_CUSHION", "BALANCE"].includes(activeDeskView) ? "" : "hidden")}>{hasOpenedCashCushion && <CashCushionDesk {...cashCushionProps} />}</div>

          {/* Keep the command console available on both Margin and Cash desks. */}
          <div id="tradingTerminalColumn" class="trading-terminal-column">
            <section
              id="marketInsightsPanel"
              class="market-insights-workspace space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10"
              aria-label="Market insights"
            ></section>
            <div
              id="tradingConsoleCard"
              class="trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 w-full"
            ></div>
          </div>

        </div>
      </main>

      {/* Closed Trade History */}
      <div
        id="closedHistoryContainer"
        class={"rounded-lg " + (activeDeskView === "CLOSED_HISTORY" ? "" : "hidden")}
      >{hasOpenedClosedHistory && <ClosedHistoryDesk />}</div>

      {/* Settings */}
      <div class={"p-4 sm:p-6 rounded-xl space-y-4 " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings"></div>

      {/* Authentication is part of the application tree, not a second Preact root. */}
      <div id="auth-container" class="auth-overlay" style={{ display: authOpen ? 'flex' : 'none' }}>
        <AuthModal isOpen={authOpen} onSaveSecret={onSaveGatewaySecret} />
      </div>
    </>
  );
}