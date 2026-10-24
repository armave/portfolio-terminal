import { useState } from 'preact/hooks';
import { loadSavedState } from './services/storage';
import { fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, normalizeFreedomPortfolio, normalizeFreedomTrades, type FreedomExecutedTrade, type FreedomPortfolioSnapshot } from './services/api';

interface AppProps {
  onToggleMarketInsights: () => void;
}

export function App({ }: AppProps) {
  const [freedomSnapshot, setFreedomSnapshot] = useState<FreedomPortfolioSnapshot | null>(null);
  const [freedomLoading, setFreedomLoading] = useState(false);
  const [freedomError, setFreedomError] = useState('');
  const [tradesDebugLoading, setTradesDebugLoading] = useState(false);
  const [tradesDebugError, setTradesDebugError] = useState('');
  const [tradesDebugResponse, setTradesDebugResponse] = useState<any>(null);
  const [executedTrades, setExecutedTrades] = useState<FreedomExecutedTrade[] | null>(null);
  // App-owned portfolio state is the authority for cash-vs-margin classification.
  const [, setAppPortfolioState] = useState(loadSavedState({ holdings: [], cashStocks: [] }));

  const refreshFreedomPortfolio = async () => {
    setFreedomLoading(true);
    setFreedomError('');
    try {
      const response = await fetchFreedomTradeNetPositions();
      const snapshot = normalizeFreedomPortfolio(response);
      // Refresh the app's own classification before reconciling the broker snapshot.
      const localState = loadSavedState({ holdings: [], cashStocks: [] });
      setAppPortfolioState(localState);
      const appHoldings = Array.isArray(localState?.holdings) ? localState.holdings : [];
      const cashTickers = new Set<string>([
        ...appHoldings.filter((holding: any) => holding && holding.isMargin === false).map((holding: any) => String(holding.ticker || '').trim().toUpperCase()),
        ...(Array.isArray(localState?.cashStocks) ? localState.cashStocks.map((holding: any) => String(holding?.ticker || '').trim().toUpperCase()) : [])
      ].filter(Boolean));
      const marginTickers = new Set<string>(
        appHoldings.filter((holding: any) => holding && holding.isMargin === true).map((holding: any) => String(holding.ticker || '').trim().toUpperCase())
      );
      // Existing app classification wins; unrecognized broker positions stay unclassified.
      const classifiedPositions = snapshot.positions.map((position) => {
        const ticker = position.ticker.trim().toUpperCase();
        const isCash = cashTickers.has(ticker);
        const isMargin = marginTickers.has(ticker);
        return { ...position, appClassification: isCash ? 'Cash' : isMargin ? 'Margin' : 'Unclassified' };
      });
      const classifiedSnapshot = { ...snapshot, positions: classifiedPositions };
      if (classifiedSnapshot.balances.length === 0) {
        throw new Error('TradeNet returned no USD cash balance for the active account.');
      }
      setFreedomSnapshot(classifiedSnapshot);
    } catch (error) {
      setFreedomError(error instanceof Error ? error.message : 'Unable to load Freedom TradeNet portfolio.');
    } finally {
      setFreedomLoading(false);
    }
  };

  // Temporary diagnostic button: fetch the raw TradeNet history response for schema verification.
  const loadTradesDebugResponse = async () => {
    setTradesDebugLoading(true);
    setTradesDebugError('');
    setTradesDebugResponse(null);
    try {
      const response = await fetchFreedomTradeNetTrades();
      setTradesDebugResponse(response);
    } catch (error) {
      setTradesDebugError(error instanceof Error ? error.message : 'Unable to fetch TradeNet trade history.');
    } finally {
      setTradesDebugLoading(false);
    }
  };

  const loadExecutedTrades = async () => {
    setTradesDebugLoading(true);
    setTradesDebugError('');
    try {
      const response = await fetchFreedomTradeNetTrades();
      setTradesDebugResponse(response);
      setExecutedTrades(normalizeFreedomTrades(response));
    } catch (error) {
      setTradesDebugError(error instanceof Error ? error.message : 'Unable to load executed trades.');
    } finally {
      setTradesDebugLoading(false);
    }
  };

  const usd = (value: number | null) => value === null
    ? '—'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

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
            <section
              aria-label="Freedom TradeNet executed trade history"
              class="rounded-lg border border-sky-900/60 bg-slate-950/70 p-4 space-y-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-sm font-bold text-sky-300">Freedom TradeNet · Executed trades</h2>
                  <p class="text-[11px] text-slate-400">Read-only execution history. Your app's Cash/Margin classification remains unchanged.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="button" onClick={loadExecutedTrades} disabled={tradesDebugLoading}
                    class="rounded border border-sky-800 bg-sky-950 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-900 disabled:opacity-50">
                    {tradesDebugLoading ? 'Loading…' : executedTrades ? 'Refresh trades' : 'Load executed trades'}
                  </button>
                  <button type="button" onClick={loadTradesDebugResponse} disabled={tradesDebugLoading}
                    class="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50">
                    Show raw JSON
                  </button>
                </div>
              </div>
              {tradesDebugError && <p role="alert" class="text-xs text-rose-300">{tradesDebugError}</p>}
              {executedTrades !== null && (
                executedTrades.length === 0
                  ? <p class="text-xs text-amber-300">No trades found in a recognized response array. Use Show raw JSON to inspect the response.</p>
                  : <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                      <thead class="text-[10px] uppercase tracking-wide text-slate-400">
                        <tr><th class="px-2 py-2">Executed at</th><th class="px-2 py-2">Ticker</th><th class="px-2 py-2">Side</th><th class="px-2 py-2 text-right">Qty</th><th class="px-2 py-2 text-right">Price</th><th class="px-2 py-2">Currency</th><th class="px-2 py-2 text-right">Commission</th><th class="px-2 py-2 text-right">Profit</th></tr>
                      </thead>
                      <tbody>
                        {executedTrades.map((trade) => (
                          <tr key={trade.id} class="border-t border-slate-800">
                            <td class="whitespace-nowrap px-2 py-2 text-slate-300">{trade.executedAt ? trade.executedAt.replace('T', ' ') : '—'}</td>
                            <td class="px-2 py-2 font-semibold text-white">{trade.ticker || '—'}</td><td class="px-2 py-2">{trade.side}</td>
                            <td class="px-2 py-2 text-right font-mono">{trade.quantity ?? '—'}</td>
                            <td class="px-2 py-2 text-right font-mono">{trade.price === null ? '—' : trade.price.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                            <td class="px-2 py-2">{trade.currency || '—'}</td>
                            <td class="px-2 py-2 text-right font-mono">{trade.commission === null ? '—' : trade.commission.toLocaleString('en-US', { maximumFractionDigits: 2 })} {trade.commissionCurrency}</td>
                            <td class="px-2 py-2 text-right font-mono">{trade.profit === null ? '—' : trade.profit.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              )}
              {tradesDebugResponse !== null && (
                <details class="space-y-2"><summary class="cursor-pointer text-xs text-slate-400">Raw TradeNet response</summary>
                  <textarea aria-label="Raw TradeNet getTradesHistory response" readOnly rows={8}
                    value={JSON.stringify(tradesDebugResponse, null, 2)}
                    class="w-full rounded border border-slate-700 bg-slate-900 p-3 font-mono text-[11px] text-slate-200"
                    onClick={(event) => (event.currentTarget as HTMLTextAreaElement).select()} />
                </details>
              )}
            </section>

            <section
              aria-label="Freedom TradeNet USD portfolio"
              class="rounded-lg border border-emerald-900/60 bg-slate-950/70 p-4 space-y-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-sm font-bold text-emerald-300">Freedom TradeNet · USD account</h2>
                  <p class="text-[11px] text-slate-400">Read-only broker snapshot. Other currencies are excluded.</p>
                </div>
                <button
                  type="button"
                  onClick={refreshFreedomPortfolio}
                  disabled={freedomLoading}
                  class="rounded border border-emerald-800 bg-emerald-950 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900 disabled:opacity-50"
                >
                  {freedomLoading ? 'Refreshing…' : freedomSnapshot ? 'Refresh broker data' : 'Load broker portfolio'}
                </button>
              </div>
              {freedomError && <p role="alert" class="text-xs text-rose-300">{freedomError}</p>}
              {!freedomSnapshot && !freedomLoading && !freedomError && (
                <p class="text-xs text-slate-400">Load your USD cash balance and holdings from Freedom TradeNet.</p>
              )}
              {freedomSnapshot && (
                <>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div class="rounded border border-slate-800 bg-slate-900/70 p-3">
                      <p class="text-[10px] uppercase tracking-wide text-slate-400">USD cash balance</p>
                      <p class="mt-1 font-mono text-lg font-bold text-white">{usd(freedomSnapshot.balances.reduce((sum, balance) => sum + balance.amount, 0))}</p>
                    </div>
                    <div class="rounded border border-slate-800 bg-slate-900/70 p-3">
                      <p class="text-[10px] uppercase tracking-wide text-slate-400">Open positions</p>
                      <p class="mt-1 font-mono text-lg font-bold text-white">{freedomSnapshot.positions.length}</p>
                    </div>
                    <div class="rounded border border-slate-800 bg-slate-900/70 p-3">
                      <p class="text-[10px] uppercase tracking-wide text-slate-400">Reported market value</p>
                      <p class="mt-1 font-mono text-lg font-bold text-white">{usd(freedomSnapshot.positions.reduce((sum, position) => sum + (position.marketValue ?? 0), 0))}</p>
                    </div>
                  </div>
                  <div class="overflow-x-auto">
                    <table class="w-full min-w-[560px] text-xs">
                      <caption class="sr-only">Freedom TradeNet USD open positions</caption>
                      <thead><tr class="border-b border-slate-800 text-slate-400">
                        <th scope="col" class="px-2 py-2 text-left">Instrument</th>
                        <th scope="col" class="px-2 py-2 text-left">App type</th>
                        <th scope="col" class="px-2 py-2 text-right">Qty</th>
                        <th scope="col" class="px-2 py-2 text-right">Avg. price</th>
                        <th scope="col" class="px-2 py-2 text-right">Market price</th>
                        <th scope="col" class="px-2 py-2 text-right">Market value</th>
                        <th scope="col" class="px-2 py-2 text-right">Close P/L</th>
                      </tr></thead>
                      <tbody class="divide-y divide-slate-800/70">
                        {freedomSnapshot.positions.map((position) => (
                          <tr key={position.ticker} class="text-slate-200">
                            <th scope="row" class="px-2 py-2 text-left">
                              <div class="font-semibold">{position.ticker}</div>
                              <div class="text-[10px] font-normal text-slate-400">{position.name}</div>
                            </th>
                            <td class="px-2 py-2 text-left text-[10px]">{(position as any).appClassification === 'Cash' ? <span class="text-cyan-300">Cash</span> : (position as any).appClassification === 'Margin' ? <span class="text-amber-300">Margin</span> : <span class="text-slate-400">Unclassified</span>}</td>
                            <td class="px-2 py-2 text-right font-mono">{position.quantity.toLocaleString('en-US')}</td>
                            <td class="px-2 py-2 text-right font-mono">{usd(position.averagePrice)}</td>
                            <td class="px-2 py-2 text-right font-mono">{usd(position.marketPrice)}</td>
                            <td class="px-2 py-2 text-right font-mono">{usd(position.marketValue)}</td>
                            <td class={`px-2 py-2 text-right font-mono ${(position.profitClose ?? 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{usd(position.profitClose)}</td>
                          </tr>
                        ))}
                        {freedomSnapshot.positions.length === 0 && <tr><td colSpan={7} class="px-2 py-4 text-center text-slate-400">No USD open positions returned.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <p class="text-[10px] text-slate-500">Cash/Margin classification comes from your app's existing holdings and cash-stock lists, not TradeNet. Unmatched broker symbols are left Unclassified. Values are broker-reported; no FX conversion is applied.</p>
                </>
              )}
            </section>

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