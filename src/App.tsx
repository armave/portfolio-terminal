import { emitUiEvent, addUiEventListener, removeUiEventListener, type UiEvent } from './ui/uiEventBus';
import { useBreakevenText, useCloudStatus, useCloudSyncStatus, useAnalystConsensus, useBoardTitle } from './ui/uiStateStore';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { AuthModal } from './components/AuthModal';
import { ClosedHistoryDesk } from './components/ClosedHistoryDesk';
import { GuestTrancheHistory } from './components/GuestTrancheHistory';
import { DeskLoading } from './components/DeskLoading';
import { CashCushionDesk } from './components/CashCushionDesk';
import { SettingsDesk } from './components/SettingsDesk';
import { TickerTabs } from './components/TickerTab';
import { SummaryMetricsGrid } from './components/SummaryMetricsGrid';
import { ProjectionsTable } from './components/ProjectionsTable';
import { MarketInsightsPanel } from './components/MarketInsightsPanel';
import { MarketDepthButton } from './components/MarketDepthButton';
import { TableScrollRegion } from './components/TableScrollRegion';
import { TradingConsole } from './components/TradingConsole';
import { BoardExternalLinks } from './components/BoardExternalLinks';
import { EmptyStatePanel } from './components/EmptyStatePanel';
import { ScenarioComparisonModal } from './components/ScenarioComparisonModal';
import { MarginIntelligenceModal, type MarginIntelligenceState, type MarginIntelligenceArticle } from './components/MarginIntelligenceModal';
import type { ScenarioModalData } from './features/terminal/scenarioContracts';
import { ensureFreedomTradeNetSession, fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, fetchFreedomTradeNetActiveOrders, normalizeFreedomPortfolio, normalizeFreedomTrades, normalizeFreedomActiveOrders, fetchMarketNews, proxyFetch, loadSyncedMarginDigest, saveSyncedMarginDigest, type AuthUser, type MarketNewsItem } from './services/api';
import { portfolioStore, usePortfolio, usePortfolioSelector } from './store/portfolioStore';
import { getAccountPermissions } from './domain/accountPermissions';
import { resolveActiveView } from './ui/renderBoard';
import { ScenarioReportModal } from './components/ScenarioReportModal';
import { dismissScenarioReport, useErrorToasts, useScenarioReport } from './ui/notificationStore';
import {
  hasFreedomTradeHistoryBaseline,
  loadSavedHistory,
  markFreedomTradeHistoryBaseline,
  restoreGatewaySecret
} from './services/storage';
import { mergeBrokerExecutionHistory, preservePersistedBrokerFeeAllocations } from './domain/closedHistoryFees';
import { getLatestClosedTradeDate } from './domain/tradeHistorySync';
import { setAppLanguage, subscribeAppLanguage } from './services/i18n';
import { addBrokerEventListener, emitBrokerEvent } from './services/brokerEventBus';
import { refreshActiveOrders } from './services/activeOrdersRefresh';
import { createLatestRequestGuard } from './utils/requestGeneration';
import { getMatchingMarginIntelligenceState } from './features/ai/marginIntelligenceState';
import { createSessionIdentityGuard, getSessionIdentityRequestKey, type SessionIdentityToken } from './utils/sessionIdentityGuard';

// In-flight broker reads are isolated by authenticated session generation.
const tradesRequests = new Map<string, Promise<void>>();
const accountRequests = new Map<string, Promise<void>>();
const activeOrdersRequests = new Map<string, Promise<void>>();

interface AppProps {
  onSaveGatewaySecret: (secret: string) => Promise<boolean>;
}

