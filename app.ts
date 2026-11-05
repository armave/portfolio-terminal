import { emitUiEvent, addUiEventListener } from './src/ui/uiEventBus';
import { getAppLanguage, translateText } from './src/services/i18n';
import { addBrokerEventListener } from './src/services/brokerEventBus';
import { setAiStatus, setBreakevenText, setCloudStatusState, setCloudSyncStatus, setAnalystConsensus } from './src/ui/uiStateStore';
import {
  calculateBreakevenDays,
  calculateCommission,
  resolveCommissionConfig,
  calculateProjectedDebt,
  calculateMarginInterest,
  collectOpenPositionTranches,
  createPortfolioBackupSnapshot,
  normalizePortfolioBackup,
  resolveSaleQuantity,
} from './src/domain/portfolio';
import { extractGeminiResponseText, parseAiIntent, type PortfolioActionIntent } from './src/features/ai/intent';
import { applyAiPortfolioActionAfterConfirmation } from './src/features/ai/confirmedPortfolioAction';
import { bindPortfolioNavigationRuntime } from './src/services/portfolioNavigationRuntime';
import { buildIntentPrompt } from './src/features/ai/prompt';
import {
  calculateTargetUpsidePercent,
} from './src/features/quotes/sentiment';
import { fetchLivePriceFromProviders, nextLiveQuoteRequestSequence } from './src/services/quoteProvider';
import type { FreedomQuoteStreamRuntime } from './src/services/freedomQuoteStreamRuntime';
import type { FreedomAccountStreamRuntime } from './src/services/freedomAccountStreamRuntime';
import { resolveFreedomAccountRefreshMode } from './src/services/freedomAccountStreamHealth';
import { refreshTrackedQuotes } from './src/services/quotePolling';
import { createQuoteRefreshCoordinator } from './src/services/quoteRefreshCoordinator';
import { bindPortfolioSyncRuntime } from './src/services/portfolioSyncRuntime';
import { createPortfolioBrokerRefreshRuntime } from './src/services/portfolioBrokerRefreshRuntime';
import { createPortfolioStartupLifecycleRuntime } from './src/services/portfolioStartupLifecycleRuntime';
import { createPortfolioEquitySyncRuntime } from './src/services/portfolioEquitySyncRuntime';
import { createPortfolioStartupRuntime } from './src/services/portfolioStartupRuntime';
import { createPortfolioAuthenticatedStartupRuntime } from './src/services/portfolioAuthenticatedStartupRuntime';
import { createPortfolioSessionRuntime } from './src/services/portfolioSessionRuntime';
import { createPortfolioAuthenticationRuntime } from './src/services/portfolioAuthenticationRuntime';
import {
  createPortfolioAutoRefreshScheduler,
  DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
  DEFAULT_GUEST_REFRESH_INTERVAL_MS,
  normalizeQuoteRefreshInterval
} from './src/services/portfolioAutoRefresh';
import { getMarketInsightsTicker, isCurrentMarketInsightsTicker } from './src/domain/portfolioSelectors';
import { getPositiveMarketPrice } from './src/domain/portfolioValuation';
import { commitPortfolioBackupImport } from './src/services/backupImport';
import { buildPortfolioBackupFilename, createPortfolioBackupBlob, validatePortfolioBackupFileSize } from './src/services/portfolioBackupFile';
import { getLatestRolloverTimestamp, getRolloverTimestampForLocalDate, getZonedDateParts, shiftCalendarDate } from './src/domain/rolloverCalendar';
import {
  fetchYahooDeepStockData,
  createFreedomQuoteStreamTicket,
  buildFreedomQuoteStreamSocketUrl,
  createFreedomAccountStreamTicket,
  buildFreedomAccountStreamSocketUrl,
  clearCloudHistory,
  clearFreedomCashflowCache,
  fetchFreedomCashflows,
  pullCloudHistory,
  pushCloudHistory,
  proxyFetch,
  setSecretGetter,
  syncCloudState as syncCloudStateService,
  validateGatewaySecret,
  getAuthStatus,
  getCurrentUser,
  listUsers,
  logoutAccount,
  normalizeFreedomTrades,
  clearFreedomTradeNetStreamSnapshotCache,
  getGuestPortfolioSnapshot,
  publishGuestPortfolioSnapshots as publishGuestPortfolioSnapshotsBatch,
  clearCloudEncryptionSecretCache
} from './src/services/api';
import {
  areHeaderCredentialsConfigured,
  clearBrokerRules,
  getGatewaySecret,
  getQuoteRefreshInterval,
  loadBrokerRules,
  restoreGatewaySecret,
  persistGatewaySecret,
  loadSavedState,
  loadSavedHistory,
  hasFreedomCashflowHistoryBaseline,
  markFreedomCashflowHistoryBaseline,
  savePortfolioSnapshot,
  saveApiKeys,
  saveGatewaySecret,
  saveQuoteRefreshInterval,
  saveState,
  hydratePortfolioPersistence,
} from './src/services/storage';
import {
  clearTerminalLog,
  logTerminal,
  showToast
} from './src/ui/notifications';
import {
  renderBoard as renderBoardUI,
} from './src/ui/renderBoard';
import { getTotalPortfolioInvested } from './src/domain/portfolioSelectors';
import { DEFAULT_BROKER_ASSUMPTIONS, normalizeBrokerAssumptions } from './src/domain/brokerAssumptions';
import { calculatePortfolioValuation } from './src/domain/portfolioValuation';
import { formatUSD } from './src/utils/formatters';
import { migrateLegacyCloudHoldingsToPositions, PORTFOLIO_PERSISTENCE_ERROR_MESSAGE, portfolioStore } from './src/store/portfolioStore';
import { createBlankPortfolioState } from './src/store/portfolioDefaults';
import {
  applyCashflowAllocationsToBrokerExecutions,
  applyCashflowAllocationsToClosedTrades,
  mergeBrokerExecutionHistory,
  preservePersistedBrokerFeeAllocations
} from './src/domain/closedHistoryFees';
import {
  getFreedomCashflowRefreshStartDate,
  mergeFreedomCashflowRows,
  normalizeFreedomCashflowRows,
  normalizeSavedFreedomCashflows
} from './src/domain/freedomCashflows';
import { calculateFreedomMarginFeeAllocations } from './src/domain/freedomMarginFees';
import { getLatestClosedTradeDate } from './src/domain/tradeHistorySync';
import { applyActiveLimitSellTargets, classifyFreedomPortfolio, getActiveLimitSellTargets, getActiveTranchesFromTrades, normalizeActiveTrancheMix } from './src/domain/freedomPortfolio';
import { getAssignableActiveTrancheCashQuantity } from './src/domain/activeTrancheGuestAssignment';
import { createGuestPortfolioHydrationRuntime } from './src/services/guestPortfolioHydrationRuntime';
import { createGuestPortfolioAssignmentRuntime } from './src/services/guestPortfolioAssignmentRuntime';
import { createSessionIdentityGuard } from './src/utils/sessionIdentityGuard';
import { CommandDispatcher } from './src/features/terminal/commandDispatcher';
import type { ScenarioModalData } from './src/features/terminal/scenarioContracts';
import type { BrokerAssumptions, PortfolioState, QuoteDetails } from './src/types/portfolio';

// ==========================================
// USER-CONFIGURABLE BROKER DEFAULT ASSUMPTIONS
// ==========================================
const DEFAULT_TRADERNET_RULES: BrokerAssumptions = DEFAULT_BROKER_ASSUMPTIONS;
const TRADERNET_RULES: BrokerAssumptions = { ...DEFAULT_TRADERNET_RULES };

let state: PortfolioState = portfolioStore.getState();

/** Clear workspace data without resetting device/account settings. */
function createCleanWorkspaceState(now = Date.now()): PortfolioState {
  const current = portfolioStore.getState();
  return {
    ...createBlankPortfolioState(now),
    brokerAssumptions: current.brokerAssumptions,
    apiKeys: current.apiKeys,
    gatewaySecret: current.gatewaySecret,
    autoRefreshInterval: current.autoRefreshInterval
  };
}
// Guest sessions may read the shared snapshot, but must never enqueue cloud writes.
let canWriteCloudState = false;
let currentAccountRole: 'admin' | 'guest' | null = null;
let currentAccountId: string | null = null;
const currentAccountSessionGuard = createSessionIdentityGuard(null);
const guestPortfolioAssignmentRuntime = createGuestPortfolioAssignmentRuntime({
  getAccountRole: () => currentAccountRole,
  requireAdmin: (action) => requireAdmin(action),
  getState: () => portfolioStore.getState(),
  setState: (updates) => {
    portfolioStore.setState(updates);
    state = portfolioStore.getState();
  },
  persistState: (nextState) => saveState(nextState),
  pushState: () => pushStateToGist(),
  listUsers,
  publishBatch: publishGuestPortfolioSnapshotsBatch,
  renderBoard,
  showToast,
  logError: (message, error) => console.error(message, error),
  logTerminal
});
guestPortfolioAssignmentRuntime.bind();
let gistSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let guestCloudRefreshInFlight: Promise<unknown> | null = null;
let lastRenderedDeskView: string | null = null;
const livePriceRequests = new Map<string, Promise<any>>();
let initialQuoteRefreshPending = false;
const boardAnalystSnapshots = new Map<string, any>();
const boardAnalystErrors = new Map<string, any>();
const boardAnalystRequests = new Map<string, Promise<void>>();
const BOARD_ANALYST_CACHE_TTL_MS = 5 * 60 * 1000;
const BOARD_ANALYST_RETRY_MS = 60 * 1000;

// Broker requests are coordinated through a typed adapter shared by manual sync
// and scheduled account refreshes. Broker response handlers remain app-owned.
const portfolioBrokerRefreshRuntime = createPortfolioBrokerRefreshRuntime();

// Automatic quote and supplemental-data cadence is centralized in the
// role-aware portfolio auto-refresh scheduler.

// Cached broker limit prices must win over default targets during asynchronous refreshes.
let activeLimitSellTargets: Record<string, number> = {};
let activeOrdersRefreshWarned = false;
let executedTradesRefreshWarned = false;

// ==========================================
// CLOUDFLARE WORKERS KV REPLICATION ENGINE
// ==========================================
function setCloudStatus(status: string, text: string) {
  setCloudStatusState({ status, text });
}

// Freedom is authoritative for broker-reported account balance, aggregate
// holdings and available broker prices. App-owned lots/cost basis remain local.
addBrokerEventListener('broker:account-info', (snapshot) => {
  if (currentAccountRole !== 'admin') return;
  if (!snapshot || snapshot.loaded !== true || !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.balances)) return;
  const current = portfolioStore.getState();
  const executedTrades = Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
  const classified = classifyFreedomPortfolio(
    snapshot,
    current.positions || {},
    current.cashCushion?.holdings || [],
    current.activeTrancheTypes || {},
    Date.now(),
    executedTrades,
    resolveCommissionConfig(TRADERNET_RULES),
    current.activeTrancheMixes || {}
  );
  const brokerCashHoldings = classified.cashStocks.map((holding) => {
    const price = getPositiveMarketPrice(holding.currentPrice, holding.price);
    return {
      ...holding,
      // The compatibility projection stores numeric shares/prices even though
      // imported cash-cushion rows may retain numeric strings.
      shares: Number(holding.shares) || 0,
      currentPrice: price ?? (typeof holding.currentPrice === 'number' ? holding.currentPrice : undefined),
      ...(price !== null ? { price } : {})
    };
  });
  const usdBalance = snapshot.balances.find((item) =>
    String(item.currency ?? '').toUpperCase() === 'USD' && Number.isFinite(Number(item.amount))
  );

  portfolioStore.setState({
    brokerAccountInfo: { ...snapshot, receivedAt: Date.now(), status: 'current' },
    ...(usdBalance ? { balance: Number(usdBalance.amount) } : {}),
    positions: applyActiveLimitSellTargets(classified.positions, activeLimitSellTargets),
    cashStocks: brokerCashHoldings,
    cashCushion: {
      ...(current.cashCushion || { freeCash: 0, holdings: [] }),
      holdings: brokerCashHoldings
    }
  });
  logTerminal('[Freedom] Active tickers, cash/margin classifications, balance and prices refreshed.');
  renderBoard();
  void guestPortfolioAssignmentRuntime.publishGuestPortfolioSnapshots();
});

addBrokerEventListener('broker:executed-trades-error', () => {
  if (currentAccountRole === 'admin') {
    guestPortfolioAssignmentRuntime.setBrokerTradeHistoryLoaded(false);
    if (!executedTradesRefreshWarned) {
      executedTradesRefreshWarned = true;
      showToast(translateText('Freedom trade history is unavailable — saved executions are being retained.'), 'warning');
      logTerminal(translateText('[Freedom Warning] Trade history refresh failed; retained executions may be out of date.'));
    }
  }
});

