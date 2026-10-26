import { useEffect } from 'preact/hooks';
import { fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, normalizeFreedomPortfolio, normalizeFreedomTrades } from './services/api';
import { restoreGatewaySecret } from './services/storage';

let tradesRequest: Promise<void> | null = null;
let accountRequest: Promise<void> | null = null;

interface AppProps {
  onToggleMarketInsights: () => void;
}

export function App({ }: AppProps) {

  // Closed History asks for trade history when mounted; do not also fetch from
  // a global navigation click listener, which caused duplicate broker requests.
  useEffect(() => {
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
        const accountSnapshot = (window as any).__tradenetAccountInfo;
        if (accountSnapshot?.loaded === true) {
          window.dispatchEvent(new CustomEvent('tradenet:account-info', { detail: accountSnapshot }));
        }
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
    void loadFreedomAccount().catch(error => console.error('Unable to load TradeNet account info:', error));
    // Fetch a bounded execution page for lot-level basis where it fully reconciles.
    void loadExecutedTrades();
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
          <div id="mainDeskContainer" class="space-y-4">
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

            <section class="portfolio-micro-column portfolio-micro-basis rounded-lg border border-slate-800 bg-slate-900/40 p-3" aria-label="Position basis">
              <span class="portfolio-micro-heading text-[10px] font-semibold tracking-wider text-slate-400">POSITION BASIS</span>
              <div class="portfolio-micro-row mt-2 flex items-start justify-between gap-3">
                <span class="portfolio-metric-label text-[10px] text-slate-400">Shares / Tranches</span>
                <span id="boardTranches" class="portfolio-metric-value text-right text-xs sm:text-sm font-mono text-slate-200">—</span>
              </div>
              <div class="portfolio-micro-row mt-1 flex items-start justify-between gap-3">
                <span class="portfolio-metric-label text-[10px] text-slate-400">Invested / Avg. Entry</span>
                <span id="boardInvested" class="portfolio-metric-value text-right text-xs sm:text-sm font-mono text-slate-200">—</span>
              </div>
            </section>

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
          <div id="cashCushionContainer" class="hidden space-y-3"></div>

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
        class="hidden rounded-lg"
      ></div>

      {/* Settings */}
      <div class="hidden p-4 sm:p-6 rounded-xl space-y-4" id="settings"></div>
    </>
  );
}