export function App({ onSaveGatewaySecret }: AppProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [, setLanguageRevision] = useState(0);
  const permissions = getAccountPermissions(currentUser?.role);
  const backupImportInputRef = useRef<HTMLInputElement>(null);
  const mainWorkspaceRef = useRef<HTMLElement>(null);
  const previousCurrentUserRef = useRef<AuthUser | null>(null);
  const brokerSessionIdentityRef = useRef(createSessionIdentityGuard(null));
  brokerSessionIdentityRef.current.setIdentity(currentUser ? `${currentUser.role}:${currentUser.id}` : null);
  const closedHistorySession = brokerSessionIdentityRef.current.capture();
  const isClosedHistorySessionCurrent = () =>
    closedHistorySession !== null && brokerSessionIdentityRef.current.isCurrent(closedHistorySession);
  const activeDeskView = usePortfolioSelector(resolveActiveView);
  const portfolioSnapshot = usePortfolio();
  const emptyStateVisible = Object.keys(portfolioSnapshot.positions || {}).length === 0 && activeDeskView === 'COMBINED';
  const [hasOpenedClosedHistory, setHasOpenedClosedHistory] = useState(false);
  const [hasOpenedGuestHistory, setHasOpenedGuestHistory] = useState(false);
  const [hasOpenedCashCushion, setHasOpenedCashCushion] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const [deskLoadingView, setDeskLoadingView] = useState<string | null>(null);
  const handleDeskLoadingChange = useCallback((view: string, isLoading: boolean) => {
    setDeskLoadingView((current) => isLoading ? view : current === view ? null : current);
  }, []);





  const { title: boardTitle, showDailyMove } = useBoardTitle();
  const breakevenText = useBreakevenText();
  const analystConsensus = useAnalystConsensus();
  const cloudStatus = useCloudStatus();
  const cloudSyncStatus = useCloudSyncStatus();
  const scenarioReport = useScenarioReport();
  const errorToasts = useErrorToasts();
  const [startupState, setStartupState] = useState({ visible: true, failed: false });
  const [scenarioModalData, setScenarioModalData] = useState<ScenarioModalData | null>(null);
  const [marginIntelligence, setMarginIntelligence] = useState<MarginIntelligenceState | null>(null);
  const closeMarginIntelligence = useCallback(() => setMarginIntelligence(null), []);
  const closeScenarioModal = useCallback(() => setScenarioModalData(null), []);

  useEffect(() => {
    if (!permissions.canViewMarginDesk) {
      setMarginIntelligence(null);
      return;
    }
    const requestGuard = createLatestRequestGuard();
    const handleMarginIntelligence = async (event: UiEvent<{ ticker?: string; refresh?: boolean }>) => {
      if (!permissions.canViewMarginDesk) return;
      // Every request supersedes older work, including a ticker that fails validation.
      const requestId = requestGuard.begin();
      const detail = event.detail;
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

      const isPortfolio = !requestedTicker;
      const scope: 'portfolio' | 'position' = isPortfolio ? 'portfolio' : 'position';
      const requestIdentity = { scope, ...(requestedTicker ? { ticker: requestedTicker } : {}) };
      const title = isPortfolio ? 'Portfolio-wide Margin Review' : requestedTicker + ' · Position Review';
      const digestKey = isPortfolio ? 'portfolio' : 'position:' + requestedTicker;
      setMarginIntelligence((current) => {
        const previous = getMatchingMarginIntelligenceState(current, requestIdentity);
        return {
          title,
          scope,
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          loading: true,
          analysis: previous?.analysis || '',
          articles: previous?.articles || [],
          ...(previous?.syncedAt ? { syncedAt: previous.syncedAt } : {}),
          ...(previous?.digestRevision !== undefined ? { digestRevision: previous.digestRevision } : {})
        };
      });

      try {
        const cached = await loadSyncedMarginDigest(digestKey);
        if (!requestGuard.isCurrent(requestId)) return;
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
            return { ticker: position.ticker, items: items.slice(0, 4) };
          } catch {
            return { ticker: position.ticker, items: [] as MarketNewsItem[] };
          }
        }));
        const articles: MarginIntelligenceArticle[] = newsByTicker.flatMap(({ ticker, items }) =>
          items.map((item) => ({
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
        if (!requestGuard.isCurrent(requestId)) return;
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
        if (!requestGuard.isCurrent(requestId)) return;
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
        if (!requestGuard.isCurrent(requestId)) return;
        const message = error instanceof Error ? error.message : 'Could not load or save the synced Gemini margin review.';
        setMarginIntelligence((current) => {
          const previous = getMatchingMarginIntelligenceState(current, requestIdentity);
          return {
            title,
            scope,
            ...(requestedTicker ? { ticker: requestedTicker } : {}),
            loading: false,
            analysis: previous?.analysis || '',
            articles: previous?.articles || [],
            ...(previous?.syncedAt ? { syncedAt: previous.syncedAt } : {}),
            ...(previous?.digestRevision !== undefined ? { digestRevision: previous.digestRevision } : {}),
            error: message
          };
        });
      }
    };
    addUiEventListener('terminal:margin-intelligence-request', handleMarginIntelligence);
    return () => {
      requestGuard.invalidate();
      removeUiEventListener('terminal:margin-intelligence-request', handleMarginIntelligence);
    };
  }, [permissions.canViewMarginDesk]);

  // Register shell event listeners synchronously after mount. Startup dispatches
  // auth/loading events immediately after render; passive effects can miss them.
  useLayoutEffect(() => {
    const handleAuthVisibility = (event: UiEvent<{ isOpen: boolean }>) => {
      setAuthOpen(event.detail.isOpen);
    };
    const handleScenarioModal = (event: UiEvent<ScenarioModalData>) => setScenarioModalData(event.detail);
    const handleBackupImportRequest = () => {
      if (permissions.canManageBackups) backupImportInputRef.current?.click();
    };
    const handleAuthUserChanged = (event: UiEvent<{ user: AuthUser | null }>) => {
      const user = event.detail.user;
      // Invalidate broker work synchronously, before Preact schedules the state update.
      brokerSessionIdentityRef.current.setIdentity(user ? `${user.role}:${user.id}` : null);
      setCurrentUser(user);
      setAppLanguage(user?.language ?? 'en');
    };
    const unsubscribeLanguage = subscribeAppLanguage(() => {
      setLanguageRevision((revision) => revision + 1);
    });
    const handleScrollWorkspace = () => {
      requestAnimationFrame(() => {
        mainWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    };
    addUiEventListener('terminal:backup-import-request', handleBackupImportRequest);
    addUiEventListener('terminal:scroll-workspace', handleScrollWorkspace);
    addUiEventListener('terminal:scenario-modal', handleScenarioModal);
    addUiEventListener('terminal:auth-visibility', handleAuthVisibility);
    addUiEventListener('auth:user-changed', handleAuthUserChanged);
    const handleStartupState = (event: UiEvent<{ visible: boolean; failed: boolean }>) => setStartupState(event.detail);
    addUiEventListener('terminal:startup-state', handleStartupState);
    return () => {
      removeUiEventListener('terminal:backup-import-request', handleBackupImportRequest);
      removeUiEventListener('terminal:scroll-workspace', handleScrollWorkspace);
      removeUiEventListener('terminal:scenario-modal', handleScenarioModal);
      removeUiEventListener('terminal:auth-visibility', handleAuthVisibility);
      removeUiEventListener('auth:user-changed', handleAuthUserChanged);
      removeUiEventListener('terminal:startup-state', handleStartupState);
      unsubscribeLanguage();
    };
  }, [permissions.canManageBackups]);

  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    let cancelled = false;
    const initializeTradeNetSession = async () => {
      try {
        // Restore the signed-in app session before making the admin-only Worker request.
        const gatewayToken = await restoreGatewaySecret();
        if (!gatewayToken.trim()) return;
        await ensureFreedomTradeNetSession();
      } catch (error) {
        if (!cancelled) {
          console.warn(
            'TradeNet live-data session initialization failed:',
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      }
    };
    void initializeTradeNetSession();
    return () => { cancelled = true; };
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    const previousUser = previousCurrentUserRef.current;
    previousCurrentUserRef.current = currentUser;
    // A guest may use Settings after signing in, but the sign-in transition itself
    // always starts at Balance. Do not repeat this when their language changes.
    if (currentUser?.role === 'guest' &&
      (previousUser?.id !== currentUser.id || previousUser?.role !== 'guest')) {
      emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' });
    }
  }, [currentUser?.id, currentUser?.role]);

  useEffect(() => {
    if (currentUser && activeDeskView === 'GUEST_HISTORY' && !permissions.canViewGuestTrancheHistory) {
      emitUiEvent('portfolio:set-active-view', { view: currentUser?.role === 'admin' ? 'COMBINED' : 'BALANCE' });
      return;
    }
    if (currentUser?.role === 'guest' &&
      !['CASH_CUSHION', 'BALANCE', 'GUEST_HISTORY', 'SETTINGS'].includes(activeDeskView)) {
      emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' });
    }
    if (activeDeskView === 'CLOSED_HISTORY' && permissions.canViewClosedHistory) setHasOpenedClosedHistory(true);
    if (activeDeskView === 'GUEST_HISTORY' && permissions.canViewGuestTrancheHistory) setHasOpenedGuestHistory(true);
    if (activeDeskView === 'CASH_CUSHION' || activeDeskView === 'BALANCE') setHasOpenedCashCushion(true);
    if (activeDeskView === 'SETTINGS') setHasOpenedSettings(true);
  }, [activeDeskView, currentUser?.role, permissions.canViewClosedHistory, permissions.canViewGuestTrancheHistory]);

  // Broker execution history is account-wide administrator data. A session change
  // rebinds the listener and starts a fresh request for that account identity.
  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    const session = brokerSessionIdentityRef.current.capture();
    if (!session) return;
    const removeRequestListener = addBrokerEventListener('broker:request-executed-trades', () => {
      void loadExecutedTrades(session);
    });
    const removeAwaitableRequestListener = addBrokerEventListener('broker:request-executed-trades-and-wait', (request) => {
      void loadExecutedTrades(session).finally(request.resolve);
    });
    void loadExecutedTrades(session);
    return () => {
      removeRequestListener();
      removeAwaitableRequestListener();
    };
  }, [currentUser?.id, currentUser?.role]);

  const loadFreedomAccount = async (session: SessionIdentityToken): Promise<void> => {
    if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = accountRequests.get(requestKey);
    if (existing) return existing;

    emitBrokerEvent('broker:account-info-refreshing');
    const request = (async () => {
      const secret = await restoreGatewaySecret();
      if (!secret.trim()) throw new Error('Gateway Secret is not available.');
      if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
      const response = await fetchFreedomTradeNetPositions();
      if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
      const snapshot = normalizeFreedomPortfolio(response);
      if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
      emitBrokerEvent('broker:account-info', snapshot);
    })();
    accountRequests.set(requestKey, request);
    try {
      await request;
    } finally {
      if (accountRequests.get(requestKey) === request) accountRequests.delete(requestKey);
    }
  };

  const loadExecutedTrades = async (session: SessionIdentityToken): Promise<void> => {
    if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
    const requestKey = getSessionIdentityRequestKey(session);
    const existing = tradesRequests.get(requestKey);
    if (existing) return existing;

    const request = (async () => {
      try {
        // The saved Gateway Secret is encrypted and restored asynchronously from IndexedDB.
        // Never issue the startup request until restoration has completed.
        const secret = await restoreGatewaySecret();
        if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
        if (!secret.trim()) {
          emitBrokerEvent('broker:executed-trades-error');
          return;
        }
        const accountId = currentUser?.id || '';
        const savedExecutions = normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades);
        const currentPortfolio = portfolioStore.getState();
        // Pre-incremental caches have no completeness marker. Perform one full
        // background baseline before trusting their latest date as an incremental
        // cursor; otherwise a one-row cache could permanently hide older sales.
        const hasCompleteBaseline = hasFreedomTradeHistoryBaseline(accountId);
        const fromDate = hasCompleteBaseline
          ? getLatestClosedTradeDate(
            [...savedExecutions, ...(currentPortfolio.brokerExecutedTrades || [])],
            currentPortfolio.closedTrades || []
          )
          : undefined;
        const response = await fetchFreedomTradeNetTrades(fromDate);
        if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
        const normalizedPage = normalizeFreedomTrades(response);
        if (!brokerSessionIdentityRef.current.isCurrent(session)) return;

        // Merge the returned range into every local source before publishing it.
        // A bounded response is never an authoritative replacement for history.
        const latestPortfolio = portfolioStore.getState();
        const latestSavedExecutions = normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades);
        const retainedExecutions = [
          ...latestSavedExecutions,
          ...(latestPortfolio.brokerExecutedTrades || [])
        ];
        const normalizedPageWithFees = preservePersistedBrokerFeeAllocations(
          normalizedPage,
          retainedExecutions
        );
        const mergedTrades = mergeBrokerExecutionHistory(retainedExecutions, normalizedPageWithFees);
        portfolioStore.setState({ brokerExecutedTrades: mergedTrades });

        if (!hasCompleteBaseline) {
          const persistedCount = loadSavedHistory().brokerExecutedTrades.length;
          if (mergedTrades.length === 0 || persistedCount >= mergedTrades.length) {
            markFreedomTradeHistoryBaseline(accountId);
          }
        }

        if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
        // Keep broker executions separate from app-owned ClosedTrade records.
        // ClosedHistoryDesk subscribes to this event and renders the merged cache.
        emitBrokerEvent('broker:executed-trades', mergedTrades);
      } catch (error) {
        if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
        console.error('Unable to load TradeNet executed trades:', error);
        emitBrokerEvent('broker:executed-trades-error');
      }
    })();
    tradesRequests.set(requestKey, request);
    try {
      await request;
    } finally {
      if (tradesRequests.get(requestKey) === request) tradesRequests.delete(requestKey);
    }
  };

  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    const session = brokerSessionIdentityRef.current.capture();
    if (!session) return;
    const loadActiveOrders = async (): Promise<void> => {
      if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
      const requestKey = getSessionIdentityRequestKey(session);
      const existing = activeOrdersRequests.get(requestKey);
      if (existing) return existing;

      const request = refreshActiveOrders({
        restoreGatewaySecret,
        isCurrent: () => brokerSessionIdentityRef.current.isCurrent(session),
        fetchActiveOrders: fetchFreedomTradeNetActiveOrders,
        normalizeActiveOrders: normalizeFreedomActiveOrders,
        onSuccess: (orders) => {
          if (brokerSessionIdentityRef.current.isCurrent(session)) {
            emitBrokerEvent('broker:active-orders', orders);
          }
        },
        onError: () => {
          if (brokerSessionIdentityRef.current.isCurrent(session)) {
            emitBrokerEvent('broker:active-orders-error');
          }
        },
        logError: (error) => {
          if (brokerSessionIdentityRef.current.isCurrent(session)) {
            console.error('Unable to load active TradeNet orders:', error);
          }
        }
      });
      activeOrdersRequests.set(requestKey, request);
      try {
        await request;
      } finally {
        if (activeOrdersRequests.get(requestKey) === request) activeOrdersRequests.delete(requestKey);
      }
    };
    const removeRequestListener = addBrokerEventListener('broker:request-active-orders', () => {
      void loadActiveOrders();
    });
    // Refresh for each authenticated administrator identity, not just at mount.
    void loadActiveOrders();
    return removeRequestListener;
  }, [currentUser?.id, currentUser?.role]);

  // Broker-wide balances and positions are administrator data. Guests refresh
  // assigned symbols and assignment state through the scoped quote/cloud flows.
  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    const session = brokerSessionIdentityRef.current.capture();
    if (!session) return;
    const refreshAccountInfo = () => {
      void loadFreedomAccount(session).catch(() => {
        // Ignore completion from a prior identity; it must not mark the next
        // account's broker snapshot stale or display an unrelated error.
        if (!brokerSessionIdentityRef.current.isCurrent(session)) return;
        emitBrokerEvent('broker:account-info-error');
      });
    };
    const removeRequestListener = addBrokerEventListener('broker:request-account-info', refreshAccountInfo);
    refreshAccountInfo();
    return removeRequestListener;
  }, [currentUser?.id, currentUser?.role]);



  return (
    <>
      {/* Active Position Header Panel */}
      <main
        ref={mainWorkspaceRef}
        id="mainTerminalView"
        aria-label="Portfolio workspace"
        class="border-card p-4 sm:p-6 rounded-xl space-y-2 max-w-6xl mx-auto"
      >
        {/* Asset View Tabs */}
        <div
          id="boardHeaderBanner"
          class="board-header-banner border-b border-slate-800 pb-3"
        >
          <div class="flex flex-wrap items-center gap-2" id="tickerTabs" role="group" aria-label="Workspace navigation"><TickerTabs isAdmin={permissions.isAdmin} userId={currentUser?.role === 'guest' ? currentUser.id : undefined} onDeskLoadingChange={handleDeskLoadingChange} /></div>
          {permissions.isAdmin && <div
            class={"text-sm font-semibold text-emerald-400 font-mono tracking-tight shrink-0 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
            id="daysToBreakeven"
          >
            {breakevenText}
          </div>}
        </div>

        {/* Desk content and terminal share a responsive grid. It creates two columns only when both can fit. */}
        <div id="tradingWorkspaceGrid" class={["BALANCE", "GUEST_HISTORY"].includes(activeDeskView)
          ? ""
          : "trading-workspace-grid " + (permissions.canViewMarginDesk && !["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "margin-workspace-layout " : "") + (emptyStateVisible ? "lg:grid-cols-1" : "lg:grid-cols-[3fr_7fr]")}>
          {/* Main Board Content */}
          {permissions.canViewMarginDesk && <div id="mainDeskContainer" class={"space-y-4 " + (!permissions.canViewMarginDesk || ["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}>
            {deskLoadingView === activeDeskView ? (
              <DeskLoading
                title="Preparing margin desk"
                message="Refreshing live quotes and preparing the latest portfolio view…"
                accent="cyan"
              />
            ) : <div class="desk-content-reveal">

              <div
                id="emptyStatePanel"
                class={"border border-dashed border-slate-700 bg-slate-900/40 rounded-lg p-4 " + (emptyStateVisible ? "" : "hidden")}
              >{emptyStateVisible && <EmptyStatePanel />}</div>

              <div
                id="boardTitleRow"
                class={"board-title-row flex flex-wrap items-center justify-between gap-2 " + (emptyStateVisible ? "hidden" : "")}
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
                {permissions.isAdmin && portfolioSnapshot.positions?.[activeDeskView]?.ticker && (
                  <MarketDepthButton ticker={portfolioSnapshot.positions[activeDeskView].ticker} />
                )}
                <div id="boardAnalystConsensus" class={analystConsensus.className} title={analystConsensus.title}>{analystConsensus.text}</div>
                <div id="boardExternalLinks" class="flex items-center gap-2"><BoardExternalLinks /></div>
              </div>

              <div
                id="portfolioMetricsGrid"
                aria-label="Portfolio summary metrics"
                class={"portfolio-metrics-grid gap-2 text-xs text-slate-300 " + (emptyStateVisible ? "hidden" : "")}
              ><SummaryMetricsGrid /></div>

              <div id="marginDataWorkspace" class="margin-data-workspace">
                {/* Projection Table */}
                <TableScrollRegion
                  label="Portfolio projection by date"
                  id="projectionTableContainer"
                  className={"table-scroll-wrapper overflow-x-auto pt-2 max-w-2xl mx-auto w-full lg:max-w-none " + (emptyStateVisible ? "hidden" : "")}
                >
                  <table aria-label="Portfolio projection by date" class="w-full min-w-[300px] text-xs border-collapse">
                    <caption class="sr-only">Projected portfolio net value, fees and commissions, margin fee, and balance by date.</caption>
                    <thead>
                      <tr class="border-b border-slate-800 text-slate-400">
                        <th scope="col" class="py-2 px-3">Date</th>
                        <th scope="col" class="py-2 px-3">Net</th>
                        <th scope="col" class="py-2 px-3">F&amp;C</th>
                        <th scope="col" class="py-2 px-3">M Fee</th>
                        <th scope="col" class="py-2 px-3">Balance</th>
                      </tr>
                    </thead>
                    <tbody
                      id="projectionTableBody"
                      class="divide-y divide-slate-800/60 font-mono"
                    ><ProjectionsTable /></tbody>
                  </table>
                </TableScrollRegion>
                <section
                  id="marketInsightsPanel"
                  class={"market-insights-workspace space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
                  aria-label="Market insights"
                >{activeDeskView === 'COMBINED' || !['CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'GUEST_HISTORY', 'SETTINGS'].includes(activeDeskView) ? <MarketInsightsPanel /> : null}</section>
              </div>
            </div>}
          </div>}

          {/* Cash Cushion Management Panel */}
          <div id="cashCushionContainer" class={"desk-view-transition space-y-3 " + (["CASH_CUSHION", "BALANCE"].includes(activeDeskView) ? "" : "hidden")}>
            {hasOpenedCashCushion
              ? <div class="desk-content-reveal"><CashCushionDesk showActiveTranches={permissions.canViewActiveTranches} isAdmin={permissions.isAdmin} guestUserId={currentUser?.role === 'guest' ? currentUser.id : undefined} /></div>
              : <DeskLoading title="Preparing balance" message="Loading holdings and account allocations…" accent="cyan" />}
          </div>

          {/* Guest-only assignment history is a standalone destination, separate from Balance. */}
          {permissions.canViewGuestTrancheHistory && <div
            id="guestHistoryContainer"
            class={`desk-view-transition min-w-0 ${activeDeskView === 'GUEST_HISTORY' ? '' : 'hidden'}`}
          >
            {hasOpenedGuestHistory
              ? <div class="desk-content-reveal"><GuestTrancheHistory
                records={portfolioSnapshot.guestTrancheLedger || []}
                activeTranches={portfolioSnapshot.guestPortfolioSnapshot?.tranches || []}
              /></div>
              : <DeskLoading title="Preparing lots" message="Loading your assigned tranche history…" accent="purple" />}
          </div>}

          {/* Keep the command console available on both Margin and Cash desks. */}
          {permissions.canUseTerminal && !["BALANCE", "GUEST_HISTORY"].includes(activeDeskView) && <div id="tradingTerminalColumn" class="trading-terminal-column">
            <div
              id="tradingConsoleCard"
              key={`trading-console-${activeDeskView}`}
              class={"desk-view-transition trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 w-full " + (["CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
            ><TradingConsole /></div>
          </div>}

        </div>
      </main>

      {/* Trades */}
      <div
        id="closedHistoryContainer"

        class={"desk-view-transition rounded-lg " + (permissions.canViewClosedHistory && activeDeskView === "CLOSED_HISTORY" ? "" : "hidden")}
      >
        {permissions.canViewClosedHistory && (hasOpenedClosedHistory
          ? <div class="desk-content-reveal"><ClosedHistoryDesk
              key={`closed-history-${closedHistorySession?.identity ?? 'none'}-${closedHistorySession?.generation ?? -1}`}
              accountId={currentUser?.id || ''}
              isSessionCurrent={isClosedHistorySessionCurrent}
            /></div>
          : <DeskLoading title="Preparing trades" message="Restoring saved trades and broker activity…" accent="purple" />)}
      </div>

      {/* Settings */}
      <div class={"p-4 sm:p-6 rounded-xl space-y-4 " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings">
        {hasOpenedSettings
          ? <div class="desk-content-reveal"><SettingsDesk currentUser={currentUser} /></div>
          : <DeskLoading title="Preparing settings" message="Loading account access and preferences…" accent="blue" />}
      </div>

      {/* Authentication is part of the application tree, not a second Preact root. */}
      <div id="auth-container" class={"auth-overlay " + (authOpen ? "auth-overlay-open" : "")}>
        <AuthModal isOpen={authOpen} onSaveSecret={onSaveGatewaySecret} />
      </div>
      {scenarioModalData && <ScenarioComparisonModal data={scenarioModalData} onClose={closeScenarioModal} />}
      {scenarioReport !== null && <ScenarioReportModal key={scenarioReport} report={scenarioReport} onClose={dismissScenarioReport} />}
      {permissions.canViewMarginDesk && marginIntelligence && <MarginIntelligenceModal data={marginIntelligence} onClose={closeMarginIntelligence} onRefresh={() => emitUiEvent('terminal:margin-intelligence-request', { ticker: marginIntelligence.ticker, refresh: true })} />}
      <div id="toastContainer" class="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2" aria-live="assertive">
        {errorToasts.map((toast) => <div key={toast.id} role="alert" class={'pointer-events-auto rounded-lg border border-rose-800 bg-slate-900/95 px-3.5 py-2 text-xs font-mono font-semibold text-rose-200 shadow-lg backdrop-blur transition-all ' + (toast.isClosing ? 'opacity-0 translate-x-2' : '')}>{toast.message}</div>)}
      </div>
      {permissions.canViewKvStatus && <div id="cloudStatus" class="flex items-center gap-2 text-[10px] font-mono text-slate-400" aria-live="polite">
        <span class={`w-1.5 h-1.5 rounded-full ${cloudStatus.status === 'syncing' ? 'bg-amber-400 animate-pulse' : cloudStatus.status === 'synced' ? 'bg-emerald-400' : cloudStatus.status === 'error' ? 'bg-rose-400' : 'bg-slate-500'}`} />
        <span>KV: {cloudStatus.text.toUpperCase()}</span>
        {cloudSyncStatus.text && <span class={`ml-2 ${cloudSyncStatus.status === 'synced' ? 'text-emerald-400' : 'text-rose-400'}`}>{cloudSyncStatus.text}</span>}
      </div>}
      {permissions.canManageBackups && <input
        ref={backupImportInputRef}
        type="file"
        id="importFileInput"
        class="hidden"
        accept=".json"
        onChange={(event: Event) => {
          const input = event.currentTarget as HTMLInputElement;
          const file = input.files?.[0];
          input.value = '';
          if (file && permissions.canManageBackups) emitUiEvent('terminal:backup-import-file', { file });
        }}
      />}
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