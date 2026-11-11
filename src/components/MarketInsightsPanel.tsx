import { formatRelativeTime } from '../utils/relativeTime';
import { decodeHtmlEntities } from '../utils/formatters';
import { createPortal, memo } from 'preact/compat';
import { ModalFrame } from './ModalFrame';
import { useState, useEffect, useRef } from 'preact/hooks';
import { fetchMarketNews, fetchStocktwitsStream, fetchYahooDeepStockData, type MarketNewsItem, type StocktwitsStream, type YahooDeepStockData } from '../services/api';
import { normalizeYahooDeepStockData } from '../services/yahooDeepDataContracts';
import { portfolioStore, usePortfolioSelector } from '../store/portfolioStore';
import { getMarketInsightsTicker } from '../domain/portfolioSelectors';
import type { BoardState } from '../types/portfolio';
import { getMarketInsightsRequestPlan, type MarketInsightsSection } from '../features/quotes/marketInsightsRequestPolicy';
import { fetchFinnhubMarketEvents } from '../services/finnhubMarketData';
import { marketHistoryProviderRegistry } from '../services/marketHistoryProviders';
import { normalizeInstrumentIdentity } from '../services/marketDataContracts';
import { createMarketEventDateRange, getNextUpcomingEarningsDate, type MarketEventsResult } from '../services/marketEvents';
import type { MarketHistoryResult, MarketPricePoint } from '../services/marketDataContracts';
import {
  applyMarketHistoryCorrectionsToResult,
  createMarketHistoryCorrectionEvent
} from '../services/marketHistoryCorrections';
import { getAppLanguage, translateText } from '../services/i18n';
import { useDialogFocus } from '../ui/dialogFocus';
import {
  formatMarketEventDate,
  marketEventLabel,
  marketEventTimingLabel
} from '../features/quotes/marketEventPresentation';
import {
  formatNewsRelativeTime,
  getClosestDatedMarketEvents,
  getStocktwitsSentiment,
  getVisibleStocktwitsMessages
} from '../features/quotes/marketInsightsContent';

type InsightSection = MarketInsightsSection;

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

const selectMarketInsightsTicker = (state: BoardState): string => getMarketInsightsTicker({
  activeView: state.activeView,
  positions: state.positions,
  selectedTicker: state.activeView
});

const INSIGHT_TABS: Array<{ id: InsightSection; domId: string; label: string }> = [
  { id: 'news', domId: 'insightTabNews', label: 'News' },
  { id: 'fundamentals', domId: 'insightTabFundamentals', label: 'Fundamentals' },
  { id: 'earnings', domId: 'insightTabEarnings', label: 'Earnings' },
  { id: 'analysts', domId: 'insightTabAnalysts', label: 'Analysts' }
];

function renderStocktwitsBody(body: string) {
  const parts = body.split(/(\$[A-Z][A-Z0-9.-]{0,9}\b)/gi);
  return parts.map((part, index) =>
    /^\$[A-Z][A-Z0-9.-]{0,9}\b$/i.test(part)
      ? <span key={index} class="inline-block rounded bg-cyan-950/80 px-1 font-bold text-cyan-300 ring-1 ring-inset ring-cyan-700/60">{part}</span>
      : part
  );
}

