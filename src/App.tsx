import { emitUiEvent, addUiEventListener, removeUiEventListener, type UiEvent } from './ui/uiEventBus';
import { useBreakevenText, useCloudStatus, useCloudSyncStatus, useAnalystConsensus, useBoardTitle } from './ui/uiStateStore';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { lazy, memo, Suspense } from 'preact/compat';
import { AuthModal } from './components/AuthModal';
import { DeskLoading } from './components/DeskLoading';
import { TickerTabs } from './components/TickerTab';
import type { QuoteProvenanceHolding } from './components/QuoteProvenance';
import { MarketStatusBadge } from './components/MarketStatusBadge';
import { CloudSyncIndicator } from './components/CloudSyncIndicator';
import { ProjectionsTable } from './components/ProjectionsTable';
import { TableScrollRegion } from './components/TableScrollRegion';
import { TradingConsole } from './components/TradingConsole';
import { EmptyStatePanel } from './components/EmptyStatePanel';
import type { MarginIntelligenceState } from './components/MarginIntelligenceModal';
import type { MarginNewsFetchResult } from './features/ai/marginIntelligence';
import type { ScenarioModalData } from './features/terminal/scenarioContracts';
import { fetchMarketNews, proxyFetch, loadSyncedMarginDigest, saveSyncedMarginDigest, type AuthUser } from './services/api';
import { PORTFOLIO_PERSISTENCE_ERROR_MESSAGE, portfolioStore, useActiveView, usePortfolioSelector } from './store/portfolioStore';
import { getAccountPermissions } from './domain/accountPermissions';
import { calculatePortfolioValuation, getPortfolioValuationReliability } from './domain/portfolioValuation';
import { addErrorToast, dismissScenarioReport, useErrorToasts, useScenarioReport } from './ui/notificationStore';
import { getAppLanguage, setAppLanguage, subscribeAppLanguage, translateText } from './services/i18n';
import { PORTFOLIO_BACKUP_FILE_EXTENSION } from './services/portfolioBackupFile';
import { getPortfolioPersistenceStatus, subscribePortfolioPersistenceStatus } from './services/storage';
import { getQuoteFreshness, summarizeQuoteFreshness } from './utils/formatters';
import { useQuoteRefreshInterval } from './ui/useQuoteRefreshInterval';
import { emitBrokerEvent } from './services/brokerEventBus';
import { bindPortfolioBrokerRequestRuntime } from './services/portfolioBrokerRequestRuntime';
import { createPortfolioBrokerDataRuntime } from './services/portfolioBrokerDataRuntime';
import { createLatestRequestGuard } from './utils/requestGeneration';
import { getMatchingMarginIntelligenceState } from './features/ai/marginIntelligenceState';
import { createSessionIdentityGuard } from './utils/sessionIdentityGuard';
import {
  buildMarginReviewPrompt,
  fingerprintMarginReviewSnapshot,
  getMarginDigestFreshness,
  MARGIN_REVIEW_PROMPT_VERSION,
  selectMarginReviewNews
} from './features/ai/marginIntelligence';
import { calculateMarginRiskMetrics } from './domain/marginRisk';
import { getCashCushionTotal } from './domain/portfolioSelectors';
import type { BoardState, PositionRecord } from './types/portfolio';


const MemoTickerTabs = memo(TickerTabs);
const MemoSummaryMetricsGrid = lazy(() =>
  import('./components/SummaryMetricsGrid').then(({ SummaryMetricsGrid }) => ({
    default: memo(SummaryMetricsGrid)
  }))
);
const MemoProjectionsTable = memo(ProjectionsTable);
const MemoTradingConsole = memo(TradingConsole);

const ClosedHistoryDesk = lazy(() =>
  import('./components/ClosedHistoryDesk').then(({ ClosedHistoryDesk }) => ({ default: memo(ClosedHistoryDesk) }))
);
const GuestTrancheHistory = lazy(() =>
  import('./components/GuestTrancheHistory').then(({ GuestTrancheHistory }) => ({ default: memo(GuestTrancheHistory) }))
);
const CashCushionDesk = lazy(() =>
  import('./components/CashCushionDesk').then(({ CashCushionDesk }) => ({ default: memo(CashCushionDesk) }))
);
const SettingsDesk = lazy(() =>
  import('./components/SettingsDesk').then(({ SettingsDesk }) => ({ default: memo(SettingsDesk) }))
);
const MarketInsightsPanel = lazy(() =>
  import('./components/MarketInsightsPanel').then(({ MarketInsightsPanel }) => ({ default: memo(MarketInsightsPanel) }))
);
const ScenarioComparisonModal = lazy(() =>
  import('./components/ScenarioComparisonModal').then(({ ScenarioComparisonModal }) => ({ default: ScenarioComparisonModal }))
);
const ScenarioReportModal = lazy(() =>
  import('./components/ScenarioReportModal').then(({ ScenarioReportModal }) => ({ default: ScenarioReportModal }))
);
const MarginIntelligenceModal = lazy(() =>
  import('./components/MarginIntelligenceModal').then(({ MarginIntelligenceModal }) => ({ default: MarginIntelligenceModal }))
);
const MarketDepthModal = lazy(() =>
  import('./components/MarketDepthModal').then(({ MarketDepthModal }) => ({ default: MarketDepthModal }))
);

