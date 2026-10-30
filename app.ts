import { emitUiEvent, addUiEventListener } from './src/ui/uiEventBus';
import { setTradingConsoleProps, setSettingsPropsState, setMarketInsightsPropsState, setExternalLinksPropsState } from './src/ui/uiStateStore';
import { setAiStatus, setBreakevenText, setCloudStatusState, setCloudSyncStatus, setAnalystConsensus } from './src/ui/uiStateStore';
import {
  calculateBreakevenDays,
  calculateCommission,
  calculateProjectedDebt,
  calculateMarginInterest,
  collectOpenPositionTranches,
  createBlankState,
  createPortfolioBackupSnapshot,
  normalizePortfolioBackup,
  resolveSaleQuantity,
} from './src/domain/portfolio';
import { evaluateIntent, parseAiIntent } from './src/features/ai/intent';
import { buildIntentPrompt } from './src/features/ai/prompt';
import {
  calculateTargetUpsidePercent,
} from './src/features/quotes/sentiment';
import { fetchLivePriceFromProviders } from './src/services/quoteProvider';
import { refreshTrackedQuotes } from './src/services/quotePolling';
import { commitPortfolioBackupImport } from './src/services/backupImport';
import { getLatestRolloverTimestamp, getRolloverTimestampForLocalDate, getZonedDateParts, shiftCalendarDate } from './src/domain/rolloverCalendar';
import {
  fetchYahooDeepStockData,
  proxyFetch,
  setSecretGetter,
  syncCloudState as syncCloudStateService,
  validateGatewaySecret
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
  saveApiKeys,
  saveBrokerRules,
  saveGatewaySecret,
  saveQuoteRefreshInterval,
  saveState,
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
import { calculatePortfolioValuation } from './src/domain/portfolioValuation';
import { formatUSD } from './src/utils/formatters';
import { migrateLegacyCloudHoldingsToPositions, portfolioStore } from './src/store/portfolioStore';
import { preservePersistedBrokerFeeAllocations } from './src/domain/closedHistoryFees';
import { applyActiveLimitSellTargets, classifyFreedomPortfolio, getActiveLimitSellTargets, getActiveTranchesFromTrades, normalizeActiveTrancheMix } from './src/domain/freedomPortfolio';
import { InsightSection } from './src/components/MarketInsightsPanel';
import { CommandDispatcher } from './src/features/terminal/commandDispatcher';
import type { ScenarioModalData } from './src/features/terminal/commandDispatcher';

// ==========================================
// USER-CONFIGURABLE BROKER DEFAULT ASSUMPTIONS
// ==========================================
const DEFAULT_TRADERNET_RULES = {
  broker: "Freedom Broker Armenia (Tradernet)",
  annualRate: 0.1500,                  // Default: 15.00% annual margin interest
  dayCountBasis: 365,
  rolloverHour: 4,                     // Default: 4:00 AM in Asia/Yerevan
  rolloverMinute: 0,
  rolloverTimeZone: "Asia/Yerevan",
  maintenanceMarginRatio: 0.10,        // Default maintenance equity ratio
  stopOutRatio: 0.00,                  // Default stop-out equity ratio
  commPerShare: 0.012,                 // Default: $0.012 per share
  commVolumePct: 0.0012,               // Default: 0.12% trade value
  minCommOrder: 1.20                   // Default: $1.20 minimum per execution
};

const TRADERNET_RULES = { ...DEFAULT_TRADERNET_RULES };

let state: any = createBlankState();
let gistSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let quoteRefreshTimer: ReturnType<typeof setInterval> | null = null;
let rolloverTimer: ReturnType<typeof setInterval> | null = null;
let lastRenderedDeskView: string | null = null;
let settingsPanelMounted = false;
let lastSettingsRulesSignature: string | null = null;
const livePriceRequests = new Map<string, Promise<any>>();
let activeInsightSection = 'news';
let insightRequestId = 0;
let initialQuoteRefreshPending = false;
const boardAnalystSnapshots = new Map<string, any>();
const boardAnalystErrors = new Map<string, any>();
const boardAnalystRequests = new Map<string, Promise<void>>();
const BOARD_ANALYST_CACHE_TTL_MS = 5 * 60 * 1000;
const BOARD_ANALYST_RETRY_MS = 60 * 1000;

const DEFAULT_QUOTE_REFRESH_INTERVAL_MS = 60 * 1000;
const QUOTE_REFRESH_INTERVALS = new Set([0, 15 * 1000, 30 * 1000, 60 * 1000]);

// Cached broker limit prices must win over default targets during asynchronous refreshes.
let activeLimitSellTargets: Record<string, number> = {};

// ==========================================
// CLOUDFLARE WORKERS KV REPLICATION ENGINE
// ==========================================
function setCloudStatus(status: string, text: string) {
  setCloudStatusState({ status, text });
}

// Freedom is authoritative for broker-reported account balance, aggregate
// holdings and available broker prices. App-owned lots/cost basis remain local.
if (typeof window !== 'undefined') {
  window.addEventListener('tradenet:account-info', (event: Event) => {
    const snapshot = (event as CustomEvent).detail;
    if (!snapshot || snapshot.loaded !== true || !Array.isArray(snapshot.positions) || !Array.isArray(snapshot.balances)) return;
    const current = portfolioStore.getState();
    const executedTrades = Array.isArray((window as any).__tradenetExecutedTrades)
      ? (window as any).__tradenetExecutedTrades
      : Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
    const classified = classifyFreedomPortfolio(
      snapshot,
      current.positions || {},
      current.cashCushion?.holdings || [],
      current.activeTrancheTypes || {},
      Date.now(),
      executedTrades,
      TRADERNET_RULES,
      current.activeTrancheMixes || {}
    );
    const brokerCashHoldings = classified.cashStocks.map((holding: any) => ({
      ...holding,
      ...(Number.isFinite(Number(holding.currentPrice ?? holding.price))
        ? { price: Number(holding.currentPrice ?? holding.price) }
        : {})
    }));
    const usdBalance = snapshot.balances.find((item: any) =>
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
  });

  window.addEventListener('tradenet:executed-trades', (event: Event) => {
    const trades = (event as CustomEvent).detail;
    if (!Array.isArray(trades)) return;
    const current = portfolioStore.getState();
    // portfolioStore.setState persists synchronously. Reattach local fee allocations
    // BEFORE setting raw broker rows, otherwise this listener overwrites the
    // separately persisted, fee-enriched history before ClosedHistoryDesk handles
    // the same event.
    const savedFeeRows = loadSavedHistory().brokerExecutedTrades;
    const tradesWithPersistedFees = preservePersistedBrokerFeeAllocations(
      trades,
      [...savedFeeRows, ...(current.brokerExecutedTrades || [])]
    );
    portfolioStore.setState({ brokerExecutedTrades: tradesWithPersistedFees });
    const snapshot = current.brokerAccountInfo;
    if (!snapshot?.loaded || !Array.isArray(snapshot.positions)) return;
    const classified = classifyFreedomPortfolio(
      snapshot,
      current.positions || {},
      current.cashCushion?.holdings || [],
      current.activeTrancheTypes || {},
      Date.now(),
      tradesWithPersistedFees,
      TRADERNET_RULES,
      current.activeTrancheMixes || {}
    );
    const brokerCashHoldings = classified.cashStocks.map((holding: any) => ({
      ...holding,
      ...(Number.isFinite(Number(holding.currentPrice ?? holding.price))
        ? { price: Number(holding.currentPrice ?? holding.price) }
        : {})
    }));
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

  window.addEventListener('tradenet:set-active-tranche-type', (event: Event) => {
    const detail = (event as CustomEvent<{
      ticker?: string;
      type?: 'cash' | 'margin' | 'mix';
      mix?: { cash?: number; margin?: number };
    }>).detail;
    const operationId = String(detail?.ticker || '').trim();
    const selectedType = detail?.type;
    if (!operationId || (selectedType !== 'cash' && selectedType !== 'margin' && selectedType !== 'mix')) return;

    const current = portfolioStore.getState();
    const activeTrancheTypes = { ...(current.activeTrancheTypes || {}), [operationId]: selectedType };
    const activeTrancheMixes = { ...(current.activeTrancheMixes || {}) };
    if (selectedType === 'mix') {
      const availableTrades = Array.isArray((window as any).__tradenetExecutedTrades)
        ? (window as any).__tradenetExecutedTrades
        : Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
      const activeTranche = getActiveTranchesFromTrades(availableTrades, current.brokerAccountInfo)
        .find((tranche) => tranche.id === operationId);
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

    const snapshot = current.brokerAccountInfo;
    if (!snapshot?.loaded || !Array.isArray(snapshot.positions)) {
      portfolioStore.setState({ activeTrancheTypes, activeTrancheMixes });
      // Persist the preference even when broker data is not ready yet.
      saveState(state);
      pushStateToGist();
      return;
    }
    const executedTrades = Array.isArray((window as any).__tradenetExecutedTrades)
      ? (window as any).__tradenetExecutedTrades
      : Array.isArray(current.brokerExecutedTrades) ? current.brokerExecutedTrades : undefined;
    const classified = classifyFreedomPortfolio(
      snapshot,
      current.positions || {},
      current.cashCushion?.holdings || [],
      activeTrancheTypes,
      Date.now(),
      executedTrades,
      TRADERNET_RULES,
      activeTrancheMixes
    );
    const brokerCashHoldings = classified.cashStocks.map((holding: any) => ({
      ...holding,
      ...(Number.isFinite(Number(holding.currentPrice ?? holding.price))
        ? { price: Number(holding.currentPrice ?? holding.price) }
        : {})
    }));
    portfolioStore.setState({
      activeTrancheTypes,
      activeTrancheMixes,
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
    const ticker = operationId.split(':')[0];
    logTerminal(`[Freedom] ${ticker} purchase operation classified as ${selectedType}.`);
    renderBoard();
  });

  window.addEventListener('tradenet:active-orders', (event: Event) => {
    const orders = (event as CustomEvent<Array<{
      id: string; ticker: string; operation: number | null; orderType: number | null;
      limitPrice: number | null; remainingQuantity: number | null; status: string;
    }>>).detail;
    if (!Array.isArray(orders)) return;

    // Cache the broker's exact limit price so a slower account/trade refresh
    // cannot replace it with the locally calculated default target.
    const marginQuantities = Object.values(portfolioStore.getState().positions || {}).reduce((quantities, position: any) => {
      const ticker = String(position?.ticker || '').trim().toUpperCase().replace(/\.US$/i, '');
      const shares = Number(position?.shares);
      if (ticker && Number.isFinite(shares) && shares > 0) quantities[ticker] = (quantities[ticker] || 0) + shares;
      return quantities;
    }, {} as Record<string, number>);
    activeLimitSellTargets = getActiveLimitSellTargets(orders, marginQuantities);
    const orderDiagnostics = orders
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
      '; orders=' + (orderDiagnostics || 'none') + '.');
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

  window.addEventListener('tradenet:account-info-error', () => {
    const current = portfolioStore.getState();
    if (current.brokerAccountInfo) {
      portfolioStore.setState({
        brokerAccountInfo: { ...current.brokerAccountInfo, status: 'stale' }
      });
    }
    showToast('Freedom account data unavailable — saved portfolio data is being retained.', 'warning');
    logTerminal('[Freedom Warning] Account refresh failed; retained local data and marked the last broker snapshot stale.');
  });
}

const syncCalculatedPortfolioEquity = (nextStoreState: ReturnType<typeof portfolioStore.getState>) => {
  state = nextStoreState as any;

  // Equity is derived from the latest stored cash, holdings, and prices. Persist
  // it into the canonical snapshot and cloud-sync only when its cent value changes.
  const valuation = calculatePortfolioValuation({
    signedAccountBalance: nextStoreState.balance,
    freeCash: nextStoreState.cashCushion?.freeCash,
    marginPositions: Object.values(nextStoreState.positions || {}),
    cashHoldings: nextStoreState.cashCushion?.holdings || []
  });
  const equity = Number(valuation.equity.toFixed(2));
  if (
    Number.isFinite(nextStoreState.portfolioEquity) &&
    Number(nextStoreState.portfolioEquity) === equity
  ) return;

  portfolioStore.setState({
    portfolioEquity: equity,
    portfolioEquityUpdatedAt: Date.now()
  });
  void pushStateToCloud();
};

portfolioStore.subscribe(syncCalculatedPortfolioEquity);
// Also calculate/persist the initial snapshot so the first equity value is not
// left local-only until the next trade or quote refresh.
syncCalculatedPortfolioEquity(portfolioStore.getState());

async function pushStateToCloud(forceImmediate = false) {
  if (!areHeaderCredentialsConfigured()) {
    setCloudStatus('idle', 'ADD SECRET');
    return;
  }

  portfolioStore.setState({ lastUpdated: Date.now() });

  const doPush = async () => {
    setCloudStatus('syncing', 'WRITING...');
    try {
      const ok = await syncCloudState('push');
      if (ok) {
        setCloudStatus('synced', 'UPDATED');
      } else {
        setCloudStatus('error', 'FAIL');
      }
    } catch (err: any) {
      logTerminal(`[KV Cloud Sync Error]: ${err.message}`);
      setCloudStatus('error', 'FAIL');
    }
  };

  if (forceImmediate) {
    if (gistSyncTimeout) clearTimeout(gistSyncTimeout);
    await doPush();
  } else {
    if (gistSyncTimeout) clearTimeout(gistSyncTimeout);
    gistSyncTimeout = setTimeout(doPush, 600);
  }
}

const pushStateToGist = pushStateToCloud;

function pullCloudAndRewriteLocal(parsedState: any) {
  const currentView = state.activeView;
  const compatibleCloudState = migrateLegacyCloudHoldingsToPositions(parsedState, state);
  const mergedState = { ...state, ...compatibleCloudState };
  if (!parsedState?.activeView && currentView) {
    mergedState.activeView = currentView;
  }
  portfolioStore.importState(loadSavedState(mergedState));
  state = portfolioStore.getState();
  switchView(state.activeView);
  console.log("[Sync]: Cloud state ingested and UI re-rendered successfully.", state);
  emitUiEvent('terminal:scroll-workspace');
}

async function syncCloudState(mode = 'push') {
  return syncCloudStateService(mode, {
    state,
    getState: () => state,
    pullCloudAndRewriteLocal,
    showToast: (msg: string, type?: string) => showToast(msg, type as any),
    logTerminal,
    onStatusChange: (status) => {
      setCloudSyncStatus(status === 'synced'
        ? { text: `Synced: ${new Date().toLocaleTimeString()}`, status: 'synced' }
        : { text: 'Sync failed', status: 'error' });
    }
  });
}

function resetToBlankState() {
  if (confirm("Reset the entire terminal to a blank slate? This will clear all holdings, balances, and history locally and on KV cloud.")) {
    portfolioStore.importState(createBlankState() as any);
    state = portfolioStore.getState();
    saveState(state, pushStateToGist);
    pushStateToGist(true);
    renderBoard();
    logTerminal("[System]: Portfolio reset to a clean blank slate.");
  }
}

function calcCommission(shares: number, totalVal: number) {
  return calculateCommission(shares, totalVal, TRADERNET_RULES as any);
}

function getDailyRate() {
  return TRADERNET_RULES.annualRate / TRADERNET_RULES.dayCountBasis;
}

function loadTradernetRules() {
  const savedRules = loadBrokerRules<any>({});
  if (!savedRules || Object.keys(savedRules).length === 0) return;

  try {
    const candidates = {
      annualRate: Number(savedRules.annualRate),
      dayCountBasis: savedRules.dayCountBasis === undefined ? DEFAULT_TRADERNET_RULES.dayCountBasis : Number(savedRules.dayCountBasis),
      maintenanceMarginRatio: Number(savedRules.maintenanceMarginRatio),
      stopOutRatio: Number(savedRules.stopOutRatio),
      rolloverHour: Number(savedRules.rolloverHour),
      rolloverMinute: Number(savedRules.rolloverMinute),
      commPerShare: Number(savedRules.commPerShare),
      commVolumePct: Number(savedRules.commVolumePct),
      minCommOrder: Number(savedRules.minCommOrder)
    };
    const valid = Number.isFinite(candidates.annualRate) && candidates.annualRate >= 0 && candidates.annualRate <= 1 &&
      [360, 365].includes(candidates.dayCountBasis) &&
      Number.isFinite(candidates.maintenanceMarginRatio) && candidates.maintenanceMarginRatio >= 0 && candidates.maintenanceMarginRatio < 1 &&
      Number.isFinite(candidates.stopOutRatio) && candidates.stopOutRatio >= 0 && candidates.stopOutRatio <= candidates.maintenanceMarginRatio &&
      Number.isInteger(candidates.rolloverHour) && candidates.rolloverHour >= 0 && candidates.rolloverHour <= 23 &&
      Number.isInteger(candidates.rolloverMinute) && candidates.rolloverMinute >= 0 && candidates.rolloverMinute <= 59 &&
      Number.isFinite(candidates.commPerShare) && candidates.commPerShare >= 0 &&
      Number.isFinite(candidates.commVolumePct) && candidates.commVolumePct >= 0 && candidates.commVolumePct <= 1 &&
      Number.isFinite(candidates.minCommOrder) && candidates.minCommOrder >= 0;
    if (!valid) throw new Error('Saved broker assumptions are outside the supported range.');
    Object.assign(TRADERNET_RULES, candidates);
    portfolioStore.updateAssumptions(TRADERNET_RULES as any);
  } catch (error: any) {
    logTerminal(`[Settings Error]: Could not load saved broker assumptions (${error.message}). Using defaults.`);
  }
}

function saveBrokerRuleInputs(values: import('./src/components/SettingsDesk').BrokerRulesFormValues) {
  const [rolloverHour, rolloverMinute] = values.rolloverTime.split(':').map(Number);
  const previousRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  const updatedRules = {
    ...TRADERNET_RULES,
    annualRate: Number(values.annualRate) / 100,
    dayCountBasis: Number(values.dayCountBasis),
    maintenanceMarginRatio: Number(values.maintenanceMargin) / 100,
    stopOutRatio: Number(values.stopOutRatio) / 100,
    rolloverHour,
    rolloverMinute,
    commPerShare: Number(values.commPerShare),
    commVolumePct: Number(values.commVolumePct) / 100,
    minCommOrder: Number(values.minCommOrder)
  };
  if (updatedRules.stopOutRatio > updatedRules.maintenanceMarginRatio) {
    showToast('Stop-out equity must not exceed maintenance equity.', 'error');
    return;
  }
  Object.assign(TRADERNET_RULES, updatedRules);
  portfolioStore.updateAssumptions(updatedRules as any);
  saveBrokerRules(updatedRules);
  const nextRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  if (previousRollover !== nextRollover) {
    portfolioStore.setLastRolloverTimestamp(getLatestRolloverTimestamp(new Date(), TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone));
    saveState(state, pushStateToGist);
  }
  verifyTradernetRulesOnload();
  renderBoard();
  renderSettingsPanel(true);
}
function resetBrokerRules() {
  const previousRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  Object.assign(TRADERNET_RULES, DEFAULT_TRADERNET_RULES);
  portfolioStore.updateAssumptions(DEFAULT_TRADERNET_RULES as any);
  clearBrokerRules();
  if (previousRollover !== `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`) {
    portfolioStore.setLastRolloverTimestamp(getLatestRolloverTimestamp(new Date(), TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone));
    saveState(state, pushStateToGist);
  }
  verifyTradernetRulesOnload();
  renderBoard();
}

function verifyTradernetRulesOnload() {
  const ratePct = (TRADERNET_RULES.annualRate * 100).toFixed(2);
  const dailyPct = (getDailyRate() * 100).toFixed(4);
  const maintenancePct = (TRADERNET_RULES.maintenanceMarginRatio * 100).toFixed(2);
  const rolloverTime = `${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')}`;
  const saveMsg =
    `Broker model: ${ratePct}% p.a. (${dailyPct}%/d, /${TRADERNET_RULES.dayCountBasis}) | ${rolloverTime} Armenia time compounding | Maintenance equity ${maintenancePct}%`;

  logTerminal(saveMsg);
}

function applyOvernightRollover() {
  const now = new Date();
  if (!Number.isFinite(Number(state.lastRolloverTimestamp)) || Number(state.lastRolloverTimestamp) <= 0) {
    portfolioStore.setLastRolloverTimestamp(getLatestRolloverTimestamp(now, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone));
    saveState(state, pushStateToGist);
    return;
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

    portfolioStore.applyRollover(compoundedDebt, interestAccrued, now.getTime(), recordAsRealized);
    saveState(state, pushStateToGist);
    logTerminal(`[Broker ${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')} Armenia rollover]: Processed ${elapsedCycles} cycle(s). Accrued interest: +${formatUSD(interestAccrued)}. Margin Debt: -${formatUSD(compoundedDebt)}.`);
  } else if (elapsedCycles > 0) {
    portfolioStore.setLastRolloverTimestamp(now.getTime());
    saveState(state, pushStateToGist);
  }
}

function setActiveView(view: string) {
  const normalizedView = view === 'BALANCE' ? 'CASH_CUSHION' : (view || 'COMBINED');
  // Preserve the prior view-only behavior; selectedTicker is managed separately.
  portfolioStore.setState({ activeView: normalizedView });
  saveState(state, pushStateToGist);
  renderBoard();
}

const switchView = setActiveView;

function renderConsoleQuickActions() {
  const position = state.positions[state.activeView];
  setTradingConsoleProps({
      position,
      onExecuteCommand: (command?: string) => executeCommand(command ?? '')
    } satisfies import('./src/components/TradingConsole').TradingConsoleProps);
}

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
  const beDateStr = beDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  setText(`Combined Breakeven: ${beDays} days (${beDateStr})`);
}

function renderBoardExternalLinks() {
  const activeTicker = state.positions[state.activeView] ? state.activeView : '';
  setExternalLinksPropsState({ ticker: activeTicker } satisfies import('./src/components/BoardExternalLinks').BoardExternalLinksProps);
}

function renderBoard() {
  renderBoardUI(state, {
    rules: TRADERNET_RULES as any,
    onSetActiveView: setActiveView,
    onRefreshAllLivePrices: refreshAllLivePrices,
    onSaveBalance: saveCurrentBalance,
    onAddCashStock: addCashStockFromDesk,
    onRenderSettingsPanel: () => renderSettingsPanel(),
    onRenderAnalystConsensus: renderBoardAnalystConsensus,
    onFetchLivePrice: fetchLivePrice,
    onRemoveCashStock: removeCashStock,
    onRenderExternalLinks: renderBoardExternalLinks,
    onRenderConsoleQuickActions: renderConsoleQuickActions,
    onUpdateCombinedBreakeven: updateCombinedBreakeven,
    onSyncMarketInsightsPanel: syncMarketInsightsPanel,
    refreshIntervalMs: getQuoteRefreshInterval(DEFAULT_QUOTE_REFRESH_INTERVAL_MS),
    lastDeskView: lastRenderedDeskView,
    onUpdateLastDeskView: (view: string) => { lastRenderedDeskView = view; }
  });

  // Keep the settings form mounted and its local edits intact during quote refreshes.
  // When settings are active, renderBoardUI calls renderSettingsPanel explicitly.
  if (!settingsPanelMounted) renderSettingsPanel();
}

function renderMarketInsightsComponent() {
  const ticker = getMarketInsightsTicker();
  setMarketInsightsPropsState({
      ticker,
      isOpen: true,
      activeSection: activeInsightSection as InsightSection,
      refreshTrigger: insightRequestId,
      onSelectSection: (section: InsightSection) => {
        activeInsightSection = section;
        renderMarketInsightsComponent();
      }
    } satisfies import('./src/components/MarketInsightsPanel').MarketInsightsPanelProps);
}

function getMarketInsightsTicker() {
  const currentView = state.activeView;
  // Desk routes are not stock symbols. Never send them to quote/insights APIs.
  const isPositionView = Boolean(
    currentView &&
    !['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS'].includes(currentView) &&
    state.positions?.[currentView]
  );
  if (isPositionView) return currentView;

  const tickers = Object.keys(state.positions || {});
  const preferredTicker = state.selectedTicker;
  if (preferredTicker && state.positions?.[preferredTicker]) return preferredTicker;
  return tickers[0] || '';
}

function syncMarketInsightsPanel() {
  // Visibility is owned by App's active-desk JSX; this function only refreshes data props.
  renderMarketInsightsComponent();
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
  } catch (err: any) {
    console.warn(`[Yahoo Worker Error for ${cleanTicker}]:`, err.message);
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
    if (getMarketInsightsTicker() === ticker) renderBoardAnalystConsensus(ticker);
  });
  boardAnalystRequests.set(ticker, request);
}

function recordTrackedPrice(
  ticker: string,
  price: number,
  sourceName: string,
  updatedAt: number | null = null,
  quoteDetails: any = null,
  requestStartedAt?: number
) {
  const symbol = ticker.toUpperCase();
  const matched = Boolean(
    state.positions[symbol] ||
    state.cashCushion?.holdings?.some((holding: any) => holding.ticker === symbol)
  );
  if (!matched) return false;

  portfolioStore.updateLiveQuote(symbol, {
    price,
    quoteSource: sourceName,
    ...(updatedAt === null ? {} : { quoteUpdatedAt: updatedAt }),
    ...(quoteDetails ? { quoteDetails } : {}),
    ...(requestStartedAt === undefined ? {} : { requestStartedAt })
  });
  return true;
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
    throw new Error('Ticker and a positive share quantity are required.');
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
  portfolioStore.removeCashStock(symbol);
  return removed;
}

function setCurrentBalance(value: number) {
  portfolioStore.setCashBalance(value);

  const state: any = portfolioStore.getState();
  return {
    balance: state.cashCushion?.freeCash || 0,
    debt: Math.abs(state.balance || 0)
  };
}

function saveCurrentBalance(signedValue: number) {
  if (!Number.isFinite(signedValue)) return;
  const { balance, debt } = setCurrentBalance(signedValue);
  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Balance]: Current balance/debt updated. Balance: ${formatUSD(balance)} | Margin debt: -${formatUSD(debt)}.`);
}

async function addCashStockFromDesk(ticker: string, shares: number, manualPrice: number) {
  const cleanTicker = ticker.trim().toUpperCase();
  if (!cleanTicker || !Number.isFinite(shares) || shares <= 0) return;
  if (Number.isFinite(manualPrice) && manualPrice <= 0) return;
  if (!Number.isFinite(manualPrice) && !Number.isNaN(manualPrice)) return;

  addCashHolding(cleanTicker, shares, manualPrice);
  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Balance]: Added ${shares} ${cleanTicker}. Fetching live online quote...`);
  await fetchLivePrice(cleanTicker);
}

function removeCashStock(index: number) {
  const holding = state.cashCushion?.holdings?.[index];
  if (!holding) return;
  const removed = removeCashHolding(holding.ticker);
  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Cash Cushion]: Removed ${removed.ticker} from cash holdings.`);
}

async function requestLivePrice(symbol: string, force = false) {
  const existingRequest = livePriceRequests.get(symbol);
  if (existingRequest && !force) return existingRequest;

  const requestStartedAt = Date.now();
  const request = fetchLivePriceFromProviders(symbol).then(result => ({
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

let liveQuoteRefreshInFlight: Promise<void> | null = null;

/**
 * Prevent interval/manual refresh triggers from starting overlapping batch
 * requests when a provider response takes longer than the configured interval.
 */
function refreshAllLivePrices(): Promise<void> {
  if (liveQuoteRefreshInFlight) return liveQuoteRefreshInFlight;

  const request = performRefreshAllLivePrices().finally(() => {
    if (liveQuoteRefreshInFlight === request) liveQuoteRefreshInFlight = null;
  });
  liveQuoteRefreshInFlight = request;
  return request;
}

async function performRefreshAllLivePrices() {
  const cashHoldings = state.cashCushion && state.cashCushion.holdings;
  const tickersArray = Array.from(new Set<string>([
    ...Object.keys(state.positions || {}),
    ...(cashHoldings || []).map((holding: any) => holding.ticker)
  ]));
  if (tickersArray.length === 0) return;

  try {
    const updatedCount = await refreshTrackedQuotes(tickersArray, Date.now(), recordTrackedPrice);
    if (updatedCount > 0) {
      // Live quotes stay local rather than causing a cloud write every poll.
      saveState(state);
      renderBoard();
      logTerminal(`[System]: Live market quotes refreshed for ${updatedCount} assets.`);
    } else {
      logTerminal('[Market Data Warning]: No quotes updated during batch fetch.');
    }
  } catch (err: any) {
    console.error('Batch quote fetch failed:', err);
    logTerminal(`[Market Data Error]: Batch fetch failed - ${err.message}`);
  }
}

function setQuoteRefreshInterval(interval: number | string) {
  const intervalMs = Number(interval);
  if (!QUOTE_REFRESH_INTERVALS.has(intervalMs)) {
    throw new Error(`Unsupported quote refresh interval: ${interval}`);
  }

  if (quoteRefreshTimer !== null) clearInterval(quoteRefreshTimer);
  quoteRefreshTimer = null;
  saveQuoteRefreshInterval(intervalMs);

  if (intervalMs > 0) {
    quoteRefreshTimer = setInterval(() => {
      if (!document.hidden) void refreshAllLivePrices();
    }, intervalMs);
  }
}

function exportBackupJSON() {
  const exportState = createPortfolioBackupSnapshot(state);
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportState, null, 2));
  const downloadAnchor = document.createElement('a');
  const filename = `margin_portfolio_backup_${new Date().toISOString().split('T')[0]}.json`;
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", filename);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  logTerminal(`[Backup]: Exported state to ${filename}.`);
}

async function importBackupJSON(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  try {
    const parsed = JSON.parse(await file.text());
    if (parsed && typeof parsed === 'object' && 'marginBalance' in parsed) {
      delete parsed.marginBalance;
    }
    const importedState: any = normalizePortfolioBackup(parsed);
    if (!confirm(`Replace this browser's portfolio with "${file.name}"? If KV cloud sync is configured, the imported portfolio will replace its remote copy too.`)) {
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
async function applyPortfolioActions(action: any) {
  applyOvernightRollover();
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
    const buyComm = calculateCommission(shares, shares * price, rules as any);
    const totalOutlay = shares * price + buyComm;
    const cashUsed = Math.min(priorFreeCash, totalOutlay);
    const debtAdded = totalOutlay - cashUsed;

    portfolioStore.buyStock(ticker, shares, price, action.date || new Date().toISOString().split('T')[0], targetPrice);
    const committedState = portfolioStore.getState();

    logTerminal(`[Executed Buy]: Added ${shares} ${ticker} @ ${formatUSD(price)}. Outlay: ${formatUSD(totalOutlay)} (Comm: ${formatUSD(buyComm)}). Funded: ${formatUSD(cashUsed)} cash | +${formatUSD(debtAdded)} margin debt. Free Cash remaining: ${formatUSD(committedState.cashCushion.freeCash)}. Total Margin Debt: -${formatUSD(Math.abs(committedState.balance))} (was -${formatUSD(priorDebt)}).`);
    await fetchLivePrice(ticker, false, true);
  }
  else if (action.action === "sell") {
    const ticker = action.ticker.toUpperCase();
    let pos = state.positions[ticker];
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

    const result = portfolioStore.sellMarginPosition(ticker, sharesToSell, sellPrice);
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
      portfolioStore.updateTargetPrice(ticker, Number(action.pt));
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
    portfolioStore.setMarginDebt(debt);
    saveState(state, pushStateToGist);
    logTerminal(`[Margin Synced]: Total margin balance explicitly set to -${formatUSD(Math.abs(state.balance))}.`);
  }
  else if (action.action === "set_free_cash") {
    const { balance, debt } = setCurrentBalance(action.amount);
    saveState(state, pushStateToGist);
    logTerminal(`[Balance]: Current balance/debt updated. Balance: ${formatUSD(balance)} | Margin debt: -${formatUSD(debt)}.`);
  }
  else if (action.action === "add_cash_stock") {
    const ticker = action.ticker.toUpperCase();
    const shares = Number(action.shares);
    const givenPrice = Number(action.price) || 0;

    addCashHolding(ticker, shares, givenPrice);
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

function confirmAiPortfolioAction(action: any) {
  let ticker = typeof action.ticker === 'string' ? action.ticker.trim().toUpperCase() : '';
  if (!ticker && ['set_pt', 'set_price'].includes(action.action)) {
    ticker = state.positions[state.activeView] ? state.activeView : Object.keys(state.positions)[0] || '';
  }
  const validTicker = /^[A-Z0-9._:-]+$/.test(ticker);
  const isPositiveFinite = (value: any) => Number.isFinite(Number(value)) && Number(value) > 0;
  const isFiniteNumber = (value: any) =>
    value !== null &&
    value !== undefined &&
    !(typeof value === 'string' && value.trim() === '') &&
    Number.isFinite(Number(value));
  const actionsWithTicker = ['buy', 'sell', 'set_pt', 'set_price', 'add_cash_stock', 'remove_cash_stock'];
  if (actionsWithTicker.includes(action.action) && !validTicker) {
    logTerminal('[AI Action Error]: Gemini returned an invalid ticker. No changes were made.');
    return false;
  }

  if (action.action === 'buy' && (!isPositiveFinite(action.shares) || !isPositiveFinite(action.price))) {
    logTerminal('[AI Action Error]: Gemini returned an invalid buy quantity or price. No changes were made.');
    return false;
  }
  if (action.action === 'sell' &&
    ((action.shares !== null && action.shares !== undefined && !isPositiveFinite(action.shares)) ||
      !isPositiveFinite(action.price))) {
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
      (action.price != null && (!Number.isFinite(Number(action.price)) || Number(action.price) < 0)))) {
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

  const details: Record<string, string> = {
    buy: `Buy ${action.shares} ${ticker} at ${action.price}?`,
    sell: `Sell ${action.shares == null ? 'all' : action.shares} ${ticker} at ${action.price}?`,
    set_pt: `Set ${ticker}'s target price to ${action.pt}?`,
    set_price: `Set ${ticker}'s tracked market price to ${action.price}?`,
    set_balance: `Set signed margin balance to ${action.balance}?`,
    set_free_cash: `Set free cash to ${action.amount}?`,
    add_cash_stock: `Add ${action.shares} shares of ${ticker} to cash holdings?`,
    remove_cash_stock: `Remove ${ticker} from cash holdings?`
  };
  const message = details[action.action];
  if (!message) {
    logTerminal(`[AI Action Error]: Unsupported action "${action.action}". No changes were made.`);
    return false;
  }

  const confirmationLines = [
    'Gemini interpreted your input as this portfolio change:',
    '',
    message
  ];
  const currentPosition = state.positions[ticker] ||
    state.cashCushion?.holdings?.find((holding: any) => holding.ticker === ticker);
  const currentShares = action.action === 'buy'
    ? Number(state.positions[ticker]?.shares) || 0
    : Number(currentPosition?.shares) || 0;
  const rules = state.brokerAssumptions || TRADERNET_RULES;

  if (action.action === 'buy') {
    const shares = Number(action.shares);
    const price = Number(action.price);
    const gross = shares * price;
    const commission = calculateCommission(shares, gross, rules as any);
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
    const shares = action.shares == null ? currentShares : Number(action.shares);
    const price = Number(action.price);
    const gross = shares * price;
    const commission = calculateCommission(shares, gross, rules as any);
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

  // Ensure any due rollover is reflected in debt before a buy/sell command mutates it.
  applyOvernightRollover();

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
        await refreshAllLivePrices();
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
    const targetState: any = portfolioStore.getState();
    const prompt = buildIntentPrompt({
      text: aiQuery,
      state: targetState,
      activeTickers: Object.keys(targetState?.positions || {}),
      activeView: targetState?.activeView || null,
      today: new Date().toISOString().split("T")[0]
    });

    const data = await proxyFetch('gemini', {}, { method: "POST", body: JSON.stringify({ prompt }) });
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = evaluateIntent(parseAiIntent(rawText) as any);

    if (parsed.intent === "action") {
      if (confirmAiPortfolioAction(parsed)) await applyPortfolioActions(parsed);
      else logTerminal("[AI Action]: Cancelled.");
    } else {
      logTerminal(`[AI Advisor]: ${parsed.response || 'Executed.'}`);
    }

    setAiStatus('READY');
  } catch (err: any) {
    logTerminal(`[Error]: ${err.message}`);
    setAiStatus('READY');
  }
}

function renderSettingsPanel(force = false) {
  const rules = { ...TRADERNET_RULES };
  const rulesSignature = JSON.stringify(rules);
  if (settingsPanelMounted && !force && rulesSignature === lastSettingsRulesSignature) return;

  // SettingsDesk is owned by App. Send current callbacks/rules as props instead
  // of creating a separate Preact root in the settings container.
  setSettingsPropsState({
      rules,
      defaultRefreshIntervalMs: DEFAULT_QUOTE_REFRESH_INTERVAL_MS,
      onSaveBrokerRules: saveBrokerRuleInputs,
      onResetBrokerRules: () => {
        resetBrokerRules();
        renderSettingsPanel(true);
      },
      onSaveApiKeys: async (secret: string) => {
        const saved = await saveApiKeys({ secret, showToast: (message, type) => showToast(message, type as any), logTerminal });
        if (saved) {
          portfolioStore.setState({ gatewaySecret: secret.trim() });
          await syncCloudState('pull');
        }
      },
      onPullCloudState: () => syncCloudState('pull'),
      onChangeRefreshInterval: (val: string) => setQuoteRefreshInterval(val),
      onExportBackup: exportBackupJSON,
      onImportBackup: importBackupJSON,
      onResetToBlankState: resetToBlankState
    } satisfies import('./src/components/SettingsDesk').SettingsDeskProps);
  settingsPanelMounted = true;
  lastSettingsRulesSignature = rulesSignature;
}

let appInitialized = false;

function hideStartupLoading() {
  emitUiEvent('terminal:startup-state', { visible: false, failed: false });
}

setSecretGetter(() => getGatewaySecret());

export async function handleSaveGatewaySecret(secret: string): Promise<boolean> {
  const submittedSecret = secret.trim();
  if (!submittedSecret) {
    showToast('Please enter the Gateway Secret.', 'error');
    return false;
  }

  // Validate first so a wrong or unverified secret is never written to device storage.
  const authenticated = await validateGatewaySecret(submittedSecret);
  if (!authenticated) return false;

  saveGatewaySecret(submittedSecret);
  const persisted = await persistGatewaySecret();
  portfolioStore.setState({ gatewaySecret: submittedSecret });
  if (!persisted) {
    showToast('Secure storage failed. Re-enter the Gateway Secret after refresh.', 'error');
  }

  window.dispatchEvent(new CustomEvent('gateway-secret-authenticated', { detail: { secret: submittedSecret } }));
  if (!appInitialized) {
    await startApp(submittedSecret);
    appInitialized = true;
  }
  // Keep the modal visible until startup and the initial cloud-data pull finish.
  hideAuthContainer();
  return true;
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

async function startApp(secret: string) {
  loadTradernetRules();
  portfolioStore.setState({ gatewaySecret: secret });
  portfolioStore.importState(loadSavedState(portfolioStore.getState()));
  state = portfolioStore.getState();
  applyOvernightRollover();

  if (secret) await syncCloudState('pull');

  const initialQuoteRefreshInterval = getQuoteRefreshInterval(DEFAULT_QUOTE_REFRESH_INTERVAL_MS);
  setQuoteRefreshInterval(initialQuoteRefreshInterval);

  if (rolloverTimer !== null) clearInterval(rolloverTimer);
  rolloverTimer = setInterval(() => {
    if (!document.hidden) applyOvernightRollover();
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyOvernightRollover();
  });


  // Avoid launching a duplicate per-ticker analyst request while the initial
  // batch already contains the same deep Yahoo data for all tracked symbols.
  initialQuoteRefreshPending = true;
  switchView(state.activeView);
  emitUiEvent('terminal:scroll-workspace');
  await refreshAllLivePrices();
  initialQuoteRefreshPending = false;
  renderBoardAnalystConsensus(getMarketInsightsTicker());
  hideStartupLoading();
}

export async function initApp() {
  if (appInitialized) return;

  try {
    const secret = await restoreGatewaySecret();
    if (secret) {
      appInitialized = true;
      hideAuthContainer();
      await startApp(secret);
    } else {
      loadTradernetRules();
      portfolioStore.importState(loadSavedState(portfolioStore.getState()));
      state = portfolioStore.getState();
      applyOvernightRollover();
      switchView(state.activeView);
      hideStartupLoading();
      showAuthContainer();
    }
  } catch (error) {
    appInitialized = false;
    console.error('[Startup Error]:', error);
    showStartupFailure();
  }
}

function showStartupFailure() {
  emitUiEvent('terminal:startup-state', { visible: true, failed: true });
}

function bindStartupActions() {
  addUiEventListener('terminal:startup-retry', () => {
    emitUiEvent('terminal:startup-state', { visible: true, failed: false });
    void initApp();
  });
  addUiEventListener('terminal:startup-offline', () => { void continueStartupOffline(); });
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