addBrokerEventListener('broker:executed-trades', (trades) => {
  if (currentAccountRole !== 'admin') return;
  if (!Array.isArray(trades)) return;
  executedTradesRefreshWarned = false;
  guestPortfolioAssignmentRuntime.setBrokerTradeHistoryLoaded(true);
  const current = portfolioStore.getState();
  // portfolioStore.setState persists synchronously. Reattach local fee allocations
  // BEFORE setting raw broker rows, otherwise this listener overwrites the
  // separately persisted, fee-enriched history before ClosedHistoryDesk handles
  // the same event.
  const savedFeeRows = normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades);
  const tradesWithPersistedFees = preservePersistedBrokerFeeAllocations(
    trades,
    [...savedFeeRows, ...(current.brokerExecutedTrades || [])]
  );
  portfolioStore.setState({ brokerExecutedTrades: tradesWithPersistedFees });
  // Execution-history changes affect active/closed guest lots, independent of
  // whether the latest broker account snapshot is currently available.
  void guestPortfolioAssignmentRuntime.publishGuestPortfolioSnapshots();
  const snapshot = current.brokerAccountInfo;
  if (!snapshot?.loaded || !Array.isArray(snapshot.positions)) return;
  const classified = classifyFreedomPortfolio(
    snapshot,
    current.positions || {},
    current.cashCushion?.holdings || [],
    current.activeTrancheTypes || {},
    Date.now(),
    tradesWithPersistedFees,
    resolveCommissionConfig(TRADERNET_RULES),
    current.activeTrancheMixes || {}
  );
  const brokerCashHoldings = classified.cashStocks.map((holding) => {
    const price = getPositiveMarketPrice(holding.currentPrice, holding.price);
    return {
      ...holding,
      // The compatibility projection stores numeric shares/prices even though
      // imported cash-cushion rows may retain numeric strings.
      shares: Number(holding.shares) || 0,
      currentPrice: price ?? (typeof holding.currentPrice === 'number' ? holding.currentPrice : undefined),
      ...(price !== null ? { price } : {})
    };
  });
  portfolioStore.setState({
    positions: applyActiveLimitSellTargets(classified.positions, activeLimitSellTargets),
    cashStocks: brokerCashHoldings,
    cashCushion: {
      ...(current.cashCushion || { freeCash: 0, holdings: [] }),
      holdings: brokerCashHoldings
    }
  });
  renderBoard();
});

addBrokerEventListener('broker:set-active-tranche-type', async (detail) => {
  if (!(await requireAdmin('change active tranche classifications'))) return;
  const operationId = String(detail?.ticker || '').trim();
  const selectedType = detail?.type;
  if (!operationId || (selectedType !== 'cash' && selectedType !== 'margin' && selectedType !== 'mix')) return;

  const current = portfolioStore.getState();
  const activeTrancheTypes = { ...(current.activeTrancheTypes || {}), [operationId]: selectedType };
  const activeTrancheMixes = { ...(current.activeTrancheMixes || {}) };
  const availableTrades = Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
  const activeTranche = getActiveTranchesFromTrades(availableTrades, current.brokerAccountInfo)
    .find((tranche) => tranche.id === operationId);
  if (selectedType === 'mix') {
    const previousType = current.activeTrancheTypes?.[operationId] ||
      current.activeTrancheTypes?.[operationId.split(':')[0]] || 'cash';
    const requestedMix = detail.mix || activeTrancheMixes[operationId] ||
      (previousType === 'margin'
        ? { cash: 0, margin: activeTranche?.quantity ?? 0 }
        : { cash: activeTranche?.quantity ?? 0, margin: 0 });
    const quantity = activeTranche?.quantity ??
      (Math.max(0, Number(requestedMix.cash) || 0) + Math.max(0, Number(requestedMix.margin) || 0));
    activeTrancheMixes[operationId] = normalizeActiveTrancheMix(quantity, requestedMix);
  }

  const activeTrancheGuestAssignments = { ...(current.activeTrancheGuestAssignments || {}) };
  const activeTrancheGuestAssignmentDetails = { ...(current.activeTrancheGuestAssignmentDetails || {}) };
  if (activeTranche && getAssignableActiveTrancheCashQuantity(
    selectedType,
    activeTranche.quantity,
    activeTrancheMixes[operationId]
  ) <= 0) {
    delete activeTrancheGuestAssignments[operationId];
    delete activeTrancheGuestAssignmentDetails[operationId];
  }

  const snapshot = current.brokerAccountInfo;
  if (!snapshot?.loaded || !Array.isArray(snapshot.positions)) {
    portfolioStore.setState({ activeTrancheTypes, activeTrancheMixes, activeTrancheGuestAssignments, activeTrancheGuestAssignmentDetails });
    // Persist the preference even when broker data is not ready yet.
    saveState(state);
    pushStateToGist();
    return;
  }
  const executedTrades = Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
  const classified = classifyFreedomPortfolio(
    snapshot,
    current.positions || {},
    current.cashCushion?.holdings || [],
    activeTrancheTypes,
    Date.now(),
    executedTrades,
    resolveCommissionConfig(TRADERNET_RULES),
    activeTrancheMixes
  );
  const brokerCashHoldings = classified.cashStocks.map((holding) => {
    const price = getPositiveMarketPrice(holding.currentPrice, holding.price);
    return {
      ...holding,
      // The compatibility projection stores numeric shares/prices even though
      // imported cash-cushion rows may retain numeric strings.
      shares: Number(holding.shares) || 0,
      currentPrice: price ?? (typeof holding.currentPrice === 'number' ? holding.currentPrice : undefined),
      ...(price !== null ? { price } : {})
    };
  });
  portfolioStore.setState({
    activeTrancheTypes,
    activeTrancheMixes,
    activeTrancheGuestAssignments,
    activeTrancheGuestAssignmentDetails,
    positions: applyActiveLimitSellTargets(classified.positions, activeLimitSellTargets),
    cashStocks: brokerCashHoldings,
    cashCushion: {
      ...(current.cashCushion || { freeCash: 0, holdings: [] }),
      holdings: brokerCashHoldings
    }
  });
  // Store updates persist locally immediately; push explicitly so the local write doesn't suppress cloud sync.
  saveState(state);
  pushStateToGist();
  void guestPortfolioAssignmentRuntime.publishGuestPortfolioSnapshots();
  const ticker = operationId.split(':')[0];
  logTerminal(`[Freedom] ${ticker} purchase operation classified as ${selectedType}.`);
  renderBoard();
});

addBrokerEventListener('broker:active-orders', (orders) => {
  if (currentAccountRole !== 'admin') return;
  if (!Array.isArray(orders)) return;
  activeOrdersRefreshWarned = false;

  // Cache the broker's exact limit price so a slower account/trade refresh
  // cannot replace it with the locally calculated default target.
  const marginQuantities = Object.values(portfolioStore.getState().positions || {}).reduce((quantities, position: any) => {
    const ticker = String(position?.ticker || '').trim().toUpperCase().replace(/\.US$/i, '');
    const shares = Number(position?.shares);
    if (ticker && Number.isFinite(shares) && shares > 0) quantities[ticker] = (quantities[ticker] || 0) + shares;
    return quantities;
  }, {} as Record<string, number>);
  activeLimitSellTargets = getActiveLimitSellTargets(orders, marginQuantities);
  /* const orderDiagnostics = orders
    .filter(order => Object.keys(marginQuantities).includes(String(order.ticker || '').trim().toUpperCase().replace(/\.US$/i, '')))
    .map(order => [
      String(order.ticker || '?').toUpperCase(),
      Number(order.limitPrice) > 0 ? '$' + Number(order.limitPrice).toFixed(2) : 'no-price',
      'remaining=' + String(order.remainingQuantity ?? '?'),
      'status=' + String(order.status || '?'),
      'operation=' + String(order.operation ?? '?'),
      'type=' + String(order.orderType ?? '?'),
      'id=' + String(order.id || '?')
    ].join(' ')).join('; ');
   const targetDiagnostics = Object.entries(activeLimitSellTargets)
    .map(([ticker, price]) => ticker + '=$' + price.toFixed(2))
    .join(', ');
   logTerminal('[Freedom] Active sell target sync: ' + (targetDiagnostics || 'no target selected') +
    '; tracked quantities=' + JSON.stringify(marginQuantities) +
    '; orders=' + (orderDiagnostics || 'none') + '.'); */
  const current = portfolioStore.getState();
  const positions = applyActiveLimitSellTargets(current.positions || {}, activeLimitSellTargets);
  const updates: Array<{ ticker: string; price: number }> = [];
  for (const [ticker, position] of Object.entries(positions)) {
    const previous = current.positions?.[ticker];
    if (Number(previous?.pt) !== Number(position.pt)) {
      updates.push({ ticker: String(position.ticker || ticker).trim().toUpperCase(), price: Number(position.pt) });
    }
  }

  if (!updates.length) return;
  portfolioStore.setState({ positions });
  saveState(state, pushStateToGist);
  for (const update of updates) {
    logTerminal(`[Freedom] Updated ${update.ticker} target from active limit sell: ${update.price.toFixed(2)}.`);
  }
  renderBoard();
});

addBrokerEventListener('broker:active-orders-error', () => {
  if (currentAccountRole !== 'admin' || activeOrdersRefreshWarned) return;
  // Keep the last known targets on failure and avoid repeating a warning on every poll.
  activeOrdersRefreshWarned = true;
  showToast(translateText('Freedom active orders are unavailable — existing position targets are unchanged.'), 'warning');
  logTerminal(translateText('[Freedom Warning] Active-order refresh failed; existing position targets were left unchanged.'));
});

addBrokerEventListener('broker:account-info-error', () => {
  const current = portfolioStore.getState();
  if (current.brokerAccountInfo) {
    portfolioStore.setState({
      brokerAccountInfo: { ...current.brokerAccountInfo, status: 'stale' }
    });
  }
  showToast('Freedom account data unavailable — saved portfolio data is being retained.', 'warning');
  logTerminal('[Freedom Warning] Account refresh failed; retained local data and marked the last broker snapshot stale.');
});

const guestPortfolioHydrationRuntime = createGuestPortfolioHydrationRuntime({
  getSessionIdentity: (missingGeneration) => {
    const identity = currentAccountSessionGuard.capture();
    return {
      role: currentAccountRole,
      accountId: currentAccountId,
      secret: getGatewaySecret(),
      generation: identity?.generation ?? missingGeneration
    };
  },
  getGuestPortfolioSnapshot,
  getActiveView: () => portfolioStore.getState().activeView,
  getCurrentCashHoldings: () => portfolioStore.getState().cashCushion?.holdings || [],
  createCleanWorkspaceState,
  importGuestWorkspace: (guestWorkspace) => {
    portfolioStore.importState(guestWorkspace);
    state = portfolioStore.getState();
    saveState(state);
    renderBoard();
  }
});

/** Hydrate a guest from their server-scoped projection, never from the shared portfolio. */
async function pullGuestPortfolioSnapshot(): Promise<void> {
  await guestPortfolioHydrationRuntime.pullGuestPortfolioSnapshot();
}

let startupCloudWritesSuppressed = true;
let startupCloudWritePending = false;

createPortfolioEquitySyncRuntime({
  subscribe: (listener) => portfolioStore.subscribe((nextStoreState, source) => {
    state = nextStoreState;
    listener(nextStoreState, source);
  }),
  getState: () => portfolioStore.getState(),
  calculateEquity: (nextStoreState) => calculatePortfolioValuation({
    signedAccountBalance: nextStoreState.balance,
    freeCash: nextStoreState.cashCushion?.freeCash,
    marginPositions: Object.values(nextStoreState.positions || {}),
    cashHoldings: nextStoreState.cashCushion?.holdings || []
  }).equity,
  setDerivedEquity: (equity, updatedAt, persist) => {
    portfolioStore.setDerivedState({
      portfolioEquity: equity,
      portfolioEquityUpdatedAt: updatedAt
    }, persist);
  },
  onDurableEquityChanged: () => { void pushStateToCloud(); }
});

