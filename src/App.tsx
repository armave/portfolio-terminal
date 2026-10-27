import { useCallback, useEffect, useState } from 'preact/hooks';
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
import type { ScenarioModalData } from './features/terminal/commandDispatcher';
import { fetchFreedomTradeNetPositions, fetchFreedomTradeNetTrades, normalizeFreedomPortfolio, normalizeFreedomTrades } from './services/api';
import { restoreGatewaySecret } from './services/storage';

let tradesRequest: Promise<void> | null = null;
let accountRequest: Promise<void> | null = null;

interface AppProps {
  onToggleMarketInsights: () => void;
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
  const [breakevenText, setBreakevenText] = useState('Combined Breakeven: 0 days');
  const [analystConsensus, setAnalystConsensus] = useState({ text: '', title: '', className: 'hidden' });
  const [cloudStatus, setCloudStatusState] = useState({ status: 'idle', text: 'OFFLINE' });
  const [cloudSyncStatus, setCloudSyncStatus] = useState({ status: 'idle', text: '' });
  const [startupState, setStartupState] = useState({ visible: true, failed: false });
  const [scenarioModalData, setScenarioModalData] = useState<ScenarioModalData | null>(null);
  const closeScenarioModal = useCallback(() => setScenarioModalData(null), []);

  useEffect(() => {
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
    window.addEventListener('terminal:scenario-modal', handleScenarioModal);
    window.addEventListener('terminal:auth-visibility', handleAuthVisibility);
    const handleCashCushionProps = (event: Event) => {
      const detail = (event as CustomEvent<CashCushionDeskProps>).detail;
      if (detail) setCashCushionProps(detail);
    };
    window.addEventListener('terminal:active-view', handleDeskView);
    const handleSettingsProps = (event: Event) => {
      const detail = (event as CustomEvent<SettingsDeskProps>).detail;
      if (detail) setSettingsProps(detail);
    };
    window.addEventListener('terminal:cash-cushion-props', handleCashCushionProps);
    const handleTickerTabsProps = (event: Event) => {
      const detail = (event as CustomEvent<TickerTabsProps>).detail;
      if (detail) setTickerTabsProps(detail);
    };
    window.addEventListener('terminal:settings-props', handleSettingsProps);
    const handleSummaryMetricsProps = (event: Event) => {
      const detail = (event as CustomEvent<SummaryMetricsGridProps>).detail;
      if (detail) setSummaryMetricsProps(detail);
    };
    const handleProjectionsProps = (event: Event) => {
      const detail = (event as CustomEvent<ProjectionsTableProps>).detail;
      if (detail) setProjectionsProps(detail);
    };
    window.addEventListener('terminal:ticker-tabs-props', handleTickerTabsProps);
    window.addEventListener('terminal:summary-metrics-props', handleSummaryMetricsProps);
    const handleMarketInsightsProps = (event: Event) => {
      const detail = (event as CustomEvent<MarketInsightsPanelProps>).detail;
      if (detail) setMarketInsightsProps(detail);
    };
    window.addEventListener('terminal:projections-props', handleProjectionsProps);
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
    window.addEventListener('terminal:market-insights-props', handleMarketInsightsProps);
    window.addEventListener('terminal:trading-console-props', handleTradingConsoleProps);
    window.addEventListener('terminal:external-links-props', handleExternalLinksProps);
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
    const handleBreakevenText = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail;
      if (detail) setBreakevenText(detail.text);
    };
    window.addEventListener('terminal:empty-state-props', handleEmptyStateProps);
    window.addEventListener('terminal:board-title', handleBoardTitle);
    window.addEventListener('terminal:breakeven-text', handleBreakevenText);
    window.addEventListener('terminal:analyst-consensus', handleAnalystConsensus);
    window.addEventListener('terminal:cloud-status', handleCloudStatus);
    window.addEventListener('terminal:cloud-sync-status', handleCloudSyncStatus);
    window.addEventListener('terminal:startup-state', handleStartupState);
    return () => {
      window.removeEventListener('terminal:scenario-modal', handleScenarioModal);
      window.removeEventListener('terminal:auth-visibility', handleAuthVisibility);
      window.removeEventListener('terminal:active-view', handleDeskView);
      window.removeEventListener('terminal:cash-cushion-props', handleCashCushionProps);
      window.removeEventListener('terminal:settings-props', handleSettingsProps);
      window.removeEventListener('terminal:ticker-tabs-props', handleTickerTabsProps);
      window.removeEventListener('terminal:summary-metrics-props', handleSummaryMetricsProps);
      window.removeEventListener('terminal:projections-props', handleProjectionsProps);
      window.removeEventListener('terminal:market-insights-props', handleMarketInsightsProps);
      window.removeEventListener('terminal:trading-console-props', handleTradingConsoleProps);
      window.removeEventListener('terminal:external-links-props', handleExternalLinksProps);
      window.removeEventListener('terminal:empty-state-props', handleEmptyStateProps);
      window.removeEventListener('terminal:board-title', handleBoardTitle);
      window.removeEventListener('terminal:breakeven-text', handleBreakevenText);
      window.removeEventListener('terminal:analyst-consensus', handleAnalystConsensus);
      window.removeEventListener('terminal:cloud-status', handleCloudStatus);
      window.removeEventListener('terminal:cloud-sync-status', handleCloudSyncStatus);
      window.removeEventListener('terminal:startup-state', handleStartupState);
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
          <div id="cashCushionContainer" class={"space-y-3 " + (["CASH_CUSHION", "BALANCE"].includes(activeDeskView) ? "" : "hidden")}>{hasOpenedCashCushion && <CashCushionDesk {...cashCushionProps} />}</div>

          {/* Keep the command console available on both Margin and Cash desks. */}
          <div id="tradingTerminalColumn" class="trading-terminal-column">
            <section
              id="marketInsightsPanel"
              class={"market-insights-workspace space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10 " + (["CASH_CUSHION", "BALANCE", "CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
              aria-label="Market insights"
            >{marketInsightsProps && <MarketInsightsPanel {...marketInsightsProps} />}</section>
            <div
              id="tradingConsoleCard"
              class={"trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 w-full " + (["CLOSED_HISTORY", "SETTINGS"].includes(activeDeskView) ? "hidden" : "")}
            >{tradingConsoleProps && <TradingConsole {...tradingConsoleProps} />}</div>
          </div>

        </div>
      </main>

      {/* Closed Trade History */}
      <div
        id="closedHistoryContainer"
        class={"rounded-lg " + (activeDeskView === "CLOSED_HISTORY" ? "" : "hidden")}
      >{hasOpenedClosedHistory && <ClosedHistoryDesk />}</div>

      {/* Settings */}
      <div class={"p-4 sm:p-6 rounded-xl space-y-4 " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings">{hasOpenedSettings && settingsProps && <SettingsDesk {...settingsProps} />}</div>

      {/* Authentication is part of the application tree, not a second Preact root. */}
      <div id="auth-container" class="auth-overlay" style={{ display: authOpen ? 'flex' : 'none' }}>
        <AuthModal isOpen={authOpen} onSaveSecret={onSaveGatewaySecret} />
      </div>
      {scenarioModalData && <ScenarioComparisonModal data={scenarioModalData} onClose={closeScenarioModal} />}
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
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('terminal:startup-retry'))}>Retry</button>
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('terminal:startup-offline'))}>Continue offline</button>
          </div>}
        </div>
      </div>}
    </>
  );
}