interface AppProps {
  onSaveGatewaySecret: (secret: string) => Promise<boolean>;
}

function finiteReviewNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMarginReviewContext(
  snapshot: BoardState,
  requestedTicker: string | null,
  now = Date.now(),
  refreshIntervalMs = 60000
) {
  const allPositions = Object.values(snapshot.positions || {}).filter(
    (position): position is PositionRecord => Boolean(position && Number(position.shares) > 0)
  ).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const focusPosition = requestedTicker
    ? allPositions.find(position => position.ticker.toUpperCase() === requestedTicker)
    : null;
  const brokerPositions = snapshot.brokerAccountInfo?.positions || [];
  const summarizePosition = (position: PositionRecord) => {
    const tranches = (position.tranches || []).filter(tranche =>
      Number.isFinite(Number(tranche.qty)) && Number(tranche.qty) > 0 &&
      Number.isFinite(Number(tranche.price)) && Number(tranche.price) > 0
    );
    const lotShares = tranches.reduce((total, tranche) => total + Number(tranche.qty), 0);
    const entryCost = tranches.reduce((total, tranche) => total + Number(tranche.qty) * Number(tranche.price), 0);
    const averageEntryPrice = lotShares > 0 ? entryCost / lotShares : null;
    const observedPrice = finiteReviewNumber(position.currentPrice);
    const marketPrice = observedPrice !== null && observedPrice > 0 ? observedPrice : null;
    const appShares = Number(position.shares);
    const brokerPosition = brokerPositions.find(item => item.ticker.toUpperCase() === position.ticker.toUpperCase());
    const brokerShares = finiteReviewNumber(brokerPosition?.quantity);
    const targetPrice = finiteReviewNumber(position.pt);
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
        status: !lotSharesMatchPosition || !brokerSharesMatchPosition
          ? 'discrepancy'
          : brokerShares === null ? 'broker quantity unavailable' : 'matched'
      },
      marketPrice,
      quoteSource: position.quoteSource || null,
      quoteUpdatedAt: position.quoteUpdatedAt || null,
      quoteFreshness: getQuoteFreshness(position, now, refreshIntervalMs),
      quoteSourceTimestamp: position.quoteDetails?.sourceTimestamp || null,
      targetOrActiveSellLimit: targetPrice !== null && targetPrice > 0 ? targetPrice : null,
      marketValue: marketPrice === null ? null : appShares * marketPrice,
      entryLots: tranches.slice(-8).map(tranche => ({
        shares: Number(tranche.qty),
        entryPrice: Number(tranche.price),
        purchaseDate: tranche.date || null,
        buyCommission: Number(tranche.buyCommission || 0)
      })),
      averageEntryPrice,
      unrealizedGrossPnl: lotBasedPnl,
      unrealizedGrossPnlBasis: lotBasedPnl === null
        ? 'unavailable: valid entry lots or market price missing'
        : 'sum of open-lot P&L; excludes commissions, fees, and interest',
      holdingStartDate: position.startDate || null,
      recordedBuyCommission: Number(position.commBuy || 0)
    };
  };
  const summarizedPositions = allPositions.map(summarizePosition);
  const totalMarginMarketValue = summarizedPositions.reduce((sum, position) => sum + (position.marketValue || 0), 0);
  const positionsWithWeight = summarizedPositions.map(position => ({
    ...position,
    marginMarketValueWeightPct: totalMarginMarketValue > 0 && position.marketValue !== null
      ? position.marketValue / totalMarginMarketValue * 100
      : null
  }));
  const positionsByTicker = new Map(positionsWithWeight.map(position => [position.ticker.toUpperCase(), position]));
  const marginPositions = allPositions.map(position => ({
    ...position,
    currentPrice: finiteReviewNumber(position.currentPrice),
    shares: Number(position.shares)
  }));
  const cashHoldings = snapshot.cashCushion?.holdings || [];
  const valuation = calculatePortfolioValuation({
    signedAccountBalance: snapshot.balance,
    freeCash: snapshot.cashCushion?.freeCash,
    marginPositions,
    cashHoldings
  });
  const grossAssets = valuation.totalHoldingsValue + valuation.cashBalance;
  const equityPct = valuation.accountBalanceAvailable && grossAssets > 0
    ? valuation.equity / grossAssets * 100
    : null;
  const debt = valuation.marginDebt;
  const assumptions = snapshot.brokerAssumptions;
  const cashCushion = getCashCushionTotal(snapshot);
  const marginRisk = assumptions
    ? calculateMarginRiskMetrics(debt, valuation.marginHoldingsValue, cashCushion, assumptions)
    : null;
  const brokerSnapshotStatus = snapshot.brokerAccountInfo?.status ||
    (snapshot.brokerAccountInfo?.loaded ? 'loaded' : 'not-loaded');
  const quotesProvisional = [...allPositions, ...cashHoldings.filter(holding => Number(holding.shares) > 0)]
    .some(position => getQuoteFreshness(position, now, refreshIntervalMs) !== 'fresh');
  const valuationReliability = !valuation.accountBalanceAvailable || valuation.unpricedHoldings > 0
    ? 'incomplete'
    : brokerSnapshotStatus !== 'current' || quotesProvisional ? 'provisional' : 'current';
  const account = {
    reportingCurrency: 'USD',
    brokerSnapshotStatus,
    brokerSnapshotReceivedAt: snapshot.brokerAccountInfo?.receivedAt || null,
    balance: finiteReviewNumber(snapshot.balance),
    cashBalance: finiteReviewNumber(snapshot.cashBalance),
    freeCash: finiteReviewNumber(snapshot.cashCushion?.freeCash),
    realizedMarginCharged: finiteReviewNumber(snapshot.realizedMarginCharged),
    brokerAssumptions: assumptions || null,
    valuation: {
      accountBalanceAvailable: valuation.accountBalanceAvailable,
      equity: valuation.accountBalanceAvailable ? valuation.equity : null,
      grossAssets: valuation.accountBalanceAvailable ? grossAssets : null,
      equityPct,
      marginDebt: valuation.marginDebt,
      marginHoldingsValue: valuation.marginHoldingsValue,
      cashHoldingsValue: valuation.cashHoldingsValue,
      unpricedHoldings: valuation.unpricedHoldings,
      reliability: valuationReliability
    },
    marginRisk: marginRisk && assumptions ? {
      equityRatioPct: Number.isFinite(marginRisk.equityRatio) ? marginRisk.equityRatio * 100 : null,
      maintenanceEquityRatioPct: assumptions.maintenanceEquityRatio * 100,
      stopOutRatioPct: assumptions.stopOutRatio * 100,
      marginCallBufferPct: Number.isFinite(marginRisk.marginCallBufferPct) ? marginRisk.marginCallBufferPct : null,
      stopOutBufferPct: Number.isFinite(marginRisk.stopOutBufferPct) ? marginRisk.stopOutBufferPct : null,
      dailyBorrowCostEstimate: debt * assumptions.annualBorrowRate / assumptions.dayCountBasis,
      annualBorrowRatePct: assumptions.annualBorrowRate * 100,
      dayCountBasis: assumptions.dayCountBasis,
      qualification: 'Application estimate using configured assumptions; not a live broker margin or liquidation indicator.'
    } : null
  };
  const identity = {
    focusTicker: requestedTicker,
    account,
    focusPosition: focusPosition ? positionsByTicker.get(focusPosition.ticker.toUpperCase()) : null,
    otherOpenPositions: positionsWithWeight.filter(position =>
      !requestedTicker || position.ticker.toUpperCase() !== requestedTicker
    )
  };
  const portfolioContext = {
    asOf: new Date(now).toISOString(),
    ...identity
  };
  const priorityTickers = [...positionsWithWeight]
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0) || a.ticker.localeCompare(b.ticker))
    .map(position => position.ticker);

  return { allPositions, focusPosition, portfolioContext, snapshotIdentity: identity, priorityTickers };
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
  const accountSession = brokerSessionIdentityRef.current.capture();
  const isAccountSessionCurrent = useCallback(
    () => accountSession !== null && brokerSessionIdentityRef.current.isCurrent(accountSession),
    [accountSession?.identity, accountSession?.generation]
  );
  const activeDeskView = useActiveView();
  const hasMarginPositions = usePortfolioSelector((state) => Object.keys(state.positions || {}).length > 0);
  const scenarioValuationSnapshot = usePortfolioSelector(
    (state) => ({
      positions: state.positions || {},
      cashHoldings: state.cashCushion?.holdings || [],
      balance: state.balance,
      freeCash: state.cashCushion?.freeCash,
      brokerAccountInfo: state.brokerAccountInfo
    }),
    (previous, next) =>
      previous.positions === next.positions &&
      previous.cashHoldings === next.cashHoldings &&
      previous.balance === next.balance &&
      previous.freeCash === next.freeCash &&
      previous.brokerAccountInfo === next.brokerAccountInfo
  );
  const scenarioRefreshIntervalMs = useQuoteRefreshInterval(
    60000,
    currentUser?.role === 'guest' ? 'guest' : 'admin'
  );
  const scenarioQuoteProvenanceHoldings: QuoteProvenanceHolding[] = [
    ...Object.values(scenarioValuationSnapshot.positions)
      .filter((position) => Number(position.shares) > 0)
      .map((position) => ({ ...position, kind: 'Margin position' as const })),
    ...scenarioValuationSnapshot.cashHoldings
      .filter((holding) => Number(holding.shares) > 0)
      .map((holding) => ({ ...holding, kind: 'Cash holding' as const }))
  ];
  const scenarioQuoteHoldings = scenarioQuoteProvenanceHoldings.map((holding) => {
    const price = holding.kind === 'Margin position'
      ? Number(holding.currentPrice)
      : Number(holding.currentPrice ?? holding.price);
    return Number.isFinite(price) && price > 0
      ? holding
      : { ...holding, quoteUpdatedAt: undefined, quoteSource: undefined, quoteDetails: undefined };
  });
  const scenarioQuoteSummary = summarizeQuoteFreshness(
    scenarioQuoteHoldings,
    Date.now(),
    scenarioRefreshIntervalMs
  );
  const scenarioValuation = calculatePortfolioValuation({
    signedAccountBalance: scenarioValuationSnapshot.balance,
    freeCash: scenarioValuationSnapshot.freeCash,
    marginPositions: Object.values(scenarioValuationSnapshot.positions),
    cashHoldings: scenarioValuationSnapshot.cashHoldings
  });
  const scenarioHasCurrentBrokerBalance = scenarioValuationSnapshot.brokerAccountInfo?.loaded === true &&
    Array.isArray(scenarioValuationSnapshot.brokerAccountInfo.balances) &&
    scenarioValuationSnapshot.brokerAccountInfo.balances.some((balance) =>
      String(balance.currency ?? '').toUpperCase() === 'USD' &&
      balance.amount !== null && balance.amount !== undefined &&
      Number.isFinite(Number(balance.amount))
    );
  const scenarioValuationStatus = getPortfolioValuationReliability({
    accountBalanceAvailable: scenarioValuation.accountBalanceAvailable,
    accountBalanceStale: scenarioValuationSnapshot.brokerAccountInfo?.status === 'stale' ||
      (scenarioValuationSnapshot.brokerAccountInfo?.loaded === true && !scenarioHasCurrentBrokerBalance),
    unpricedHoldings: scenarioValuation.unpricedHoldings,
    staleQuotes: scenarioQuoteSummary.stale,
    delayedQuotes: scenarioQuoteSummary.delayed,
    unknownQuotes: scenarioQuoteSummary.unknown,
    unavailableQuotes: scenarioQuoteSummary.unavailable
  });
  const scenarioDataQualityWarning = scenarioValuationStatus === 'incomplete'
    ? translateText('Scenario interpretation may be incomplete because the current account balance or one or more holding prices are unavailable.', getAppLanguage())
    : scenarioValuationStatus === 'provisional'
      ? translateText('Scenario interpretation is provisional because one or more account balances or quotes are stale, delayed, or lack a verified observation time.', getAppLanguage())
      : null;
  const guestHistorySnapshot = usePortfolioSelector(
    (state) => ({
      guestTrancheLedger: state.guestTrancheLedger || [],
      guestPortfolioSnapshot: state.guestPortfolioSnapshot
    }),
    (previous, next) =>
      previous.guestTrancheLedger === next.guestTrancheLedger &&
      previous.guestPortfolioSnapshot === next.guestPortfolioSnapshot
  );
  const emptyStateVisible = !hasMarginPositions && activeDeskView === 'COMBINED';
  const [hasOpenedClosedHistory, setHasOpenedClosedHistory] = useState(false);
  const [hasOpenedGuestHistory, setHasOpenedGuestHistory] = useState(false);
  const [hasOpenedCashCushion, setHasOpenedCashCushion] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const shouldRenderClosedHistory = hasOpenedClosedHistory || activeDeskView === 'CLOSED_HISTORY';
  const shouldRenderCashCushion = hasOpenedCashCushion ||
    activeDeskView === 'CASH_CUSHION' ||
    activeDeskView === 'BALANCE';




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
  const [marketDepthTicker, setMarketDepthTicker] = useState<string | null>(null);
  const closeMarginIntelligence = useCallback(() => setMarginIntelligence(null), []);
  const closeScenarioModal = useCallback(() => setScenarioModalData(null), []);

  useEffect(() => portfolioStore.subscribePersistenceErrors((message) => {
    addErrorToast(translateText(message, getAppLanguage()));
  }), []);

  useEffect(() => {
    let warningShown = false;
    const reportPersistenceStatus = (status: ReturnType<typeof getPortfolioPersistenceStatus>) => {
      if (status.state === 'degraded' || status.state === 'conflict') {
        if (!warningShown) {
          addErrorToast(translateText(status.message || PORTFOLIO_PERSISTENCE_ERROR_MESSAGE, getAppLanguage()));
          warningShown = true;
        }
        return;
      }
      if (status.state === 'ready' || status.state === 'idle') warningShown = false;
    };
    reportPersistenceStatus(getPortfolioPersistenceStatus());
    return subscribePortfolioPersistenceStatus(reportPersistenceStatus);
  }, []);

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
      const reviewInput = buildMarginReviewContext(snapshot, requestedTicker || null, Date.now(), scenarioRefreshIntervalMs);
      const { allPositions, focusPosition } = reviewInput;

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
          ...(previous?.coverage ? { coverage: previous.coverage } : {}),
          ...(previous?.stale !== undefined ? { stale: previous.stale } : {}),
          ...(previous?.staleReasons ? { staleReasons: previous.staleReasons } : {}),
          ...(previous?.snapshotAsOf ? { snapshotAsOf: previous.snapshotAsOf } : {}),
          ...(previous?.syncedAt ? { syncedAt: previous.syncedAt } : {}),
          ...(previous?.digestRevision !== undefined ? { digestRevision: previous.digestRevision } : {})
        };
      });

      try {
        const snapshotFingerprint = await fingerprintMarginReviewSnapshot(reviewInput.snapshotIdentity);
        const cached = await loadSyncedMarginDigest(digestKey);
        if (!requestGuard.isCurrent(requestId)) return;
        const latestCacheInput = buildMarginReviewContext(portfolioStore.getState(), requestedTicker || null, Date.now(), scenarioRefreshIntervalMs);
        const latestCacheFingerprint = await fingerprintMarginReviewSnapshot(latestCacheInput.snapshotIdentity);
        if (cached && !detail?.refresh) {
          const freshness = getMarginDigestFreshness(cached.digest, latestCacheFingerprint);
          setMarginIntelligence({
            title: cached.digest.title || title,
            scope: cached.digest.scope,
            ...(cached.digest.ticker ? { ticker: cached.digest.ticker } : {}),
            loading: false,
            analysis: cached.digest.analysis,
            articles: cached.digest.articles,
            ...(cached.digest.coverage ? { coverage: cached.digest.coverage } : {}),
            stale: freshness.stale,
            staleReasons: freshness.reasons,
            ...(cached.digest.snapshotAsOf ? { snapshotAsOf: cached.digest.snapshotAsOf } : {}),
            syncedAt: cached.digest.syncedAt,
            digestRevision: cached.revision
          });
          return;
        }
        if (cached) {
          const freshness = getMarginDigestFreshness(cached.digest, latestCacheFingerprint);
          setMarginIntelligence({
            title: cached.digest.title || title,
            scope: cached.digest.scope,
            ...(cached.digest.ticker ? { ticker: cached.digest.ticker } : {}),
            loading: true,
            analysis: cached.digest.analysis,
            articles: cached.digest.articles,
            ...(cached.digest.coverage ? { coverage: cached.digest.coverage } : {}),
            stale: freshness.stale,
            staleReasons: freshness.reasons,
            ...(cached.digest.snapshotAsOf ? { snapshotAsOf: cached.digest.snapshotAsOf } : {}),
            syncedAt: cached.digest.syncedAt,
            digestRevision: cached.revision
          });
        }
        const newsPositions = isPortfolio ? allPositions : focusPosition ? [focusPosition] : [];
        const newsResults: MarginNewsFetchResult[] = await Promise.all(newsPositions.map(async position => {
          try {
            const items = await fetchMarketNews(position.ticker, true);
            return {
              ticker: position.ticker,
              fetchedAt: new Date().toISOString(),
              items: Array.isArray(items) ? items : []
            };
          } catch (error) {
            return {
              ticker: position.ticker,
              fetchedAt: new Date().toISOString(),
              items: [],
              error: error instanceof Error ? error.message : 'News provider request failed.'
            };
          }
        }));
        const { articles, coverage } = selectMarginReviewNews(newsResults, reviewInput.priorityTickers);
        const prompt = buildMarginReviewPrompt(reviewInput.portfolioContext, coverage, articles);
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
        const latestInput = buildMarginReviewContext(portfolioStore.getState(), requestedTicker || null, Date.now(), scenarioRefreshIntervalMs);
        const latestFingerprint = await fingerprintMarginReviewSnapshot(latestInput.snapshotIdentity);
        if (latestFingerprint !== snapshotFingerprint) {
          setMarginIntelligence({
            title,
            scope,
            ...(requestedTicker ? { ticker: requestedTicker } : {}),
            loading: false,
            analysis,
            articles,
            coverage,
            snapshotAsOf: reviewInput.portfolioContext.asOf,
            stale: true,
            staleReasons: ['snapshot-changed'],
            error: 'The portfolio changed while this review was being generated. Refresh to review the current snapshot.'
          });
          return;
        }
        const syncedAt = new Date().toISOString();
        const digest = {
          key: digestKey,
          title,
          scope: (isPortfolio ? 'portfolio' : 'position') as 'portfolio' | 'position',
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          analysis,
          articles,
          coverage,
          snapshotFingerprint,
          snapshotAsOf: reviewInput.portfolioContext.asOf,
          promptVersion: MARGIN_REVIEW_PROMPT_VERSION,
          syncedAt
        };
        const nextRevision = await saveSyncedMarginDigest(digest, cached?.revision ?? 0);
        if (!requestGuard.isCurrent(requestId)) return;
        const postSaveInput = buildMarginReviewContext(portfolioStore.getState(), requestedTicker || null, Date.now(), scenarioRefreshIntervalMs);
        const postSaveFingerprint = await fingerprintMarginReviewSnapshot(postSaveInput.snapshotIdentity);
        const freshness = getMarginDigestFreshness(digest, postSaveFingerprint);
        setMarginIntelligence({
          title,
          scope: isPortfolio ? 'portfolio' : 'position',
          ...(requestedTicker ? { ticker: requestedTicker } : {}),
          loading: false,
          analysis,
          articles,
          coverage,
          snapshotAsOf: reviewInput.portfolioContext.asOf,
          stale: freshness.stale,
          staleReasons: freshness.reasons,
          ...(freshness.stale ? { error: 'The portfolio changed while the review was being saved. Refresh to review the current snapshot.' } : {}),
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
            ...(previous?.coverage ? { coverage: previous.coverage } : {}),
            ...(previous?.stale !== undefined ? { stale: previous.stale } : {}),
            ...(previous?.staleReasons ? { staleReasons: previous.staleReasons } : {}),
            ...(previous?.snapshotAsOf ? { snapshotAsOf: previous.snapshotAsOf } : {}),
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
  }, [permissions.canViewMarginDesk, scenarioRefreshIntervalMs]);

  // Register shell event listeners synchronously after mount. Startup dispatches
  // auth/loading events immediately after render; passive effects can miss them.
  useLayoutEffect(() => {
    const handleAuthVisibility = (event: UiEvent<{ isOpen: boolean }>) => {
      setAuthOpen(event.detail.isOpen);
    };
    const handleScenarioModal = (event: UiEvent<ScenarioModalData>) => setScenarioModalData(event.detail);
    const handleMarketDepthRequest = (event: UiEvent<{ ticker: string }>) => {
      if (permissions.isAdmin) setMarketDepthTicker(event.detail.ticker);
    };
    const handleBackupImportRequest = () => {
      if (permissions.canManageBackups) backupImportInputRef.current?.click();
    };
    const handleAuthUserChanged = (event: UiEvent<{ user: AuthUser | null }>) => {
      const user = event.detail.user;
      // Invalidate broker work synchronously, before Preact schedules the state update.
      brokerSessionIdentityRef.current.setIdentity(user ? `${user.role}:${user.id}` : null);
      setMarketDepthTicker(null);
      setCurrentUser(user);
      setAppLanguage(user?.language ?? 'en');
    };
    const unsubscribeLanguage = subscribeAppLanguage(() => {
      setLanguageRevision((revision) => revision + 1);
    });
    const handleScrollWorkspace = () => {
      requestAnimationFrame(() => {
        mainWorkspaceRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    };
    addUiEventListener('terminal:backup-import-request', handleBackupImportRequest);
    addUiEventListener('terminal:scroll-workspace', handleScrollWorkspace);
    addUiEventListener('terminal:scenario-modal', handleScenarioModal);
    addUiEventListener('terminal:market-depth-request', handleMarketDepthRequest);
    addUiEventListener('terminal:auth-visibility', handleAuthVisibility);
    addUiEventListener('auth:user-changed', handleAuthUserChanged);
    const handleStartupState = (event: UiEvent<{ visible: boolean; failed: boolean }>) => setStartupState(event.detail);
    addUiEventListener('terminal:startup-state', handleStartupState);
    return () => {
      removeUiEventListener('terminal:backup-import-request', handleBackupImportRequest);
      removeUiEventListener('terminal:scroll-workspace', handleScrollWorkspace);
      removeUiEventListener('terminal:scenario-modal', handleScenarioModal);
      removeUiEventListener('terminal:market-depth-request', handleMarketDepthRequest);
      removeUiEventListener('terminal:auth-visibility', handleAuthVisibility);
      removeUiEventListener('auth:user-changed', handleAuthUserChanged);
      removeUiEventListener('terminal:startup-state', handleStartupState);
      unsubscribeLanguage();
    };
  }, [permissions.canManageBackups, permissions.isAdmin]);

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

  // Broker data reads are session-bound in the broker data runtime. App remains
  // the single owner of portfolio state and injects its account/session boundary.
  useEffect(() => {
    if (currentUser?.role !== 'admin') return;
    const session = brokerSessionIdentityRef.current.capture();
    if (!session) return;

    const brokerDataRuntime = createPortfolioBrokerDataRuntime({
      getAccountId: () => currentUser?.id || '',
      isSessionCurrent: (requestedSession) => brokerSessionIdentityRef.current.isCurrent(requestedSession),
      getCurrentBrokerExecutions: () => portfolioStore.getState().brokerExecutedTrades || [],
      getClosedTrades: () => portfolioStore.getState().closedTrades || [],
      setBrokerExecutions: (executions) => portfolioStore.setState({ brokerExecutedTrades: executions }),
      emit: emitBrokerEvent,
      logError: (message, error) => console.error(message, error)
    });

    return bindPortfolioBrokerRequestRuntime({
      refreshAccountInfo: () => brokerDataRuntime.refreshAccountInfo(session),
      refreshAccountInfoForWait: () => brokerDataRuntime.loadFreedomAccount(session),
      refreshExecutedTrades: () => brokerDataRuntime.loadExecutedTrades(session),
      refreshActiveOrders: () => brokerDataRuntime.loadActiveOrders(session)
    });
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
          <div class="flex flex-wrap items-center gap-2 justify-center">
            <div id="tickerTabs" role="group" aria-label={translateText('Workspace navigation', getAppLanguage())}><MemoTickerTabs isAdmin={permissions.isAdmin} userId={currentUser?.role === 'guest' ? currentUser.id : undefined} /></div>
            <MarketStatusBadge isAdmin={permissions.isAdmin} />
            {permissions.canViewKvStatus && <CloudSyncIndicator cloudStatus={cloudStatus} cloudSyncStatus={cloudSyncStatus} />}
          </div>
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
            <div class="desk-content-reveal">

              <div
                id="emptyStatePanel"
                class={"border border-dashed border-slate-700 bg-slate-900/40 rounded-lg p-4 " + (emptyStateVisible ? "" : "hidden")}
              >{emptyStateVisible && <EmptyStatePanel />}</div>

              <div
                id="boardTitleRow"
                class={"board-title-row flex justify-center flex-wrap items-center md:justify-between gap-2 " + (emptyStateVisible ? "hidden" : "")}
              >
                <div class="board-title-text min-w-0 text-lg font-bold text-white" id="boardTitle">
                  {boardTitle}
                </div>
                <div id="boardAnalystConsensus" class={"board-analyst-consensus " + analystConsensus.className} title={analystConsensus.title}>{analystConsensus.text}</div>
              </div>



              <div
                id="boardTitleActions"
                class="board-title-actions flex flex-wrap items-center gap-2"
              >
                <div id="boardDailyMove" class={showDailyMove ? "" : "hidden"}></div>
              </div>

              <div
                id="portfolioMetricsGrid"
                aria-label="Portfolio summary metrics"
                class={"portfolio-metrics-grid gap-2 text-xs text-slate-300 " + (emptyStateVisible ? "hidden" : "")}
              >
                {permissions.canViewMarginDesk &&
                  !["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) && (
                    <Suspense fallback={<DeskLoading title="Preparing portfolio metrics" message="Loading portfolio metrics…" accent="cyan" />}>
                      <MemoSummaryMetricsGrid isAdmin={permissions.isAdmin} />
                    </Suspense>
                  )}
              </div>

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
                    ><MemoProjectionsTable /></tbody>
                  </table>
                </TableScrollRegion>
                <section
                  id="marketInsightsPanel"
                  class={"market-insights-workspace space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
                  aria-label="Market insights"
                >{activeDeskView === 'COMBINED' || !['CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'GUEST_HISTORY', 'SETTINGS'].includes(activeDeskView) ? (
                  <Suspense fallback={<DeskLoading title="Preparing market insights" message="Loading market data panels…" accent="cyan" />}>
                    <MarketInsightsPanel />
                  </Suspense>
                ) : null}</section>
              </div>
            </div>
          </div>}

          {/* Cash Cushion Management Panel */}
          <div id="cashCushionContainer" class={"desk-view-transition space-y-3 " + (["CASH_CUSHION", "BALANCE"].includes(activeDeskView) ? "" : "hidden")}>
            {shouldRenderCashCushion
              ? <div class="desk-content-reveal"><Suspense fallback={<DeskLoading title="Preparing balance" message="Loading holdings and account allocations…" accent="cyan" />}>
                <CashCushionDesk
                  key={`balance-${accountSession?.identity ?? 'none'}-${accountSession?.generation ?? -1}`}
                  showActiveTranches={permissions.canViewActiveTranches}
                  isAdmin={permissions.isAdmin}
                  guestUserId={currentUser?.role === 'guest' ? currentUser.id : undefined}
                />
              </Suspense></div>
              : <DeskLoading title="Preparing balance" message="Loading holdings and account allocations…" accent="cyan" />}
          </div>

          {/* Guest-only assignment history is a standalone destination, separate from Balance. */}
          {permissions.canViewGuestTrancheHistory && <div
            id="guestHistoryContainer"
            class={`desk-view-transition min-w-0 ${activeDeskView === 'GUEST_HISTORY' ? '' : 'hidden'}`}
          >
            {hasOpenedGuestHistory
              ? <div class="desk-content-reveal"><Suspense fallback={<DeskLoading title="Preparing lots" message="Loading your assigned tranche history…" accent="purple" />}>
                <GuestTrancheHistory
                  records={guestHistorySnapshot.guestTrancheLedger}
                  activeTranches={guestHistorySnapshot.guestPortfolioSnapshot?.tranches || []}
                />
              </Suspense></div>
              : <DeskLoading title="Preparing lots" message="Loading your assigned tranche history…" accent="purple" />}
          </div>}

          {/* Keep the command console available on both Margin and Cash desks. */}
          {permissions.canUseTerminal && !["CASH_CUSHION", "BALANCE", "GUEST_HISTORY"].includes(activeDeskView) && <div id="tradingTerminalColumn" class="trading-terminal-column">
            <div
              id="tradingConsoleCard"
              class={"desk-view-transition trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 w-full " + (["CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
            ><MemoTradingConsole /></div>
          </div>}

        </div>
      </main>

      {/* Trades */}
      <div
        id="closedHistoryContainer"

        class={"desk-view-transition rounded-lg " + (permissions.canViewClosedHistory && activeDeskView === "CLOSED_HISTORY" ? "" : "hidden")}
      >
        {permissions.canViewClosedHistory && shouldRenderClosedHistory
          ? <div class="desk-content-reveal"><Suspense fallback={<DeskLoading title="Preparing trades" message="Restoring saved trades and broker activity…" accent="purple" />}>
            <ClosedHistoryDesk
              key={`closed-history-${accountSession?.identity ?? 'none'}-${accountSession?.generation ?? -1}`}
              accountId={currentUser?.id || ''}
              isSessionCurrent={isAccountSessionCurrent}
            />
          </Suspense></div>
          : null}
      </div>

      {/* Settings */}
      <div class={"p-4 sm:p-6 rounded-xl space-y-4 " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings">
        {hasOpenedSettings
          ? <div class="desk-content-reveal"><Suspense fallback={<DeskLoading title="Preparing settings" message="Loading account access and preferences…" accent="blue" />}>
            <SettingsDesk currentUser={currentUser} />
          </Suspense></div>
          : <DeskLoading title="Preparing settings" message="Loading account access and preferences…" accent="blue" />}
      </div>

      {/* Authentication is part of the application tree, not a second Preact root. */}
      <div id="auth-container" class={"auth-overlay " + (authOpen ? "auth-overlay-open" : "")}>
        <AuthModal isOpen={authOpen} onSaveSecret={onSaveGatewaySecret} />
      </div>
      {scenarioModalData && <Suspense fallback={null}><ScenarioComparisonModal data={scenarioModalData} onClose={closeScenarioModal} /></Suspense>}
      {scenarioReport !== null && <Suspense fallback={null}><ScenarioReportModal key={scenarioReport} report={scenarioReport} dataQualityWarning={scenarioDataQualityWarning} quoteProvenanceHoldings={scenarioQuoteProvenanceHoldings} onClose={dismissScenarioReport} /></Suspense>}
      {permissions.canViewMarginDesk && marginIntelligence && <Suspense fallback={null}><MarginIntelligenceModal data={marginIntelligence} onClose={closeMarginIntelligence} onRefresh={() => emitUiEvent('terminal:margin-intelligence-request', { ticker: marginIntelligence.ticker, refresh: true })} /></Suspense>}
      {permissions.isAdmin && marketDepthTicker && <Suspense fallback={null}><MarketDepthModal key={`${marketDepthTicker}:${currentUser?.id || ''}`} ticker={marketDepthTicker} sessionKey={`admin:${currentUser?.id || ''}`} onClose={() => setMarketDepthTicker(null)} /></Suspense>}
      <div id="toastContainer" class="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2" aria-live="assertive">
        {errorToasts.map((toast) => <div key={toast.id} role="alert" class={'pointer-events-auto rounded-lg border border-rose-800 bg-slate-900/95 px-3.5 py-2 text-xs font-mono font-semibold text-rose-200 shadow-lg backdrop-blur transition-all ' + (toast.isClosing ? 'opacity-0 translate-x-2' : '')}>{toast.message}</div>)}
      </div>
      {permissions.canManageBackups && <input
        ref={backupImportInputRef}
        type="file"
        id="importFileInput"
        class="hidden"
        accept={PORTFOLIO_BACKUP_FILE_EXTENSION}
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