import { emitUiEvent, addUiEventListener, removeUiEventListener } from './ui/uiEventBus';
import { useBreakevenText } from './ui/uiStateStore';
import { useCallback, useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { AuthModal } from './components/AuthModal';
import { ClosedHistoryDesk } from './components/ClosedHistoryDesk';
import { CashCushionDesk, type CashCushionDeskProps } from './components/CashCushionDesk';
import { SettingsDesk, type SettingsDeskProps } from './components/SettingsDesk';
import { TickerTabs, type TickerTabsProps } from './components/TickerTab';
import { SummaryMetricsGrid, type SummaryMetricsGridProps } from './components/SummaryMetricsGrid';
import { ProjectionsTable, type ProjectionsTableProps } from './components/ProjectionsTable';
import { MarketInsightsPanel, type MarketInsightsPanelProps } from './components/MarketInsightsPanel';
import { TradingConsole, type TradingConsoleProps } from './components/TradingConsole';
import { BoardExternalLinks, type BoardExternalLinksProps } from './components/BoardExternalLinks';
import { EmptyStatePanel, type EmptyStatePanelProps } from './components/EmptyStatePanel';
import { ScenarioComparisonModal } from './components/ScenarioComparisonModal';
import { MarginIntelligenceModal, type MarginIntelligenceState, type MarginIntelligenceArticle } from './components/MarginIntelligenceModal';
import type { ScenarioModalData } from './features/terminal/commandDispatcher';
import { fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, fetchFreedomTradeNetActiveOrders, normalizeFreedomPortfolio, normalizeFreedomTrades, normalizeFreedomActiveOrders, fetchMarketNews, proxyFetch, loadSyncedMarginDigest, saveSyncedMarginDigest } from './services/api';
import { portfolioStore } from './store/portfolioStore';
import { restoreGatewaySecret } from './services/storage';

let tradesRequest: Promise<void> | null = null;
let accountRequest: Promise<void> | null = null;
let activeOrdersRequest: Promise<void> | null = null;

interface AppProps {
  onSaveGatewaySecret: (secret: string) => Promise<boolean>;
}

export function App({ onSaveGatewaySecret }: AppProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [activeDeskView, setActiveDeskView] = useState('COMBINED');
  const [hasOpenedClosedHistory, setHasOpenedClosedHistory] = useState(false);
  const [hasOpenedCashCushion, setHasOpenedCashCushion] = useState(false);
  const [cashCushionProps, setCashCushionProps] = useState<CashCushionDeskProps>({});
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const [settingsProps, setSettingsProps] = useState<SettingsDeskProps | null>(null);
  const [tickerTabsProps, setTickerTabsProps] = useState<TickerTabsProps | null>(null);
  const [summaryMetricsProps, setSummaryMetricsProps] = useState<SummaryMetricsGridProps | null>(null);
  const [projectionsProps, setProjectionsProps] = useState<ProjectionsTableProps | null>(null);
  const [marketInsightsProps, setMarketInsightsProps] = useState<MarketInsightsPanelProps | null>(null);
  const [tradingConsoleProps, setTradingConsoleProps] = useState<TradingConsoleProps | null>(null);
  const [externalLinksProps, setExternalLinksProps] = useState<BoardExternalLinksProps | null>(null);
  const [emptyStateProps, setEmptyStateProps] = useState<EmptyStatePanelProps | null>(null);
  const [boardTitle, setBoardTitle] = useState('COMBINED PORTFOLIO');
  const [showDailyMove, setShowDailyMove] = useState(false);
  const breakevenText = useBreakevenText();
  const [analystConsensus, setAnalystConsensus] = useState({ text: '', title: '', className: 'hidden' });
  const [cloudStatus, setCloudStatusState] = useState({ status: 'idle', text: 'OFFLINE' });
  const [cloudSyncStatus, setCloudSyncStatus] = useState({ status: 'idle', text: '' });
  const [startupState, setStartupState] = useState({ visible: true, failed: false });
  const [scenarioModalData, setScenarioModalData] = useState<ScenarioModalData | null>(null);
  const [marginIntelligence, setMarginIntelligence] = useState<MarginIntelligenceState | null>(null);
  const closeMarginIntelligence = useCallback(() => setMarginIntelligence(null), []);
  const closeScenarioModal = useCallback(() => setScenarioModalData(null), []);

  useEffect(() => {
    let requestGeneration = 0;
    const handleMarginIntelligence = async (event: Event) => {
      const detail = (event as CustomEvent<{ ticker?: string; refresh?: boolean }>).detail;
      const requestedTicker = String(detail?.ticker || '').trim().toUpperCase();
      const snapshot = portfolioStore.getState();
      const allPositions = Object.values(snapshot.positions || {}).filter((position: any) =>
        position && Number(position.shares) > 0
      ) as Array<{ ticker: string; shares: number; currentPrice: number; pt: number; commBuy?: number; startDate?: string; tranches?: Array<{ qty: number; price: number; date?: string; buyCommission?: number }>; quoteUpdatedAt?: number; quoteSource?: string; quoteDetails?: Record<string, unknown> }>;
      const focusPosition = requestedTicker
        ? allPositions.find((position) => String(position.ticker).toUpperCase() === requestedTicker)
        : null;

      if (requestedTicker && !focusPosition) {
        setMarginIntelligence({
          title: requestedTicker + ' · Position Review',
          scope: 'position',
          ticker: requestedTicker,
          loading: false,
          analysis: '',
          articles: [],
          error: 'No active margin position was found for ' + requestedTicker + '. Select an active margin ticker and try again.'
        });
        return;
      }

      const requestId = ++requestGeneration;
      const isPortfolio = !requestedTicker;
      const title = isPortfolio ? 'Portfolio-wide Margin Review' : requestedTicker + ' · Position Review';
      const digestKey = isPortfolio ? 'portfolio' : 'position:' + requestedTicker;
      setMarginIntelligence((current) => ({
        title,
        scope: isPortfolio ? 'portfolio' : 'position',
        ...(requestedTicker ? { ticker: requestedTicker } : {}),
        loading: true,
        analysis: current?.analysis || '',
        articles: current?.articles || [],
        ...(current?.syncedAt ? { syncedAt: current.syncedAt } : {})
      }));

      try {
        const cached = await loadSyncedMarginDigest(digestKey);
        if (requestId !== requestGeneration) return;
        if (cached && !detail?.refresh) {
          setMarginIntelligence({
            title: cached.digest.title || title,
            scope: cached.digest.scope,
            ...(cached.digest.ticker ? { ticker: cached.digest.ticker } : {}),
            loading: false,
            analysis: cached.digest.analysis,
            articles: cached.digest.articles,
            syncedAt: cached.digest.syncedAt,
            digestRevision: cached.revision
          });
          return;
        }
        if (cached) {
          setMarginIntelligence({
            title: cached.digest.title || title,
            scope: cached.digest.scope,
            ...(cached.digest.ticker ? { ticker: cached.digest.ticker } : {}),
            loading: true,
            analysis: cached.digest.analysis,
            articles: cached.digest.articles,
            syncedAt: cached.digest.syncedAt,
            digestRevision: cached.revision
          });
        }
        // Explicit refresh fetches fresh news and regenerates the analysis.
        // Initial open only reaches this point when no synced digest exists.
        // Single-position reviews fetch news for the selected ticker; portfolio
        // reviews fetch news for each active margin position. The full portfolio
        // snapshot is included in both cases so Gemini can reason about concentration.
        const newsPositions = isPortfolio ? allPositions : focusPosition ? [focusPosition] : [];
        const newsByTicker = await Promise.all(newsPositions.map(async (position) => {
          try {
            const items = await fetchMarketNews(position.ticker, true);
            return { ticker: position.ticker, items: Array.isArray(items) ? items.slice(0, 4) : [] };
          } catch {
            return { ticker: position.ticker, items: [] as any[] };
          }
        }));
        const articles: MarginIntelligenceArticle[] = newsByTicker.flatMap(({ ticker, items }) =>
          items.map((item: any) => ({
            ticker,
            headline: String(item?.headline || item?.title || 'Untitled news item'),
            source: String(item?.source || item?.publisher || ''),
            url: String(item?.url || item?.link || ''),
            publishedAt: Number(item?.datetime || item?.publishedAt || 0) || undefined,
            summary: String(item?.summary || item?.description || '').slice(0, 280)
          }))
        ).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).slice(0, isPortfolio ? 5 : 3);

        const brokerPositions = snapshot.brokerAccountInfo?.positions || [];
        const summarizePosition = (position: typeof allPositions[number]) => {
          const tranches = (position.tranches || []).filter((tranche) =>
            Number.isFinite(Number(tranche.qty)) && Number(tranche.qty) > 0 &&
            Number.isFinite(Number(tranche.price)) && Number(tranche.price) > 0
          );
          const lotShares = tranches.reduce((total, tranche) => total + Number(tranche.qty), 0);
          const entryCost = tranches.reduce((total, tranche) => total + Number(tranche.qty) * Number(tranche.price), 0);
          const averageEntryPrice = lotShares > 0 ? entryCost / lotShares : null;
          const marketPrice = Number.isFinite(Number(position.currentPrice)) && Number(position.currentPrice) > 0
            ? Number(position.currentPrice) : null;
          const appShares = Number(position.shares);
          const brokerPosition = brokerPositions.find((item: any) => String(item.ticker || '').toUpperCase() === String(position.ticker).toUpperCase());
          const brokerShares = brokerPosition ? Number(brokerPosition.quantity) : null;
          const lotSharesMatchPosition = Math.abs(lotShares - appShares) < 0.000001;
          const brokerSharesMatchPosition = brokerShares === null || Math.abs(brokerShares - appShares) < 0.000001;
          const lotBasedPnl = marketPrice !== null && tranches.length > 0
            ? tranches.reduce((total, tranche) => total + (marketPrice - Number(tranche.price)) * Number(tranche.qty), 0)
            : null;
          return {
            ticker: position.ticker,
            appTrackedShares: appShares,
            brokerReportedShares: brokerShares,
            entryLotShares: lotShares,
            quantityReconciliation: {
              appSharesMatchEntryLots: lotSharesMatchPosition,
              appSharesMatchBroker: brokerSharesMatchPosition,
              status: !lotSharesMatchPosition || !brokerSharesMatchPosition ? 'discrepancy' : brokerShares === null ? 'broker quantity unavailable' : 'matched'
            },
            marketPrice,
            quoteSource: position.quoteSource || null,
            quoteUpdatedAt: position.quoteUpdatedAt || null,
            quoteFreshness: position.quoteDetails?.freshness || 'unknown',
            quoteSourceTimestamp: position.quoteDetails?.sourceTimestamp || null,
            targetOrActiveSellLimit: Number.isFinite(Number(position.pt)) && Number(position.pt) > 0 ? Number(position.pt) : null,
            marketValue: marketPrice === null ? null : appShares * marketPrice,
            entryLots: tranches.slice(-8).map((tranche) => ({
              shares: Number(tranche.qty),
              entryPrice: Number(tranche.price),
              purchaseDate: tranche.date || null,
              buyCommission: Number(tranche.buyCommission || 0)
            })),
            averageEntryPrice,
            unrealizedGrossPnl: lotBasedPnl,
            unrealizedGrossPnlBasis: lotBasedPnl === null ? 'unavailable: valid entry lots or market price missing' : 'sum of open-lot P&L; excludes commissions, fees, and interest',
            holdingStartDate: position.startDate || null,
            recordedBuyCommission: Number(position.commBuy || 0)
          };
        };
        const summarizeBalance = (value: unknown) => {
          if (value === null || value === undefined || value === '') return null;
          const numeric = Number(value);
          return Number.isFinite(numeric) ? numeric : null;
        };
        const portfolioContext = {
          asOf: new Date().toISOString(),
          focusTicker: requestedTicker || null,
          account: {
            brokerSnapshotStatus: snapshot.brokerAccountInfo?.status || (snapshot.brokerAccountInfo?.loaded ? 'loaded' : 'not-loaded'),
            brokerSnapshotReceivedAt: snapshot.brokerAccountInfo?.receivedAt || null,
            balance: summarizeBalance(snapshot.balance),
            cashBalance: summarizeBalance(snapshot.cashBalance),
            freeCash: summarizeBalance(snapshot.cashCushion?.freeCash),
            realizedMarginCharged: summarizeBalance(snapshot.realizedMarginCharged),
            brokerAssumptions: snapshot.brokerAssumptions || null
          },
          focusPosition: focusPosition ? summarizePosition(focusPosition) : null,
          otherOpenPositions: allPositions
            .filter((position) => !requestedTicker || String(position.ticker).toUpperCase() !== requestedTicker)
            .map(summarizePosition)
        };
        const prompt = [
          'Act as a cautious, concise margin-position research assistant. Maximum 350 words. No introduction, no generic preface, no repeated disclaimer, no preset/template data.',
          'Output exactly these sections in this order: **Stance** (one sentence plus confidence: low/medium/high); **What matters now** (up to 3 news items and why each matters); **Risks / invalidation** (up to 3 bullets); **Monitor next** (up to 3 concrete items); **Position facts** (brief factual snapshot at the end).',
          'Use only supplied account data and article headlines/summaries. Do not invent prices, dates, events, rates, broker rules, or liquidation thresholds. Clearly label fact versus interpretation. If a key field is missing or stale, state it briefly.',
          'If app-tracked shares, broker-reported shares, and entry-lot shares disagree, put a concise DATA QUALITY WARNING first, list the three quantities and their sources, and do not make a firm size-dependent recommendation. Do not silently choose a quantity.',
          'Use the application-calculated gross P&L as supplied; do not recompute it. It excludes commissions, fees, and interest. Do not suggest a new price target unless the supplied data supports a transparent calculation. Do not submit or modify orders.',
          'Mention a news claim only when supported by a supplied headline/summary. Do not include inline source citations, provider IDs, numeric article IDs, or parentheticals like (Yahoo, 1793156968); source cards below the analysis are the citations. Do not infer earnings timing; call an earnings date unverified unless explicitly provided. No more than 3 key news developments for a ticker and no repeated source list in the prose.',
          'PORTFOLIO DATA:', JSON.stringify(portfolioContext),
          'NEWS (newest first):', JSON.stringify(articles.map((article) => ({
            ticker: article.ticker,
            headline: article.headline.slice(0, 180),
            source: article.source,
            url: article.url,
            publishedAt: article.publishedAt,
            summary: (article.summary || '').slice(0, 220)
          })))
        ].join('\n\n');
        const response = await proxyFetch('gemini', {}, {
          method: 'POST',
          body: JSON.stringify({ prompt, model: 'gemini-3.8-flash' }),
          cache: 'no-store'
        });
        const analysis = response?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => String(part.text || ''))
          .filter(Boolean).join('\n\n');
        if (!analysis) throw new Error(response?.error?.message || response?.error || 'Gemini returned an empty analysis.');
        if (requestId !== requestGeneration) return;
        const syncedAt = new Date().toISOString();
        const digest = {
          key: digestKey,
          title,
          scope: (isPortfolio ? 'portfolio' : 'position') as 'portfolio' | 'position',
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          analysis,
          articles,
          syncedAt
        };
        const nextRevision = await saveSyncedMarginDigest(digest, cached?.revision ?? 0);
        if (requestId !== requestGeneration) return;
        setMarginIntelligence({
          title,
          scope: isPortfolio ? 'portfolio' : 'position',
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          loading: false,
          analysis,
          articles,
          syncedAt,
          digestRevision: nextRevision
        });
      } catch (error) {
        if (requestId !== requestGeneration) return;
        setMarginIntelligence({
          title,
          scope: isPortfolio ? 'portfolio' : 'position',
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          loading: false,
          analysis: '',
          articles: [],
          error: error instanceof Error ? error.message : 'Could not load or save the synced Gemini margin review.'
        });
      }
    };
    addUiEventListener('terminal:margin-intelligence-request', handleMarginIntelligence);
    return () => {
      requestGeneration += 1;
      removeUiEventListener('terminal:margin-intelligence-request', handleMarginIntelligence);
    };
  }, []);

  // Register shell event listeners synchronously after mount. Startup dispatches
  // auth/loading events immediately after render; passive effects can miss them.
  useLayoutEffect(() => {
    const handleAuthVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ isOpen?: boolean }>).detail;
      setAuthOpen(Boolean(detail?.isOpen));
    };
    const handleDeskView = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      if (detail?.view) {
        setActiveDeskView(detail.view);
        if (detail.view === 'CLOSED_HISTORY') setHasOpenedClosedHistory(true);
        if (detail.view === 'CASH_CUSHION' || detail.view === 'BALANCE') setHasOpenedCashCushion(true);
        if (detail.view === 'SETTINGS') setHasOpenedSettings(true);
      }
    };
    const handleScenarioModal = (event: Event) => setScenarioModalData((event as CustomEvent<ScenarioModalData | null>).detail ?? null);
    addUiEventListener('terminal:scenario-modal', handleScenarioModal);
    addUiEventListener('terminal:auth-visibility', handleAuthVisibility);
    const handleCashCushionProps = (event: Event) => {
      const detail = (event as CustomEvent<CashCushionDeskProps>).detail;
      if (detail) setCashCushionProps(detail);
    };
    addUiEventListener('terminal:active-view', handleDeskView);
    const handleSettingsProps = (event: Event) => {
      const detail = (event as CustomEvent<SettingsDeskProps>).detail;
      if (detail) setSettingsProps(detail);
    };
    addUiEventListener('terminal:cash-cushion-props', handleCashCushionProps);
    const handleTickerTabsProps = (event: Event) => {
      const detail = (event as CustomEvent<TickerTabsProps>).detail;
      if (detail) setTickerTabsProps(detail);
    };
    addUiEventListener('terminal:settings-props', handleSettingsProps);
    const handleSummaryMetricsProps = (event: Event) => {
      const detail = (event as CustomEvent<SummaryMetricsGridProps>).detail;
      if (detail) setSummaryMetricsProps(detail);
    };
    const handleProjectionsProps = (event: Event) => {
      const detail = (event as CustomEvent<ProjectionsTableProps>).detail;
      if (detail) setProjectionsProps(detail);
    };
    addUiEventListener('terminal:ticker-tabs-props', handleTickerTabsProps);
    addUiEventListener('terminal:summary-metrics-props', handleSummaryMetricsProps);
    const handleMarketInsightsProps = (event: Event) => {
      const detail = (event as CustomEvent<MarketInsightsPanelProps>).detail;
      if (detail) setMarketInsightsProps(detail);
    };
    addUiEventListener('terminal:projections-props', handleProjectionsProps);
    const handleTradingConsoleProps = (event: Event) => {
      const detail = (event as CustomEvent<TradingConsoleProps>).detail;
      if (detail) setTradingConsoleProps(detail);
    };
    const handleExternalLinksProps = (event: Event) => {
      const detail = (event as CustomEvent<BoardExternalLinksProps>).detail;
      if (detail) setExternalLinksProps(detail);
    };
    const handleEmptyStateProps = (event: Event) => {
      setEmptyStateProps((event as CustomEvent<EmptyStatePanelProps | null>).detail);
    };
    addUiEventListener('terminal:market-insights-props', handleMarketInsightsProps);
    addUiEventListener('terminal:trading-console-props', handleTradingConsoleProps);
    addUiEventListener('terminal:external-links-props', handleExternalLinksProps);
    const handleBoardTitle = (event: Event) => {
      const detail = (event as CustomEvent<{ title: string; showDailyMove: boolean }>).detail;
      if (detail) {
        setBoardTitle(detail.title);
        setShowDailyMove(detail.showDailyMove);
      }
    };
    const handleCloudStatus = (event: Event) => { const detail = (event as CustomEvent<{status:string;text:string}>).detail; if (detail) setCloudStatusState(detail); };
    const handleCloudSyncStatus = (event: Event) => { const detail = (event as CustomEvent<{status:string;text:string}>).detail; if (detail) setCloudSyncStatus(detail); };
    const handleStartupState = (event: Event) => { const detail = (event as CustomEvent<{visible:boolean;failed:boolean}>).detail; if (detail) setStartupState(detail); };
    const handleAnalystConsensus = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; title: string; className: string }>).detail;
      if (detail) setAnalystConsensus(detail);
    };
    addUiEventListener('terminal:empty-state-props', handleEmptyStateProps);
    addUiEventListener('terminal:board-title', handleBoardTitle);
    addUiEventListener('terminal:analyst-consensus', handleAnalystConsensus);
    addUiEventListener('terminal:cloud-status', handleCloudStatus);
    addUiEventListener('terminal:cloud-sync-status', handleCloudSyncStatus);
    addUiEventListener('terminal:startup-state', handleStartupState);
    return () => {
      removeUiEventListener('terminal:scenario-modal', handleScenarioModal);
      removeUiEventListener('terminal:auth-visibility', handleAuthVisibility);
      removeUiEventListener('terminal:active-view', handleDeskView);
      removeUiEventListener('terminal:cash-cushion-props', handleCashCushionProps);
      removeUiEventListener('terminal:settings-props', handleSettingsProps);
      removeUiEventListener('terminal:ticker-tabs-props', handleTickerTabsProps);
      removeUiEventListener('terminal:summary-metrics-props', handleSummaryMetricsProps);
      removeUiEventListener('terminal:projections-props', handleProjectionsProps);
      removeUiEventListener('terminal:market-insights-props', handleMarketInsightsProps);
      removeUiEventListener('terminal:trading-console-props', handleTradingConsoleProps);
      removeUiEventListener('terminal:external-links-props', handleExternalLinksProps);
      removeUiEventListener('terminal:empty-state-props', handleEmptyStateProps);
      removeUiEventListener('terminal:board-title', handleBoardTitle);
      removeUiEventListener('terminal:analyst-consensus', handleAnalystConsensus);
      removeUiEventListener('terminal:cloud-status', handleCloudStatus);
      removeUiEventListener('terminal:cloud-sync-status', handleCloudSyncStatus);
      removeUiEventListener('terminal:startup-state', handleStartupState);
    };
  }, []);

  // Closed History asks for trade history when mounted; do not also fetch from
  // a global navigation click listener, which caused duplicate broker requests.
  useEffect(() => {
    // Load broker executions so margin commissions can use Freedom-reported fees
    // when present; local commission rules remain the fallback.
    void loadExecutedTrades();
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
        // Account snapshots are emitted only after a successful account API
        // request. Re-emitting the cached global here would falsely refresh its
        // timestamp and could mark stale broker data as current.
      }
    } catch (error) {
      console.error('Unable to load TradeNet executed trades:', error);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tradenet:executed-trades-error'));
    } finally {
    }
    })();
    try { await tradesRequest; } finally { tradesRequest = null; }
  };

  useEffect(() => {
    const loadActiveOrders = async () => {
      if (activeOrdersRequest) return activeOrdersRequest;
      activeOrdersRequest = (async () => {
        try {
          // Restore the saved Gateway Secret before querying Freedom on startup.
          const secret = await restoreGatewaySecret();
          if (!secret.trim()) return;
          const response = await fetchFreedomTradeNetActiveOrders();
          const orders = normalizeFreedomActiveOrders(response);
          window.dispatchEvent(new CustomEvent('tradenet:active-orders', { detail: orders }));
        } catch (error) {
          console.error('Unable to load active TradeNet orders:', error);
          window.dispatchEvent(new CustomEvent('tradenet:active-orders-error'));
        }
      })();
      try { await activeOrdersRequest; } finally { activeOrdersRequest = null; }
    };
    const onRequest = () => { void loadActiveOrders(); };
    window.addEventListener('tradenet:request-active-orders', onRequest);
    // The Margin desk requests active orders when it becomes visible.
    return () => window.removeEventListener('tradenet:request-active-orders', onRequest);
  }, []);

  // Load account/balance/position data first on startup. Trade history is fetched
  // only when Closed History opens.
  useEffect(() => {
    void loadFreedomAccount().catch(() => {
      // Keep the saved portfolio intact, but notify the app shell so stale
      // broker data is never mistaken for a successful current snapshot.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tradenet:account-info-error'));
      }
    });
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
          <div class="flex flex-wrap items-center gap-2" id="tickerTabs" role="group" aria-label="Portfolio assets">{tickerTabsProps && <TickerTabs {...tickerTabsProps} />}</div>
          <div
            class={"text-sm font-semibold text-emerald-400 font-mono tracking-tight shrink-0 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
            id="daysToBreakeven"
          >
            {breakevenText}
          </div>
        </div>

        {/* Desk content and terminal share a responsive grid. It creates two columns only when both can fit. */}
        <div id="tradingWorkspaceGrid" class={"trading-workspace-grid " + (emptyStateProps ? "lg:grid-cols-1" : "lg:grid-cols-[3fr_7fr]")}>
          {/* Main Board Content */}
          <div id="mainDeskContainer" class={"space-y-4 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}>
            <div
              id="emptyStatePanel"
              class={"border border-dashed border-slate-700 bg-slate-900/40 rounded-lg p-4 " + (emptyStateProps ? "" : "hidden")}
            >{emptyStateProps && <EmptyStatePanel {...emptyStateProps} />}</div>

            <div
              id="boardTitleRow"
              class={"board-title-row flex flex-wrap items-center justify-between gap-2 " + (emptyStateProps ? "hidden" : "")}
            >
              <div class="min-w-0 flex-1 text-lg font-bold text-white" id="boardTitle">
                {boardTitle}
              </div>
            </div>



            <div
              id="boardTitleActions"
              class="board-title-actions flex flex-wrap items-center gap-2"
            >
              <div id="boardDailyMove" class={showDailyMove ? "" : "hidden"}></div>
              <div id="boardAnalystConsensus" class={analystConsensus.className} title={analystConsensus.title}>{analystConsensus.text}</div>
              <div id="boardExternalLinks" class="flex items-center gap-2">{externalLinksProps && <BoardExternalLinks {...externalLinksProps} />}</div>
            </div>

            <div
              id="portfolioMetricsGrid"
              aria-label="Portfolio summary metrics"
              class={"portfolio-metrics-grid gap-2 text-xs text-slate-300 " + (emptyStateProps ? "hidden" : "")}
            >{summaryMetricsProps && <SummaryMetricsGrid {...summaryMetricsProps} />}</div>

            {/* Projection Table */}
            <div
              class={"table-scroll-wrapper overflow-x-auto pt-2 max-w-2xl mx-auto w-full lg:max-w-none " + (emptyStateProps ? "hidden" : "")}
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
                >{projectionsProps && <ProjectionsTable {...projectionsProps} />}</tbody>
              </table>
            </div>
          </div>

          {/* Cash Cushion Management Panel */}
          <div id="cashCushionContainer" class={"desk-view-transition space-y-3 " + (["CASH_CUSHION", "BALANCE"].includes(activeDeskView) ? "" : "hidden")}>{hasOpenedCashCushion && <CashCushionDesk {...cashCushionProps} />}</div>

          {/* Keep the command console available on both Margin and Cash desks. */}
          <div id="tradingTerminalColumn" class="trading-terminal-column">
            <section
              id="marketInsightsPanel"
              key={`market-insights-${activeDeskView}`}
              class={"market-insights-workspace space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
              aria-label="Market insights"
            >{marketInsightsProps && <MarketInsightsPanel {...marketInsightsProps} />}</section>
            <div
              id="tradingConsoleCard"
              key={`trading-console-${activeDeskView}`}
              class={"desk-view-transition trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 w-full " + (["CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
            >{tradingConsoleProps && <TradingConsole {...tradingConsoleProps} />}</div>
          </div>

        </div>
      </main>

      {/* Closed Trade History */}
      <div
        id="closedHistoryContainer"
       
        class={"desk-view-transition rounded-lg " + (activeDeskView === "CLOSED_HISTORY" ? "" : "hidden")}
      >{hasOpenedClosedHistory && <ClosedHistoryDesk />}</div>

      {/* Settings */}
      <div class={"p-4 sm:p-6 rounded-xl space-y-4 " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings">{hasOpenedSettings && settingsProps && <SettingsDesk {...settingsProps} />}</div>

      {/* Authentication is part of the application tree, not a second Preact root. */}
      <div id="auth-container" class={"auth-overlay " + (authOpen ? "auth-overlay-open" : "")}>
        <AuthModal isOpen={authOpen} onSaveSecret={onSaveGatewaySecret} />
      </div>
      {scenarioModalData && <ScenarioComparisonModal data={scenarioModalData} onClose={closeScenarioModal} />}
      {marginIntelligence && <MarginIntelligenceModal data={marginIntelligence} onClose={closeMarginIntelligence} onRefresh={() => emitUiEvent('terminal:margin-intelligence-request', { ticker: marginIntelligence.ticker, refresh: true })} />}
      <div id="cloudStatus" class="flex items-center gap-2 text-[10px] font-mono text-slate-400" aria-live="polite">
        <span class={`w-1.5 h-1.5 rounded-full ${cloudStatus.status === 'syncing' ? 'bg-amber-400 animate-pulse' : cloudStatus.status === 'synced' ? 'bg-emerald-400' : cloudStatus.status === 'error' ? 'bg-rose-400' : 'bg-slate-500'}`} />
        <span>KV: {cloudStatus.text.toUpperCase()}</span>
        {cloudSyncStatus.text && <span class={`ml-2 ${cloudSyncStatus.status === 'synced' ? 'text-emerald-400' : 'text-rose-400'}`}>{cloudSyncStatus.text}</span>}
      </div>
      {startupState.visible && <div class="startup-loading fixed inset-0 z-[100] flex items-center justify-center" role="status" aria-live="polite">
        <div class="startup-loading__content">
          <div class="startup-loading__mark" aria-hidden="true">PT</div>
          <div class="startup-loading__title">PORTFOLIO TERMINAL</div>
          <div class="startup-loading__message">{startupState.failed ? 'Could not finish initializing the app.' : 'Initializing your portfolio…'}</div>
          {!startupState.failed && <div class="startup-loading__track" aria-hidden="true"><span /></div>}
          <div class="startup-loading__hint">{startupState.failed ? 'Check your connection, then retry or continue offline.' : 'Restoring saved data and market connections'}</div>
          {startupState.failed && <div class="startup-loading__actions">
            <button type="button" onClick={() => emitUiEvent('terminal:startup-retry', undefined)}>Retry</button>
            <button type="button" onClick={() => emitUiEvent('terminal:startup-offline', undefined)}>Continue offline</button>
          </div>}
        </div>
      </div>}
    </>
  );
}