async function pushStateToCloud(forceImmediate = false): Promise<boolean> {
  if (!canWriteCloudState) {
    if (gistSyncTimeout) clearTimeout(gistSyncTimeout);
    gistSyncTimeout = null;
    return false;
  }

  if (!areHeaderCredentialsConfigured()) {
    setCloudStatus('idle', 'ADD SECRET');
    return false;
  }

  if (startupCloudWritesSuppressed) {
    startupCloudWritePending = true;
    return false;
  }

  portfolioStore.setState({ lastUpdated: Date.now() });
  state = portfolioStore.getState();

  const doPush = async (): Promise<boolean> => {
    setCloudStatus('syncing', 'WRITING...');
    try {
      const ok = await syncCloudState('push');
      if (ok) {
        setCloudStatus('synced', 'UPDATED');
        return true;
      }

      setCloudStatus('error', 'FAIL');
      return false;
    } catch (err: any) {
      logTerminal(`[KV Cloud Sync Error]: ${err.message}`);
      setCloudStatus('error', 'FAIL');
      return false;
    }
  };

  if (forceImmediate) {
    if (gistSyncTimeout) clearTimeout(gistSyncTimeout);
    return doPush();
  }

  if (gistSyncTimeout) clearTimeout(gistSyncTimeout);
  gistSyncTimeout = setTimeout(() => { void doPush(); }, 600);
  return true;
}

const pushStateToGist = pushStateToCloud;

function pullCloudAndRewriteLocal(parsedState: any) {
  const currentView = state.activeView;
  const compatibleCloudState = migrateLegacyCloudHoldingsToPositions(parsedState, state);
  const mergedState = { ...state, ...compatibleCloudState };
  if (currentAccountRole === 'guest') {
    // The shared snapshot may contain the admin's last-opened desk. Guest login
    // always starts on Balance instead of inheriting that shared navigation state.
    mergedState.activeView = 'CASH_CUSHION';
  } else if (!parsedState?.activeView && currentView) {
    mergedState.activeView = currentView;
  }
  portfolioStore.importState(loadSavedState(mergedState));
  state = portfolioStore.getState();
  switchView(state.activeView);
  console.log("[Sync]: Cloud state ingested and UI re-rendered successfully.", state);
  emitUiEvent('terminal:scroll-workspace');
}

async function syncCloudState(mode = 'push') {
  if (currentAccountRole === 'guest') {
    if (mode === 'pull') {
      await pullGuestPortfolioSnapshot();
      return true;
    }
    return false;
  }
  const requestSession = currentAccountSessionGuard.capture();
  return syncCloudStateService(mode, {
    state,
    getState: () => state,
    isCurrentSession: () => requestSession !== null && currentAccountSessionGuard.isCurrent(requestSession),
    allowCloudWrites: canWriteCloudState,
    pullCloudAndRewriteLocal,
    showToast: (msg: string, type?: string) => showToast(msg, type as any),
    logTerminal,
    onStatusChange: (status) => {
      setCloudSyncStatus(status === 'synced'
        ? { text: `${translateText('Synced')}: ${new Date().toLocaleTimeString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')}`, status: 'synced' }
        : { text: 'Sync failed', status: 'error' });
    }
  });
}

async function resetToBlankState(): Promise<void> {
  const resetSession = currentAccountSessionGuard.capture();
  const resetSecret = getGatewaySecret();
  const isResetSessionCurrent = () =>
    currentAccountRole === 'admin' &&
    resetSession !== null &&
    currentAccountSessionGuard.isCurrent(resetSession) &&
    getGatewaySecret() === resetSecret;
  if (!isResetSessionCurrent()) return;

  if (!confirm(translateText("Reset the terminal to a blank slate? This clears saved portfolio and history data locally and in KV cloud. It does not delete TradeNet records held by the broker; those read-only records may reappear when broker history is refreshed."))) {
    return;
  }
  if (!isResetSessionCurrent()) return;

  const previousState = portfolioStore.getState();
  let previousDeviceActiveView: string | null = null;
  try {
    previousDeviceActiveView = localStorage.getItem('portfolio_active_view');
  } catch {
    // The snapshot helper will report unavailable storage if it cannot commit.
  }
  // Defer the store's ordinary save so the blank portfolio, explicit empty
  // history sidecar, and device-local active-view preference can be committed
  // together. If any write fails, restore the previous in-memory snapshot.
  portfolioStore.resetToBlankState(Date.now(), false);
  state = portfolioStore.getState();
  const localSnapshotSaved = savePortfolioSnapshot(
    state,
    { brokerExecutedTrades: [], cashflows: [] },
    { deviceActiveView: 'COMBINED' }
  );

  if (!localSnapshotSaved) {
    try {
      if (previousDeviceActiveView === null) localStorage.removeItem('portfolio_active_view');
      else localStorage.setItem('portfolio_active_view', previousDeviceActiveView);
    } catch (error) {
      console.error('Could not restore the previous device desk preference after reset rollback:', error);
    }
    portfolioStore.update(() => previousState, false);
    state = portfolioStore.getState();
    renderBoard();
    showToast(
      "Portfolio reset was cancelled because the complete local snapshot could not be saved. Your previous portfolio and history have been retained.",
      "error"
    );
    logTerminal("[System]: Portfolio reset cancelled; local storage could not commit the portfolio and history together.");
    return;
  }

  // Only enqueue remote writes after the complete local reset is durable.
  pushStateToGist(true);
  renderBoard();
  logTerminal("[System]: Portfolio reset to a clean blank slate.");

  try {
    const historyCleared = await clearCloudHistory(resetSecret, { isCurrentSession: isResetSessionCurrent });
    if (!isResetSessionCurrent()) return;
    if (!historyCleared) {
      throw new Error("The cloud history reset was not confirmed. Verify cloud access and retry.");
    }
    logTerminal("[System]: Closed trade history cleared from KV cloud.");
  } catch (error) {
    if (!isResetSessionCurrent()) return;
    const detail = error instanceof Error ? error.message : "Unknown cloud history error.";
    console.error("Unable to clear closed history from KV cloud:", error);
    showToast(
      "The portfolio was reset locally, but cloud closed history could not be cleared. Restore cloud access and retry the reset.",
      "error"
    );
    logTerminal(`[KV Cloud Error]: Closed history reset failed: ${detail}`);
  }
}

function calcCommission(shares: number, totalVal: number) {
  return calculateCommission(shares, totalVal, resolveCommissionConfig(TRADERNET_RULES));
}

function getDailyRate() {
  return TRADERNET_RULES.annualBorrowRate / TRADERNET_RULES.dayCountBasis;
}

function loadTradernetRules() {
  const savedRules = loadBrokerRules();
  const normalized = normalizeBrokerAssumptions(savedRules, portfolioStore.getState().brokerAssumptions);
  Object.assign(TRADERNET_RULES, normalized);
  if (savedRules !== null) portfolioStore.updateAssumptions(normalized);
}

function saveBrokerRuleInputs(values: import('./src/components/SettingsDesk').BrokerRulesFormValues) {
  const [rolloverHour, rolloverMinute] = values.rolloverTime.split(':').map(Number);
  const previousRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  const requestedMaintenance = Number(values.maintenanceMargin) / 100;
  const requestedStopOut = Number(values.stopOutRatio) / 100;
  if (requestedStopOut > requestedMaintenance) {
    showToast('Stop-out equity must not exceed maintenance equity.', 'error');
    return;
  }
  const updatedRules = normalizeBrokerAssumptions({
    ...TRADERNET_RULES,
    annualBorrowRate: Number(values.annualRate) / 100,
    dayCountBasis: Number(values.dayCountBasis),
    maintenanceEquityRatio: requestedMaintenance,
    stopOutRatio: requestedStopOut,
    rolloverHour,
    rolloverMinute,
    commissionPerShare: Number(values.commPerShare),
    commissionRatePct: Number(values.commVolumePct) / 100,
    commissionMin: Number(values.minCommOrder)
  }, TRADERNET_RULES);
  if (!portfolioStore.updateAssumptions(updatedRules)) return;
  Object.assign(TRADERNET_RULES, updatedRules);
  const nextRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  if (previousRollover !== nextRollover) {
    if (!portfolioStore.setLastRolloverTimestamp(getLatestRolloverTimestamp(new Date(), TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone))) return;
    saveState(state, pushStateToGist);
  }
  verifyTradernetRulesOnload();
  renderBoard();
}
function resetBrokerRules() {
  const previousRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  if (!portfolioStore.updateAssumptions(DEFAULT_TRADERNET_RULES)) return;
  Object.assign(TRADERNET_RULES, DEFAULT_TRADERNET_RULES);
  clearBrokerRules();
  if (previousRollover !== `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`) {
    if (!portfolioStore.setLastRolloverTimestamp(getLatestRolloverTimestamp(new Date(), TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone))) return;
    saveState(state, pushStateToGist);
  }
  verifyTradernetRulesOnload();
  renderBoard();
}

function verifyTradernetRulesOnload() {
  const ratePct = (TRADERNET_RULES.annualBorrowRate * 100).toFixed(2);
  const dailyPct = (getDailyRate() * 100).toFixed(4);
  const maintenancePct = (TRADERNET_RULES.maintenanceEquityRatio * 100).toFixed(2);
  const rolloverTime = `${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')}`;
  const saveMsg =
    `Broker model: ${ratePct}% p.a. (${dailyPct}%/d, /${TRADERNET_RULES.dayCountBasis}) | ${rolloverTime} Armenia time compounding | Maintenance equity ${maintenancePct}%`;

  logTerminal(saveMsg);
}

function applyOvernightRollover(): boolean {
  const now = new Date();
  if (!Number.isFinite(Number(state.lastRolloverTimestamp)) || Number(state.lastRolloverTimestamp) <= 0) {
    const initialized = portfolioStore.setLastRolloverTimestamp(getLatestRolloverTimestamp(now, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone));
    if (initialized) saveState(state, pushStateToGist);
    return initialized;
  }

  let elapsedCycles = 0;
  const lastRolloverTimestamp = Number(state.lastRolloverTimestamp);
  const last = getZonedDateParts(new Date(lastRolloverTimestamp), TRADERNET_RULES.rolloverTimeZone);
  let rolloverDate = { year: last.year, month: last.month, day: last.day };
  let cursor = getRolloverTimestampForLocalDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone);
  if (cursor <= lastRolloverTimestamp) {
    rolloverDate = shiftCalendarDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, 1);
    cursor = getRolloverTimestampForLocalDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone);
  }
  while (cursor <= now.getTime()) {
    elapsedCycles++;
    rolloverDate = shiftCalendarDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, 1);
    cursor = getRolloverTimestampForLocalDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone);
  }

  if (elapsedCycles > 0 && Math.abs(state.balance) > 0) {
    const currentDebt = Math.abs(state.balance);
    const compoundedDebt = calculateProjectedDebt(currentDebt, getDailyRate(), elapsedCycles);
    const interestAccrued = calculateMarginInterest(currentDebt, getDailyRate(), elapsedCycles);

    const tickers = Object.keys(state.positions);
    const totalInvested = getTotalPortfolioInvested(state);
    const recordAsRealized = tickers.length === 0 || totalInvested === 0;

    if (!portfolioStore.applyRollover(compoundedDebt, interestAccrued, now.getTime(), recordAsRealized)) return false;
    saveState(state, pushStateToGist);
    logTerminal(`[Broker ${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')} Armenia rollover]: Processed ${elapsedCycles} cycle(s). Accrued interest: +${formatUSD(interestAccrued)}. Margin Debt: -${formatUSD(compoundedDebt)}.`);
  } else if (elapsedCycles > 0) {
    if (!portfolioStore.setLastRolloverTimestamp(now.getTime())) return false;
    saveState(state, pushStateToGist);
  }
  return true;
}

function setActiveView(view: string) {
  const normalizedView = view === 'BALANCE' ? 'CASH_CUSHION' : (view || 'COMBINED');
  // Desk selection is a per-browser preference. The store persists it locally;
  // a tab switch should not POST the entire shared portfolio to KV.
  portfolioStore.setActiveView(normalizedView);
  state = portfolioStore.getState();
  renderBoard();
}

const switchView = setActiveView;

