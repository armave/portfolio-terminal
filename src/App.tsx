interface AppProps {
  onToggleMarketInsights: () => void;
}

export function App({ onToggleMarketInsights }: AppProps) {
  return (
    <>
      {/* Active Position Header Panel */}
      <div
        id="mainTerminalView"
        class="border-card p-4 sm:p-6 rounded-xl space-y-2 max-w-6xl mx-auto"
      >
        {/* Asset View Tabs */}
        <div
          id="boardHeaderBanner"
          class="board-header-banner border-b border-slate-800 pb-3"
        >
          <div class="flex flex-wrap items-center gap-2" id="tickerTabs"></div>
          <div
            class="text-sm font-semibold text-emerald-400 font-mono tracking-tight shrink-0"
            id="daysToBreakeven"
          >
            Combined Breakeven: 0 days
          </div>
        </div>

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
            <div
              id="boardTitleActions"
              class="board-title-actions flex flex-wrap items-center gap-2"
            >
              <div id="boardDailyMove" class="hidden"></div>
              <div id="boardAnalystConsensus" class="hidden"></div>
              <div id="boardExternalLinks" class="flex items-center gap-2"></div>
              <button
                id="marketInsightsToggle"
                type="button"
                onClick={onToggleMarketInsights}
                aria-expanded="false"
                aria-controls="marketInsightsPanel"
                class="hidden rounded border border-cyan-800/70 bg-cyan-950/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-900/50"
              >
                Market insights
              </button>
            </div>
          </div>

          <div
            id="portfolioMetricsGrid"
            class="portfolio-metrics-grid gap-2 text-xs text-slate-300"
          ></div>

          <section
            id="marketInsightsPanel"
            class="hidden space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10"
            aria-label="Market insights"
          ></section>

          <div class="desktop-workspace-grid grid grid-cols-1 lg:grid-cols-[3fr_7fr] gap-4 lg:gap-6 items-start">
            {/* Projection Table */}
            <div
              class="table-scroll-wrapper overflow-x-auto pt-2 max-w-2xl mx-auto w-full lg:max-w-none lg:mx-0"
              id="projectionTableContainer"
            >
              <table class="w-full min-w-[300px] text-xs border-collapse">
                <thead>
                  <tr class="border-b border-slate-800 text-slate-400">
                    <th class="py-2 px-3 text-left">Date</th>
                    <th class="py-2 px-3 text-right">P&amp;L (Net)</th>
                    <th class="py-2 px-3 text-right">Fee&amp;Com</th>
                    <th class="py-2 px-3 text-right">Margin Fee</th>
                    <th class="py-2 px-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody
                  id="projectionTableBody"
                  class="divide-y divide-slate-800/60 font-mono"
                ></tbody>
              </table>
            </div>

            {/* Conversational Terminal Box */}
            <div
              id="tradingConsoleCard"
              class="trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 max-w-2xl mx-auto w-full lg:max-w-none lg:mx-0"
            ></div>
          </div>
        </div>

        {/* Cash Cushion Management Panel */}
        <div id="cashCushionContainer" class="hidden space-y-3"></div>
      </div>

      {/* Closed Trade History */}
      <div
        id="closedHistoryContainer"
        class="hidden border-card p-6 rounded-lg space-y-4"
      ></div>

      {/* Settings */}
      <div class="hidden border-card p-4 sm:p-6 rounded-xl space-y-4" id="settings"></div>
    </>
  );
}