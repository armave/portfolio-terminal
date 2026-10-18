import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchMarketNews, fetchYahooDeepStockData } from '../services/api';

export type InsightSection = 'news' | 'fundamentals' | 'earnings' | 'analysts';

export interface MarketInsightsPanelProps {
  ticker: string;
  isOpen: boolean;
  activeSection: InsightSection;
  refreshTrigger?: number;
  onSelectSection: (section: InsightSection) => void;
  onClose: () => void;
}

const INSIGHT_TABS: Array<{ id: InsightSection; domId: string; label: string }> = [
  { id: 'news', domId: 'insightTabNews', label: 'News' },
  { id: 'fundamentals', domId: 'insightTabFundamentals', label: 'Fundamentals' },
  { id: 'earnings', domId: 'insightTabEarnings', label: 'Earnings' },
  { id: 'analysts', domId: 'insightTabAnalysts', label: 'Analysts' }
];

export function MarketInsightsPanel({
  ticker,
  isOpen,
  activeSection,
  refreshTrigger = 0,
  onSelectSection,
  onClose
}: MarketInsightsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newsData, setNewsData] = useState<any[]>([]);
  const [stockData, setStockData] = useState<any>(null);
  const requestIdRef = useRef(0);
  const lastRefreshTriggerRef = useRef(refreshTrigger);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!isOpen || !ticker) return;

    const currentRequestId = ++requestIdRef.current;
    const forceRefresh = refreshTrigger !== lastRefreshTriggerRef.current;
    lastRefreshTriggerRef.current = refreshTrigger;
    setLoading(true);
    setError(null);

    const fetchInsight = async () => {
      try {
        if (activeSection === 'news') {
          const news = await fetchMarketNews(ticker, forceRefresh);
          if (currentRequestId !== requestIdRef.current) return;
          setNewsData(Array.isArray(news) ? news : []);
        } else {
          const data = await fetchYahooDeepStockData(ticker, forceRefresh);
          if (currentRequestId !== requestIdRef.current) return;
          setStockData(data || {});
        }
      } catch (err: any) {
        if (currentRequestId !== requestIdRef.current) return;
        setError(err?.message || 'Unknown error');
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    fetchInsight();
  }, [ticker, isOpen, activeSection, refreshTrigger]);

  const handleTabKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = INSIGHT_TABS.findIndex((t) => t.id === activeSection);
    if (currentIndex < 0) return;

    event.preventDefault();
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? INSIGHT_TABS.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : INSIGHT_TABS.length - 1)) %
          INSIGHT_TABS.length;

    const nextTab = INSIGHT_TABS[nextIndex];
    tabRefs.current[nextTab.id]?.focus();
    onSelectSection(nextTab.id);
  };

  const renderContent = () => {
    if (!ticker) {
      return (
        <div class="py-4 text-center text-xs text-slate-500">
          Select a margin position to load its market insights.
        </div>
      );
    }

    if (loading) {
      return (
        <div class="py-4 text-center text-xs text-slate-500 font-mono animate-pulse">
          Loading live data...
        </div>
      );
    }

    if (error) {
      return (
        <div class="py-3 text-rose-400 text-xs">Failed to load insights: {error}</div>
      );
    }

    if (activeSection === 'news') {
      if (!newsData || newsData.length === 0) {
        return <div class="py-3 text-slate-500 text-xs">No recent news found.</div>;
      }
      return (
        <div class="space-y-2 mt-2">
          {newsData.slice(0, 5).map((n: any, idx: number) => (
            <a
              key={n.id || n.url || idx}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              class="block bg-slate-900/60 p-2.5 rounded border border-slate-800 hover:border-cyan-800 transition"
            >
              <div class="text-[10px] text-cyan-400 mb-1">
                {new Date(n.datetime * 1000).toLocaleDateString()} · {n.source || 'News'}
              </div>
              <div class="text-slate-200 text-xs font-semibold leading-snug">
                {n.headline}
              </div>
            </a>
          ))}
        </div>
      );
    }

    const data = stockData || {};

    if (activeSection === 'fundamentals') {
      const val = data.valuation || {};
      const fh = data.financialHealth || {};

      return (
        <div class="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Trailing P/E</span>
              <span class="text-white font-bold">
                {val.peTrailing ? Number(val.peTrailing).toFixed(2) : '—'}
              </span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Forward P/E</span>
              <span class="text-white font-bold">
                {val.peForward ? Number(val.peForward).toFixed(2) : '—'}
              </span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">PEG Ratio</span>
              <span class="text-white font-bold">{val.pegRatio ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Short % Float</span>
              <span class="text-amber-400 font-bold">{val.shortPercentOfFloat ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Profit Margin</span>
              <span class="text-white font-bold">{fh.profitMargin ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">ROE</span>
              <span class="text-white font-bold">{fh.returnOnEquity ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Price to Book</span>
              <span class="text-white font-bold">{val.priceToBook ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Total Debt</span>
              <span class="text-rose-400 font-bold">
                {fh.totalDebt ? '$' + (fh.totalDebt / 1e9).toFixed(2) + 'B' : '—'}
              </span>
            </div>
          </div>
        </div>
      );
    }

    if (activeSection === 'analysts') {
      const t = data.analystTargets || {};
      const upDown = data.upgradesDowngrades || [];

      return (
        <div class="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-slate-800/60 pb-3">
            <div>
              <span class="text-slate-500 block text-[10px]">Mean Target</span>
              <span class="text-emerald-400 font-bold">
                ${t.mean ? Number(t.mean).toFixed(2) : '—'}
              </span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px]">High Target</span>
              <span class="text-emerald-400 font-bold">
                ${t.high ? Number(t.high).toFixed(2) : '—'}
              </span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px]">Low Target</span>
              <span class="text-rose-400 font-bold">
                ${t.low ? Number(t.low).toFixed(2) : '—'}
              </span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px]">Consensus</span>
              <span class="text-cyan-300 font-bold uppercase">
                {t.consensusRecommendation || '—'}
              </span>
            </div>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 uppercase block mb-2">
              Recent Firm Actions
            </span>
            {upDown.length > 0 ? (
              upDown.slice(0, 4).map((u: any, idx: number) => (
                <div
                  key={idx}
                  class="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0"
                >
                  <span class="text-slate-300">{u.firm}</span>
                  <span
                    class={`text-[10px] font-bold ${u.action === 'up'
                      ? 'text-emerald-400'
                      : u.action === 'down'
                        ? 'text-rose-400'
                        : 'text-cyan-400'
                      }`}
                  >
                    {(u.action || '').toUpperCase()}: {u.fromGrade || ''} ➝ {u.toGrade || ''}
                  </span>
                </div>
              ))
            ) : (
              <div class="text-slate-500">No recent actions</div>
            )}
          </div>
        </div>
      );
    }

    if (activeSection === 'earnings') {
      const cal = data.calendar || {};
      const eh = data.earningsHistory || [];

      return (
        <div class="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div class="bg-slate-900/70 p-2.5 rounded border border-slate-800/80 mb-3">
            <span class="text-[10px] text-slate-500 uppercase block">Next Earnings Date</span>
            <span class="text-purple-300 font-bold text-sm">{cal.earningsDate || 'TBD'}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 uppercase block mb-2">
              Past Earnings Surprises
            </span>
            {eh.length > 0 ? (
              eh.map((e: any, idx: number) => (
                <div
                  key={idx}
                  class="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0"
                >
                  <span class="text-slate-300 font-bold">{e.quarter}</span>
                  <span class="text-[10px]">
                    Est: {e.epsEstimate} | Act:{' '}
                    <span
                      class={`${e.epsDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        } font-bold`}
                    >
                      {e.epsActual}
                    </span>{' '}
                    ({e.surprisePercent})
                  </span>
                </div>
              ))
            ) : (
              <div class="text-slate-500">No recent earnings history</div>
            )}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-sm font-black uppercase tracking-wider text-slate-100">
              Market insights{' '}
              <span id="marketInsightsTicker" class="text-cyan-300">
                {ticker ? `· ${ticker}` : ''}
              </span>
            </h2>
            <span
              id="marketInsightsStatus"
              class="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] font-semibold text-slate-400"
              role="status"
            >
              {loading ? 'Loading' : 'Ready'}
            </span>
          </div>
          <p class="mt-1 text-[10px] text-slate-500">
            Company news, fundamentals, earnings, and analyst consensus. Finnhub and Alpha Vantage
            are tried as available.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-expanded={isOpen}
          aria-controls="marketInsightsPanel"
          class="rounded border border-cyan-800/70 bg-cyan-950/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-900/50"
        >
          Close
        </button>
      </div>

      <div
        id="marketInsightsTabs"
        onKeyDown={handleTabKeyDown}
        class="flex gap-1.5 overflow-x-auto border-b border-slate-800 pb-2"
        role="tablist"
        aria-label="Market insight categories"
      >
        {INSIGHT_TABS.map((tab) => {
          const selected = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              id={tab.domId}
              data-insight={tab.id}
              onClick={() => onSelectSection(tab.id)}
              onKeyDown={handleTabKeyDown}
              role="tab"
              aria-controls="marketInsightsContent"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              class={`insight-tab whitespace-nowrap rounded px-3 py-1.5 text-[10px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${selected
                ? 'bg-cyan-400 text-slate-950 shadow-sm shadow-cyan-950'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id="marketInsightsContent"
        class="min-h-24 rounded-lg border border-slate-800/80 bg-slate-950/70 p-3 text-xs text-slate-300"
        role="tabpanel"
        aria-labelledby={
          INSIGHT_TABS.find((t) => t.id === activeSection)?.domId || 'insightTabNews'
        }
        aria-live="polite"
        aria-busy={loading}
      >
        {renderContent()}
      </div>
    </>
  );
}