function updateCombinedBreakeven() {
  const setText = (text: string) => setBreakevenText(text);

  const tickers = Object.keys(state.positions);
  const totalDebt = Math.abs(state.balance);

  let totalGrossTarget = 0;
  let totalInvested = 0;
  let totalComms = 0;
  let totalMarginCharged = state.realizedMarginCharged || 0;

  tickers.forEach(t => {
    const pos = state.positions[t];
    if (pos && pos.shares > 0) {
      const cost = (pos.tranches || []).reduce((sum: number, tr: any) => sum + (tr.qty * tr.price), 0);
      totalInvested += cost;
      const valSell = pos.shares * pos.pt;
      const commSell = calcCommission(pos.shares, valSell);
      totalGrossTarget += (valSell - cost);
      totalComms += (pos.commBuy || 0) + commSell;
    }
  });

  const tranchesForCombined = collectOpenPositionTranches(state.positions);
  const openMarginCharged = calculateMarginInterest(tranchesForCombined, {
    dailyRate: getDailyRate(),
    marginDebt: totalDebt,
    totalDebt
  });
  totalMarginCharged += openMarginCharged;

  const netTargetProfit = totalGrossTarget - totalComms - totalMarginCharged;

  if (tickers.length === 0 || totalInvested === 0) {
    setText("Combined Breakeven: No active trades");
    return;
  }

  if (totalDebt <= 0) {
    setText("Combined Breakeven: No margin debt");
    return;
  }

  if (netTargetProfit <= 0) {
    setText("Combined Breakeven: No date");
    return;
  }

  if (getDailyRate() === 0) {
    setText("Combined Breakeven: No date");
    return;
  }

  const beDays = calculateBreakevenDays(netTargetProfit, totalDebt, getDailyRate());
  if (beDays === null) {
    setText("Combined Breakeven: No non-negative breakeven date");
    return;
  }

  const beDate = new Date();
  beDate.setDate(beDate.getDate() + beDays);
  const beDateStr = beDate.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  setText(`Combined Breakeven: ${beDays} days (${beDateStr})`);
}

function renderBoard() {
  renderBoardUI(state, {
    rules: TRADERNET_RULES,
    onRenderAnalystConsensus: renderBoardAnalystConsensus,
    onUpdateCombinedBreakeven: updateCombinedBreakeven,
    lastDeskView: lastRenderedDeskView,
    onUpdateLastDeskView: (view: string) => { lastRenderedDeskView = view; }
  });

}

async function fetchBoardAnalystTarget(ticker: string, force = false) {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    const data = await fetchYahooDeepStockData(cleanTicker, force);
    const t = data?.analystTargets;
    const targetPrice = t?.median || t?.mean || t?.high;

    if (typeof targetPrice === "number" && Number.isFinite(targetPrice) && targetPrice > 0) {
      return {
        targetPrice,
        provider: "Yahoo",
        source: "Yahoo",
        targetMean: t.mean,
        targetHigh: t.high,
        targetLow: t.low,
        numberOfAnalysts: t.numberOfAnalysts || 0,
        consensus: t.consensusRecommendation || null,
        valuation: data.valuation,
        calendar: data.calendar,
        profile: data.profile
      };
    }
  } catch (err: unknown) {
    console.warn(`[Yahoo Worker Error for ${cleanTicker}]:`, err instanceof Error ? err.message : err);
  }

  throw new Error(`Analyst price target unavailable via proxy for ${cleanTicker}.`);
}

function renderBoardAnalystConsensus(ticker: string, force = false) {
  const publish = (text: string, title = '', className = 'hidden') => setAnalystConsensus({ text, title, className });
  const hideConsensus = () => publish('');
  if (!ticker || !state.positions[ticker]) {
    hideConsensus();
    return;
  }

  const now = Date.now();
  const snapshot = boardAnalystSnapshots.get(ticker);
  const error = boardAnalystErrors.get(ticker);
  const currentPrice = Number(state.positions[ticker].currentPrice);

  if (!force && snapshot && now - snapshot.fetchedAt < BOARD_ANALYST_CACHE_TTL_MS) {
    const upside = calculateTargetUpsidePercent(snapshot.targetPrice, currentPrice);
    if (upside !== undefined) {
      const color = upside > 0
        ? 'border-emerald-800 bg-emerald-950/40 text-emerald-300'
        : upside < 0
          ? 'border-rose-800 bg-rose-950/40 text-rose-300'
          : 'border-slate-700 bg-slate-900 text-slate-300';
      publish(`${snapshot.source} · ${formatUSD(snapshot.targetPrice)} · ${upside >= 0 ? '+' : ''}${upside.toFixed(2)}%`, `Target from ${snapshot.source}: ${formatUSD(snapshot.targetPrice)} versus current price ${formatUSD(currentPrice)}.`, `rounded border px-2.5 py-1 text-[10px] font-semibold ${color}`);
    } else {
      publish(`${snapshot.source} price target · ${formatUSD(snapshot.targetPrice)} · current price unavailable`, `Price target from ${snapshot.source}.`, 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-300');
    }
    return;
  }

  if (!force && error && now - error.failedAt < BOARD_ANALYST_RETRY_MS) {
    publish('Analyst target unavailable', error.message, 'rounded border border-amber-800 bg-amber-950/30 px-2.5 py-1 text-[10px] font-semibold text-amber-300');
    return;
  }

  if (initialQuoteRefreshPending && !snapshot) {
    publish('Loading analyst target…', 'Waiting for the initial batch quote refresh.', 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400');
    return;
  }

  if (boardAnalystRequests.has(ticker)) {
    return;
  }

  publish('Checking analyst target…', '', 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400');

  const request = fetchBoardAnalystTarget(ticker, force).then(result => {
    boardAnalystSnapshots.set(ticker, { ...result, fetchedAt: Date.now() });
    boardAnalystErrors.delete(ticker);
  }).catch(requestError => {
    const message = requestError instanceof Error ? requestError.message : String(requestError);
    boardAnalystErrors.set(ticker, { failedAt: Date.now(), message });
  }).finally(() => {
    boardAnalystRequests.delete(ticker);
    if (isCurrentMarketInsightsTicker(portfolioStore.getState(), ticker)) renderBoardAnalystConsensus(ticker);
  });
  boardAnalystRequests.set(ticker, request);
}

function recordTrackedPrice(
  ticker: string,
  price: number,
  sourceName: string,
  updatedAt: number | null = null,
  quoteDetails: QuoteDetails | null = null,
  requestStartedAt?: number
) {
  const symbol = ticker.trim().toUpperCase();
  const current = portfolioStore.getState();
  const matched = Boolean(
    current.positions[symbol] ||
    current.cashCushion?.holdings?.some((holding: any) => holding.ticker.trim().toUpperCase() === symbol) ||
    current.cashStocks?.some((holding: any) => holding.ticker.trim().toUpperCase() === symbol) ||
    current.guestPortfolioSnapshot?.tranches?.some((tranche) => tranche.ticker.trim().toUpperCase() === symbol)
  );
  if (!matched) return false;

  return portfolioStore.updateLiveQuote(symbol, {
    price,
    quoteSource: sourceName,
    ...(updatedAt === null ? {} : { quoteUpdatedAt: updatedAt }),
    ...(quoteDetails ? { quoteDetails } : {}),
    ...(requestStartedAt === undefined ? {} : { requestStartedAt })
  });
}

let freedomAccountStreamRuntimePromise: Promise<FreedomAccountStreamRuntime> | null = null;

function getFreedomAccountStreamRuntime(): Promise<FreedomAccountStreamRuntime> {
  if (!freedomAccountStreamRuntimePromise) {
    freedomAccountStreamRuntimePromise = import('./src/services/freedomAccountStreamAppRuntime')
      .then(({ createFreedomAccountStreamAppRuntime }) => createFreedomAccountStreamAppRuntime({
        createTicket: async () => {
          const result = await createFreedomAccountStreamTicket();
          return { ticket: result.ticket };
        },
        buildSocketUrl: buildFreedomAccountStreamSocketUrl,
        getCurrentSessionKey: () => currentAccountRole && currentAccountId
          ? `${currentAccountRole}:${currentAccountId}`
          : '',
        isAdmin: () => currentAccountRole === 'admin',
        loadSavedBrokerExecutions: () => normalizeFreedomTrades(loadSavedHistory().brokerExecutedTrades),
        getCurrentBrokerExecutions: () => portfolioStore.getState().brokerExecutedTrades || [],
        onStatus: (status, message) => {
          if (status === 'connected') {
            logTerminal('[System]: Live TradeNet portfolio and orders streams connected.');
          } else if (status === 'reconnecting') {
            logTerminal(message
              ? `[Warning]: TradeNet account stream reconnecting (${message}).`
              : '[Warning]: TradeNet account stream reconnecting.');
          }
        }
      })).catch((error) => {
        freedomAccountStreamRuntimePromise = null;
        throw error;
      });
  }
  return freedomAccountStreamRuntimePromise;
}

function stopFreedomAccountStreamRuntime(): void {
  if (freedomAccountStreamRuntimePromise) {
    void freedomAccountStreamRuntimePromise.then((runtime) => runtime.stop()).catch(() => undefined);
  }
}

let freedomQuoteStreamRuntimePromise: Promise<FreedomQuoteStreamRuntime> | null = null;
let freedomQuoteStreamRuntime: FreedomQuoteStreamRuntime | null = null;

function getFreedomQuoteStreamRuntime(): Promise<FreedomQuoteStreamRuntime> {
  if (!freedomQuoteStreamRuntimePromise) {
    freedomQuoteStreamRuntimePromise = import('./src/services/freedomQuoteStreamAppRuntime')
      .then(({ createFreedomQuoteStreamAppRuntime }) => {
        const runtime = createFreedomQuoteStreamAppRuntime({
          createTicket: async (tickers) => {
            const result = await createFreedomQuoteStreamTicket(tickers);
            return { ticket: result.ticket };
          },
          buildSocketUrl: buildFreedomQuoteStreamSocketUrl,
          getCurrentSessionKey: () => currentAccountRole && currentAccountId
            ? `${currentAccountRole}:${currentAccountId}`
            : '',
          nextRequestSequence: nextLiveQuoteRequestSequence,
          recordQuote: (ticker, price, source, updatedAt, details, requestStartedAt) =>
            recordTrackedPrice(ticker, price, source, updatedAt, details as QuoteDetails, requestStartedAt),
          renderAfterUpdate: () => {
            state = portfolioStore.getState();
            renderBoard();
          },
          onStatus: (status, message) => {
            if (status === 'connected') {
              logTerminal('[System]: Live TradeNet quote stream connected.');
            } else if (status === 'reconnecting') {
              logTerminal(message
                ? `[Warning]: Live TradeNet quote stream reconnecting (${message}).`
                : '[Warning]: Live TradeNet quote stream reconnecting; the browser socket remains open.');
            }
          }
        });
        freedomQuoteStreamRuntime = runtime;
        return runtime;
      }).catch((error) => {
        freedomQuoteStreamRuntimePromise = null;
        freedomQuoteStreamRuntime = null;
        throw error;
      });
  }
  return freedomQuoteStreamRuntimePromise;
}

function stopFreedomQuoteStreamRuntime(): void {
  if (freedomQuoteStreamRuntimePromise) {
    void freedomQuoteStreamRuntimePromise.then((runtime) => runtime.stop()).catch(() => undefined);
  }
}



function addCashHolding(ticker: string, shares: number, givenPrice = 0) {
  const symbol = ticker.trim().toUpperCase();
  const quantity = Number(shares);
  const manualPrice = Number(givenPrice);
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Ticker and a positive share quantity are required.');
  }

  const added = portfolioStore.addCashHolding(symbol, quantity, manualPrice);
  if (!added) {
    throw new Error(PORTFOLIO_PERSISTENCE_ERROR_MESSAGE);
  }

  if (Number.isFinite(manualPrice) && manualPrice > 0) {
    recordTrackedPrice(symbol, manualPrice, 'Manual');
  }
  return added;
}

function removeCashHolding(ticker: string) {
  const symbol = ticker.trim().toUpperCase();
  const holdings = state.cashCushion?.holdings;
  if (!symbol || !Array.isArray(holdings)) return null;

  const removed = holdings.find((holding: any) => holding.ticker === symbol);
  if (!removed) return null;

  // Let the store own this state transition; its subscriber updates the runtime
  // state reference after the canonical mutation has been committed.
  if (!portfolioStore.removeCashStock(symbol)) return null;
  return removed;
}

function setCurrentBalance(value: number): { balance: number; debt: number } | null {
  if (!portfolioStore.setCashBalance(value)) return null;

  const current: any = portfolioStore.getState();
  return {
    balance: current.cashCushion?.freeCash || 0,
    debt: Math.abs(current.balance || 0)
  };
}

async function requestLivePrice(symbol: string, force = false) {
  const existingRequest = livePriceRequests.get(symbol);
  if (existingRequest && !force) return existingRequest;

  const requestStartedAt = Date.now();
  const request = fetchLivePriceFromProviders(symbol, requestStartedAt, force).then(result => ({
    ...result,
    matched: result.price !== null
      ? recordTrackedPrice(symbol, result.price, result.sourceName, result.updatedAt, result.quoteDetails, requestStartedAt)
      : false
  }));
  livePriceRequests.set(symbol, request);
  try {
    return await request;
  } finally {
    if (livePriceRequests.get(symbol) === request) livePriceRequests.delete(symbol);
  }
}


async function fetchLivePrice(ticker: string, silent = false, force = false) {
  const symbol = ticker.toUpperCase();
  const sessionKey = currentAccountRole && currentAccountId
    ? `${currentAccountRole}:${currentAccountId}`
    : '';
  const hasActiveQuoteSocket = Boolean(
    freedomQuoteStreamRuntime?.isForSession(sessionKey) &&
    freedomQuoteStreamRuntime.isSocketOpen()
  );
  if (hasActiveQuoteSocket && !freedomQuoteStreamRuntime?.isSubscribed(symbol)) {
    await refreshAllLivePrices(force);
  }
  const quoteSocketIsOpenForSession = Boolean(
    freedomQuoteStreamRuntime?.isForSession(sessionKey) &&
    freedomQuoteStreamRuntime.isSocketOpen()
  );
  if (quoteSocketIsOpenForSession) {
    const trackedPrice = Number(state.positions[symbol]?.currentPrice ||
      state.cashCushion?.holdings?.find((holding: any) => holding.ticker.trim().toUpperCase() === symbol)?.price ||
      state.cashStocks?.find((holding: any) => holding.ticker.trim().toUpperCase() === symbol)?.currentPrice ||
      0);
    if (!silent) {
      logTerminal(freedomQuoteStreamRuntime?.isSubscribed(symbol)
        ? `[System]: ${symbol} is subscribed to the live quote socket; the REST quote backup was skipped.`
        : `[System]: ${symbol} is awaiting live quote socket subscription; the REST quote backup was skipped.`);
    }
    return Number.isFinite(trackedPrice) && trackedPrice > 0 ? trackedPrice : null;
  }
  const result = await requestLivePrice(symbol, force);

  if (result.price !== null) {
    // Quote refreshes are transient market data; persist locally without
    // uploading the full portfolio to cloud on every manual quote lookup.
    saveState(state);
    renderBoard();
    if (!silent) {
      logTerminal(`[${result.sourceName}]: ${symbol} updated to ${formatUSD(result.price)}${result.matched ? '' : ' (quote only)'}.`);
    }
    return result.price;
  }

  const tracked = state.positions[symbol]?.currentPrice || (state.cashCushion?.holdings?.find((h: any) => h.ticker === symbol)?.price) || 0;
  if (!silent) {
    logTerminal(`[Market Data Error]: Could not fetch ${symbol}. ${result.error}. Retained tracked price: ${formatUSD(tracked)}. Set manually via: price ${symbol} <number>.`);
  }
  return null;
}

const liveQuoteRefreshCoordinator = createQuoteRefreshCoordinator(performRefreshAllLivePrices);

/** Coalesce routine polling while reserving a fresh follow-up for explicit triggers. */
function refreshAllLivePrices(force = false): Promise<boolean> {
  return liveQuoteRefreshCoordinator.refresh(force);
}

async function performRefreshAllLivePrices(force = false): Promise<boolean> {
  const current = portfolioStore.getState();
  const cashHoldings = current.cashCushion && current.cashCushion.holdings;
  const tickersArray = currentAccountRole === 'guest'
    ? Array.from(new Set((current.guestPortfolioSnapshot?.tranches || []).map((tranche) => tranche.ticker)))
    : currentAccountRole === 'admin'
      ? Array.from(new Set<string>([
        ...Object.keys(current.positions || {}),
        ...(cashHoldings || []).map((holding: any) => holding.ticker),
        ...(current.cashStocks || []).map((holding: any) => holding.ticker)
      ]))
      : [];
  const accountStreamSessionKey = currentAccountRole && currentAccountId
    ? `${currentAccountRole}:${currentAccountId}`
    : '';
  if (currentAccountRole === 'admin' && accountStreamSessionKey) {
    try {
      const accountStreamRuntime = await getFreedomAccountStreamRuntime();
      await accountStreamRuntime.start(accountStreamSessionKey);
    } catch (streamError) {
      console.warn('[Freedom Account Stream]: Unable to establish the portfolio/orders socket; initial account snapshots remain available.', streamError);
    }
  } else {
    stopFreedomAccountStreamRuntime();
  }

  if (tickersArray.length === 0) {
    stopFreedomQuoteStreamRuntime();
    return true;
  }

  const sessionKey = currentAccountRole && currentAccountId
    ? `${currentAccountRole}:${currentAccountId}`
    : '';
  if (!sessionKey) {
    stopFreedomQuoteStreamRuntime();
    return true;
  }

  try {
    // The persistent TradeNet q socket is the primary quote source. It remains
    // open after the first q payload and pushes later price changes directly
    // into the portfolio store; routine scheduler ticks only maintain it.
    const quoteStreamRuntime = await getFreedomQuoteStreamRuntime();
    const currentSessionKey = currentAccountRole && currentAccountId
      ? `${currentAccountRole}:${currentAccountId}`
      : '';
    if (currentSessionKey !== sessionKey) {
      quoteStreamRuntime.stop();
      return true;
    }
    const connected = await quoteStreamRuntime.start(tickersArray, sessionKey);
    if (connected) return true;
    throw new Error('TradeNet quote socket did not become ready.');
  } catch (streamError) {
    const quoteSocketIsOpen = Boolean(
      freedomQuoteStreamRuntime?.isForSession(sessionKey) &&
      freedomQuoteStreamRuntime.isSocketOpen()
    );
    if (quoteSocketIsOpen) {
      console.warn('[Freedom Quote Stream]: The browser socket remains open; REST quote backups are suppressed.', streamError);
      return true;
    }
    console.warn('[Freedom Quote Stream]: Unable to establish the live socket; using the one-time snapshot fallback.', streamError);
    try {
      const refreshResult = await refreshTrackedQuotes(tickersArray, Date.now(), recordTrackedPrice, force);
      if (refreshResult.skipped) return true;
      const updatedCount = refreshResult.updatedCount;
      if (updatedCount > 0) {
        state = portfolioStore.getState();
        saveState(state);
        renderBoard();
        logTerminal(`[System]: Initial market quote fallback refreshed ${updatedCount} assets; the live socket is reconnecting.`);
        return true;
      }
      logTerminal('[Warning]: The live quote socket and initial quote fallback returned no usable prices.');
      return false;
    } catch (err: any) {
      console.error('Initial quote fallback failed:', err);
      logTerminal(`[Error]: Initial quote fallback failed - ${err.message}`);
      return false;
    }
  }
}

function refreshAllLivePricesAfterCurrent(force = false): Promise<boolean> {
  return liveQuoteRefreshCoordinator.refreshAfterCurrent(force);
}

async function refreshSupplementalPortfolioData(): Promise<boolean> {
  if (document.hidden) return false;

  if (currentAccountRole === 'admin') {
    const sessionKey = currentAccountId ? `admin:${currentAccountId}` : '';
    if (!sessionKey) return false;

    try {
      const accountStreamRuntime = await getFreedomAccountStreamRuntime();
      if (`${currentAccountRole}:${currentAccountId}` !== sessionKey) return false;
      await accountStreamRuntime.start(sessionKey);
    } catch (streamError) {
      console.warn('[Freedom Account Stream]: Unable to establish the private account socket before broker refresh.', streamError);
    }

    // The persistent browser stream suppresses its REST backups while connected.
    // If a recovery check runs before reconnection, perform one broker catch-up.
    const refreshMode = resolveFreedomAccountRefreshMode(sessionKey);
    if (refreshMode === 'recover') clearFreedomTradeNetStreamSnapshotCache();
    if (refreshMode === 'recover' || refreshMode === 'fallback') {
      const results = await Promise.all([
        portfolioBrokerRefreshRuntime.refreshAccountInfo(),
        portfolioBrokerRefreshRuntime.refreshExecutedTrades(),
        portfolioBrokerRefreshRuntime.refreshActiveOrders()
      ]);
      return results.every(Boolean);
    }
    return true;
  }

  if (currentAccountRole === 'guest') {
    // Refresh only the authenticated guest's assigned holdings and LOTS ledger.
    // Wait for an older quote batch before fetching prices for the latest assignment set.
    if (guestCloudRefreshInFlight) {
      const existingResult = await guestCloudRefreshInFlight;
      return existingResult !== false;
    }
    const request = pullGuestPortfolioSnapshot()
      .then(() => refreshAllLivePricesAfterCurrent(true))
      .then((result) => result !== false)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[Guest Auto Update Warning]: Unable to refresh assigned holdings and LOTS history.', error);
        logTerminal(`[Guest Auto Update Warning]: Assigned holdings and LOTS history were not refreshed (${message}).`);
        return false;
      })
      .finally(() => {
        if (guestCloudRefreshInFlight === request) guestCloudRefreshInFlight = null;
      });
    guestCloudRefreshInFlight = request;
    return await request;
  }

  return false;
}

