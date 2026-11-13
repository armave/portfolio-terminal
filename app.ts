import { emitUiEvent, addUiEventListener } from './src/ui/uiEventBus';
import { getAppLanguage, translateText } from './src/services/i18n';
import { addBrokerEventListener } from './src/services/brokerEventBus';
import { brokerAdapterRegistry } from './src/services/brokerAdapters/registry';
import { setBreakevenText, setCloudStatusState, setCloudSyncStatus, setAnalystConsensus } from './src/ui/uiStateStore';
import {
  calculateBreakevenDays,
  calculateCommission,
  resolveCommissionConfig,
  calculateProjectedDebt,
  calculateMarginInterest,
  collectOpenPositionTranches,
  createPortfolioBackupSnapshot,
  normalizePortfolioBackup,
} from './src/domain/portfolio';
import { bindPortfolioNavigationRuntime } from './src/services/portfolioNavigationRuntime';
import {
  calculateTargetUpsidePercent,
} from './src/features/quotes/sentiment';
import { nextLiveQuoteRequestSequence } from './src/services/quoteProvider';
import type { FreedomQuoteStreamRuntime } from './src/services/freedomQuoteStreamRuntime';
import type { FreedomAccountStreamRuntime } from './src/services/freedomAccountStreamRuntime';
import { resolveFreedomAccountRefreshMode } from './src/services/freedomAccountStreamHealth';
import { refreshTrackedQuotes } from './src/services/quotePolling';
import { createQuoteRefreshCoordinator } from './src/services/quoteRefreshCoordinator';
import { launchBackgroundTask } from './src/services/launchBackgroundTask';
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
  pullCloudHistory,
  pushCloudHistory,
  setSecretGetter,
  syncCloudState as syncCloudStateService,
  validateGatewaySecret,
  getAuthStatus,
  getCurrentUser,
  listUsers,
  logoutAccount,
  clearFreedomTradeNetStreamSnapshotCache,
  getGuestPortfolioSnapshot,
  publishGuestPortfolioSnapshots as publishGuestPortfolioSnapshotsBatch,
  cancelPendingApiReads,
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
  savePortfolioStateSnapshot,
  saveSavedHistory,
  saveApiKeys,
  saveGatewaySecret,
  saveQuoteRefreshInterval,
  saveState,
} from './src/services/storage';
import {
  logAppMessage,
  showToast
} from './src/ui/notifications';
import {
  renderBoard as renderBoardUI,
} from './src/ui/renderBoard';
import { getTotalPortfolioInvested } from './src/domain/portfolioSelectors';
import { DEFAULT_BROKER_ASSUMPTIONS, normalizeBrokerAssumptions } from './src/domain/brokerAssumptions';
import { calculatePortfolioValuation } from './src/domain/portfolioValuation';
import { formatUSD } from './src/utils/formatters';
import { migrateLegacyCloudHoldingsToPositions, portfolioStore } from './src/store/portfolioStore';
import { createBlankPortfolioState } from './src/store/portfolioDefaults';
import {
  applyCashflowAllocationsToBrokerExecutions,
  applyCashflowAllocationsToClosedTrades,
  aggregateOpenBrokerMarginFeeAllocationsByTicker,
  applyCashflowAllocationsToMarginPositions,
  mergeBrokerExecutionHistory,
  preservePersistedBrokerFeeAllocations
} from './src/domain/closedHistoryFees';
import {
  getFreedomCashflowRefreshStartDate,
  mergeFreedomCashflowRows,
  normalizeSavedFreedomCashflows
} from './src/domain/freedomCashflows';
import { calculateFreedomMarginFeeAllocations } from './src/domain/freedomMarginFees';
import { getLatestClosedTradeDate } from './src/domain/tradeHistorySync';
import { applyActiveLimitSellTargets, canApplyFreedomBrokerBalance, classifyFreedomPortfolio, getActiveLimitSellTargets, getActiveTranchesFromTrades, normalizeActiveTrancheMix } from './src/domain/freedomPortfolio';
import { getAssignableActiveTrancheCashQuantity } from './src/domain/activeTrancheGuestAssignment';
import { createGuestPortfolioHydrationRuntime } from './src/services/guestPortfolioHydrationRuntime';
import { createGuestPortfolioAssignmentRuntime } from './src/services/guestPortfolioAssignmentRuntime';
import { createSessionIdentityGuard } from './src/utils/sessionIdentityGuard';
import type { BrokerAssumptions, PortfolioState, QuoteDetails } from './src/types/portfolio';
import { addToast } from './src/ui/notificationStore';

