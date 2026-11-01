import { formatRelativeTime } from '../utils/relativeTime';
import { decodeHtmlEntities } from '../utils/formatters';
import { createPortal } from 'preact/compat';
import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchMarketNews, fetchStocktwitsStream, fetchYahooDeepStockData, type MarketNewsItem, type StocktwitsStream, type YahooDeepStockData } from '../services/api';
import { normalizeYahooDeepStockData } from '../services/yahooDeepDataContracts';
import { usePortfolio } from '../store/portfolioStore';
import { getMarketInsightsTicker } from '../domain/portfolioSelectors';
import { getMarketInsightsRequestPlan, type MarketInsightsSection } from '../features/quotes/marketInsightsRequestPolicy';
import { useDialogFocus } from '../ui/dialogFocus';

export type InsightSection = MarketInsightsSection;

export function formatNewsRelativeTime(datetime: unknown, now = Date.now()): string {
  if ((typeof datetime !== 'number' && typeof datetime !== 'string') ||
      (typeof datetime === 'string' && !datetime.trim())) {
    return formatRelativeTime(Number.NaN, now);
  }

  const seconds = Number(datetime);
  if (!Number.isFinite(seconds) || seconds <= 0) return formatRelativeTime(Number.NaN, now);
  return formatRelativeTime(seconds * 1000, now);
}

const INSIGHT_TABS: Array<{ id: InsightSection; domId: string; label: string }> = [
  { id: 'news', domId: 'insightTabNews', label: 'News' },
  { id: 'fundamentals', domId: 'insightTabFundamentals', label: 'Fundamentals' },
  { id: 'earnings', domId: 'insightTabEarnings', label: 'Earnings' },
  { id: 'analysts', domId: 'insightTabAnalysts', label: 'Analysts' }
];

const STOCKTWITS_CASHTAG_PATTERN = /\$([A-Z][A-Z0-9.-]{0,9})\b/gi;

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

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

function getStocktwitsSentiment(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const value = message as {
    sentiment?: { basic?: string | null } | null;
    entities?: { sentiment?: { basic?: string | null } | null } | null;
  };
  const sentiment = value.sentiment?.basic ?? value.entities?.sentiment?.basic;
  return typeof sentiment === 'string' ? sentiment.trim() : null;
}