/**
 * Merge local/admin store history with the separately encrypted cloud history
 * before writing. A first sync on a new device must never replace a populated
 * cloud ledger with an empty local snapshot.
 */
async function syncAdminClosedHistory(): Promise<boolean> {
  const accountId = currentAccountId || '';
  const session = currentAccountSessionGuard.capture();
  const isCurrentSession = () =>
    currentAccountRole === 'admin' &&
    Boolean(accountId) &&
    session !== null &&
    currentAccountSessionGuard.isCurrent(session);
  if (!isCurrentSession()) return false;

  try {
    // Pull the remote history first; never let an empty/new device overwrite a
    // populated Closed History record before local and broker data are merged.
    const cloudHistory = await pullCloudHistory(undefined, { isCurrentSession });
    if (!isCurrentSession()) return false;
    const savedAtStart = loadSavedHistory();
    const currentAtStart = portfolioStore.getState();
    const cloudExecutions = normalizeFreedomTrades(cloudHistory?.brokerExecutedTrades || []);
    const savedExecutions = normalizeFreedomTrades(savedAtStart.brokerExecutedTrades);
    const currentExecutions = normalizeFreedomTrades(currentAtStart.brokerExecutedTrades || []);
    const baselineExecutions = mergeBrokerExecutionHistory(
      mergeBrokerExecutionHistory(cloudExecutions, savedExecutions),
      currentExecutions
    );
    const executionsWithFees = preservePersistedBrokerFeeAllocations(
      baselineExecutions,
      [...savedExecutions, ...cloudExecutions, ...currentExecutions]
    );
    const priorCashflows = [
      ...normalizeSavedFreedomCashflows(cloudHistory?.cashflows || []),
      ...normalizeSavedFreedomCashflows(savedAtStart.cashflows),
      ...normalizeSavedFreedomCashflows(currentAtStart.cashflows || [])
    ];
    const latestCashflowDate = hasFreedomCashflowHistoryBaseline(accountId)
      ? getFreedomCashflowRefreshStartDate(priorCashflows) ||
        getLatestClosedTradeDate(executionsWithFees, currentAtStart.closedTrades || [])
      : undefined;

    // Bypass the brief quote-side cache: every 60-second checkpoint and manual
    // sync must ask Freedom for the latest cashflow rows (full baseline once,
    // then an overlapping incremental window).
    clearFreedomCashflowCache();
    const cashflowResponse = await fetchFreedomCashflows(latestCashflowDate);
    if (!isCurrentSession()) return false;
    const fetchedCashflows = normalizeFreedomCashflowRows(cashflowResponse);

    // Broker executions may have completed while the cashflow request was in
    // flight. Re-read the canonical store and sidecar before calculating fees.
    const current = portfolioStore.getState();
    const saved = loadSavedHistory();
    const latestSavedExecutions = normalizeFreedomTrades(saved.brokerExecutedTrades);
    const latestCurrentExecutions = normalizeFreedomTrades(current.brokerExecutedTrades || []);
    const mergedExecutions = preservePersistedBrokerFeeAllocations(
      mergeBrokerExecutionHistory(
        mergeBrokerExecutionHistory(cloudExecutions, latestSavedExecutions),
        latestCurrentExecutions
      ),
      [...latestSavedExecutions, ...cloudExecutions, ...latestCurrentExecutions]
    );
    const cloudCashflows = normalizeSavedFreedomCashflows(cloudHistory?.cashflows || []);
    const savedCashflows = normalizeSavedFreedomCashflows(saved.cashflows);
    const currentCashflows = normalizeSavedFreedomCashflows(current.cashflows || []);
    const mergedCashflows = mergeFreedomCashflowRows(
      mergeFreedomCashflowRows(
        mergeFreedomCashflowRows(cloudCashflows, savedCashflows),
        currentCashflows
      ),
      fetchedCashflows
    );

    const appClosedTrades = [...(current.closedTrades || [])];
    const allocations = calculateFreedomMarginFeeAllocations(
      mergedCashflows,
      mergedExecutions,
      appClosedTrades
    );
    const updatedExecutions = applyCashflowAllocationsToBrokerExecutions(
      mergedExecutions,
      allocations.brokerAllocations
    );
    const updatedClosedTrades = applyCashflowAllocationsToClosedTrades(
      appClosedTrades,
      allocations.appAllocations
    );
    const nextState: Partial<PortfolioState> = {};
    if (JSON.stringify(current.brokerExecutedTrades || []) !== JSON.stringify(updatedExecutions)) {
      nextState.brokerExecutedTrades = updatedExecutions;
    }
    if (JSON.stringify(current.cashflows || []) !== JSON.stringify(mergedCashflows)) {
      nextState.cashflows = mergedCashflows;
    }
    if (JSON.stringify(appClosedTrades) !== JSON.stringify(updatedClosedTrades)) {
      nextState.closedTrades = updatedClosedTrades;
    }

    const previousState = current;
    if (Object.keys(nextState).length) portfolioStore.setState(nextState, false);
    if (!isCurrentSession()) {
      portfolioStore.update(() => previousState, false);
      state = portfolioStore.getState();
      return false;
    }

    const persisted = savePortfolioSnapshot(portfolioStore.getState(), {
      brokerExecutedTrades: updatedExecutions,
      cashflows: mergedCashflows
    });
    if (!persisted) {
      portfolioStore.update(() => previousState, false);
      state = portfolioStore.getState();
      logTerminal('[Closed History Sync Error]: Could not persist broker executions and cashflows locally; cloud history was not changed.');
      return false;
    }
    state = portfolioStore.getState();
    if (!isCurrentSession()) return false;

    const mergedHistory = {
      brokerExecutedTrades: updatedExecutions,
      cashflows: mergedCashflows
    };
    const normalizedCloudHistory = cloudHistory ? {
      brokerExecutedTrades: cloudExecutions,
      cashflows: cloudCashflows
    } : null;
    if (
      (!normalizedCloudHistory || JSON.stringify(mergedHistory) !== JSON.stringify(normalizedCloudHistory)) &&
      (updatedExecutions.length > 0 || mergedCashflows.length > 0)
    ) {
      const pushed = await pushCloudHistory(mergedHistory, undefined, undefined, {
        isCurrentSession,
        force: true
      });
      if (!isCurrentSession()) return false;
      if (!pushed) {
        logTerminal('[Closed History Sync Warning]: Local cashflows and trades are saved, but the cloud history checkpoint was not confirmed.');
        return false;
      }
    }

    if (!hasFreedomCashflowHistoryBaseline(accountId) &&
        !markFreedomCashflowHistoryBaseline(accountId)) {
      logTerminal('[Closed History Sync Warning]: Cashflows are saved, but the completed-history baseline could not be recorded; the next sync will retry a full read.');
      return false;
    }
    return true;
  } catch (error) {
    if (isCurrentSession()) {
      const message = error instanceof Error ? error.message : String(error);
      logTerminal(`[Closed History Sync Warning]: Freedom cashflow or cloud history refresh failed (${message}).`);
    }
    return false;
  }
}

