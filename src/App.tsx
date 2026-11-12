import { emitUiEvent, addUiEventListener, removeUiEventListener, type UiEvent } from './ui/uiEventBus';
import { useBreakevenText, useCloudStatus, useCloudSyncStatus, useAnalystConsensus, useBoardTitle } from './ui/uiStateStore';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { lazy, memo, Suspense } from 'preact/compat';
import { AuthModal } from './components/AuthModal';
import { DeskLoading } from './components/DeskLoading';
import { TickerTabs } from './components/TickerTab';
import { MarketStatusBadge } from './components/MarketStatusBadge';
import { CloudSyncIndicator } from './components/CloudSyncIndicator';
import { ProjectionsTable } from './components/ProjectionsTable';
import { TableScrollRegion } from './components/TableScrollRegion';
import { EmptyStatePanel } from './components/EmptyStatePanel';
import type { MarginIntelligenceState } from './features/ai/marginIntelligenceState';
import type { AuthUser } from './services/api';
import { startFreedomAccountStreamForSession } from '../app';
import { portfolioStore, useActiveView, usePortfolioSelector } from './store/portfolioStore';
import { getAccountPermissions } from './domain/accountPermissions';
import { addToast, useToasts } from './ui/notificationStore';
import { getAppLanguage, setAppLanguage, subscribeAppLanguage, translateText } from './services/i18n';
import { PORTFOLIO_BACKUP_FILE_EXTENSION } from './services/portfolioBackupFile';
import { useQuoteRefreshInterval } from './ui/useQuoteRefreshInterval';
import { DEFAULT_ADMIN_REFRESH_INTERVAL_MS } from './services/portfolioAutoRefresh';
import { emitBrokerEvent } from './services/brokerEventBus';
import { bindPortfolioBrokerRequestRuntime } from './services/portfolioBrokerRequestRuntime';
import { createPortfolioBrokerDataRuntime } from './services/portfolioBrokerDataRuntime';
import { createSessionIdentityGuard } from './utils/sessionIdentityGuard';
import { createMarginIntelligenceRuntime } from './features/ai/marginIntelligenceRuntime';
import { resolveActivePageRootId, watchPageRenderReadiness } from './services/pageRenderReadiness';