export function isBearishStocktwitsMessage(message: unknown): boolean {
  return getStocktwitsSentiment(message)?.toLowerCase() === 'bearish';
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
    .filter((message) => !isBearishStocktwitsMessage(message))
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

export function MarketInsightsPanel() {
  const portfolio = usePortfolio();
  const ticker = getMarketInsightsTicker(portfolio);
  const [activeSection, setActiveSection] = useState<InsightSection>('news');
  const [deepDataRequest, setDeepDataRequest] = useState<{
    ticker: string;
    loading: boolean;
    error: string | null;
  }>({ ticker, loading: false, error: null });
  const [stockData, setStockData] = useState<YahooDeepStockData | null>(null);
  const [stockDataTicker, setStockDataTicker] = useState<string | null>(null);
  const [newsData, setNewsData] = useState<MarketNewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<MarketNewsItem | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<number | null>(null);
  const [newsRefreshRequest, setNewsRefreshRequest] = useState(0);
  const newsDialogRef = useRef<HTMLElement | null>(null);
  const newsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const newsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeNewsDialog = () => setSelectedNews(null);
  useDialogFocus(newsDialogRef, {
    active: selectedNews !== null,
    initialFocusRef: newsCloseButtonRef,
    restoreFocusRef: newsTriggerRef,
    onEscape: closeNewsDialog
  });
  const [stocktwitsData, setStocktwitsData] = useState<StocktwitsStream | null>(null);
  const [stocktwitsRequested, setStocktwitsRequested] = useState(false);
  const [stocktwitsLoading, setStocktwitsLoading] = useState(false);
  const [stocktwitsError, setStocktwitsError] = useState<string | null>(null);
  const [stocktwitsUpdatedAt, setStocktwitsUpdatedAt] = useState<number | null>(null);
  const [stocktwitsRefreshRequest, setStocktwitsRefreshRequest] = useState(0);
  const stocktwitsRequestIdRef = useRef(0);
  const newsRequestIdRef = useRef(0);
  const requestIdRef = useRef(0);
  const lastNewsManualRefreshRef = useRef(0);
  const lastStocktwitsManualRefreshRef = useRef(0);
  const newsTickerRef = useRef<string | null>(null);
  const stocktwitsTickerRef = useRef<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const requestPlan = getMarketInsightsRequestPlan(ticker, activeSection, stocktwitsRequested);
  const loading = requestPlan.deepData &&
    (deepDataRequest.ticker !== ticker ||
      deepDataRequest.loading ||
      (stockDataTicker !== ticker && !deepDataRequest.error));
  const error = requestPlan.deepData && deepDataRequest.ticker === ticker ? deepDataRequest.error : null;
  const currentStockData = stockDataTicker === ticker ? stockData : null;
  const hasCurrentNews = newsTickerRef.current === ticker;
  const currentNewsData = hasCurrentNews ? newsData : [];
  const currentNewsError = hasCurrentNews ? newsError : null;
  const currentNewsLoading = requestPlan.news && (!hasCurrentNews || newsLoading);
  const currentNewsUpdatedAt = hasCurrentNews ? newsUpdatedAt : null;
  const hasCurrentStocktwits = stocktwitsTickerRef.current === ticker;
  const currentStocktwitsData = hasCurrentStocktwits ? stocktwitsData : null;
  const currentStocktwitsError = hasCurrentStocktwits ? stocktwitsError : null;
  const currentStocktwitsLoading = requestPlan.stocktwits &&
    (!hasCurrentStocktwits || stocktwitsLoading);
  const currentStocktwitsUpdatedAt = hasCurrentStocktwits ? stocktwitsUpdatedAt : null;

  // Keep the detailed fundamentals/earnings/analyst request separate from news.
  // Background refreshes must not replace the current panel with a loading screen.
  useEffect(() => {
    if (!requestPlan.deepData) {
      setDeepDataRequest({ ticker, loading: false, error: null });
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const controller = new AbortController();
    setDeepDataRequest({ ticker, loading: true, error: null });

    fetchYahooDeepStockData(ticker, false, controller.signal)
      .then((data) => {
        if (currentRequestId !== requestIdRef.current) return;
        setStockData(data);
        setStockDataTicker(ticker);
        setDeepDataRequest({ ticker, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (currentRequestId !== requestIdRef.current) return;
        setDeepDataRequest({
          ticker,
          loading: false,
          error: isAbortError(err) ? null : err instanceof Error ? err.message : 'Unknown error'
        });
      });

    return () => {
      controller.abort();
      requestIdRef.current += 1;
    };
  }, [ticker, requestPlan.deepData]);

  // Company news loads on open and refreshes only when requested.
  useEffect(() => {
    if (!requestPlan.news) return;

    const forceOnStart = newsRefreshRequest !== lastNewsManualRefreshRef.current;
    lastNewsManualRefreshRef.current = newsRefreshRequest;
    if (newsTickerRef.current !== ticker) {
      newsTickerRef.current = ticker;
      setNewsData([]);
      setNewsUpdatedAt(null);
      setNewsError(null);
    }
    let disposed = false;
    const controller = new AbortController();

    const refreshNews = async (force: boolean) => {
      const currentRequestId = ++newsRequestIdRef.current;
      setNewsLoading(true);
      try {
        const news = await fetchMarketNews(ticker, force, controller.signal);
        if (disposed || currentRequestId !== newsRequestIdRef.current) return;
        setNewsData(Array.isArray(news) ? news : []);
        setNewsUpdatedAt(Date.now());
        setNewsError(null);
      } catch (err: unknown) {
        if (disposed || currentRequestId !== newsRequestIdRef.current || isAbortError(err)) return;
        setNewsError(err instanceof Error ? err.message : 'Unable to load company news.');
      } finally {
        if (!disposed && currentRequestId === newsRequestIdRef.current) setNewsLoading(false);
      }
    };

    void refreshNews(forceOnStart);
    return () => {
      disposed = true;
      controller.abort();
      newsRequestIdRef.current += 1;
    };
  }, [ticker, activeSection, newsRefreshRequest, requestPlan.news]);

  // Stocktwits is an optional secondary feed; defer its request until the user asks for it.
  useEffect(() => {
    if (!requestPlan.stocktwits) return;

    const forceOnStart = stocktwitsRefreshRequest !== lastStocktwitsManualRefreshRef.current;
    lastStocktwitsManualRefreshRef.current = stocktwitsRefreshRequest;
    if (stocktwitsTickerRef.current !== ticker) {
      stocktwitsTickerRef.current = ticker;
      setStocktwitsData(null);
      setStocktwitsUpdatedAt(null);
      setStocktwitsError(null);
    }
    let disposed = false;
    const controller = new AbortController();

    const refreshStocktwits = async (force: boolean) => {
      const currentRequestId = ++stocktwitsRequestIdRef.current;
      setStocktwitsLoading(true);
      try {
        const data = await fetchStocktwitsStream(ticker, force, controller.signal);
        if (disposed || currentRequestId !== stocktwitsRequestIdRef.current) return;
        setStocktwitsData(data);
        setStocktwitsUpdatedAt(Date.now());
        setStocktwitsError(null);
      } catch (err: unknown) {
        if (disposed || currentRequestId !== stocktwitsRequestIdRef.current || isAbortError(err)) return;
        setStocktwitsError(err instanceof Error ? err.message : 'Unable to load Stocktwits.');
      } finally {
        if (!disposed && currentRequestId === stocktwitsRequestIdRef.current) setStocktwitsLoading(false);
      }
    };

    void refreshStocktwits(forceOnStart);
    return () => {
      disposed = true;
      controller.abort();
      stocktwitsRequestIdRef.current += 1;
    };
  }, [ticker, stocktwitsRefreshRequest, stocktwitsRequested, requestPlan.stocktwits]);

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
    setActiveSection(nextTab.id);
  };

  // Keep terse and multi-cashtag standalone posts, but exclude bearish entries.
  // Apply the ten-post limit after those two content filters.
  const filteredStocktwitsMessages = getVisibleStocktwitsMessages(currentStocktwitsData?.messages ?? [], 10);

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
      if (currentNewsLoading && currentNewsData.length === 0) {
        return <div class="py-3 text-center text-xs text-slate-500 font-mono animate-pulse">Loading company news…</div>;
      }
      if (currentNewsError && currentNewsData.length === 0) {
        return <div class="py-3 text-rose-400 text-xs">Failed to load news: {currentNewsError}</div>;
      }
      if (!currentNewsData || currentNewsData.length === 0) {
        return <div class="py-3 text-slate-500 text-xs">No recent news found.</div>;
      }
      return (
        <div class="news-feed-enter space-y-2 mt-2">
          {currentNewsError && <p class="text-[10px] text-amber-400">Refresh failed; showing previously loaded news.</p>}
          <p class="text-[10px] text-slate-500">{currentNewsUpdatedAt ? `Updated ${formatRelativeTime(Math.floor(currentNewsUpdatedAt / 1000) * 1000)}` : ''}{currentNewsLoading ? ' · Refreshing…' : ''}</p>
          <div class="news-feed-list h-[240px] overflow-y-auto overscroll-contain pr-1 space-y-2" role="region" aria-label="Company news articles" tabIndex={0}>
            {currentNewsData.map((n, idx) => (
              <button
                key={n.id || n.url || idx}
                type="button"
                onClick={(event) => {
                  newsTriggerRef.current = event.currentTarget;
                  setSelectedNews(n);
                }}
                aria-label={`Read news: ${n.headline || 'Untitled article'}`}
                class="news-feed-item block w-full text-left bg-slate-900/60 p-2.5 rounded border border-slate-800 hover:border-cyan-800 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
              >
                <div class="text-[10px] text-cyan-400 mb-1">
                  {formatNewsRelativeTime(n.datetime)} · {n.source || 'News'}
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

    const data = currentStockData ?? normalizeYahooDeepStockData(null);

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
              upDown.slice(0, 4).map((u, idx) => {

                let fromToGrade = '';

                if (u.fromGrade === u.toGrade) {
                  fromToGrade = u.toGrade ?? '';
                } else if (u.fromGrade) {
                  fromToGrade = u.fromGrade + ' ➝ ' + (u.toGrade ?? '');
                } else {
                  fromToGrade = u.toGrade ?? '';
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
              eh.map((e, idx) => (
                <div
                  key={idx}
                  class="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0"
                >
                  <span class="text-slate-300 font-bold">{e.quarter}</span>
                  <span class="text-[10px]">
                    Est: {e.epsEstimate} | Act:{' '}
                    <span
                      class={`${(e.epsDifference ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
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
            {currentNewsLoading ? 'Refreshing…' : 'Refresh'}
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
              onClick={() => setActiveSection(tab.id)}
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
          <button type="button" onClick={() => {
            if (stocktwitsRequested) setStocktwitsRefreshRequest((value) => value + 1);
            else setStocktwitsRequested(true);
          }}
            class="rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 hover:border-cyan-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            aria-label="Refresh Stocktwits messages">
            {currentStocktwitsLoading ? 'Refreshing…' : stocktwitsRequested ? 'Refresh' : 'Load'}
          </button>
          {currentStocktwitsData?.streamUrl && (
            <a href={currentStocktwitsData.streamUrl} target="_blank" rel="noopener noreferrer"
              class="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300">
              Open Stocktwits ↗
            </a>
          )}
        </div>

        {!ticker ? (
          <p class="py-2 text-xs text-slate-500">Select a ticker to view community posts.</p>
        ) : currentStocktwitsLoading && !currentStocktwitsData?.messages.length ? (
          <p class="py-2 text-xs text-slate-500 font-mono animate-pulse">Loading Stocktwits stream…</p>
        ) : currentStocktwitsError && !currentStocktwitsData?.messages.length ? (
          <p class="py-2 text-xs text-rose-400">Stocktwits unavailable: {currentStocktwitsError}</p>
        ) : !stocktwitsRequested ? (
          <p class="py-2 text-xs text-slate-500">Load Stocktwits messages to view community posts.</p>
        ) : !currentStocktwitsData?.messages.length ? (
          <p class="py-2 text-xs text-slate-500">No recent Stocktwits messages found.</p>
        ) : (
          <div class="stocktwits-feed-enter space-y-2">
            <p class="text-[10px] text-slate-500">{currentStocktwitsUpdatedAt ? `Updated ${formatRelativeTime(currentStocktwitsUpdatedAt)}` : ''}{currentStocktwitsLoading ? ' · Refreshing…' : ''}</p>
            {currentStocktwitsError && <p class="text-[10px] text-amber-400">Refresh failed; showing previously loaded messages.</p>}
            <div class="stocktwits-feed-list h-[306px] overflow-y-auto overscroll-contain pr-1 space-y-2" role="region" aria-label="Stocktwits messages" tabIndex={0}>
              {filteredStocktwitsMessages.length === 0 ? (
                <p class="rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-500">No single-ticker messages found.</p>
              ) : filteredStocktwitsMessages.map((message, idx) => {
                const sentiment = getStocktwitsSentiment(message);
                const sentimentClass = sentiment?.toLowerCase() === 'bullish'
                  ? 'text-emerald-400 border-emerald-900/70'
                  : sentiment?.toLowerCase() === 'bearish'
                    ? 'text-rose-400 border-rose-900/70'
                    : 'text-slate-400 border-slate-700';
                const createdAt = Date.parse(message.created_at ?? '');
                return (
                  <article key={message.id || idx} class="stocktwits-feed-item rounded border border-slate-800 bg-slate-900/50 p-2.5">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                      <span class="font-semibold text-slate-300">@{message.user?.username || message.user?.name || 'user'}</span>
                      {Number.isFinite(createdAt) && <span>{formatRelativeTime(createdAt)}</span>}
                      {sentiment && <span class={`rounded border px-1.5 py-0.5 font-bold uppercase ${sentimentClass}`}>{sentiment}</span>}
                      {typeof message.likes?.total === 'number' && <span class="text-rose-400">♥ {message.likes.total}</span>}
                    </div>
                    <p class="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-200">{renderStocktwitsBody(decodeHtmlEntities(typeof message.body === 'string' ? message.body : ''))}</p>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {selectedNews && createPortal(
        <div
          class="news-article-modal news-modal-enter fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-950/80 backdrop-blur-sm"
          role="presentation"
          onClick={closeNewsDialog}
        >
          <section
            ref={newsDialogRef}
            tabIndex={-1}
            class="news-article-dialog news-dialog-enter flex w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="newsArticleModalTitle"
            onClick={(event: MouseEvent) => event.stopPropagation()}
          >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5">
              <div class="min-w-0">
                <p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                  {selectedNews.source || 'Company news'} · {formatNewsRelativeTime(selectedNews.datetime)}
                </p>
                <h2 id="newsArticleModalTitle" class="text-base font-bold leading-snug text-slate-100 sm:text-lg">
                  {selectedNews.headline || 'Untitled article'}
                </h2>
              </div>
              <button ref={newsCloseButtonRef} type="button" class="shrink-0 rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-700 hover:text-white" onClick={closeNewsDialog} aria-label="Close news article" data-news-dialog-close>✕</button>
            </header>
            <div class="news-article-content min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5" role="region" aria-labelledby="newsArticleModalTitle" tabIndex={0}>
              <div class="whitespace-pre-wrap break-words leading-relaxed text-slate-300">
                {selectedNews.summary || selectedNews.description || selectedNews.content || 'A summary is not available from the news provider. Open the original article for the full story.'}
              </div>
              {selectedNews.url && <a href={selectedNews.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 rounded border border-cyan-800/80 bg-cyan-950/40 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/50">Read full article ↗</a>}
            </div>
          </section>
        </div>,
        document.body
      )}
    </>
  );
}