function MarketInsightsPanelView() {
  const ticker = usePortfolioSelector(selectMarketInsightsTicker);
  const corporateActionHistory = usePortfolioSelector(state => state.corporateActionEvents || []);
  const marketHistoryCorrections = usePortfolioSelector(state => state.marketHistoryCorrections || []);
  const [historyCorrectionDraft, setHistoryCorrectionDraft] = useState<{
    timestamp: number;
    previous: MarketPricePoint;
    correctedPrice: string;
    reason: string;
  } | null>(null);
  const [historyCorrectionFeedback, setHistoryCorrectionFeedback] = useState<{
    timestamp: number;
    message: string;
  } | null>(null);
  const [corporateActionFeedback, setCorporateActionFeedback] = useState<{
    sourceId: string; message: string;
  } | null>(null);
  const [activeSection, setActiveSection] = useState<InsightSection>('news');
  const [deepDataRequest, setDeepDataRequest] = useState<{
    ticker: string;
    loading: boolean;
    error: string | null;
  }>({ ticker, loading: false, error: null });
  const [deepDataRefreshRequest, setDeepDataRefreshRequest] = useState(0);
  const [stockData, setStockData] = useState<YahooDeepStockData | null>(null);
  const [stockDataTicker, setStockDataTicker] = useState<string | null>(null);
  const [newsData, setNewsData] = useState<MarketNewsItem[]>([]);
  const [selectedNews, setSelectedNews] = useState<{ ticker: string; article: MarketNewsItem } | null>(null);
  const currentSelectedNews = selectedNews?.ticker === ticker ? selectedNews.article : null;
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [newsUpdatedAt, setNewsUpdatedAt] = useState<number | null>(null);
  const [newsRefreshRequest, setNewsRefreshRequest] = useState(0);
  const newsDialogRef = useRef<HTMLElement | null>(null);
  const newsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const newsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const newsCloseRef = useRef<(() => void) | null>(null);
  const dismissNewsDialog = () => setSelectedNews(null);
  const requestCloseNewsDialog = () => { newsCloseRef.current?.(); };
  useEffect(() => {
    if (selectedNews && selectedNews.ticker !== ticker) setSelectedNews(null);
  }, [ticker, selectedNews]);
  useDialogFocus(newsDialogRef, {
    active: currentSelectedNews !== null,
    initialFocusRef: newsCloseButtonRef,
    restoreFocusRef: newsTriggerRef,
    onEscape: requestCloseNewsDialog
  });
  const [marketEventsState, setMarketEventsState] = useState<{
    ticker: string | null; data: MarketEventsResult | null; loading: boolean; error: string | null;
  }>({ ticker: null, data: null, loading: false, error: null });
  const [marketEventsRefreshRequest, setMarketEventsRefreshRequest] = useState(0);
  const [marketHistoryState, setMarketHistoryState] = useState<{
    ticker: string | null; data: MarketHistoryResult | null; loading: boolean; error: string | null;
  }>({ ticker: null, data: null, loading: false, error: null });
  const [marketHistoryRequest, setMarketHistoryRequest] = useState(0);
  const marketEventsRequestIdRef = useRef(0);
  const marketHistoryRequestIdRef = useRef(0);
  const [stocktwitsData, setStocktwitsData] = useState<StocktwitsStream | null>(null);
  const [stocktwitsRequested, setStocktwitsRequested] = useState(false);
  const [stocktwitsLoading, setStocktwitsLoading] = useState(false);
  const [stocktwitsError, setStocktwitsError] = useState<string | null>(null);
  const [stocktwitsUpdatedAt, setStocktwitsUpdatedAt] = useState<number | null>(null);
  const [stocktwitsRefreshRequest, setStocktwitsRefreshRequest] = useState(0);
  const stocktwitsRequestIdRef = useRef(0);
  const newsRequestIdRef = useRef(0);
  const requestIdRef = useRef(0);
  const lastDeepDataManualRefreshRef = useRef(0);
  const lastNewsManualRefreshRef = useRef(0);
  const lastStocktwitsManualRefreshRef = useRef(0);
  const newsTickerRef = useRef<string | null>(null);
  const stocktwitsTickerRef = useRef<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const requestPlan = getMarketInsightsRequestPlan(ticker, activeSection, stocktwitsRequested);
  const currentStockData = stockDataTicker === ticker ? stockData : null;
  // Keep the last successful snapshot visible during a manual refresh. A first
  // load still gets a blocking loading state, scoped to the selected ticker.
  const loading = requestPlan.deepData && !currentStockData &&
    (deepDataRequest.ticker !== ticker || deepDataRequest.loading || !deepDataRequest.error);
  const error = requestPlan.deepData && deepDataRequest.ticker === ticker ? deepDataRequest.error : null;
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

    const forceOnStart = deepDataRefreshRequest !== lastDeepDataManualRefreshRef.current;
    lastDeepDataManualRefreshRef.current = deepDataRefreshRequest;
    const currentRequestId = ++requestIdRef.current;
    const controller = new AbortController();
    setDeepDataRequest({ ticker, loading: true, error: null });

    fetchYahooDeepStockData(ticker, forceOnStart, controller.signal)
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
  }, [ticker, deepDataRefreshRequest, requestPlan.deepData]);

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

  // Earnings/dividend events are fetched only when the Earnings tab is opened.
  // The Worker supplies server receipt time; provider observation/publication time
  // remains unknown unless a provider explicitly returns it.
  useEffect(() => {
    if (activeSection !== 'earnings' || !ticker) return;
    const requestId = ++marketEventsRequestIdRef.current;
    const controller = new AbortController();
    const { from, to } = createMarketEventDateRange(new Date());
    const symbol = ticker.trim().toUpperCase().replace(/\.US$/i, '');
    setMarketEventsState(current => ({
      ticker,
      data: current.ticker === ticker ? current.data : null,
      loading: true,
      error: null
    }));

    void fetchFinnhubMarketEvents(symbol, from, to, { signal: controller.signal })
      .then(data => {
        if (requestId !== marketEventsRequestIdRef.current) return;
        setMarketEventsState({ ticker, data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (requestId !== marketEventsRequestIdRef.current || isAbortError(error)) return;
        setMarketEventsState({
          ticker,
          data: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Events unavailable'
        });
      });

    return () => {
      controller.abort();
      marketEventsRequestIdRef.current += 1;
    };
  }, [ticker, activeSection, marketEventsRefreshRequest]);

  // Historical candles are opt-in rather than added to every earnings-tab load.
  // No exchange or currency is guessed from a bare ticker; the shared normalizer
  // marks provenance partial when the instrument mapping is incomplete.
  useEffect(() => {
    if (!marketHistoryRequest || activeSection !== 'earnings' || !ticker) return;
    const requestId = ++marketHistoryRequestIdRef.current;
    const controller = new AbortController();
    const symbol = ticker.trim().toUpperCase().replace(/\.US$/i, '');
    const identity = normalizeInstrumentIdentity({ symbol, assetType: 'EQUITY' }).instrument;
    if (!identity) {
      setMarketHistoryState({ ticker, data: null, loading: false, error: 'Daily history unavailable' });
      return;
    }
    const endAt = Date.now();
    const startAt = endAt - 90 * 24 * 60 * 60 * 1000;
    setMarketHistoryState(current => ({
      ticker,
      data: current.ticker === ticker ? current.data : null,
      loading: true,
      error: null
    }));
    void marketHistoryProviderRegistry.fetchDailyHistory({
      instrument: identity,
      startAt,
      endAt,
      interval: '1D',
      signal: controller.signal
    }).then(data => {
      if (requestId !== marketHistoryRequestIdRef.current) return;
      setMarketHistoryState({ ticker, data, loading: false, error: null });
    }).catch((error: unknown) => {
      if (requestId !== marketHistoryRequestIdRef.current || isAbortError(error)) return;
      setMarketHistoryState({
        ticker,
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : 'Daily history unavailable'
      });
    });
    return () => {
      controller.abort();
      marketHistoryRequestIdRef.current += 1;
    };
  }, [ticker, activeSection, marketHistoryRequest]);

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

    if (error && !currentStockData) {
      return (
        <div role="alert" class="flex flex-col items-start gap-2 py-3 text-xs text-rose-400">
          <span>Failed to load insights: {error}</span>
          <button
            type="button"
            onClick={() => setDeepDataRefreshRequest((value) => value + 1)}
            class="min-h-11 rounded border border-rose-800/70 px-2.5 py-1.5 font-semibold text-rose-200 transition hover:bg-rose-950/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400"
            aria-label="Retry market data refresh"
          >
            Retry
          </button>
        </div>
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
                  setSelectedNews({ ticker, article: n });
                }}
                aria-label={`Read news: ${n.headline || 'Untitled article'}`}
                class="news-feed-item block min-h-11 w-full text-left bg-slate-900/60 p-2.5 rounded border border-slate-800 hover:border-cyan-800 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
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

      const currentEvents = marketEventsState.ticker === ticker ? marketEventsState.data : null;
      const eventsLoading = marketEventsState.ticker === ticker && marketEventsState.loading;
      const currentEventsError = marketEventsState.ticker === ticker ? marketEventsState.error : null;
      const currentHistorySource = marketHistoryState.ticker === ticker ? marketHistoryState.data : null;
      const historySymbol = currentHistorySource?.instrument?.symbol ??
        ticker.trim().toUpperCase().replace(/\.US$/i, '');
      const historyCorrectionApplication = currentHistorySource
        ? applyMarketHistoryCorrectionsToResult(currentHistorySource, historySymbol, '1D', marketHistoryCorrections)
        : null;
      const currentHistory = historyCorrectionApplication?.result ?? null;
      const historyLoading = marketHistoryState.ticker === ticker && marketHistoryState.loading;
      const historyError = marketHistoryState.ticker === ticker ? marketHistoryState.error : null;
      const upcomingEarnings = getClosestDatedMarketEvents(
        currentEvents?.earnings ?? [], event => event.eventDate
      );
      const upcomingDividends = getClosestDatedMarketEvents(
        currentEvents?.dividends ?? [], event => event.exDate
      );
      const corporateActions = currentEvents?.corporateActions ?? [];
      const recordedCorporateActionIds = new Set(corporateActionHistory.map(event => event.sourceId));
      const nextEarningsDate = getNextUpcomingEarningsDate(
        currentEvents?.earnings ?? [], Date.now()
      ) ?? getNextUpcomingEarningsDate(
        typeof cal.earningsDate === 'string' ? [{ eventDate: cal.earningsDate }] : [], Date.now()
      ) ?? 'TBD';
      const latestHistory = currentHistory?.points.slice(-5).reverse() ?? [];

      return (
        <div class="space-y-3">
          <div class="bg-slate-900/70 p-2.5 rounded border border-slate-800/80 mb-3">
            <span class="text-[10px] text-slate-500 uppercase block">Next Earnings Date</span>
            <span class="text-purple-300 font-bold text-sm">{nextEarningsDate}</span>
          </div>

          <section class="rounded border border-slate-800/80 bg-slate-900/40 p-2.5" aria-label={marketEventLabel('Upcoming and recent events')}>
            <div class="mb-2 flex items-center justify-between gap-2">
              <h4 class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{marketEventLabel('Upcoming and recent events')}</h4>
              {eventsLoading && <span class="text-[10px] text-slate-500" role="status">{marketEventLabel('Loading events…')}</span>}
            </div>
            {currentEvents?.quality === 'partial' && (
              <p class="mb-2 text-[10px] text-amber-300">{marketEventLabel('Partial provider coverage')}</p>
            )}
            {currentEventsError && !currentEvents && (
              <p class="mb-2 text-[10px] text-slate-500">{marketEventLabel('Events unavailable')}</p>
            )}

            <div class="space-y-2">
              <div>
                <h5 class="mb-1 text-[10px] font-semibold text-slate-300">{marketEventLabel('Earnings')}</h5>
                {currentEvents?.earningsAvailable === false ? (
                  <p class="text-[10px] text-slate-500">{marketEventLabel('Earnings unavailable')}</p>
                ) : upcomingEarnings.length ? upcomingEarnings.map(event => (
                  <div key={event.id} class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 py-1.5 last:border-0">
                    <div>
                      <span class="text-[11px] font-semibold text-slate-200">{formatMarketEventDate(event.eventDate)}</span>
                      <span class="ml-2 text-[10px] text-slate-500">{marketEventTimingLabel(event.timing)}</span>
                    </div>
                    <div class="text-right text-[10px] text-slate-400">
                      {marketEventLabel('Estimate')}: {event.epsEstimate ?? '—'}
                      {' · '}{marketEventLabel('Actual')}: {event.epsActual ?? '—'}
                    </div>
                  </div>
                )) : currentEvents?.earningsAvailable === true && !eventsLoading ? (
                  <p class="text-[10px] text-slate-500">{marketEventLabel('No earnings events in this period.')}</p>
                ) : null}
              </div>
              <div>
                <h5 class="mb-1 text-[10px] font-semibold text-slate-300">{marketEventLabel('Dividends')}</h5>
                {currentEvents?.dividendsAvailable === false ? (
                  <p class="text-[10px] text-slate-500">{marketEventLabel('Dividends unavailable')}</p>
                ) : upcomingDividends.length ? upcomingDividends.map(event => (
                  <div key={event.id} class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 py-1.5 last:border-0">
                    <span class="text-[11px] font-semibold text-slate-200">{formatMarketEventDate(event.exDate)}</span>
                    <span class="text-[10px] text-slate-400">
                      {marketEventLabel('Ex-date')} · {event.amount === null
                        ? marketEventLabel('Amount unavailable')
                        : event.amount + (event.currency ? ' ' + event.currency : ' (' + marketEventLabel('Currency unknown; no conversion applied.') + ')')}
                    </span>
                  </div>
                )) : currentEvents?.dividendsAvailable === true && !eventsLoading ? (
                  <p class="text-[10px] text-slate-500">{marketEventLabel('No dividend events in this period.')}</p>
                ) : null}
              </div>
            </div>

            {currentEvents && (
              <p class="mt-2 border-t border-slate-800 pt-2 text-[9px] leading-4 text-slate-500">
                {currentEvents.provider || 'Provider'} · {marketEventLabel('Received')}: {currentEvents.receivedAt ? formatRelativeTime(currentEvents.receivedAt) : '—'}
                {' · '}{currentEvents.observedAt === null ? marketEventLabel('Observed time unavailable') : formatRelativeTime(currentEvents.observedAt)}
              </p>
            )}
            <div class="mt-2">
              <button type="button" onClick={() => setMarketEventsRefreshRequest(value => value + 1)}
                disabled={eventsLoading}
                class="min-h-11 rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-cyan-300 disabled:opacity-50">
                {eventsLoading ? marketEventLabel('Loading events…') : marketEventLabel('Refresh')}
              </button>
            </div>
          </section>

          <section class="rounded border border-slate-800/80 bg-slate-900/40 p-2.5" aria-label={marketEventLabel('Corporate actions')}>
            <div class="mb-2">
              <h4 class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{marketEventLabel('Corporate actions')}</h4>
              <p class="text-[9px] text-slate-500">{marketEventLabel('Stock splits and reverse splits')} · {marketEventLabel('Dividends')}</p>
            </div>
            {currentEvents?.corporateActionsAvailable === false && (
              <p class="text-[10px] text-slate-500">{marketEventLabel('Split data unavailable')}</p>
            )}
            {currentEvents?.corporateActionsAvailable === true &&
              !corporateActions.some(event => event.kind === 'stock_split' || event.kind === 'reverse_split') &&
              !eventsLoading && (
              <p class="text-[10px] text-slate-500">{marketEventLabel('No verified split events in this period.')}</p>
            )}
            <div class="space-y-2">
              {corporateActions.map(event => {
                const alreadyRecorded = recordedCorporateActionIds.has(event.sourceId);
                const priorAction = corporateActionHistory.find(item => item.sourceId === event.sourceId);
                const isFeedback = corporateActionFeedback?.sourceId === event.sourceId;
                const isDividend = event.kind === 'cash_dividend';
                const alreadyApplied = priorAction?.status === 'applied';
                const notApplicable = priorAction?.status === 'not_applicable';
                return (
                  <div key={event.id} class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/60 py-2 last:border-0">
                    <div class="min-w-0">
                      <div class="text-[11px] font-semibold text-slate-200">{formatMarketEventDate(event.effectiveDate)}</div>
                      <div class="text-[10px] text-slate-500">
                        {isDividend ? marketEventLabel('Cash dividend') : marketEventLabel(event.kind === 'stock_split' ? 'Split' : 'Reverse split')}
                        {' · '}
                        {isDividend
                          ? (event.amountPerShare ?? '—') + (event.currency ? ' ' + event.currency : '')
                          : marketEventLabel('Share ratio') + ': ' + event.fromFactor + ':' + event.toFactor}
                      </div>
                      {priorAction && (
                        <p class="mt-1 text-[9px] text-amber-300">{marketEventLabel('Review required')}: {priorAction.note}</p>
                      )}
                      {isFeedback && (
                        <p class="mt-1 text-[9px] text-cyan-300" role="status">{corporateActionFeedback.message}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={eventsLoading || (isDividend && alreadyRecorded) ||
                        (!isDividend && (alreadyApplied || notApplicable))}
                      onClick={() => {
                        if (isDividend) {
                          const saved = portfolioStore.recordCorporateActionEvidence(event);
                          setCorporateActionFeedback({
                            sourceId: event.sourceId,
                            message: saved
                              ? marketEventLabel('Dividend evidence saved')
                              : marketEventLabel('Could not save this corporate action.')
                          });
                          return;
                        }
                        const confirmed = window.confirm(marketEventLabel('Apply the verified share ratio to every eligible pre-action lot? Total acquisition cost will remain unchanged. No cash receipt or investment profit will be created.'));
                        if (!confirmed) return;
                        const saved = portfolioStore.applyCorporateActionSplit(event);
                        const message = !saved
                          ? marketEventLabel('Could not save this corporate action.')
                          : saved.status === 'applied'
                            ? marketEventLabel('Split applied; cost basis preserved.')
                            : marketEventLabel('Split evidence saved for review. No position or cash was changed.');
                        setCorporateActionFeedback({ sourceId: event.sourceId, message });
                      }}
                      class="min-h-11 rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">
                      {alreadyApplied ? marketEventLabel('Split already applied')
                        : notApplicable ? marketEventLabel('No adjustment needed')
                          : isDividend && alreadyRecorded ? marketEventLabel('Dividend evidence saved')
                            : isDividend ? marketEventLabel('Record dividend evidence')
                              : marketEventLabel('Apply split to open position')}
                    </button>
                  </div>
                );
              })}
            </div>
            <p class="mt-2 border-t border-slate-800 pt-2 text-[9px] leading-4 text-slate-500">
              {marketEventLabel('Dividend events are evidence only; cash is recorded when broker settlement is confirmed.')}
            </p>
          </section>

          <section class="rounded border border-slate-800/80 bg-slate-900/40 p-2.5" aria-label={marketEventLabel('Daily price history')}>
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{marketEventLabel('Daily price history')}</h4>
              <button type="button" onClick={() => setMarketHistoryRequest(value => value + 1)}
                disabled={historyLoading}
                class="min-h-11 rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-cyan-300 disabled:opacity-50">
                {historyLoading ? marketEventLabel('Loading history…') : marketEventLabel(currentHistory ? 'Refresh history' : 'Load daily history')}
              </button>
            </div>
            {historyError && !currentHistory && <p class="text-[10px] text-slate-500">{marketEventLabel('Daily history unavailable')}</p>}
            {!currentHistory && !historyError && !historyLoading && <p class="text-[10px] text-slate-500">{marketEventLabel('No historical prices loaded.')}</p>}
            {historyLoading && !currentHistory && <p class="text-[10px] text-slate-500" role="status">{marketEventLabel('Loading history…')}</p>}
            {latestHistory.length > 0 && (
              <div class="space-y-1">
                {latestHistory.map(point => {
                  const pointCorrections = marketHistoryCorrections.filter(event =>
                    event.symbol === historySymbol &&
                    (event.interval === '1D' || event.interval === 'D') &&
                    event.timestamp === point.timestamp
                  ).sort((a, b) => a.recordedAt - b.recordedAt);
                  const correction = pointCorrections[pointCorrections.length - 1];
                  const isCorrected = currentHistory?.correctionStatus === 'applied' && !!correction;
                  const isEditing = historyCorrectionDraft?.timestamp === point.timestamp;
                  return (
                    <div key={point.timestamp} class="border-b border-slate-800/50 py-1.5 last:border-0">
                      <div class="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                        <span class="text-slate-400">{new Date(point.timestamp).toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')}</span>
                        <span class="flex items-center gap-2">
                          {isCorrected && <span class="text-[9px] text-amber-300">{marketEventLabel('Corrected')}</span>}
                          <span class="font-mono text-slate-200">{point.price.toFixed(2)}</span>
                          <button type="button" disabled={!!historyCorrectionDraft}
                            onClick={() => {
                              setHistoryCorrectionFeedback(null);
                              setHistoryCorrectionDraft({
                                timestamp: point.timestamp,
                                previous: point,
                                correctedPrice: String(point.price),
                                reason: ''
                              });
                            }}
                            class="min-h-11 rounded border border-slate-700 px-2 text-[9px] text-cyan-300 disabled:opacity-40">
                            {marketEventLabel('Correct close')}
                          </button>
                        </span>
                      </div>
                      {isCorrected && correction && (
                        <p class="mt-1 text-[9px] text-slate-500">
                          {marketEventLabel('Manual correction')} · {correction.previous?.price?.toFixed(2) ?? '—'} → {correction.corrected?.price?.toFixed(2) ?? '—'} · {correction.reason}
                        </p>
                      )}
                      {isEditing && historyCorrectionDraft && (
                        <div class="mt-2 space-y-2 rounded border border-slate-700/70 bg-slate-950/40 p-2">
                          <label class="block text-[9px] text-slate-400">
                            {marketEventLabel('New close price')}
                            <input type="number" inputMode="decimal" min="0.00000001" step="any"
                              value={historyCorrectionDraft.correctedPrice}
                              onInput={event => setHistoryCorrectionDraft(current => current
                                ? { ...current, correctedPrice: event.currentTarget.value }
                                : current)}
                              class="mt-1 min-h-9 w-full rounded border border-slate-700 bg-slate-900 px-2 text-[11px] text-slate-100" />
                          </label>
                          <label class="block text-[9px] text-slate-400">
                            {marketEventLabel('Reason for correction')}
                            <textarea rows={2} maxLength={1000} value={historyCorrectionDraft.reason}
                              onInput={event => setHistoryCorrectionDraft(current => current
                                ? { ...current, reason: event.currentTarget.value }
                                : current)}
                              placeholder={marketEventLabel('Enter a corrected close and a reason.')}
                              class="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2 text-[10px] text-slate-100" />
                          </label>
                          <div class="flex flex-wrap gap-2">
                            <button type="button"
                              disabled={!Number.isFinite(Number(historyCorrectionDraft.correctedPrice)) ||
                                Number(historyCorrectionDraft.correctedPrice) <= 0 ||
                                Number(historyCorrectionDraft.correctedPrice) === historyCorrectionDraft.previous.price ||
                                (historyCorrectionDraft.previous.high !== undefined &&
                                  Number(historyCorrectionDraft.correctedPrice) > historyCorrectionDraft.previous.high) ||
                                (historyCorrectionDraft.previous.low !== undefined &&
                                  Number(historyCorrectionDraft.correctedPrice) < historyCorrectionDraft.previous.low) ||
                                !historyCorrectionDraft.reason.trim()}
                              onClick={() => {
                                const recordedAt = Date.now();
                                try {
                                  const event = createMarketHistoryCorrectionEvent({
                                    symbol: historySymbol,
                                    interval: '1D',
                                    timestamp: historyCorrectionDraft.timestamp,
                                    provider: 'USER',
                                    receivedAt: recordedAt,
                                    recordedAt,
                                    previous: historyCorrectionDraft.previous,
                                    corrected: {
                                      ...historyCorrectionDraft.previous,
                                      price: Number(historyCorrectionDraft.correctedPrice)
                                    },
                                    reason: historyCorrectionDraft.reason
                                  });
                                  const saved = portfolioStore.recordMarketHistoryCorrection(event);
                                  setHistoryCorrectionFeedback({
                                    timestamp: historyCorrectionDraft.timestamp,
                                    message: saved
                                      ? marketEventLabel('Correction saved to history.')
                                      : marketEventLabel('Could not save history correction.')
                                  });
                                  if (saved) setHistoryCorrectionDraft(null);
                                } catch {
                                  setHistoryCorrectionFeedback({
                                    timestamp: historyCorrectionDraft.timestamp,
                                    message: marketEventLabel('Could not save history correction.')
                                  });
                                }
                              }}
                              class="min-h-11 rounded border border-cyan-700 px-2 py-1 text-[10px] font-semibold text-cyan-300 disabled:opacity-40">
                              {marketEventLabel('Save correction')}
                            </button>
                            <button type="button" onClick={() => setHistoryCorrectionDraft(null)}
                              class="min-h-11 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300">
                              {marketEventLabel('Cancel')}
                            </button>
                          </div>
                        </div>
                      )}
                      {historyCorrectionFeedback?.timestamp === point.timestamp && (
                        <p class="mt-1 text-[9px] text-cyan-300" role="status">{historyCorrectionFeedback.message}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {historyCorrectionApplication?.status === 'review_required' && (
              <p class="mt-2 text-[9px] text-amber-300">{marketEventLabel('History correction needs review; provider prices are shown unchanged.')}</p>
            )}
            {historyCorrectionApplication?.status === 'applied' && (
              <p class="mt-2 text-[9px] text-amber-300">{marketEventLabel('Manual corrections affect this history list only; saved portfolio valuations and P&L are not rewritten.')}</p>
            )}
            {currentHistory?.quality === 'partial' && (
              <p class="mt-2 text-[9px] text-amber-300">{currentHistory.issues.map(marketEventLabel).join(' · ') || marketEventLabel('Currency unknown; no conversion applied.')}</p>
            )}
            {currentHistory && (
              <p class="mt-2 border-t border-slate-800 pt-2 text-[9px] leading-4 text-slate-500">
                {currentHistory.provider || 'Provider'} · {marketEventLabel('Received')}: {currentHistory.receivedAt ? formatRelativeTime(currentHistory.receivedAt) : '—'}
                {' · '}{currentHistory.observedAt === null ? marketEventLabel('Observed time unavailable') : formatRelativeTime(currentHistory.observedAt)}
              </p>
            )}
          </section>
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
                    <span>Est:</span> {e.epsEstimate} <span>|</span> <span>Act:</span>{' '}
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
        {requestPlan.deepData && !error && (
          <button
            type="button"
            onClick={() => setDeepDataRefreshRequest((value) => value + 1)}
            disabled={deepDataRequest.ticker === ticker && deepDataRequest.loading}
            aria-busy={deepDataRequest.ticker === ticker && deepDataRequest.loading}
            class="min-h-11 rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 transition hover:border-cyan-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Refresh market data"
          >
            {deepDataRequest.ticker === ticker && deepDataRequest.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        {activeSection === 'news' && (
          <button type="button" onClick={() => setNewsRefreshRequest((value) => value + 1)}
            class="min-h-11 rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 hover:border-cyan-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
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
              class={`insight-tab min-h-11 whitespace-nowrap rounded px-3 py-1.5 text-[10px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${selected
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
        {error && currentStockData && (
          <div role="alert" class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-900/60 bg-amber-950/20 px-2.5 py-2 text-[10px] text-amber-300">
            <span>Refresh failed; showing previously loaded market data. {error}</span>
            <button
              type="button"
              onClick={() => setDeepDataRefreshRequest((value) => value + 1)}
              class="min-h-11 rounded border border-amber-800/70 px-2.5 py-1 font-semibold text-amber-100 transition hover:bg-amber-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
              aria-label="Retry market data refresh"
            >
              Retry
            </button>
          </div>
        )}
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
            class="min-h-11 rounded border border-slate-700 px-2.5 py-1 text-[10px] font-semibold text-cyan-300 hover:border-cyan-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
            aria-label="Refresh Stocktwits messages">
            {currentStocktwitsLoading ? 'Refreshing…' : stocktwitsRequested ? 'Refresh' : 'Load'}
          </button>
          {currentStocktwitsData?.streamUrl && (
            <a href={currentStocktwitsData.streamUrl} target="_blank" rel="noopener noreferrer"
              class="inline-flex min-h-11 items-center text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
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

      {currentSelectedNews && createPortal(
        <ModalFrame
          backdropClassName="news-article-modal fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-950/80 backdrop-blur-sm"
          dialogClassName="news-article-dialog flex w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
          dialogRef={newsDialogRef}
          ariaLabelledBy="newsArticleModalTitle"
          closeRef={newsCloseRef}
          onClose={dismissNewsDialog}
        >
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 p-4 sm:p-5">
              <div class="min-w-0">
                <p class="mb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                  {currentSelectedNews.source || 'Company news'} · {formatNewsRelativeTime(currentSelectedNews.datetime)}
                </p>
                <h2 id="newsArticleModalTitle" class="text-base font-bold leading-snug text-slate-100 sm:text-lg">
                  {currentSelectedNews.headline || 'Untitled article'}
                </h2>
              </div>
              <button ref={newsCloseButtonRef} type="button" class="shrink-0 flex min-h-11 min-w-11 items-center justify-center rounded border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-cyan-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400" style={{ minHeight: '44px', minWidth: '44px' }} onClick={requestCloseNewsDialog} aria-label="Close news article" data-news-dialog-close>✕</button>
            </header>
            <div class="news-article-content min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5" role="region" aria-labelledby="newsArticleModalTitle" tabIndex={0}>
              <div class="whitespace-pre-wrap break-words leading-relaxed text-slate-300">
                {currentSelectedNews.summary || currentSelectedNews.description || currentSelectedNews.content || 'A summary is not available from the news provider. Open the original article for the full story.'}
              </div>
              {currentSelectedNews.url && <a href={currentSelectedNews.url} target="_blank" rel="noopener noreferrer" class="inline-flex min-h-11 items-center gap-2 rounded border border-cyan-800/80 bg-cyan-950/40 px-3 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">Read full article ↗</a>}
            </div>
          </ModalFrame>,
        document.body
      )}
    </>
  );
}

export const MarketInsightsPanel = memo(MarketInsightsPanelView);