// ==========================================
const freedomBrokerAdapter = brokerAdapterRegistry.get('freedom-tradenet');

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
  logAppMessage
});
guestPortfolioAssignmentRuntime.bind();
let gistSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let guestCloudRefreshInFlight: Promise<unknown> | null = null;
let lastRenderedDeskView: string | null = null;
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
  const positionIntegrityIssues = classified.positionIntegrityIssues || [];
  const canApplyBrokerBalance = canApplyFreedomBrokerBalance(positionIntegrityIssues);
  const positionIntegrityWarnings = positionIntegrityIssues.length
    ? ['One or more broker positions have unverified direction or incomplete long-position history; the previous tracked values were retained.']
    : [];

  portfolioStore.setState({
    brokerAccountInfo: {
      ...snapshot,
      // Short proceeds or unresolved position effects can change available cash.
      // Retain the last accepted broker balance until every affected ticker is understood.
      balances: canApplyBrokerBalance ? snapshot.balances : current.brokerAccountInfo?.balances || [],
      receivedAt: Date.now(),
      status: 'current',
      quality: canApplyBrokerBalance ? 'complete' : 'partial',
      snapshotQuality: 'complete',
      positionIntegrityIssues,
      warnings: positionIntegrityWarnings
    },
    ...(canApplyBrokerBalance && usdBalance ? { balance: Number(usdBalance.amount) } : {}),
    positions: applyActiveLimitSellTargets(classified.positions, activeLimitSellTargets),
    cashStocks: brokerCashHoldings,
    cashCushion: {
      ...(current.cashCushion || { freeCash: 0, holdings: [] }),
      holdings: brokerCashHoldings
    }
  });
  logAppMessage('[Freedom] Active tickers, cash/margin classifications, balance and prices refreshed.');
  renderBoard();
  void guestPortfolioAssignmentRuntime.publishGuestPortfolioSnapshots();
});

// Retain the adapter's provenance alongside the compatibility data-only event.
// Keeping this separate avoids changing existing account-info consumers.
addBrokerEventListener('broker:account-info-snapshot', (snapshot) => {
  if (currentAccountRole !== 'admin') return;
  const current = portfolioStore.getState();
  const accountInfo = current.brokerAccountInfo;
  if (!accountInfo?.loaded) return;
  const positionIntegrityIssues = [
    ...(accountInfo.positionIntegrityIssues || []),
    ...(snapshot.positionIntegrityIssues || [])
  ].filter((finding, index, all) =>
    all.findIndex(item => item.ticker === finding.ticker && item.code === finding.code && item.source === finding.source) === index
  );
  const integrityWarning = 'One or more broker positions have unverified direction or incomplete long-position history; the previous tracked values were retained.';
  const warnings = [
    ...snapshot.warnings,
    ...(positionIntegrityIssues.length ? [integrityWarning] : [])
  ].filter((warning, index, all) => all.indexOf(warning) === index);
  portfolioStore.setState({
    brokerAccountInfo: {
      ...accountInfo,
      provider: snapshot.provider,
      quality: positionIntegrityIssues.length ? 'partial' : snapshot.quality,
      snapshotQuality: snapshot.quality,
      source: snapshot.source,
      receivedAt: snapshot.receivedAt,
      ...(snapshot.observedAt === undefined ? { observedAt: undefined } : { observedAt: snapshot.observedAt }),
      warnings,
      positionIntegrityIssues,
      lastRefreshIssue: undefined,
      status: 'current'
    }
  });
});

addBrokerEventListener('broker:executed-trades-error', () => {
  if (currentAccountRole === 'admin') guestPortfolioAssignmentRuntime.setBrokerTradeHistoryLoaded(false);
});

