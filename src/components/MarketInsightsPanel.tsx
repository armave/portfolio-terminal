import { formatRelativeTime } from '../utils/relativeTime';
import { decodeHtmlEntities } from '../utils/formatters';
import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchMarketNews, fetchStocktwitsStream, fetchYahooDeepStockData, type StocktwitsStream } from '../services/api';

export type InsightSection = 'news' | 'fundamentals' | 'earnings' | 'analysts';

export interface MarketInsightsPanelProps {
  ticker: string;
  isOpen: boolean;
  activeSection: InsightSection;
  refreshTrigger?: number;
  onSelectSection: (section: InsightSection) => void;
}

const INSIGHT_TABS: Array<{ id: InsightSection; domId: string; label: string }> = [
  { id: 'news', domId: 'insightTabNews', label: 'News' },
  { id: 'fundamentals', domId: 'insightTabFundamentals', label: 'Fundamentals' },
  { id: 'earnings', domId: 'insightTabEarnings', label: 'Earnings' },
  { id: 'analysts', domId: 'insightTabAnalysts', label: 'Analysts' }
];

const STOCKTWITS_CASHTAG_PATTERN = /\$([A-Z][A-Z0-9.-]{0,9})\b/gi;

export function isStandaloneStocktwitsMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const value = message as {
    conversation?: { parent_message_id?: number | string | null } | null;
    in_reply_to?: unknown;
    reply_to?: unknown;
  };
  return value.conversation?.parent_message_id == null &&
    value.in_reply_to == null &&
    value.reply_to == null;
}

export function getStocktwitsCashtags(body: unknown): string[] {
  if (typeof body !== 'string') return [];
  return Array.from(new Set(
    Array.from(body.matchAll(STOCKTWITS_CASHTAG_PATTERN), (match) => match[1].toUpperCase())
  ));
}

export function hasStocktwitsCommentary(body: unknown): boolean {
  if (typeof body !== 'string') return false;
  return body
    .replace(STOCKTWITS_CASHTAG_PATTERN, '')
    .replace(/[\s.,!?;:\(\)\[\]{}|\/\\-]+/g, '')
    .length > 0;
}

export function getVisibleStocktwitsMessages<T>(messages: T[], limit = 10): T[] {
  return messages
    .filter(isStandaloneStocktwitsMessage)
    .slice(0, Math.max(0, Math.floor(limit)));
}

function renderStocktwitsBody(body: string) {
  const parts = body.split(/(\$[A-Z][A-Z0-9.-]{0,9}\b)/gi);
  return parts.map((part, index) =>
    /^\$[A-Z][A-Z0-9.-]{0,9}\b$/i.test(part)
      ? <span key={index} class="inline-block rounded bg-cyan-950/80 px-1 font-bold text-cyan-300 ring-1 ring-inset ring-cyan-700/60">{part}</span>
      : part
  );
}

