import { useState, useEffect } from 'preact/hooks';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatQuoteMetadata } from '../utils/formatters';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';
import { QuoteDetails, ActiveTrancheType } from '../types/portfolio';
import { getActiveTranchesFromTrades, FreedomExecutedTradeLike } from '../domain/freedomPortfolio';

export interface CashCushionDeskProps {
  refreshIntervalMs?: number;
}

const BADGE_STYLES: Record<string, string> = {
  bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
  neutral: 'border-slate-700 bg-slate-900 text-slate-300',
  unknown: 'border-slate-800 bg-slate-950 text-slate-500'
};

export function formatDailyQuoteRange(details: Pick<QuoteDetails, 'high' | 'low'>): string {
  return `H ${formatUSD(details.high)} / L ${formatUSD(details.low)}`;
}

function renderDailyQuoteSubtext(details?: QuoteDetails | null) {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const parts: string[] = [];
  let colorClass = 'text-slate-400';

  if (hasChange && details.change !== undefined && details.changePercent !== undefined) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(
      `${sign}${formatUSD(Math.abs(details.change))}`
    );
    colorClass =
      details.change > 0
        ? 'text-emerald-400'
        : details.change < 0
          ? 'text-rose-400'
          : 'text-slate-400';
  }

  if (hasRange) {
    parts.push(formatDailyQuoteRange(details));
  }

  return (
    <span class={`mt-0.5 block text-[9px] font-normal tabular-nums ${colorClass}`}>
      Day: {parts.join(' · ')}
    </span>
  );
}

