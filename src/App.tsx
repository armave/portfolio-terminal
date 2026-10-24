import { useEffect, useState } from 'preact/hooks';
import { fetchFreedomTradeNetTrades, normalizeFreedomTrades } from './services/api';
import { restoreGatewaySecret } from './services/storage';

interface AppProps {
  onToggleMarketInsights: () => void;
}

export function App({ }: AppProps) {
  const [tradesDebugLoading, setTradesDebugLoading] = useState(false);

  // The app's main navigation is managed outside this component. Load broker
  // trade history when the user opens Closed History, rather than requiring a
  // separate diagnostic-button click. Ignore unrelated navigation clicks.
  useEffect(() => {
    const isClosedHistoryTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      const element = target.closest('button, a, [role="tab"], [data-tab], [data-view]');
      if (!element) return false;
      const label = [
        element.textContent ?? '',
        element.getAttribute('aria-label') ?? '',
        element.getAttribute('href') ?? '',
        element.getAttribute('data-tab') ?? '',
        element.getAttribute('data-view') ?? '',
        element.id ?? ''
      ].join(' ').toLowerCase();
      return label.includes('closed history') || label.includes('closed-history') || label.includes('closedhistory');
    };
    const onNavigationClick = (event: MouseEvent) => {
      if (isClosedHistoryTarget(event.target) && !tradesDebugLoading) {
        void loadExecutedTrades();
      }
    };
    document.addEventListener('click', onNavigationClick, true);
    return () => document.removeEventListener('click', onNavigationClick, true);
  }, [tradesDebugLoading]);


  useEffect(() => {
    const onRequest = () => { void loadExecutedTrades(); };
    window.addEventListener('tradenet:request-executed-trades', onRequest);
    return () => window.removeEventListener('tradenet:request-executed-trades', onRequest);
  }, []);

  const loadExecutedTrades = async () => {
    setTradesDebugLoading(true);
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
      }
    } catch (error) {
      console.error('Unable to load TradeNet executed trades:', error);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tradenet:executed-trades-error'));
    } finally {
      setTradesDebugLoading(false);
    }
  };

  // Load broker trade history automatically on app start.
  useEffect(() => {
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
        class="hidden p-6 rounded-lg space-y-4"
      ></div>

      {/* Settings */}
      <div class="hidden p-4 sm:p-6 rounded-xl space-y-4" id="settings"></div>
    </>
  );
}