addBrokerEventListener('broker:executed-trades', (trades) => {
  if (currentAccountRole !== 'admin') return;
  if (!Array.isArray(trades)) return;
  guestPortfolioAssignmentRuntime.setBrokerTradeHistoryLoaded(true);
  const current = portfolioStore.getState();
  // portfolioStore.setState persists synchronously. Reattach local fee allocations
  // BEFORE setting raw broker rows, otherwise this listener overwrites the
  // separately persisted, fee-enriched history before ClosedHistoryDesk handles
  // the same event.
  const savedFeeRows = freedomBrokerAdapter.normalizeExecutions(loadSavedHistory().brokerExecutedTrades, { source: 'cache' }).data;
  const tradesWithPersistedFees = preservePersistedBrokerFeeAllocations(
    trades,
    [...savedFeeRows, ...(current.brokerExecutedTrades || [])]
  );
  portfolioStore.setState({ brokerExecutedTrades: tradesWithPersistedFees });
  // Reclassify the account against the newly persisted executions before
  // allowing any guest projection to publish.
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
  const positionIntegrityIssues = classified.positionIntegrityIssues || [];
  const previousWarnings = snapshot.warnings || [];
  const integrityWarning = 'One or more broker positions have unverified direction or incomplete long-position history; the previous tracked values were retained.';
  portfolioStore.setState({
    brokerAccountInfo: {
      ...snapshot,
      snapshotQuality: snapshot.snapshotQuality ?? snapshot.quality ?? 'complete',
      quality: positionIntegrityIssues.length ? 'partial' : snapshot.snapshotQuality ?? snapshot.quality ?? 'complete',
      positionIntegrityIssues,
      warnings: [
        ...previousWarnings.filter(warning => warning !== integrityWarning),
        ...(positionIntegrityIssues.length ? [integrityWarning] : [])
      ]
    },
    positions: applyActiveLimitSellTargets(classified.positions, activeLimitSellTargets),
    cashStocks: brokerCashHoldings,
    cashCushion: {
      ...(current.cashCushion || { freeCash: 0, holdings: [] }),
      holdings: brokerCashHoldings
    }
  });
  void guestPortfolioAssignmentRuntime.publishGuestPortfolioSnapshots();
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
  logAppMessage(`[Freedom] ${ticker} purchase operation classified as ${selectedType}.`);
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
   logAppMessage('[Freedom] Active sell target sync: ' + (targetDiagnostics || 'no target selected') +
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
    logAppMessage(`[Freedom] Updated ${update.ticker} target from active limit sell: ${update.price.toFixed(2)}.`);
  }
  renderBoard();
});

addBrokerEventListener('broker:active-orders-error', () => {
  if (currentAccountRole !== 'admin' || activeOrdersRefreshWarned) return;
  // Keep the last known targets on failure and avoid repeating a warning on every poll.
  activeOrdersRefreshWarned = true;
  showToast(translateText('Freedom active orders are unavailable — existing position targets are unchanged.'), 'warning');
  logAppMessage(translateText('[Freedom Warning] Active-order refresh failed; existing position targets were left unchanged.'));
});