export function CashCushionDesk({
  refreshIntervalMs = 60000
}: CashCushionDeskProps) {
  const state = usePortfolio();
  const [executedTrades, setExecutedTrades] = useState<FreedomExecutedTradeLike[]>(() =>
    typeof window !== 'undefined' && Array.isArray((window as any).__tradenetExecutedTrades)
      ? (window as any).__tradenetExecutedTrades
      : Array.isArray(state.brokerExecutedTrades) ? state.brokerExecutedTrades as FreedomExecutedTradeLike[] : []
  );

  useEffect(() => {
    const onTrades = (event: Event) => {
      const trades = (event as CustomEvent<FreedomExecutedTradeLike[]>).detail;
      if (Array.isArray(trades)) setExecutedTrades(trades);
    };
    const onTradesError = () => setExecutedTrades([]);
    window.addEventListener('tradenet:executed-trades', onTrades);
    window.addEventListener('tradenet:executed-trades-error', onTradesError);
    window.dispatchEvent(new CustomEvent('tradenet:request-executed-trades'));
    return () => {
      window.removeEventListener('tradenet:executed-trades', onTrades);
      window.removeEventListener('tradenet:executed-trades-error', onTradesError);
    };
  }, []);

  const freeCash = Number(state.cashCushion?.freeCash) || 0;
  const holdings = state.cashCushion?.holdings || [];
  const activeTranches = getActiveTranchesFromTrades(executedTrades, state.brokerAccountInfo);
  const setActiveTrancheType = (ticker: string, type: ActiveTrancheType) => {
    window.dispatchEvent(new CustomEvent('tradenet:set-active-tranche-type', { detail: { ticker, type } }));
  };

  const [activeTranchesExpanded, setActiveTranchesExpanded] = useState(false);

  const stocksTotal = holdings.reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + (Number(h.shares) || 0) * price;
  }, 0);

  const totalCushion = freeCash + stocksTotal;


  return (
    <>
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <h2 class="text-lg font-black text-cyan-400 tracking-wide">
            CASH &amp; NON-MARGIN HOLDINGS
          </h2>
        </div>
        <div class="text-right">
          <span class="text-xs text-slate-500 block">Cash + Holdings</span>
          <span class="text-xl font-bold text-cyan-300 font-mono" id="cushionTotalValue">
            {formatUSD(totalCushion)}
          </span>
        </div>
      </div>

      <div class="space-y-2">
        <div class="table-scroll-wrapper overflow-x-auto">
          <table class="w-full min-w-0 table-fixed text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 font-medium">
                <th class="w-[15%] py-2 px-2">Ticker</th>
                <th class="w-[15%] py-2 px-2 text-right">Shares</th>
                <th class="w-[20%] py-2 px-2 text-right">Price · Mkt</th>
                <th class="w-[15%] py-2 px-2 text-right">Mkt Value</th>
                <th class="w-[15%] py-2 px-2 text-right">Eq. Alloc</th>
              </tr>
            </thead>
            <tbody id="cashStocksTableBody" class="divide-y divide-slate-800/60 font-mono">
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={5} class="py-3 text-center text-slate-500 italic">
                    No broker-reported cash holdings available.
                  </td>
                </tr>
              ) : (
                holdings.map((h) => {
                  const shares = Number(h.shares) || 0;
                  const price = Number(h.currentPrice ?? h.price) || 0;
                  const val = shares * price;
                  const allocation = stocksTotal > 0 ? (val / stocksTotal) * 100 : 0;
                  const quoteMeta = formatQuoteMetadata(h, refreshIntervalMs);

                  const hasChange = Number.isFinite(h.quoteDetails?.change);
                  const direction: SentimentDirection = hasChange
                    ? h.quoteDetails!.change! > 0
                      ? 'bullish'
                      : h.quoteDetails!.change! < 0
                        ? 'bearish'
                        : 'neutral'
                    : 'unknown';
                  const badgeText =
                    hasChange && h.quoteDetails?.changePercent !== undefined
                      ? `${h.quoteDetails.changePercent.toFixed(2)}%`
                      : sentimentLabel(direction);

                  return (
                    <tr key={h.ticker} class="hover:bg-slate-900/40">
                      <td class="py-2 px-3 text-cyan-300 font-bold">
                        <div class="inline-flex items-center gap-1.5">
                          <span>{h.ticker}</span>
                          <span
                            data-sentiment={direction}
                            title={
                              direction === 'unknown'
                                ? 'The selected data source did not provide a sentiment signal.'
                                : 'A directional marker based only on the provider values shown in this section.'
                            }
                            class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${BADGE_STYLES[direction] || BADGE_STYLES.unknown
                              }`}
                          >
                            {badgeText}
                          </span>
                        </div>
                      </td>
                      <td class="py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap">
                        {shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                      </td>
                      <td class="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums">
                        <span>{formatUSD(price)}</span>
                        {renderDailyQuoteSubtext(h.quoteDetails)}
                        <span class="mt-0.5 block text-[9px] font-normal text-slate-500">
                          {quoteMeta}
                        </span>
                      </td>
                      <td class="py-2 px-3 text-right text-white font-semibold">
                        {formatUSD(val)}
                      </td>
                      <td class="py-2 px-3 text-right text-slate-300 tabular-nums">
                        {allocation.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot id="cashStocksTableFooter" class="border-t border-slate-700 font-mono">
              {holdings.length > 0 && (
                <tr>
                  <td class="py-2 px-3 text-slate-300 font-bold" colSpan={3}>
                    {holdings.length} holding{holdings.length === 1 ? '' : 's'}
                  </td>
                  <td class="py-2 px-3 text-right text-white font-bold">
                    {formatUSD(stocksTotal)}
                  </td>
                  <td class="py-2 px-3 text-right text-slate-300 font-bold">
                    {stocksTotal > 0 ? '100.0%' : '—'}
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        <section class="rounded-lg border border-slate-800 bg-slate-950/40 p-3 space-y-2" id="activeTranches" aria-labelledby="activeTranchesHeading">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div>
              <h2 id="activeTranchesHeading" class="text-sm font-black uppercase tracking-wide text-cyan-300">Active Tranches ({activeTranches.length})</h2>
              <p class="mt-0.5 text-[10px] text-slate-500">Open purchases from Freedom trade history · new operations default to Cash</p>
            </div>
            <div class="flex items-center gap-2">
              <span class={`text-[10px] font-bold uppercase tracking-wide ${state.brokerAccountInfo?.status === 'stale' ? 'text-amber-400' : state.brokerAccountInfo?.loaded ? 'text-emerald-400' : 'text-slate-500'}`}>
                {state.brokerAccountInfo?.status === 'stale' ? 'Broker data stale' : executedTrades.length ? 'Trades synced' : 'Waiting for trade history'}
              </span>
              <button type="button" aria-expanded={activeTranchesExpanded} aria-controls="activeTranchesTable" onClick={() => setActiveTranchesExpanded((expanded) => !expanded)} class="rounded border border-slate-700 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-slate-900">
                {activeTranchesExpanded ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>
          <div
            id="activeTranchesPanel"
            class={`expandable-motion ${activeTranchesExpanded ? 'is-expanded' : ''}`}
            aria-hidden={!activeTranchesExpanded}
          >
            <div class="expandable-motion__inner">
              <div class="table-scroll-wrapper overflow-x-auto">
            <table id="activeTranchesTable" class="w-full min-w-[500px] text-left text-xs border-collapse">
              <thead>
                <tr class="border-b border-slate-800 text-slate-500">
                  <th class="py-2 px-2">Ticker</th>
                  <th class="py-2 px-2">Purchase date</th>
                  <th class="py-2 px-2 text-right">Shares</th>
                  <th class="py-2 px-2 text-right">Avg. Cost</th>
                  <th class="py-2 px-2 text-right">Value</th>
                  <th class="py-2 px-2 text-center">Operation</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60 font-mono">
                {activeTranches.length === 0 ? (
                  <tr><td colSpan={6} class="py-4 px-2 text-center font-sans text-slate-500 italic">
                    {executedTrades.length ? 'No active purchase operations.' : 'Active purchase operations will appear after Freedom trade history loads.'}
                  </td></tr>
                ) : activeTranches.map((tranche) => {
                  const type = state.activeTrancheTypes?.[tranche.id] || state.activeTrancheTypes?.[tranche.ticker] || 'cash';
                  return (
                    <tr key={tranche.id} class="hover:bg-slate-900/50">
                      <td class="py-2 px-2 font-bold text-cyan-300">{tranche.ticker}</td>
                      <td class="py-2 px-2 text-slate-400 tabular-nums">{tranche.purchasedAt !== null ? new Date(tranche.purchasedAt).toLocaleString() : '—'}</td>
                      <td class="py-2 px-2 text-right text-slate-200 tabular-nums">{tranche.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                      <td class="py-2 px-2 text-right text-slate-300 tabular-nums">{tranche.averagePrice !== null ? formatUSD(tranche.averagePrice) : '—'}</td>
                      <td class="py-2 px-2 text-right text-slate-200 tabular-nums">{tranche.marketValue !== null ? formatUSD(tranche.marketValue) : '—'}</td>
                      <td class="py-2 px-2 text-center">
                        <div class="inline-flex rounded-md border border-slate-700 p-0.5" role="group" aria-label={`${tranche.ticker} ${tranche.purchasedAt !== null ? new Date(tranche.purchasedAt).toLocaleString() : 'undated'} operation type`}>
                          <button type="button" aria-pressed={type === 'cash'} onClick={() => setActiveTrancheType(tranche.id, 'cash')}
                            class={`rounded px-2 py-1 text-[10px] font-bold transition ${type === 'cash' ? 'bg-cyan-950 text-cyan-300' : 'text-slate-500 hover:text-slate-300'}`}>Cash</button>
                          <button type="button" aria-pressed={type === 'margin'} onClick={() => setActiveTrancheType(tranche.id, 'margin')}
                            class={`rounded px-2 py-1 text-[10px] font-bold transition ${type === 'margin' ? 'bg-amber-950 text-amber-300' : 'text-slate-500 hover:text-slate-300'}`}>Margin</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {activeTranches.length > 0 && <tfoot class="border-t border-slate-700"><tr>
                <td colSpan={6} class="px-2 py-2 text-[10px] text-slate-500">{activeTranches.length} active purchase operation{activeTranches.length === 1 ? '' : 's'} · same-ticker purchases within 5 minutes are grouped</td>
              </tr></tfoot>}
            </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}