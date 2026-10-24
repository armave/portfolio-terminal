import { useEffect, useState } from 'preact/hooks';
import { loadSavedState } from './services/storage';
import { fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, normalizeFreedomPortfolio, normalizeFreedomTrades, type FreedomPortfolioSnapshot } from './services/api';

interface AppProps {
  onToggleMarketInsights: () => void;
}

export function App({ }: AppProps) {
  const [freedomSnapshot, setFreedomSnapshot] = useState<FreedomPortfolioSnapshot | null>(null);
  const [freedomLoading, setFreedomLoading] = useState(false);
  const [freedomError, setFreedomError] = useState('');
  const [tradesDebugLoading, setTradesDebugLoading] = useState(false);
  // App-owned portfolio state is the authority for cash-vs-margin classification.
  const [appPortfolioState, setAppPortfolioState] = useState(loadSavedState({ holdings: [], cashStocks: [] }));

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

  useEffect(() => {
    const onRequest = () => { void loadExecutedTrades(); };
    window.addEventListener('tradenet:request-executed-trades', onRequest);
    return () => window.removeEventListener('tradenet:request-executed-trades', onRequest);
  }, []);

  const loadExecutedTrades = async () => {
    setTradesDebugLoading(true);
    try {
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
              aria-label="Freedom TradeNet USD portfolio"
              class="rounded-lg border border-emerald-900/60 bg-slate-950/70 p-4 space-y-3"
            >
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-sm font-bold text-emerald-300">Freedom TradeNet · USD account</h2>
                  <p class="text-[11px] text-slate-400">Read-only USD broker snapshot. Compare broker quantities and market prices against app-owned positions; differences are diagnostic and never overwrite app data.</p>
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
                        <th scope="col" class="px-2 py-2 text-right">Broker qty</th>
                        <th scope="col" class="px-2 py-2 text-right">App qty</th>
                        <th scope="col" class="px-2 py-2 text-right">Qty diff</th>
                        <th scope="col" class="px-2 py-2 text-right">Avg. price</th>
                        <th scope="col" class="px-2 py-2 text-right">App price</th>
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
                            {(() => {
                              const appPosition = Object.entries((appPortfolioState as any)?.positions ?? {}).find(([key, value]: [string, any]) => key.trim().toUpperCase() === position.ticker.trim().toUpperCase() || String(value?.ticker ?? '').trim().toUpperCase() === position.ticker.trim().toUpperCase())?.[1] as any;
                              const rawAppQty = appPosition?.shares;
                              const appQty = rawAppQty === undefined || rawAppQty === null || rawAppQty === '' || !Number.isFinite(Number(rawAppQty)) ? null : Number(rawAppQty);
                              const difference = appQty === null ? null : position.quantity - appQty;
                              return <>
                                <td class="px-2 py-2 text-right font-mono">{position.quantity.toLocaleString('en-US')}</td>
                                <td class="px-2 py-2 text-right font-mono">{appQty === null ? '—' : appQty.toLocaleString('en-US')}</td>
                                <td class={'px-2 py-2 text-right font-mono ' + (difference === null ? 'text-slate-500' : Math.abs(difference) < 1e-6 ? 'text-emerald-300' : 'text-amber-300')}>{difference === null ? '—' : difference.toLocaleString('en-US')}</td>
                              </>;
                            })()}
                            <td class="px-2 py-2 text-right font-mono">{usd(position.averagePrice)}</td>
                            <td class="px-2 py-2 text-right font-mono">{(() => {
                              const appPosition = Object.entries((appPortfolioState as any)?.positions ?? {}).find(([key, value]: [string, any]) => key.trim().toUpperCase() === position.ticker.trim().toUpperCase() || String(value?.ticker ?? '').trim().toUpperCase() === position.ticker.trim().toUpperCase())?.[1] as any;
                              const price = Number(appPosition?.currentPrice);
                              return appPosition && Number.isFinite(price) && price > 0 ? usd(price) : '—';
                            })()}</td>
                            <td class="px-2 py-2 text-right font-mono">{usd(position.marketPrice)}</td>
                            <td class="px-2 py-2 text-right font-mono">{usd(position.marketValue)}</td>
                            <td class={`px-2 py-2 text-right font-mono ${(position.profitClose ?? 0) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{usd(position.profitClose)}</td>
                          </tr>
                        ))}
                        {freedomSnapshot.positions.length === 0 && <tr><td colSpan={9} class="px-2 py-4 text-center text-slate-400">No USD open positions returned.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  {(() => {
                    const brokerTickers = new Set(freedomSnapshot.positions.map((position) => position.ticker.trim().toUpperCase()));
                    const appPositions = Object.entries((appPortfolioState as any)?.positions ?? {})
                      .map(([key, value]: [string, any]) => ({ ticker: String(value?.ticker ?? key).trim().toUpperCase(), shares: Number(value?.shares), value }))
                      .filter((position) => position.ticker && Number.isFinite(position.shares) && Math.abs(position.shares) > 1e-8 && !brokerTickers.has(position.ticker));
                    const appHoldings = Array.isArray((appPortfolioState as any)?.holdings) ? (appPortfolioState as any).holdings : [];
                    const cashTickers = new Set([
                      ...appHoldings.filter((holding: any) => holding?.isMargin === false).map((holding: any) => String(holding.ticker ?? '').trim().toUpperCase()),
                      ...(Array.isArray((appPortfolioState as any)?.cashStocks) ? (appPortfolioState as any).cashStocks.map((holding: any) => String(holding?.ticker ?? '').trim().toUpperCase()) : [])
                    ]);
                    const marginTickers = new Set(appHoldings.filter((holding: any) => holding?.isMargin === true).map((holding: any) => String(holding.ticker ?? '').trim().toUpperCase()));
                    return <div class="rounded border border-slate-800 bg-slate-900/40 p-3 space-y-2">
                      <div class="flex items-center justify-between gap-2">
                        <h3 class="text-xs font-semibold text-slate-300">App positions not returned by TradeNet</h3>
                        <span class="rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">{appPositions.length}</span>
                      </div>
                      {appPositions.length === 0
                        ? <p class="text-[11px] text-slate-500">All nonzero app positions have a matching ticker in the broker snapshot.</p>
                        : <div class="overflow-x-auto"><table class="w-full text-xs text-left">
                          <thead class="text-[10px] uppercase text-slate-500"><tr><th class="px-2 py-1">Ticker</th><th class="px-2 py-1">App type</th><th class="px-2 py-1 text-right">App qty</th><th class="px-2 py-1">Status</th></tr></thead>
                          <tbody>{appPositions.map((position) => <tr key={position.ticker} class="border-t border-slate-800">
                            <td class="px-2 py-2 font-semibold text-slate-200">{position.ticker}</td>
                            <td class="px-2 py-2">{cashTickers.has(position.ticker) ? 'Cash' : marginTickers.has(position.ticker) ? 'Margin' : 'Unclassified'}</td>
                            <td class="px-2 py-2 text-right font-mono">{position.shares.toLocaleString('en-US')}</td>
                            <td class="px-2 py-2 text-amber-300">Not returned by broker</td>
                          </tr>)}</tbody>
                        </table></div>}
                    </div>;
                  })()}
                  <p class="text-[10px] text-slate-500">Cash/Margin classification comes from your app's existing holdings and cash-stock lists, not TradeNet. Broker qty minus app qty is shown as Qty diff; a dash means no app position could be matched. Differences are diagnostic only and never overwrite app holdings. Values are broker-reported; no FX conversion is applied.</p>
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