const MemoTickerTabs = memo(TickerTabs);
const MemoSummaryMetricsGrid = lazy(() =>
  import('./components/SummaryMetricsGrid').then(({ SummaryMetricsGrid }) => ({
    default: memo(SummaryMetricsGrid)
  }))
);
const PortfolioPerformancePanel = lazy(() =>
  import('./components/PortfolioPerformancePanel').then(({ PortfolioPerformancePanel }) => ({
    default: memo(PortfolioPerformancePanel)
  }))
);
const MemoProjectionsTable = memo(ProjectionsTable);

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
const ExitComparisonModal = lazy(() =>
  import('./components/ExitComparisonModal').then(({ ExitComparisonModal }) => ({ default: ExitComparisonModal }))
);
const BuyMoreModal = lazy(() =>
  import('./components/BuyMoreModal').then(({ BuyMoreModal }) => ({ default: BuyMoreModal }))
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
  const scenarioRefreshIntervalMs = useQuoteRefreshInterval(
    DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
    currentUser?.role === 'guest' ? 'guest' : 'admin'
  );
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
  // Render Settings on the same navigation update that activates its view.
  // The first-open flag only keeps the section mounted after the user leaves it.
  const shouldRenderSettings = hasOpenedSettings || activeDeskView === 'SETTINGS';




  const { title: boardTitle, showDailyMove } = useBoardTitle();
  const breakevenText = useBreakevenText();
  const analystConsensus = useAnalystConsensus();
  const cloudStatus = useCloudStatus();
  const cloudSyncStatus = useCloudSyncStatus();
  const toasts = useToasts();
  const [startupState, setStartupState] = useState({ visible: true, failed: false, readyRequested: false });
  const [exitComparisonRequest, setExitComparisonRequest] = useState<{ ticker?: string } | null>(null);
  const [buyMoreRequest, setBuyMoreRequest] = useState<{ ticker?: string } | null>(null);
  const [marginIntelligence, setMarginIntelligence] = useState<MarginIntelligenceState | null>(null);
  const [marketDepthTicker, setMarketDepthTicker] = useState<string | null>(null);
  const closeMarginIntelligence = useCallback(() => setMarginIntelligence(null), []);
  const closeExitComparison = useCallback(() => setExitComparisonRequest(null), []);
  const closeBuyMore = useCallback(() => setBuyMoreRequest(null), []);

  useEffect(() => portfolioStore.subscribePersistenceErrors((message) => {
    addToast(translateText(message, getAppLanguage()), 'error');
  }), []);

  useEffect(() => {
    if (!permissions.canViewMarginDesk) {
      setMarginIntelligence(null);
      return;
    }

    const marginIntelligenceRuntime = createMarginIntelligenceRuntime({
      canViewMarginDesk: () => permissions.canViewMarginDesk,
      getPortfolioState: () => portfolioStore.getState(),
      refreshIntervalMs: scenarioRefreshIntervalMs,
      setState: setMarginIntelligence,
      translate: (message) => translateText(message, getAppLanguage())
    });
    const handleMarginIntelligence = (event: UiEvent<{ ticker?: string; refresh?: boolean }>) => {
      void marginIntelligenceRuntime.handleRequest(event.detail);
    };

    addUiEventListener('margin:intelligence-request', handleMarginIntelligence);
    return () => {
      marginIntelligenceRuntime.dispose();
      removeUiEventListener('margin:intelligence-request', handleMarginIntelligence);
    };
  }, [permissions.canViewMarginDesk, scenarioRefreshIntervalMs]);

  // Register shell event listeners synchronously after mount. Startup dispatches
  // auth/loading events immediately after render; passive effects can miss them.
  useLayoutEffect(() => {
    const handleAuthVisibility = (event: UiEvent<{ isOpen: boolean }>) => {
      setAuthOpen(event.detail.isOpen);
    };
    const handleExitComparisonRequest = (event: UiEvent<{ ticker?: string }>) => {
      setExitComparisonRequest(event.detail);
    };
    const handleBuyMoreRequest = (event: UiEvent<{ ticker?: string }>) => {
      setBuyMoreRequest(event.detail);
    };
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
      setExitComparisonRequest(null);
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
    addUiEventListener('settings:backup-import-request', handleBackupImportRequest);
    addUiEventListener('app:scroll-workspace', handleScrollWorkspace);
    addUiEventListener('scenario:exit-comparison-request', handleExitComparisonRequest);
    addUiEventListener('scenario:buy-more-request', handleBuyMoreRequest);
    addUiEventListener('market:depth-request', handleMarketDepthRequest);
    addUiEventListener('auth:visibility', handleAuthVisibility);
    addUiEventListener('auth:user-changed', handleAuthUserChanged);
    const handleStartupState = (event: UiEvent<{ visible: boolean; failed: boolean }>) => {
      if (event.detail.visible || event.detail.failed) {
        setStartupState({ ...event.detail, readyRequested: false });
      } else {
        // Startup completion is only a dismissal request. Keep the overlay in
        // place until the active desk has finished mounting and painting.
        setStartupState({ visible: true, failed: false, readyRequested: true });
      }
    };
    addUiEventListener('app:startup-state', handleStartupState);
    return () => {
      removeUiEventListener('settings:backup-import-request', handleBackupImportRequest);
      removeUiEventListener('app:scroll-workspace', handleScrollWorkspace);
      removeUiEventListener('scenario:exit-comparison-request', handleExitComparisonRequest);
      removeUiEventListener('scenario:buy-more-request', handleBuyMoreRequest);
      removeUiEventListener('market:depth-request', handleMarketDepthRequest);
      removeUiEventListener('auth:visibility', handleAuthVisibility);
      removeUiEventListener('auth:user-changed', handleAuthUserChanged);
      removeUiEventListener('app:startup-state', handleStartupState);
      unsubscribeLanguage();
    };
  }, [permissions.canManageBackups, permissions.isAdmin]);

  useEffect(() => {
    if (!startupState.readyRequested || startupState.failed) return;

    return watchPageRenderReadiness({
      document,
      getRoot: () =>
        document.getElementById(resolveActivePageRootId(activeDeskView)) ??
        document.getElementById('mainTerminalView'),
      onReady: () => setStartupState({ visible: false, failed: false, readyRequested: false })
    });
  }, [activeDeskView, startupState.failed, startupState.readyRequested]);

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
      startAccountStream: (sessionKey) => startFreedomAccountStreamForSession(sessionKey),
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
        aria-label={translateText('Portfolio workspace', getAppLanguage())}
        class="border-card p-4 sm:p-6 rounded-xl space-y-2 max-w-6xl mx-auto"
      >
        {/* Asset View Tabs */}
        <div
          id="boardHeaderBanner"
          class="board-header-banner border-b border-slate-800 pb-3"
        >
          <div class="flex flex-wrap gap-2 justify-center items-baseline">
            <div id="tickerTabs" role="group" aria-label={translateText('Workspace navigation', getAppLanguage())}><MemoTickerTabs isAdmin={permissions.isAdmin} userId={currentUser?.role === 'guest' ? currentUser.id : undefined} /></div>
            <MarketStatusBadge isAdmin={permissions.isAdmin} />
            {permissions.canViewKvStatus && <CloudSyncIndicator cloudStatus={cloudStatus} cloudSyncStatus={cloudSyncStatus} />}
          </div>
        </div>

        {/* Desk content and terminal share a responsive grid. It creates two columns only when both can fit. */}
        <div id="tradingWorkspaceGrid" class="trading-workspace-grid">
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
                <h1 class="board-title-text min-w-0 text-lg font-bold text-white text-center md:text-left" id="boardTitle">
                  {boardTitle}
                </h1>

                {permissions.isAdmin && <div
                  class={"text-sm font-semibold text-emerald-400 font-mono tracking-tight shrink-0 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
                  id="daysToBreakeven"
                >
                  {breakevenText}
                </div>}

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
                aria-label={translateText('Portfolio summary metrics', getAppLanguage())}
                class={"portfolio-metrics-grid gap-2 text-xs text-slate-300 " + (emptyStateVisible ? "hidden" : "")}
              >
                {permissions.canViewMarginDesk &&
                  !["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "GUEST_HISTORY", "SETTINGS"].includes(activeDeskView) && (
                    <Suspense fallback={<DeskLoading title={translateText('Preparing portfolio metrics', getAppLanguage())} message={translateText('Loading portfolio metrics…', getAppLanguage())} accent="cyan" />}>
                      <MemoSummaryMetricsGrid isAdmin={permissions.isAdmin} />
                    </Suspense>
                  )}
              </div>

              {permissions.isAdmin && activeDeskView === 'COMBINED' && (
                <Suspense fallback={<DeskLoading title="Preparing performance" message="Loading portfolio performance…" accent="cyan" />}>
                  <PortfolioPerformancePanel />
                </Suspense>
              )}

              <div id="marginDataWorkspace" class="margin-data-workspace">
                {/* Projection Table */}
                <TableScrollRegion
                  label={translateText('Portfolio projection by date', getAppLanguage())}
                  id="projectionTableContainer"
                  className={"table-scroll-wrapper overflow-x-auto pt-2 max-w-2xl mx-auto w-full lg:max-w-none " + (emptyStateVisible ? "hidden" : "")}
                >
                  <table aria-label={translateText('Portfolio projection by date', getAppLanguage())} class="w-full min-w-[300px] text-xs border-collapse">
                    <caption class="sr-only">{translateText('Projected portfolio net value, fees and commissions, margin fee, and balance by date.', getAppLanguage())}</caption>
                    <thead>
                      <tr class="border-b border-slate-800 text-slate-400">
                        <th scope="col" class="py-2 px-3">{translateText('Date', getAppLanguage())}</th>
                        <th scope="col" class="py-2 px-3">{translateText('Net', getAppLanguage())}</th>
                        <th scope="col" class="py-2 px-3">{translateText('Fees & commissions', getAppLanguage())}</th>
                        <th scope="col" class="py-2 px-3">{translateText('Margin fee', getAppLanguage())}</th>
                        <th scope="col" class="py-2 px-3">{translateText('Balance', getAppLanguage())}</th>
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
                  aria-label={translateText('Market insights', getAppLanguage())}
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

          {/* Desk-specific content stays within the responsive portfolio workspace. */}
          

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
      <div class={"border-card p-4 sm:p-6 rounded-xl space-y-4 max-w-6xl mx-auto " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings">
        {shouldRenderSettings
          ? <div class="desk-content-reveal"><Suspense fallback={<DeskLoading title="Preparing settings" message="Loading account access and preferences…" accent="blue" />}>
            <SettingsDesk currentUser={currentUser} />
          </Suspense></div>
          : <DeskLoading title="Preparing settings" message="Loading account access and preferences…" accent="blue" />}
      </div>

      {/* Authentication is part of the application tree, not a second Preact root. */}
      <div id="auth-container" class={"auth-overlay " + (authOpen ? "auth-overlay-open" : "")}>
        <AuthModal isOpen={authOpen} onSaveSecret={onSaveGatewaySecret} />
      </div>
      {exitComparisonRequest && <Suspense fallback={null}>
        <ExitComparisonModal
          key={`${currentUser?.id || 'local'}:${exitComparisonRequest.ticker || 'portfolio'}`}
          initialTicker={exitComparisonRequest.ticker}
          storageKey={`portfolio-terminal:exit-comparison:v1:${currentUser?.id || 'local'}`}
          onClose={closeExitComparison}
        />
      </Suspense>}
      {buyMoreRequest && <Suspense fallback={null}>
        <BuyMoreModal
          key={`${currentUser?.id || 'local'}:${buyMoreRequest.ticker || 'portfolio'}`}
          initialTicker={buyMoreRequest.ticker}
          storageKey={`portfolio-terminal:buy-more:v1:${currentUser?.id || 'local'}`}
          onClose={closeBuyMore}
        />
      </Suspense>}
      {permissions.canViewMarginDesk && marginIntelligence && <Suspense fallback={null}><MarginIntelligenceModal data={marginIntelligence} onClose={closeMarginIntelligence} onRefresh={() => emitUiEvent('margin:intelligence-request', { ticker: marginIntelligence.ticker, refresh: true })} /></Suspense>}
      {permissions.isAdmin && marketDepthTicker && <Suspense fallback={null}><MarketDepthModal key={`${marketDepthTicker}:${currentUser?.id || ''}`} ticker={marketDepthTicker} sessionKey={`admin:${currentUser?.id || ''}`} onClose={() => setMarketDepthTicker(null)} /></Suspense>}
      <div id="toastContainer" class="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} role={toast.variant === 'error' ? 'alert' : 'status'} class={'pointer-events-auto rounded-lg border bg-slate-900/95 px-3.5 py-2 text-xs font-mono font-semibold shadow-lg backdrop-blur transition-all ' +
          (toast.variant === 'error' ? 'border-rose-800 text-rose-200' :
            toast.variant === 'warning' ? 'border-amber-800 text-amber-200' :
              toast.variant === 'success' ? 'border-emerald-800 text-emerald-200' : 'border-slate-700 text-slate-200') +
          (toast.isClosing ? ' opacity-0 translate-x-2' : '')}>{toast.message}</div>)}
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
          if (file && permissions.canManageBackups) emitUiEvent('settings:backup-import-file', { file });
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
            <button type="button" onClick={() => emitUiEvent('app:startup-retry', undefined)}>Retry</button>
            <button type="button" onClick={() => emitUiEvent('app:startup-offline', undefined)}>Continue offline</button>
          </div>}
        </div>
      </div>}
    </>
  );
}