export function MarketInsightsPanel({
  ticker,
  isOpen,
  activeSection,
  refreshTrigger = 0,
  onSelectSection
}: MarketInsightsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newsData, setNewsData] = useState<any[]>([]);
  const [selectedNews, setSelectedNews] = useState<any | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<number | null>(null);
  const [newsRefreshRequest, setNewsRefreshRequest] = useState(0);

  useEffect(() => {
    if (!selectedNews) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedNews(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNews]);
  const [stockData, setStockData] = useState<any>(null);
  const [stocktwitsData, setStocktwitsData] = useState<StocktwitsStream | null>(null);
  const [stocktwitsRequested, setStocktwitsRequested] = useState(false);
  const [stocktwitsLoading, setStocktwitsLoading] = useState(false);
  const [stocktwitsError, setStocktwitsError] = useState<string | null>(null);
  const [stocktwitsUpdatedAt, setStocktwitsUpdatedAt] = useState<number | null>(null);
  const [stocktwitsRefreshRequest, setStocktwitsRefreshRequest] = useState(0);
  const stocktwitsRequestIdRef = useRef(0);
  const newsRequestIdRef = useRef(0);
  const requestIdRef = useRef(0);
  const lastRefreshTriggerRef = useRef(refreshTrigger);
  const lastNewsRefreshTriggerRef = useRef(refreshTrigger);
  const lastStocktwitsRefreshTriggerRef = useRef(refreshTrigger);
  const lastNewsManualRefreshRef = useRef(0);
  const lastStocktwitsManualRefreshRef = useRef(0);
  const newsTickerRef = useRef(ticker);
  const stocktwitsTickerRef = useRef(ticker);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Keep the detailed fundamentals/earnings/analyst request separate from news.
  // Background refreshes must not replace the current panel with a loading screen.
  useEffect(() => {
    if (!isOpen || !ticker) return;
    if (activeSection === 'news') {
      setLoading(false);
      setError(null);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const forceRefresh = refreshTrigger !== lastRefreshTriggerRef.current;
    lastRefreshTriggerRef.current = refreshTrigger;
    setLoading(true);
    setError(null);

    fetchYahooDeepStockData(ticker, forceRefresh)
      .then((data) => {
        if (currentRequestId !== requestIdRef.current) return;
        setStockData(data || {});
      })
      .catch((err: any) => {
        if (currentRequestId !== requestIdRef.current) return;
        setError(err?.message || 'Unknown error');
      })
      .finally(() => {
        if (currentRequestId === requestIdRef.current) setLoading(false);
      });

    return () => {
      requestIdRef.current += 1;
    };
  }, [ticker, isOpen, activeSection, refreshTrigger]);

  // Company news loads on open and refreshes only when requested.
  useEffect(() => {
    if (!isOpen || !ticker) return;

    const forceOnStart = refreshTrigger !== lastNewsRefreshTriggerRef.current || newsRefreshRequest !== lastNewsManualRefreshRef.current;
    lastNewsRefreshTriggerRef.current = refreshTrigger;
    lastNewsManualRefreshRef.current = newsRefreshRequest;
    if (newsTickerRef.current !== ticker) {
      newsTickerRef.current = ticker;
      setNewsData([]);
      setNewsUpdatedAt(null);
      setNewsError(null);
    }
    let disposed = false;

    const refreshNews = async (force: boolean) => {
      const currentRequestId = ++newsRequestIdRef.current;
      setNewsLoading(true);
      try {
        const news = await fetchMarketNews(ticker, force);
        if (disposed || currentRequestId !== newsRequestIdRef.current) return;
        setNewsData(Array.isArray(news) ? news : []);
        setNewsUpdatedAt(Date.now());
        setNewsError(null);
      } catch (err: any) {
        if (disposed || currentRequestId !== newsRequestIdRef.current) return;
        setNewsError(err?.message || 'Unable to load company news.');
      } finally {
        if (!disposed && currentRequestId === newsRequestIdRef.current) setNewsLoading(false);
      }
    };

    void refreshNews(forceOnStart);
    return () => {
      disposed = true;
      newsRequestIdRef.current += 1;
    };
  }, [ticker, isOpen, refreshTrigger, newsRefreshRequest]);

  // Stocktwits is an optional secondary feed; defer its request until the user asks for it.
  useEffect(() => {
    if (!isOpen || !ticker || !stocktwitsRequested) return;

    const forceOnStart = refreshTrigger !== lastStocktwitsRefreshTriggerRef.current || stocktwitsRefreshRequest !== lastStocktwitsManualRefreshRef.current;
    lastStocktwitsRefreshTriggerRef.current = refreshTrigger;
    lastStocktwitsManualRefreshRef.current = stocktwitsRefreshRequest;
    if (stocktwitsTickerRef.current !== ticker) {
      stocktwitsTickerRef.current = ticker;
      setStocktwitsData(null);
      setStocktwitsUpdatedAt(null);
      setStocktwitsError(null);
    }
    let disposed = false;

    const refreshStocktwits = async (force: boolean) => {
      const currentRequestId = ++stocktwitsRequestIdRef.current;
      setStocktwitsLoading(true);
      try {
        const data = await fetchStocktwitsStream(ticker, force);
        if (disposed || currentRequestId !== stocktwitsRequestIdRef.current) return;
        setStocktwitsData(data);
        setStocktwitsUpdatedAt(Date.now());
        setStocktwitsError(null);
      } catch (err: unknown) {
        if (disposed || currentRequestId !== stocktwitsRequestIdRef.current) return;
        setStocktwitsError(err instanceof Error ? err.message : 'Unable to load Stocktwits.');
      } finally {
        if (!disposed && currentRequestId === stocktwitsRequestIdRef.current) setStocktwitsLoading(false);
      }
    };

    void refreshStocktwits(forceOnStart);
    return () => {
      disposed = true;
      stocktwitsRequestIdRef.current += 1;
    };
  }, [ticker, isOpen, refreshTrigger, stocktwitsRefreshRequest, stocktwitsRequested]);

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

  // Show ten recent standalone posts. Don't discard valid posts just because
  // they contain multiple cashtags or little text; those filters made the feed
  // appear nearly empty even when the API returned a full stream.
  const filteredStocktwitsMessages = getVisibleStocktwitsMessages(stocktwitsData?.messages ?? [], 10);

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
      if (newsLoading && newsData.length === 0) {
        return <div class="py-3 text-center text-xs text-slate-500 font-mono animate-pulse">Loading company news…</div>;
      }
      if (newsError && newsData.length === 0) {
        return <div class="py-3 text-rose-400 text-xs">Failed to load news: {newsError}</div>;
      }
      if (!newsData || newsData.length === 0) {
        return <div class="py-3 text-slate-500 text-xs">No recent news found.</div>;
      }
      return (
        <div class="news-feed-enter space-y-2 mt-2">
          {newsError && <p class="text-[10px] text-amber-400">Refresh failed; showing previously loaded news.</p>}
          <p class="text-[10px] text-slate-500">{newsUpdatedAt ? `Updated ${formatRelativeTime(Math.floor(newsUpdatedAt / 1000) * 1000)}` : ''}{newsLoading ? ' · Refreshing…' : ''}</p>
          <div class="news-feed-list h-[240px] overflow-y-auto overscroll-contain pr-1 space-y-2" aria-label="Company news articles">
            {newsData.map((n: any, idx: number) => (
              <button
                key={n.id || n.url || idx}
                type="button"
                onClick={() => setSelectedNews(n)}
                aria-label={`Read news: ${n.headline || 'Untitled article'}`}
                class="news-feed-item block w-full text-left bg-slate-900/60 p-2.5 rounded border border-slate-800 hover:border-cyan-800 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <div class="text-[10px] text-cyan-400 mb-1">
                  {formatRelativeTime(Number(n.datetime) * 1000)} · {n.source || 'News'}
                </div>
                <div class="text-slate-200 text-xs font-semibold leading-snug">
                  {n.headline || 'Untitled article'}
                </div>
                {n.summary && <p class="mt-1.5 text-[11px] leading-relaxed text-slate-400 line-clamp-2">{n.summary}</p>}
              </button>
            ))}
          </div>
        </div>
      );
    }

    const data = stockData || {};

    if (activeSection === 'fundamentals') {
      const val = data.valuation || {};
      const fh = data.financialHealth || {};

      return (
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
      );
    }

    if (activeSection === 'analysts') {
      const t = data.analystTargets || {};
      const upDown = data.upgradesDowngrades || [];

      return (
        <div>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-slate-800/60 pb-3">
            <div>
              <span class="text-slate-500 block text-[10px]">Mean</span>
              <span class="text-emerald-400 font-bold">
                ${t.mean ? Number(t.mean).toFixed(2) : '—'}
              </span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px]">High</span>
              <span class="text-emerald-400 font-bold">
                ${t.high ? Number(t.high).toFixed(2) : '—'}
              </span>
            </div>
            <div>
              <span class="text-slate-500 block text-[10px]">Low</span>
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
              upDown.slice(0, 4).map((u: any, idx: number) => {

                let fromToGrade = '';

                if (u.fromGrade === u.toGrade) {
                  fromToGrade = u.toGrade;
                } else if (u.fromGrade) {
                  fromToGrade = u.fromGrade + ' ➝ ' + u.toGrade || '';
                } else {
                  fromToGrade = u.toGrade;
                }

                return (
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
                      {fromToGrade}
                    </span>
                  </div>
                )
              })
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
        <div>
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
            {loading && (
              <span
                id="marketInsightsStatus"
                class="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[9px] font-semibold text-slate-400"
                role="status"
              >
                Loading
              </span>
            )
            }
          </div>
        </div>
        {activeSection === 'news' && (
          <button type="button" onClick={() => setNewsRefreshRequest((value) => value + 1)}
            class="rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 hover:border-cyan-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            aria-label="Refresh company news">
            {newsLoading ? 'Refreshing…' : 'Refresh news'}
          </button>
        )}
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
        key={activeSection}
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

      <section class="mt-3 rounded-lg border border-slate-800/80 bg-slate-950/70 p-3" aria-labelledby="stocktwitsHeading">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 id="stocktwitsHeading" class="text-xs font-black uppercase tracking-wider text-slate-100">
              Stocktwits <span class="text-cyan-300">{ticker ? `· ${ticker}` : ''}</span>
            </h3>
          </div>
          <button type="button" onClick={() => { setStocktwitsRequested(true); setStocktwitsRefreshRequest((value) => value + 1); }}
            class="rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 hover:border-cyan-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            aria-label="Refresh Stocktwits messages">
            {stocktwitsLoading ? 'Refreshing…' : stocktwitsRequested ? 'Refresh' : 'Load'}
          </button>
          {stocktwitsData?.streamUrl && (
            <a href={stocktwitsData.streamUrl} target="_blank" rel="noopener noreferrer"
              class="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300">
              Open Stocktwits ↗
            </a>
          )}
        </div>

        {!ticker ? (
          <p class="py-2 text-xs text-slate-500">Select a ticker to view community posts.</p>
        ) : stocktwitsLoading && !stocktwitsData?.messages.length ? (
          <p class="py-2 text-xs text-slate-500 font-mono animate-pulse">Loading Stocktwits stream…</p>
        ) : stocktwitsError && !stocktwitsData?.messages.length ? (
          <p class="py-2 text-xs text-rose-400">Stocktwits unavailable: {stocktwitsError}</p>
        ) : !stocktwitsRequested ? (
          <p class="py-2 text-xs text-slate-500">Load Stocktwits messages to view community posts.</p>
        ) : !stocktwitsData?.messages.length ? (
          <p class="py-2 text-xs text-slate-500">No recent Stocktwits messages found.</p>
        ) : (
          <div class="stocktwits-feed-enter space-y-2">
            <p class="text-[10px] text-slate-500">{stocktwitsUpdatedAt ? `Updated ${formatRelativeTime(stocktwitsUpdatedAt)}` : ''}{stocktwitsLoading ? ' · Refreshing…' : ''}</p>
            {stocktwitsError && <p class="text-[10px] text-amber-400">Refresh failed; showing previously loaded messages.</p>}
            <div class="stocktwits-feed-list h-[306px] overflow-y-auto overscroll-contain pr-1 space-y-2" aria-label="Stocktwits messages">
              {filteredStocktwitsMessages.length === 0 ? (
                <p class="rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-500">No single-ticker messages found.</p>
              ) : filteredStocktwitsMessages.map((message, idx) => {
                const sentiment = message.sentiment?.basic ?? message.entities?.sentiment?.basic ?? null;
                const sentimentClass = sentiment?.toLowerCase() === 'bullish'
                  ? 'text-emerald-400 border-emerald-900/70'
                  : sentiment?.toLowerCase() === 'bearish'
                    ? 'text-rose-400 border-rose-900/70'
                    : 'text-slate-400 border-slate-700';
                const createdAt = Date.parse(message.created_at);
                return (
                  <article key={message.id || idx} class="stocktwits-feed-item rounded border border-slate-800 bg-slate-900/50 p-2.5">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      <span class="font-semibold text-slate-300">@{message.user?.username || message.user?.name || 'user'}</span>
                      {Number.isFinite(createdAt) && <span>{formatRelativeTime(createdAt)}</span>}
                      {sentiment && <span class={`rounded border px-1.5 py-0.5 font-bold uppercase ${sentimentClass}`}>{sentiment}</span>}
                      {typeof message.likes?.total === 'number' && <span>♥ {message.likes.total}</span>}
                    </div>
                    <p class="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-200">{renderStocktwitsBody(decodeHtmlEntities(typeof message.body === 'string' ? message.body : ''))}</p>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {selectedNews && (
        <div
          class="news-article-modal news-modal-enter fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
          role="presentation"
          onClick={() => setSelectedNews(null)}
        >
          <section
            class="news-article-dialog news-dialog-enter w-full max-w-3xl overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="newsArticleModalTitle"
            onClick={(event: MouseEvent) => event.stopPropagation()}
          >
            <header class="flex items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5">
              <div class="min-w-0">
                <p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                  {selectedNews.source || 'Company news'}{selectedNews.datetime ? ` · ${formatRelativeTime(Number(selectedNews.datetime) * 1000)}` : ''}
                </p>
                <h2 id="newsArticleModalTitle" class="text-base font-bold leading-snug text-slate-100 sm:text-lg">
                  {selectedNews.headline || 'Untitled article'}
                </h2>
              </div>
              <button type="button" class="shrink-0 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-700 hover:text-white" onClick={() => setSelectedNews(null)} aria-label="Close news article">✕</button>
            </header>
            <div class="max-h-[min(72dvh,42rem)] space-y-4 overflow-y-auto p-4 sm:p-5">
              <div class="whitespace-pre-wrap break-words leading-relaxed text-slate-300">
                {selectedNews.summary || selectedNews.description || selectedNews.content || 'A summary is not available from the news provider. Open the original article for the full story.'}
              </div>
              {selectedNews.url && <a href={selectedNews.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded border border-cyan-800/80 bg-cyan-950/40 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/50">Read full article ↗</a>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}