addBrokerEventListener('broker:account-info-error', (issue) => {
  const current = portfolioStore.getState();
  const previousAccountInfo = current.brokerAccountInfo;
  portfolioStore.setState({
    brokerAccountInfo: {
      ...(previousAccountInfo || {
        loaded: false,
        balances: [],
        positions: [],
        receivedAt: issue?.receivedAt ?? Date.now()
      }),
      status: previousAccountInfo?.loaded ? 'stale' : 'unavailable',
      lastRefreshIssue: issue
    }
  });
  showToast('Freedom account data unavailable — saved portfolio data is being retained.', 'warning');
  if (issue?.quality === 'partial' && issue.warnings.length > 0) {
    logAppMessage(`[Freedom Warning] Rejected partial broker snapshot from ${issue.provider}; retained local data and marked the previous snapshot stale. ${issue.warnings.join(' ')}`);
    return;
  }
  logAppMessage('[Freedom Warning] Account refresh failed; retained local data and marked the last broker snapshot stale.');
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
  setCloudStatus('synced', 'READY');
}

let startupCloudWritesSuppressed = true;
let startupCloudWritePending = false;
let performanceSnapshotInFlight = false;
let performanceSnapshotPending = false;

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
  onDurableEquityChanged: () => { void pushStateToCloud(); },
  recordPerformanceSnapshot: async (_nextStoreState, timestamp) => {
    // Performance history is administrator-owned until PT-05 tenant isolation is implemented.
    if (performanceSnapshotInFlight) {
      performanceSnapshotPending = true;
      return false;
    }
    const accountId = currentAccountId;
    const session = currentAccountSessionGuard.capture();
    if (currentAccountRole !== 'admin' || !accountId || !session) return false;

    performanceSnapshotInFlight = true;
    try {
      const {
        appendDailyPerformanceValuation,
        capturePortfolioPerformanceValuation
      } = await import('./src/domain/portfolioPerformanceCapture');

      let changed = false;
      do {
        performanceSnapshotPending = false;
        // A login switch may have happened while the lazy module was resolving.
        // Rebind to the active administrator only after that await; never save a
        // previous account's state into the newly authenticated account.
        const activeAccountId = currentAccountId;
        const activeSession = currentAccountSessionGuard.capture();
        const isCurrentSession = currentAccountRole === 'admin' &&
          Boolean(activeAccountId) &&
          activeSession !== null &&
          currentAccountSessionGuard.isCurrent(activeSession);
        if (!isCurrentSession || !activeAccountId) return changed;

        // Read after the lazy import resolves, not from the potentially stale
        // notification that initiated this asynchronous capture.
        const latestState = portfolioStore.getState();
        const cashflowHistoryComplete = hasFreedomCashflowHistoryBaseline(activeAccountId);
        const observedAt = Math.max(timestamp, Date.now());
        const snapshot = capturePortfolioPerformanceValuation(
          latestState,
          observedAt,
          cashflowHistoryComplete
        );
        if (snapshot) {
          const existing = latestState.performanceValuations || [];
          const next = appendDailyPerformanceValuation(existing, snapshot);
          const unchanged = next.length === existing.length &&
            next.every((item, index) => item === existing[index]);
          if (!unchanged) {
            const saved = portfolioStore.setDerivedState({ performanceValuations: next }, true);
            if (saved) {
              state = portfolioStore.getState();
              changed = true;
            }
          }
        }
      } while (performanceSnapshotPending);

      return changed;
    } finally {
      performanceSnapshotInFlight = false;
      performanceSnapshotPending = false;
    }
  },
  onPerformanceSnapshotChanged: () => { void pushStateToCloud(); }
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
      logAppMessage(`[KV Cloud Sync Error]: ${err.message}`);
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

function pullCloudAndRewriteLocal(parsedState: Record<string, unknown>) {
  const currentView = state.activeView;
  // The cloud validator checks safe containers; this migration helper owns legacy field normalization.
  const compatibleCloudState = migrateLegacyCloudHoldingsToPositions(
    parsedState as unknown as Partial<PortfolioState>,
    state
  );
  const mergedState = { ...state, ...compatibleCloudState };
  if (currentAccountRole === 'guest') {
    // The shared snapshot may contain the admin's last-opened desk. Guest login
    // always starts on Balance instead of inheriting that shared navigation state.
    mergedState.activeView = 'CASH_CUSHION';
  } else if (!parsedState?.activeView && currentView) {
    mergedState.activeView = currentView;
  }
  if (!portfolioStore.importState(loadSavedState(mergedState))) {
    throw new Error(translateText('Cloud portfolio could not be merged because its transaction journal conflicts with this device. The local state was preserved.', getAppLanguage()));
  }
  state = portfolioStore.getState();
  switchView(state.activeView);
  console.log("[Sync]: Cloud state ingested and UI re-rendered successfully.", state);
  emitUiEvent('app:scroll-workspace');
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
    logAppMessage,
    onStatusChange: (status) => {
      const synced = status === 'synced';
      setCloudStatus(synced ? 'synced' : 'error', synced ? 'READY' : 'UNAVAILABLE');
      setCloudSyncStatus(synced
        ? { text: 'Synced', status: 'synced', lastSyncedAt: Date.now() }
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
  const localSnapshotSaved = await savePortfolioSnapshot(
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
    logAppMessage("[System]: Portfolio reset cancelled; local storage could not commit the portfolio and history together.");
    return;
  }

  // Only enqueue remote writes after the complete local reset is durable.
  pushStateToGist(true);
  renderBoard();
  logAppMessage("[System]: Portfolio reset to a clean blank slate.");

  try {
    const historyCleared = await clearCloudHistory(resetSecret, { isCurrentSession: isResetSessionCurrent });
    if (!isResetSessionCurrent()) return;
    if (!historyCleared) {
      throw new Error("The cloud history reset was not confirmed. Verify cloud access and retry.");
    }
    logAppMessage("[System]: Closed trade history cleared from KV cloud.");
  } catch (error) {
    if (!isResetSessionCurrent()) return;
    const detail = error instanceof Error ? error.message : "Unknown cloud history error.";
    console.error("Unable to clear closed history from KV cloud:", error);
    showToast(
      "The portfolio was reset locally, but cloud closed history could not be cleared. Restore cloud access and retry the reset.",
      "error"
    );
    logAppMessage(`[KV Cloud Error]: Closed history reset failed: ${detail}`);
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

  logAppMessage(saveMsg);
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
    const msg = `Applied ${elapsedCycles} rollover cycle${elapsedCycles > 1 ? 's' : ''}: accrued interest $${interestAccrued.toFixed(2)}, new margin debt $${compoundedDebt.toFixed(2)}.`;
    addToast(msg, 'info');
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
    setText("Breakeven: No active trades");
    return;
  }

  if (totalDebt <= 0) {
    setText("Breakeven: No margin debt");
    return;
  }

  if (netTargetProfit <= 0) {
    setText("Breakeven: No date");
    return;
  }

  if (getDailyRate() === 0) {
    setText("Breakeven: No date");
    return;
  }

  const beDays = calculateBreakevenDays(netTargetProfit, totalDebt, getDailyRate());
  if (beDays === null) {
    setText("Breakeven: No non-negative breakeven date");
    return;
  }

  const beDate = new Date();
  beDate.setDate(beDate.getDate() + beDays);
  const beDateStr = beDate.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  setText(`Breakeven: ${beDays} days (${beDateStr})`);
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
        loadSavedBrokerExecutions: () => freedomBrokerAdapter.normalizeExecutions(loadSavedHistory().brokerExecutedTrades, { source: 'cache' }).data,
        getCurrentBrokerExecutions: () => portfolioStore.getState().brokerExecutedTrades || [],
        onStatus: (status, message) => {
          if (status === 'connected') {
            logAppMessage('[System]: Live TradeNet portfolio and orders streams connected.');
          } else if (status === 'reconnecting') {
            logAppMessage(message
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
              logAppMessage('[System]: Live TradeNet quote stream connected.');
            } else if (status === 'reconnecting') {
              logAppMessage(message
                ? `[Warning]: Live TradeNet quote stream reconnecting (${message}).`
                : '[Warning]: Live TradeNet quote stream reconnecting; the browser socket remains open.');
            }
          }
        });
        return runtime;
      }).catch((error) => {
        freedomQuoteStreamRuntimePromise = null;
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



/**
 * Start the private account stream for the currently authenticated administrator.
 * Broker startup calls this before attempting the one-shot account/trade/order
 * reads, allowing the persistent stream to satisfy those initial snapshots.
 */
export async function startFreedomAccountStreamForSession(sessionKey: string): Promise<boolean> {
  const currentSessionKey = () => currentAccountRole && currentAccountId
    ? `${currentAccountRole}:${currentAccountId}`
    : '';
  if (currentAccountRole !== 'admin' || !sessionKey.startsWith('admin:') ||
      currentSessionKey() !== sessionKey) {
    return false;
  }

  const runtime = await getFreedomAccountStreamRuntime();
  if (currentAccountRole !== 'admin' || currentSessionKey() !== sessionKey) return false;
  return runtime.start(sessionKey);
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
    ? currentAccountRole + ':' + currentAccountId
    : '';
  if (currentAccountRole === 'admin' && accountStreamSessionKey) {
    // Persistent sockets are best-effort background transports. Do not make
    // first-render readiness wait for a WebSocket ready frame; REST snapshots
    // remain the bounded source for initial portfolio/quote data.
    launchBackgroundTask(
      () => startFreedomAccountStreamForSession(accountStreamSessionKey),
      (streamError) => {
        console.warn('[Freedom Account Stream]: Unable to establish the portfolio/orders socket; REST snapshots remain available.', streamError);
      }
    );
  } else {
    stopFreedomAccountStreamRuntime();
  }

  if (tickersArray.length === 0) {
    stopFreedomQuoteStreamRuntime();
    return true;
  }

  const sessionKey = currentAccountRole && currentAccountId
    ? currentAccountRole + ':' + currentAccountId
    : '';
  if (!sessionKey) {
    stopFreedomQuoteStreamRuntime();
    return true;
  }

  try {
    const quoteStreamRuntime = await getFreedomQuoteStreamRuntime();
    const currentSessionKey = currentAccountRole && currentAccountId
      ? currentAccountRole + ':' + currentAccountId
      : '';
    if (currentSessionKey !== sessionKey) {
      quoteStreamRuntime.stop();
      return true;
    }

    if (quoteStreamRuntime.isConnected()) return true;

    // Start the persistent quote socket in the background. The initial
    // one-time REST quote batch below supplies prices while the socket opens
    // or reconnects; later q messages take over without blocking startup.
    launchBackgroundTask(
      () => quoteStreamRuntime.start(tickersArray, sessionKey),
      (streamError) => console.warn(
        '[Freedom Quote Stream]: Live socket is not ready yet; REST quote snapshots remain active.',
        streamError
      )
    );

    const refreshResult = await refreshTrackedQuotes(tickersArray, Date.now(), recordTrackedPrice, force);
    if (refreshResult.skipped) return true;
    if (refreshResult.updatedCount > 0) {
      state = portfolioStore.getState();
      saveState(state);
      renderBoard();
      logAppMessage('[System]: Initial market quote snapshot refreshed ' + refreshResult.updatedCount + ' assets; the live socket is connecting in the background.');
      return true;
    }
    logAppMessage('[Warning]: The live quote socket is connecting; the initial REST quote snapshot returned no usable prices.');
    return false;
  } catch (err: any) {
    console.error('Initial REST quote fallback failed:', err);
    logAppMessage('[Error]: Initial quote snapshot failed - ' + err.message);
    return false;
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
      if (currentAccountRole + ':' + currentAccountId !== sessionKey) return false;
      launchBackgroundTask(
        () => accountStreamRuntime.start(sessionKey),
        (streamError) => console.warn('[Freedom Account Stream]: Unable to establish the private account socket; broker REST catch-up will continue.', streamError)
      );
    } catch (streamError) {
      console.warn('[Freedom Account Stream]: Unable to load the private account socket; broker REST catch-up will continue.', streamError);
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
        logAppMessage(`[Guest Auto Update Warning]: Assigned holdings and LOTS history were not refreshed (${message}).`);
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
    const cloudExecutions = freedomBrokerAdapter.normalizeExecutions(cloudHistory?.brokerExecutedTrades || [], { source: 'cache' }).data;
    const savedExecutions = freedomBrokerAdapter.normalizeExecutions(savedAtStart.brokerExecutedTrades, { source: 'cache' }).data;
    const currentExecutions = freedomBrokerAdapter.normalizeExecutions(currentAtStart.brokerExecutedTrades || [], { source: 'cache' }).data;
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
    const cashflowResponse = await freedomBrokerAdapter.fetchCashflows(latestCashflowDate);
    if (!isCurrentSession()) return false;
    const fetchedCashflows = freedomBrokerAdapter.normalizeCashflows(cashflowResponse).data;

    // Broker executions may have completed while the cashflow request was in
    // flight. Re-read the canonical store and sidecar before calculating fees.
    const current = portfolioStore.getState();
    const saved = loadSavedHistory();
    const latestSavedExecutions = freedomBrokerAdapter.normalizeExecutions(saved.brokerExecutedTrades, { source: 'cache' }).data;
    const latestCurrentExecutions = freedomBrokerAdapter.normalizeExecutions(current.brokerExecutedTrades || [], { source: 'cache' }).data;
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

    // Broker cashflow retrieval is asynchronous. Read classifications and open
    // positions again immediately before allocating so a user edit made during
    // the fetch is not overwritten by a stale fee projection.
    const allocationState = portfolioStore.getState();
    const appClosedTrades = [...(allocationState.closedTrades || [])];
    const allocations = calculateFreedomMarginFeeAllocations(
      mergedCashflows,
      mergedExecutions,
      appClosedTrades,
      {
        trancheTypes: allocationState.activeTrancheTypes,
        trancheMixes: allocationState.activeTrancheMixes,
        openAppPositions: allocationState.positions
      }
    );
    const updatedExecutions = applyCashflowAllocationsToBrokerExecutions(
      mergedExecutions,
      allocations.brokerAllocations,
      allocations.brokerOpenAllocations
    );
    const openPositionFeeAllocations = mergedExecutions.length
      ? aggregateOpenBrokerMarginFeeAllocationsByTicker(mergedExecutions, allocations.brokerOpenAllocations)
      : allocations.appOpenAllocations;
    const updatedMarginPositions = applyCashflowAllocationsToMarginPositions(
      allocationState.positions || {},
      openPositionFeeAllocations
    );
    const updatedClosedTrades = applyCashflowAllocationsToClosedTrades(
      appClosedTrades,
      allocations.appAllocations
    );
    const nextState: Partial<PortfolioState> = {};
    if (JSON.stringify(allocationState.brokerExecutedTrades || []) !== JSON.stringify(updatedExecutions)) {
      nextState.brokerExecutedTrades = updatedExecutions;
    }
    if (JSON.stringify(allocationState.positions || {}) !== JSON.stringify(updatedMarginPositions)) {
      nextState.positions = updatedMarginPositions;
    }
    if (JSON.stringify(allocationState.cashflows || []) !== JSON.stringify(mergedCashflows)) {
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

    // The full history is checkpointed to the separate encrypted cloud-history
    // record below. Do not duplicate the entire multi-megabyte history in
    // localStorage on every scheduled sync; retain the previous local cache.
    const persisted = savePortfolioStateSnapshot(portfolioStore.getState());
    if (!persisted) {
      portfolioStore.update(() => previousState, false);
      state = portfolioStore.getState();
      logAppMessage('[Closed History Sync Error]: Could not persist the local portfolio snapshot; cloud history was not changed.');
      return false;
    }
    state = portfolioStore.getState();
    if (!isCurrentSession()) return false;

    const mergedHistory = {
      brokerExecutedTrades: updatedExecutions,
      cashflows: mergedCashflows
    };
    const localHistorySaved = await saveSavedHistory(mergedHistory);
    if (!localHistorySaved) {
      logAppMessage('[Closed History Cache Warning]: Local IndexedDB history cache could not be updated; the encrypted cloud-history checkpoint will still be attempted.');
    }
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
        logAppMessage('[Closed History Sync Warning]: Local cashflows and trades are saved, but the cloud history checkpoint was not confirmed.');
        return false;
      }
    }

    if (!hasFreedomCashflowHistoryBaseline(accountId) &&
      !markFreedomCashflowHistoryBaseline(accountId)) {
      logAppMessage('[Closed History Sync Warning]: Cashflows are saved, but the completed-history baseline could not be recorded; the next sync will retry a full read.');
      return false;
    }
    return true;
  } catch (error) {
    if (isCurrentSession()) {
      const message = error instanceof Error ? error.message : String(error);
      logAppMessage(`[Closed History Sync Warning]: Freedom cashflow or cloud history refresh failed (${message}).`);
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
    logAppMessage(`[Auto Update Warning]: ${source} refresh failed (${message}).`);
  }
});

const portfolioStartupLifecycleRuntime = createPortfolioStartupLifecycleRuntime({
  getAccountRole: () => currentAccountRole,
  isDocumentVisible: () => !document.hidden,
  applyOvernightRollover,
  refreshOnVisibilityChange: () => portfolioAutoRefresh.onVisibilityChange(),
  setStartupState: (visible, failed) => emitUiEvent('app:startup-state', { visible, failed }),
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
  logAppMessage(`[Backup]: Exported state to ${filename}.`);
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
      logAppMessage('[Backup Import]: Import cancelled; the current portfolio was not changed.');
      return;
    }

    importedState.lastUpdated = Date.now();
    const previousState = portfolioStore.getState();
    commitPortfolioBackupImport(
      importedState,
      previousState,
      (snapshot) => {
        if (!portfolioStore.importState(snapshot as any)) {
          throw new Error(translateText('Backup transaction history conflicts with this device or is not supported.', getAppLanguage()));
        }
        state = portfolioStore.getState();
      },
      () => saveState(state, pushStateToGist)
    );
    await pushStateToGist(true);
    renderBoard();
    logAppMessage(`[Backup Import]: Imported ${file.name} into this browser. Check KV cloud status for sync results.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logAppMessage(`[Backup Error]: Could not import backup (${message}).`);
    showToast(`Backup import failed: ${message}`, 'error');
  }
}

let appInitialized = false;

function hideStartupLoading() {
  emitUiEvent('app:startup-state', { visible: false, failed: false });
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
  cancelPendingApiReads,
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
  emitUiEvent('auth:visibility', { isOpen });
}

function showAuthContainer() {
  renderAuthModal(true);
}

function hideAuthContainer() {
  renderAuthModal(false);
}

const portfolioAuthenticatedStartupRuntime = createPortfolioAuthenticatedStartupRuntime({
  loadBrokerRules: loadTradernetRules,
  publishCurrentUser,
  clearAccountIdentity: () => {
    stopFreedomQuoteStreamRuntime();
    stopFreedomAccountStreamRuntime();
    currentAccountRole = null;
    currentAccountId = null;
    canWriteCloudState = false;
  },
  setGatewaySecret: (secret) => { portfolioStore.setState({ gatewaySecret: secret }); },
  getAccountRole: () => currentAccountRole,
  pullGuestPortfolioSnapshot,
  importSavedAdminWorkspace: () => {
    portfolioStore.importState(loadSavedState(portfolioStore.getState()));
    state = portfolioStore.getState();
  },
  applyOvernightRollover,
  pullSharedCloudState: async () => {
    setCloudStatus('syncing', 'CHECKING...');
    await syncCloudState('pull');
  },
  getInitialQuoteRefreshInterval: (role) => getQuoteRefreshInterval(
    role === 'guest' ? DEFAULT_GUEST_REFRESH_INTERVAL_MS : DEFAULT_ADMIN_REFRESH_INTERVAL_MS,
    role === 'guest' ? 'guest' : 'admin'
  ),
  setQuoteRefreshInterval,
  configureAdminRollover: (enabled) => portfolioStartupLifecycleRuntime.configureAdminRollover(enabled),
  beginInitialQuoteRefresh: () => { initialQuoteRefreshPending = true; },
  showGuestBalanceView: () => setActiveView('BALANCE'),
  showSavedAdminView: () => switchView(state.activeView),
  scrollWorkspace: () => emitUiEvent('app:scroll-workspace'),
  refreshLivePrices: () => {
    // Show the restored workspace promptly; provider snapshots are independent
    // background refreshes and can take several seconds across fallback sources.
    launchBackgroundTask(
      () => refreshAllLivePrices(true),
      (error) => console.warn('[Startup Quote Refresh]: Initial background quote refresh did not complete.', error)
    );
    return Promise.resolve();
  },
  finishInitialQuoteRefresh: () => { initialQuoteRefreshPending = false; },
  renderBoardAnalystConsensus: () => renderBoardAnalystConsensus(getMarketInsightsTicker(state)),
  recoverPendingCloudWrites: async () => {
    startupCloudWritesSuppressed = false;
    if (startupCloudWritePending) {
      startupCloudWritePending = false;
      launchBackgroundTask(
        async () => {
          const saved = await pushStateToCloud();
          if (!saved) console.warn('[Startup Cloud Sync]: Pending cloud write was not confirmed; retry from the KV status control.');
        },
        (error) => console.warn('[Startup Cloud Sync]: Pending cloud write could not be started.', error)
      );
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
  emitUiEvent('app:startup-state', { visible: true, failed: true });
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
    logAppMessage
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
          logAppMessage
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
  addUiEventListener('settings:backup-import-file', (event) => {
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