const portfolioAutoRefresh = createPortfolioAutoRefreshScheduler({
  getRole: () => currentAccountRole,
  isVisible: () => !document.hidden,
  refreshQuotes: () => refreshAllLivePrices(),
  refreshSupplemental: () => refreshSupplementalPortfolioData(),
  syncState: () => currentAccountRole === 'admin' ? pushStateToCloud(true) : undefined,
  syncHistory: () => currentAccountRole === 'admin' ? syncAdminClosedHistory() : undefined,
  onError: (source, error) => {
    const message = error instanceof Error ? error.message : String(error);
    logTerminal(`[Auto Update Warning]: ${source} refresh failed (${message}).`);
  }
});

const portfolioStartupLifecycleRuntime = createPortfolioStartupLifecycleRuntime({
  getAccountRole: () => currentAccountRole,
  isDocumentVisible: () => !document.hidden,
  applyOvernightRollover,
  refreshOnVisibilityChange: () => portfolioAutoRefresh.onVisibilityChange(),
  setStartupState: (visible, failed) => emitUiEvent('terminal:startup-state', { visible, failed }),
  retryStartup: () => initApp(),
  continueStartupOffline: () => continueStartupOffline(),
  addVisibilityChangeListener: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
  scheduleInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearScheduledInterval: (handle) => clearInterval(handle)
});

function setQuoteRefreshInterval(interval: number | string): number {
  const role = currentAccountRole;
  const fallback = role === 'guest'
    ? DEFAULT_GUEST_REFRESH_INTERVAL_MS
    : DEFAULT_ADMIN_REFRESH_INTERVAL_MS;
  const intervalMs = normalizeQuoteRefreshInterval(interval, fallback);

  // An offline/unauthenticated session must not overwrite an administrator's preference.
  if (role) saveQuoteRefreshInterval(intervalMs, role);
  portfolioAutoRefresh.configure(intervalMs, role);
  return intervalMs;
}

function exportBackupJSON() {
  const exportState = createPortfolioBackupSnapshot(state);
  const backupBlob = createPortfolioBackupBlob(exportState);
  const downloadUrl = URL.createObjectURL(backupBlob);
  const downloadAnchor = document.createElement('a');
  const filename = buildPortfolioBackupFilename();
  downloadAnchor.href = downloadUrl;
  downloadAnchor.download = filename;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  logTerminal(`[Backup]: Exported state to ${filename}.`);
}

async function importBackupFile(file: File) {
  try {
    validatePortfolioBackupFileSize(file.size);
    const parsed = JSON.parse(await file.text());
    if (parsed && typeof parsed === 'object' && 'marginBalance' in parsed) {
      delete parsed.marginBalance;
    }
    const importedState: any = normalizePortfolioBackup(parsed);
    const importedPositionCount = Object.keys(importedState.positions || {}).length;
    const importedCashHoldingCount = Array.isArray(importedState.cashCushion?.holdings)
      ? importedState.cashCushion.holdings.length
      : 0;
    if (!confirm(
      `Restore "${file.name}" (${importedPositionCount} margin positions, ${importedCashHoldingCount} cash holdings)? ` +
      `This replaces this browser's portfolio and, if cloud sync is available, the shared administrator workspace. ` +
      `Export a current backup first if you may need the existing data.`
    )) {
      logTerminal('[Backup Import]: Import cancelled; the current portfolio was not changed.');
      return;
    }

    importedState.lastUpdated = Date.now();
    const previousState = portfolioStore.getState();
    commitPortfolioBackupImport(
      importedState,
      previousState,
      (snapshot) => {
        portfolioStore.importState(snapshot as any);
        state = portfolioStore.getState();
      },
      () => saveState(state, pushStateToGist)
    );
    await pushStateToGist(true);
    renderBoard();
    logTerminal(`[Backup Import]: Imported ${file.name} into this browser. Check KV cloud status for sync results.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logTerminal(`[Backup Error]: Could not import backup (${message}).`);
    showToast(`Backup import failed: ${message}`, 'error');
  }
}

// ==========================================
// PORTFOLIO ACTIONS (CASH-FIRST ORDER FLOW)
// ==========================================
async function applyPortfolioActions(action: PortfolioActionIntent) {
  if ((action.action === 'buy' || action.action === 'sell') && !applyOvernightRollover()) {
    logTerminal('[Error]: Could not save the margin rollover. The portfolio action was not applied.');
    return;
  }
  if (action.action === "buy") {
    const ticker = String(action.ticker || '').trim().toUpperCase();
    const shares = Number(action.shares);
    const price = Number(action.price);
    if (!ticker || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0) {
      logTerminal('[AI Action Error]: Buy requires a valid ticker, positive share count, and positive price.');
      showToast('Invalid buy details.', 'error');
      return;
    }

    const priorState = portfolioStore.getState();
    const targetPrice = Number(action.pt) > 0
      ? Number(action.pt)
      : priorState.positions[ticker]
        ? undefined
        : Number((price * 1.05).toFixed(2));
    const priorFreeCash = Math.max(0, Number(priorState.cashCushion?.freeCash) || 0);
    const priorDebt = Math.abs(Number(priorState.balance) || 0);
    const rules = priorState.brokerAssumptions || TRADERNET_RULES;
    const buyComm = calculateCommission(shares, shares * price, resolveCommissionConfig(rules));
    const totalOutlay = shares * price + buyComm;
    const cashUsed = Math.min(priorFreeCash, totalOutlay);
    const debtAdded = totalOutlay - cashUsed;

    const committed = portfolioStore.buyStock(
      ticker,
      shares,
      price,
      action.date || new Date().toISOString().split('T')[0],
      targetPrice
    );
    if (!committed) {
      logTerminal('[Error]: Could not save portfolio changes. Previous saved data is unchanged.');
      return;
    }
    const committedState = portfolioStore.getState();

    logTerminal(`[Executed Buy]: Added ${shares} ${ticker} @ ${formatUSD(price)}. Outlay: ${formatUSD(totalOutlay)} (Comm: ${formatUSD(buyComm)}). Funded: ${formatUSD(cashUsed)} cash | +${formatUSD(debtAdded)} margin debt. Free Cash remaining: ${formatUSD(committedState.cashCushion.freeCash)}. Total Margin Debt: -${formatUSD(Math.abs(committedState.balance))} (was -${formatUSD(priorDebt)}).`);
    await fetchLivePrice(ticker, false, true);
  }
  else if (action.action === "sell") {
    const ticker = action.ticker.toUpperCase();
    let pos: { ticker: string; shares: number | string } | undefined = state.positions[ticker];
    let isCashHolding = false;
    let cashHoldingIdx = -1;

    if (!pos && state.cashCushion && state.cashCushion.holdings) {
      cashHoldingIdx = state.cashCushion.holdings.findIndex((h: any) => h.ticker === ticker);
      if (cashHoldingIdx !== -1) {
        isCashHolding = true;
        pos = state.cashCushion.holdings[cashHoldingIdx];
      }
    }

    if (!pos) {
      logTerminal(`[Error]: Position ${ticker} not found to close.`);
      return;
    }

    const hasRequestedShares = action.shares !== null && action.shares !== undefined;
    let sharesToSell: number;
    try {
      sharesToSell = resolveSaleQuantity(
        Number(pos.shares),
        hasRequestedShares ? Number(action.shares) : null
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logTerminal(`[Sell Error]: ${message}`);
      showToast(message, 'error');
      return;
    }

    const sellPrice = Number(action.price);
    if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
      logTerminal(`[Sell Error]: Enter a valid sale price greater than zero for ${ticker}.`);
      showToast('Sale price must be greater than zero.', 'error');
      return;
    }
    if (isCashHolding) {
      const result = portfolioStore.sellCashHolding(ticker, sharesToSell, sellPrice);
      if (!result) {
        logTerminal(`[Sell Error]: Could not sell cash holding ${ticker}.`);
        showToast('Cash holding sale failed.', 'error');
        return;
      }

      saveState(state, pushStateToGist);
      if (result.remainingShares <= 1e-8) {
        logTerminal(`[Cash Holding Closed]: Sold ${result.sharesSold} ${ticker} @ ${formatUSD(sellPrice)}. Net credited: +${formatUSD(result.netProceeds)} (Debt paid: ${formatUSD(result.debtRepaid)}, Free Cash added: ${formatUSD(result.cashSurplus)}).`);
      } else {
        logTerminal(`[Cash Holding Partial Sell]: Sold ${result.sharesSold} ${ticker} @ ${formatUSD(sellPrice)}. Remaining: ${result.remainingShares} shares. Net credited: +${formatUSD(result.netProceeds)} (Debt paid: ${formatUSD(result.debtRepaid)}, Free Cash added: ${formatUSD(result.cashSurplus)}).`);
      }
      renderBoard();
      return;
    }

    let result: ReturnType<typeof portfolioStore.sellMarginPosition>;
    try {
      result = portfolioStore.sellMarginPosition(ticker, sharesToSell, sellPrice);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logTerminal(`[Sell Error]: ${detail}`);
      showToast(translateText(
        'Sale blocked because purchase lots are missing or inconsistent. Reconcile the cost basis before selling.',
        getAppLanguage()
      ), 'error');
      return;
    }
    if (!result) {
      logTerminal(`[Sell Error]: Could not sell margin position ${ticker}.`);
      showToast('Margin position sale failed.', 'error');
      return;
    }

    saveState(state, pushStateToGist);
    if (result.remainingShares <= 1e-8) {
      logTerminal(`[Position Closed]: Sold ${result.sharesSold} ${ticker} @ ${formatUSD(sellPrice)}. Net credited: +${formatUSD(result.netProceeds)} (Debt paid: ${formatUSD(result.debtRepaid)}, Free Cash added: ${formatUSD(result.cashSurplus)}). Remaining Debt: -${formatUSD(Math.abs(state.balance))}. Free Cash: ${formatUSD(state.cashCushion.freeCash)}.`);
    } else {
      logTerminal(`[Partial Sell]: Sold ${result.sharesSold} ${ticker} @ ${formatUSD(sellPrice)}. Net credited: +${formatUSD(result.netProceeds)} (Debt paid: ${formatUSD(result.debtRepaid)}, Free Cash added: ${formatUSD(result.cashSurplus)}). Remaining: ${result.remainingShares} shares.`);
    }
  }
  else if (action.action === "set_pt") {
    const ticker = (action.ticker ? action.ticker.toUpperCase() : null) || (state.activeView !== "COMBINED" && state.activeView !== "CASH_CUSHION" && state.activeView !== "CLOSED_HISTORY" ? state.activeView : Object.keys(state.positions)[0]);
    if (state.positions[ticker] && Number(action.pt) > 0) {
      if (!portfolioStore.updateTargetPrice(ticker, Number(action.pt))) {
        logTerminal(`[Error]: ${PORTFOLIO_PERSISTENCE_ERROR_MESSAGE}`);
        return;
      }
      saveState(state, pushStateToGist);
      logTerminal(`[Target Updated]: ${ticker} PT updated to ${formatUSD(action.pt)}.`);
    }
  }
  else if (action.action === "set_price") {
    const ticker = (action.ticker ? action.ticker.toUpperCase() : null) || (state.activeView !== "COMBINED" && state.activeView !== "CASH_CUSHION" && state.activeView !== "CLOSED_HISTORY" ? state.activeView : Object.keys(state.positions)[0]);
    const newP = Number(action.price);

    if (!newP || isNaN(newP) || newP <= 0) {
      logTerminal(`[Price Unchanged]: No valid price amount supplied. Enter: price ${ticker} <number>.`);
      return;
    }

    const updated = recordTrackedPrice(ticker, newP, 'Manual');
    if (updated) {
      saveState(state, pushStateToGist);
      logTerminal(`[Price Updated]: ${ticker} market price set to ${formatUSD(newP)}.`);
    }
  }
  else if (action.action === "set_balance") {
    const debt = Math.abs(Number(action.balance));
    if (!Number.isFinite(debt)) {
      logTerminal('[Margin Sync Error]: Enter a valid finite debt amount.');
      showToast('Invalid margin debt amount.', 'error');
      return;
    }
    if (!portfolioStore.setMarginDebt(debt)) {
      logTerminal(`[Error]: ${PORTFOLIO_PERSISTENCE_ERROR_MESSAGE}`);
      return;
    }
    saveState(state, pushStateToGist);
    logTerminal(`[Margin Synced]: Total margin balance explicitly set to -${formatUSD(Math.abs(state.balance))}.`);
  }
  else if (action.action === "set_free_cash") {
    const committedBalance = setCurrentBalance(action.amount);
    if (!committedBalance) {
      logTerminal(`[Error]: ${PORTFOLIO_PERSISTENCE_ERROR_MESSAGE}`);
      return;
    }
    const { balance, debt } = committedBalance;
    saveState(state, pushStateToGist);
    logTerminal(`[Balance]: Current balance/debt updated. Balance: ${formatUSD(balance)} | Margin debt: -${formatUSD(debt)}.`);
  }
  else if (action.action === "add_cash_stock") {
    const ticker = action.ticker.toUpperCase();
    const shares = Number(action.shares);
    const givenPrice = Number(action.price) || 0;

    try {
      addCashHolding(ticker, shares, givenPrice);
    } catch (error) {
      logTerminal(`[Error]: ${error instanceof Error ? error.message : PORTFOLIO_PERSISTENCE_ERROR_MESSAGE}`);
      return;
    }
    saveState(state, pushStateToGist);
    logTerminal(`[Balance]: Added ${shares} ${ticker} to balance holdings. Syncing online quote...`);
    renderBoard();
    await fetchLivePrice(ticker);
    return;
  }
  else if (action.action === "remove_cash_stock") {
    const ticker = action.ticker.toUpperCase();
    const removed = removeCashHolding(ticker);
    if (removed) {
      saveState(state, pushStateToGist);
      logTerminal(`[Balance]: Removed ${removed.ticker} from balance holdings.`);
    }
  }

  renderBoard();
}

function assertNeverAiAction(action: never): never {
  throw new Error(`Unsupported AI portfolio action: ${String(action)}`);
}

function confirmAiPortfolioAction(action: PortfolioActionIntent): boolean {
  let ticker = 'ticker' in action && typeof action.ticker === 'string'
    ? action.ticker.trim().toUpperCase()
    : '';
  if (!ticker && (action.action === 'set_pt' || action.action === 'set_price')) {
    ticker = state.positions[state.activeView] ? state.activeView : Object.keys(state.positions)[0] || '';
  }
  const validTicker = /^[A-Z0-9._:-]+$/.test(ticker);
  const isPositiveFinite = (value: number) => Number.isFinite(value) && value > 0;
  const isFiniteNumber = (value: number) => Number.isFinite(value);
  const actionRequiresTicker = action.action !== 'set_balance' && action.action !== 'set_free_cash';
  if (actionRequiresTicker && !validTicker) {
    logTerminal('[AI Action Error]: Gemini returned an invalid ticker. No changes were made.');
    return false;
  }

  if (action.action === 'buy' && (!isPositiveFinite(action.shares) || !isPositiveFinite(action.price))) {
    logTerminal('[AI Action Error]: Gemini returned an invalid buy quantity or price. No changes were made.');
    return false;
  }
  if (action.action === 'sell' &&
    ((action.shares !== null && !isPositiveFinite(action.shares)) || !isPositiveFinite(action.price))) {
    logTerminal('[AI Action Error]: Gemini returned an invalid sale quantity or price. No changes were made.');
    return false;
  }
  if ((action.action === 'set_pt' && !isPositiveFinite(action.pt)) ||
    (action.action === 'set_price' && !isPositiveFinite(action.price))) {
    logTerminal('[AI Action Error]: Gemini returned an invalid price. No changes were made.');
    return false;
  }
  if (action.action === 'add_cash_stock' &&
    (!isPositiveFinite(action.shares) ||
      (action.price !== null && (!Number.isFinite(action.price) || action.price < 0)))) {
    logTerminal('[AI Action Error]: Gemini returned invalid cash holding details. No changes were made.');
    return false;
  }
  if (action.action === 'set_balance' && !isFiniteNumber(action.balance)) {
    logTerminal('[AI Action Error]: Gemini returned an invalid margin balance. No changes were made.');
    return false;
  }
  if (action.action === 'set_free_cash' && !isFiniteNumber(action.amount)) {
    logTerminal('[AI Action Error]: Gemini returned an invalid account balance. No changes were made.');
    return false;
  }

  const message = (() => {
    switch (action.action) {
      case 'buy': return `Buy ${action.shares} ${ticker} at ${action.price}?`;
      case 'sell': return `Sell ${action.shares === null ? 'all' : action.shares} ${ticker} at ${action.price}?`;
      case 'set_pt': return `Set ${ticker}'s target price to ${action.pt}?`;
      case 'set_price': return `Set ${ticker}'s tracked market price to ${action.price}?`;
      case 'set_balance': return `Set signed margin balance to ${action.balance}?`;
      case 'set_free_cash': return `Set free cash to ${action.amount}?`;
      case 'add_cash_stock': return `Add ${action.shares} shares of ${ticker} to cash holdings?`;
      case 'remove_cash_stock': return `Remove ${ticker} from cash holdings?`;
      default: return assertNeverAiAction(action);
    }
  })();

  const confirmationLines = [
    'Gemini interpreted your input as this portfolio change:',
    '',
    message
  ];
  const currentPosition = state.positions[ticker] ||
    state.cashCushion?.holdings?.find((holding) => holding.ticker === ticker);
  const currentShares = action.action === 'buy'
    ? Number(state.positions[ticker]?.shares) || 0
    : Number(currentPosition?.shares) || 0;
  const rules = state.brokerAssumptions || TRADERNET_RULES;

  if (action.action === 'buy') {
    const shares = action.shares;
    const price = action.price;
    const gross = shares * price;
    const commission = calculateCommission(shares, gross, resolveCommissionConfig(rules));
    const totalOutlay = gross + commission;
    const availableCash = Math.max(0, Number(state.cashCushion?.freeCash) || 0);
    const cashUsed = Math.min(availableCash, totalOutlay);
    const debtAdded = totalOutlay - cashUsed;
    confirmationLines.push(
      '',
      `Estimated purchase value: ${formatUSD(gross)}`,
      `Estimated commission: ${formatUSD(commission)}`,
      `Estimated total outlay: ${formatUSD(totalOutlay)}`,
      `Estimated free cash used: ${formatUSD(cashUsed)}`,
      `Estimated additional margin debt: ${formatUSD(debtAdded)}`,
      `Tracked shares: ${currentShares} → ${currentShares + shares}`
    );
  } else if (action.action === 'sell') {
    const shares = action.shares === null ? currentShares : action.shares;
    const price = action.price;
    const gross = shares * price;
    const commission = calculateCommission(shares, gross, resolveCommissionConfig(rules));
    confirmationLines.push(
      '',
      `Tracked shares available: ${currentShares}`,
      `Estimated gross proceeds: ${formatUSD(gross)}`,
      `Estimated commission: ${formatUSD(commission)}`,
      `Estimated proceeds after commission: ${formatUSD(gross - commission)}`
    );
    if (shares > currentShares) {
      confirmationLines.push('Warning: requested sale exceeds tracked shares and will be rejected.');
    } else {
      confirmationLines.push(`Tracked shares after sale: ${Math.max(0, currentShares - shares)}`);
    }
  } else if (action.action === 'set_balance') {
    confirmationLines.push('Sign convention: positive means available cash; negative means margin debt.');
  } else if (action.action === 'set_free_cash') {
    confirmationLines.push('This changes the free-cash cushion; it does not directly change the margin balance.');
  } else if (action.action === 'set_price') {
    confirmationLines.push('This sets a manually tracked price; it is not a live quote refresh.');
  }

  confirmationLines.push(
    '',
    'These are portfolio-model estimates only. No broker order is submitted.',
    'Verify quantities, prices, and fees before applying this change.',
    '',
    'Apply this change?'
  );
  return confirm(confirmationLines.join('\n'));
}

function showScenarioModal(data: ScenarioModalData): void {
  emitUiEvent('terminal:scenario-modal', data);
}

async function executeCommand(commandText: string) {
  const text = commandText.trim();
  if (!text) return;

  logTerminal(text, true);

  // Apply due margin interest before a trade, but do not block read-only commands
  // or independent settings/quote updates when a rollover snapshot cannot be saved.
  if (/^(?:buy|bought|sell|sold)\b/i.test(text) && !/\bvs\b/i.test(text) && !applyOvernightRollover()) {
    logTerminal('[CLI Error]: Could not save the margin rollover. The trade was not applied.');
    return;
  }

  // 1. Execute via the deterministic dispatcher
  const localResult = CommandDispatcher.execute(text);

  // 2. Surface dispatcher validation errors directly; never send them to the AI fallback.
  if (localResult.type === 'err') {
    if (localResult.text) {
      logTerminal(`[CLI Error]: ${localResult.text}`);
      showToast(localResult.text, 'error');
    }
    return;
  }

  // Scenario commands return structured data for a decision modal, not a terminal dump.
  if (localResult.modal) {
    showScenarioModal(localResult.modal);
    return;
  }

  // 3. Run command side effects without hiding an already-applied local mutation
  // if quote refresh or cloud synchronization fails.
  let sideEffectError: string | undefined;
  if (localResult.sideEffect) {
    const effect = localResult.sideEffect;
    try {
      if (effect.type === 'SYNC_CLOUD') {
        renderBoard();
        await pushStateToGist();
      } else if (effect.type === 'FETCH_QUOTE') {
        renderBoard();
        await fetchLivePrice(effect.ticker, false, true); // Start quote request after the trade.
        await pushStateToGist();
      } else if (effect.type === 'REFRESH_ALL') {
        await refreshAllLivePrices(true);
      } else if (effect.type === 'SWITCH_VIEW') {
        setActiveView(effect.view);
      } else if (effect.type === 'CLEAR_TERMINAL') {
        clearTerminalLog();
      }
    } catch (error) {
      console.error('Terminal command side effect failed:', error);
      sideEffectError = effect.type === 'SYNC_CLOUD' || effect.type === 'FETCH_QUOTE'
        ? 'Command applied locally, but quote refresh or cloud sync failed. Check your connection and retry sync.'
        : effect.type === 'REFRESH_ALL'
          ? 'Quote refresh failed. Please retry.'
          : 'The command completed locally, but its follow-up action failed.';
    }
  }

  // 4. Return if a command was matched and executed locally.
  if (localResult.type === 'res' || localResult.type === 'cmd') {
    if (localResult.text) logTerminal(`[CLI]: ${localResult.text}`);
    if (sideEffectError) {
      logTerminal(`[CLI Error]: ${sideEffectError}`);
      showToast(sideEffectError, 'error');
    }
    return;
  }

  // Only hit the Gemini API if explicitly prefixed with "ai " or "ask "
  //    (Or delete this block entirely to make the terminal 100% offline/frontend)
  if (!/^(ai|ask)\b/i.test(text)) {
    logTerminal(`[CLI]: Unrecognized command. Type "help" for local commands, or prefix with "ask ..." for AI advisor.`);
    return;
  }

  const aiQuery = text.replace(/^(ai|ask)\s*:?\s*/i, '');
  setAiStatus('CONNECTING...');

  try {
    const targetState = portfolioStore.getState();
    const prompt = buildIntentPrompt({
      text: aiQuery,
      state: {
        positions: targetState.positions,
        activeView: targetState.activeView || ''
      },
      activeTickers: Object.keys(targetState.positions || {}),
      activeView: targetState.activeView || '',
      today: new Date().toISOString().split("T")[0]
    });

    const data: unknown = await proxyFetch('gemini', {}, { method: "POST", body: JSON.stringify({ prompt }) });
    const rawText = extractGeminiResponseText(data);
    const parsed = parseAiIntent(rawText);

    if (parsed.intent === "action") {
      const applied = await applyAiPortfolioActionAfterConfirmation(
        parsed,
        confirmAiPortfolioAction,
        applyPortfolioActions
      );
      if (!applied) logTerminal("[AI Action]: Cancelled.");
    } else {
      const response = parsed.intent === 'chat' ? parsed.response : 'Executed.';
      logTerminal(`[AI Advisor]: ${response}`);
    }

    setAiStatus('READY');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown AI request error.';
    logTerminal(`[Error]: ${message}`);
    setAiStatus('READY');
  }
}

let appInitialized = false;

function hideStartupLoading() {
  emitUiEvent('terminal:startup-state', { visible: false, failed: false });
}

setSecretGetter(() => getGatewaySecret());

const portfolioSessionRuntime = createPortfolioSessionRuntime({
  getCurrentUser,
  getAccountRole: () => currentAccountRole,
  getAccountId: () => currentAccountId,
  setAccountRole: (role) => {
    if (currentAccountRole !== role) {
      stopFreedomQuoteStreamRuntime();
      stopFreedomAccountStreamRuntime();
    }
    currentAccountRole = role;
  },
  setAccountId: (accountId) => {
    if (currentAccountId !== accountId) {
      stopFreedomQuoteStreamRuntime();
      stopFreedomAccountStreamRuntime();
    }
    currentAccountId = accountId;
  },
  setCloudWritePermission: (allowed) => { canWriteCloudState = allowed; },
  setSessionIdentity: (identity) => currentAccountSessionGuard.setIdentity(identity),
  clearCloudEncryptionSecretCache,
  clearPendingCloudWrite: () => {
    if (gistSyncTimeout) clearTimeout(gistSyncTimeout);
    gistSyncTimeout = null;
  },
  clearGuestWorkspace: () => {
    portfolioStore.importState(createCleanWorkspaceState());
    state = portfolioStore.getState();
  },
  emitUserChanged: (user) => emitUiEvent('auth:user-changed', { user }),
  showToast,
  logoutAccount,
  clearSavedGatewaySecret: () => saveGatewaySecret(''),
  persistGatewaySecret,
  clearStoreGatewaySecret: () => portfolioStore.setState({ gatewaySecret: '' }),
  reloadPage: () => window.location.reload()
});
const { publishCurrentUser, requireAdmin } = portfolioSessionRuntime;

const portfolioAuthenticationRuntime = createPortfolioAuthenticationRuntime({
  validateGatewaySecret,
  saveGatewaySecret,
  publishCurrentUser,
  getAccountRole: () => currentAccountRole,
  isAppInitialized: () => appInitialized,
  setAppInitialized: (initialized) => { appInitialized = initialized; },
  persistGatewaySecret,
  setPortfolioGatewaySecret: (secret) => portfolioStore.setState({ gatewaySecret: secret }),
  showToast,
  emitGatewaySecretAuthenticated: (secret) => {
    emitUiEvent('settings:gateway-secret-authenticated', { secret });
  },
  setActiveView,
  resolveRefreshInterval: (role) => getQuoteRefreshInterval(
    role === 'guest' ? DEFAULT_GUEST_REFRESH_INTERVAL_MS : DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
    role
  ),
  setQuoteRefreshInterval,
  pullGuestPortfolioSnapshot,
  pullAdminPortfolioSnapshot: () => syncCloudState('pull'),
  refreshAllLivePrices: () => refreshAllLivePrices(true),
  startApp,
  hideAuthContainer
});

export async function handleSaveGatewaySecret(secret: string): Promise<boolean> {
  return portfolioAuthenticationRuntime.handleSaveGatewaySecret(secret);
}

function renderAuthModal(isOpen: boolean) {
  // App owns the auth overlay inside the main Preact tree. Communicate visibility
  // as state rather than mounting a second Preact root into a sibling container.
  emitUiEvent('terminal:auth-visibility', { isOpen });
}

function showAuthContainer() {
  renderAuthModal(true);
}

function hideAuthContainer() {
  renderAuthModal(false);
}

const portfolioAuthenticatedStartupRuntime = createPortfolioAuthenticatedStartupRuntime({
  hydrateLocalPortfolioState: async () => {
    await hydratePortfolioPersistence();
  },
  loadBrokerRules: loadTradernetRules,
  publishCurrentUser,
  clearAccountIdentity: () => {
    stopFreedomQuoteStreamRuntime();
    stopFreedomAccountStreamRuntime();
    currentAccountRole = null;
    currentAccountId = null;
    canWriteCloudState = false;
  },
  setGatewaySecret: (secret) => { portfolioStore.setState({ gatewaySecret: secret }, false); },
  getAccountRole: () => currentAccountRole,
  pullGuestPortfolioSnapshot,
  importSavedAdminWorkspace: () => {
    portfolioStore.importState(loadSavedState(portfolioStore.getState()));
    state = portfolioStore.getState();
  },
  applyOvernightRollover,
  pullSharedCloudState: () => syncCloudState('pull'),
  getInitialQuoteRefreshInterval: (role) => getQuoteRefreshInterval(
    role === 'guest' ? DEFAULT_GUEST_REFRESH_INTERVAL_MS : DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
    role === 'guest' ? 'guest' : 'admin'
  ),
  setQuoteRefreshInterval,
  configureAdminRollover: (enabled) => portfolioStartupLifecycleRuntime.configureAdminRollover(enabled),
  beginInitialQuoteRefresh: () => { initialQuoteRefreshPending = true; },
  showGuestBalanceView: () => setActiveView('BALANCE'),
  showSavedAdminView: () => switchView(state.activeView),
  scrollWorkspace: () => emitUiEvent('terminal:scroll-workspace'),
  refreshLivePrices: () => refreshAllLivePrices(true),
  finishInitialQuoteRefresh: () => { initialQuoteRefreshPending = false; },
  renderBoardAnalystConsensus: () => renderBoardAnalystConsensus(getMarketInsightsTicker(state)),
  recoverPendingCloudWrites: async () => {
    startupCloudWritesSuppressed = false;
    if (startupCloudWritePending) {
      startupCloudWritePending = false;
      await pushStateToCloud();
    }
  },
  hideStartupLoading
});

async function startApp(secret: string) {
  await portfolioAuthenticatedStartupRuntime.startApp(secret);
}

const portfolioStartupRuntime = createPortfolioStartupRuntime({
  isInitialized: () => appInitialized,
  setInitialized: (initialized) => { appInitialized = initialized; },
  restoreGatewaySecret,
  validateGatewaySecret,
  getAuthStatus,
  clearSavedGatewaySecret: () => saveGatewaySecret(''),
  persistGatewaySecret,
  loadBrokerRules: loadTradernetRules,
  clearUnresolvedWorkspace: () => {
    portfolioStore.importState(createBlankPortfolioState());
    state = portfolioStore.getState();
  },
  showBalanceView: () => switchView('BALANCE'),
  hideStartupLoading,
  showAuthContainer,
  hideAuthContainer,
  startApp,
  onStartupFailure: (error) => {
    console.error('[Startup Error]:', error);
    showStartupFailure();
  }
});

export async function initApp() {
  await portfolioStartupRuntime.initApp();
}

function showStartupFailure() {
  emitUiEvent('terminal:startup-state', { visible: true, failed: true });
}

function bindStartupActions() {
  portfolioStartupLifecycleRuntime.bind();
  bindPortfolioNavigationRuntime({
    getAccountRole: () => currentAccountRole,
    getActiveView: () => portfolioStore.getState().activeView,
    setActiveView,
    refreshLivePrices: () => refreshAllLivePrices(true)
  });
  bindPortfolioSyncRuntime({
    getAccountRole: () => currentAccountRole,
    refreshBrokerAccount: portfolioBrokerRefreshRuntime.refreshAccountInfo,
    refreshExecutedTrades: portfolioBrokerRefreshRuntime.refreshExecutedTrades,
    refreshActiveOrders: portfolioBrokerRefreshRuntime.refreshActiveOrders,
    refreshQuotes: () => refreshAllLivePrices(true),
    pushCloud: async () => {
      state = portfolioStore.getState();
      return pushStateToCloud(true);
    },
    syncClosedHistory: () => currentAccountRole === 'admin' ? syncAdminClosedHistory() : Promise.resolve(false),
    pullGuestSnapshot: async () => {
      await pullGuestPortfolioSnapshot();
      return true;
    },
    translateText,
    showToast,
    logTerminal
  });
  addUiEventListener('terminal:execute-command', (event) => {
    void (async () => {
      if (!(await requireAdmin('use the trading terminal'))) return;
      await executeCommand(event.detail.command);
    })();
  });
  addUiEventListener('settings:save-broker-rules', (event) => {
    void requireAdmin('change broker rules').then((allowed) => {
      if (allowed) saveBrokerRuleInputs(event.detail.values);
    });
  });
  addUiEventListener('settings:reset-broker-rules', () => {
    void requireAdmin('reset broker rules').then((allowed) => {
      if (allowed) resetBrokerRules();
    });
  });
  addUiEventListener('settings:save-api-keys', (event) => {
    void (async () => {
      let saved = false;
      try {
        saved = await saveApiKeys({
          secret: event.detail.secret,
          showToast: (message, type) => showToast(message, type as any),
          logTerminal
        });
        if (saved) {
          portfolioStore.setState({ gatewaySecret: event.detail.secret.trim() });
          await syncCloudState('pull');
        }
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        event.detail.resolve(saved);
      }
    })();
  });

  portfolioSessionRuntime.bindLogout();
  addUiEventListener('settings:pull-cloud-state', () => {
    if (!window.confirm(translateText("Pulling cloud will replace this device's local portfolio with the shared KV cloud snapshot. Any changes that have not synced can be lost. Export a JSON backup first if you may need them. Continue?"))) return;
    void syncCloudState('pull');
  });
  addUiEventListener('settings:change-refresh-interval', (event) => {
    const normalizedIntervalMs = setQuoteRefreshInterval(event.detail.intervalMs);
    emitUiEvent('settings:refresh-interval-changed', { intervalMs: normalizedIntervalMs });
    if (event.detail.refreshNow && normalizedIntervalMs > 0) {
      void portfolioAutoRefresh.refreshNow();
    }
  });
  addUiEventListener('settings:export-backup', () => {
    void requireAdmin('export portfolio backups').then((allowed) => {
      if (allowed) exportBackupJSON();
    });
  });
  addUiEventListener('settings:reset-to-blank-state', () => {
    void requireAdmin('reset the portfolio').then((allowed) => {
      if (allowed) resetToBlankState();
    });
  });
  addUiEventListener('terminal:backup-import-file', (event) => {
    void requireAdmin('import portfolio backups').then((allowed) => {
      if (allowed) void importBackupFile(event.detail.file);
    });
  });
}
bindStartupActions();

async function continueStartupOffline() {
  appInitialized = true;
  portfolioStore.setState({ gatewaySecret: '' });
  try {
    await startApp('');
  } catch (error) {
    appInitialized = false;
    console.error('[Startup Error]: Could not continue offline.', error);
    showStartupFailure();
  }
}
