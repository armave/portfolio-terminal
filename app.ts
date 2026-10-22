import { render, h } from 'preact';
import { ClosedHistoryDesk } from './src/components/ClosedHistoryDesk';

import {
  calculateBreakevenDays,
  calculateCommission,
  calculateProjectedDebt,
  calculateMarginInterest,
  collectOpenPositionTranches,
  createBlankState,
  createPortfolioBackupSnapshot,
  normalizePortfolioBackup,
  normalizePortfolioState,
  processRollovers,
  realizeClosedTrade,
  resolveSaleQuantity,
  resolveTradeDateTimestamp
} from './src/domain/portfolio';
import { evaluateIntent, parseAiIntent } from './src/features/ai/intent';
import { buildIntentPrompt } from './src/features/ai/prompt';
import {
  calculateTargetUpsidePercent,
  sentimentLabel,
  SentimentDirection
} from './src/features/quotes/sentiment';
import { fetchLivePriceFromProviders } from './src/services/quoteProvider';
import { refreshTrackedQuotes } from './src/services/quotePolling';
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
  clearLocalData,
  getGatewaySecret,
  getQuoteRefreshInterval,
  loadBrokerRules,
  restoreGatewaySecret,
  persistGatewaySecret,
  loadSavedState,
  saveApiKeys,
  saveBrokerRules,
  saveGatewaySecret,
  saveQuoteRefreshInterval,
  saveState,
  saveStateToStorage
} from './src/services/storage';
import {
  clearTerminalLog,
  logTerminal,
  showToast
} from './src/ui/notifications';
import {
  renderBoard as renderBoardUI,
  renderCashCushion,
  renderPositionsTable,
  renderSummaryCards
} from './src/ui/renderBoard';
import { getCashCushionTotal, getTotalPortfolioInvested } from './src/domain/portfolioSelectors';
import { formatUSD } from './src/utils/formatters';
import { migrateLegacyCloudHoldingsToPositions, portfolioStore } from './src/store/portfolioStore';
import { BoardExternalLinks } from './src/components/BoardExternalLinks';
import { ConsoleQuickActions } from './src/components/ConsoleQuickActions';
import { InsightSection, MarketInsightsPanel } from './src/components/MarketInsightsPanel';
import { SettingsDesk } from './src/components/SettingsDesk';
import { AuthModal } from './src/components/AuthModal';
import { TradingConsole } from './src/components/TradingConsole';
import { App } from './src/App';
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
const livePriceRequests = new Map<string, Promise<any>>();
let marketInsightsOpen = true;
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

/**
 * Syncs the active runtime state into the reactive portfolioStore
 */
function syncStore() {
  portfolioStore.importState(state as any);
}

// ==========================================
// CLOUDFLARE WORKERS KV REPLICATION ENGINE
// ==========================================
function setCloudStatus(status: string, text: string) {
  const dot = document.getElementById('cloudStatusDot');
  const label = document.getElementById('cloudStatusText');
  if (!dot || !label) return;

  label.innerText = `KV: ${text.toUpperCase()}`;
  dot.className = "w-1.5 h-1.5 rounded-full";

  if (status === 'syncing') {
    dot.classList.add('bg-amber-400', 'animate-pulse');
  } else if (status === 'synced') {
    dot.classList.add('bg-emerald-400');
  } else if (status === 'error') {
    dot.classList.add('bg-rose-400');
  } else {
    dot.classList.add('bg-slate-500');
  }
}

portfolioStore.subscribe((nextStoreState) => {
  state = nextStoreState as any;
});

async function pushStateToCloud(forceImmediate = false) {
  if (!areHeaderCredentialsConfigured()) {
    setCloudStatus('idle', 'ADD SECRET');
    return;
  }

  state.lastUpdated = Date.now();
  syncStore();

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
  state = { ...state, ...compatibleCloudState };
  if (!parsedState?.activeView && currentView) {
    state.activeView = currentView;
  }
  state = loadSavedState(state);
  syncStore();
  switchView(state.activeView);
  console.log("[Sync]: Cloud state ingested and UI re-rendered successfully", state);
  setTimeout(() => {
    const mainView = document.getElementById('mainTerminalView');
    if (mainView) {
      mainView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
}

async function syncCloudState(mode = 'push') {
  return syncCloudStateService(mode, {
    state,
    getState: () => state,
    pullCloudAndRewriteLocal,
    showToast: (msg: string, type?: string) => showToast(msg, type as any),
    logTerminal
  });
}

function resetToBlankState() {
  if (confirm("Reset the entire terminal to a blank slate? This will clear all holdings, balances, and history locally and on KV cloud.")) {
    state = createBlankState();
    saveState(state, pushStateToGist);
    syncStore();
    pushStateToGist(true);
    renderBoard();
    logTerminal("[System]: Portfolio reset to a clean blank slate.");
    showToast('Portfolio reset to a blank slate.', 'warning');
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

function setBrokerRuleInputs() {
  const annualInput = document.getElementById('annualMarginRateInput') as HTMLInputElement | null;
  const dayCountInput = document.getElementById('interestDayCountInput') as HTMLInputElement | null;
  const maintInput = document.getElementById('maintenanceMarginInput') as HTMLInputElement | null;
  const stopOutInput = document.getElementById('stopOutRatioInput') as HTMLInputElement | null;
  const rolloverInput = document.getElementById('rolloverTimeInput') as HTMLInputElement | null;
  const commShareInput = document.getElementById('commissionPerShareInput') as HTMLInputElement | null;
  const commVolInput = document.getElementById('commissionVolumeInput') as HTMLInputElement | null;
  const minCommInput = document.getElementById('minimumCommissionInput') as HTMLInputElement | null;

  if (annualInput) annualInput.value = (TRADERNET_RULES.annualRate * 100).toFixed(2);
  if (dayCountInput) dayCountInput.value = String(TRADERNET_RULES.dayCountBasis);
  if (maintInput) maintInput.value = (TRADERNET_RULES.maintenanceMarginRatio * 100).toFixed(2);
  if (stopOutInput) {
    stopOutInput.value = (TRADERNET_RULES.stopOutRatio * 100).toFixed(2);
    stopOutInput.setCustomValidity('');
  }
  if (rolloverInput) {
    rolloverInput.value = `${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')}`;
  }
  if (commShareInput) commShareInput.value = String(TRADERNET_RULES.commPerShare);
  if (commVolInput) commVolInput.value = (TRADERNET_RULES.commVolumePct * 100).toFixed(2);
  if (minCommInput) minCommInput.value = TRADERNET_RULES.minCommOrder.toFixed(2);
}

function saveBrokerRuleInputs(event: Event) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const stopOutInput = document.getElementById('stopOutRatioInput') as HTMLInputElement;
  stopOutInput.setCustomValidity('');
  if (!form.reportValidity()) return;

  const rolloverInput = document.getElementById('rolloverTimeInput') as HTMLInputElement;
  const [rolloverHour, rolloverMinute] = rolloverInput.value.split(':').map(Number);
  const previousRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  const updatedRules = {
    ...TRADERNET_RULES,
    annualRate: Number((document.getElementById('annualMarginRateInput') as HTMLInputElement).value) / 100,
    dayCountBasis: Number((document.getElementById('interestDayCountInput') as HTMLInputElement).value),
    maintenanceMarginRatio: Number((document.getElementById('maintenanceMarginInput') as HTMLInputElement).value) / 100,
    stopOutRatio: Number(stopOutInput.value) / 100,
    rolloverHour,
    rolloverMinute,
    commPerShare: Number((document.getElementById('commissionPerShareInput') as HTMLInputElement).value),
    commVolumePct: Number((document.getElementById('commissionVolumeInput') as HTMLInputElement).value) / 100,
    minCommOrder: Number((document.getElementById('minimumCommissionInput') as HTMLInputElement).value)
  };
  if (updatedRules.stopOutRatio > updatedRules.maintenanceMarginRatio) {
    stopOutInput.setCustomValidity('Stop-out equity must not exceed maintenance equity.');
    stopOutInput.reportValidity();
    return;
  }
  stopOutInput.setCustomValidity('');
  Object.assign(TRADERNET_RULES, updatedRules);
  portfolioStore.updateAssumptions(updatedRules as any);
  saveBrokerRules(updatedRules);
  const nextRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  if (previousRollover !== nextRollover) {
    state.lastRolloverTimestamp = getLatestRolloverTimestamp(new Date(), TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone);
    saveState(state, pushStateToGist);
    syncStore();
  }
  verifyTradernetRulesOnload();
  renderBoard();
  showToast('Broker assumptions saved in this browser.', 'success');
}

function resetBrokerRules() {
  const previousRollover = `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`;
  Object.assign(TRADERNET_RULES, DEFAULT_TRADERNET_RULES);
  portfolioStore.updateAssumptions(DEFAULT_TRADERNET_RULES as any);
  clearBrokerRules();
  setBrokerRuleInputs();
  if (previousRollover !== `${TRADERNET_RULES.rolloverHour}:${TRADERNET_RULES.rolloverMinute}`) {
    state.lastRolloverTimestamp = getLatestRolloverTimestamp(new Date(), TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone);
    saveState(state, pushStateToGist);
    syncStore();
  }
  verifyTradernetRulesOnload();
  renderBoard();
  showToast('Broker assumptions restored to defaults.', 'info');
}

function verifyTradernetRulesOnload() {
  const ratePct = (TRADERNET_RULES.annualRate * 100).toFixed(2);
  const dailyPct = (getDailyRate() * 100).toFixed(4);
  const maintenancePct = (TRADERNET_RULES.maintenanceMarginRatio * 100).toFixed(2);
  const rolloverTime = `${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')}`;
  const saveMsg =
    `Broker model: ${ratePct}% p.a. (${dailyPct}%/d, /${TRADERNET_RULES.dayCountBasis}) | ${rolloverTime} Armenia time compounding | Maintenance equity ${maintenancePct}%`;
  updateRiskAssumptionTitles();

  logTerminal(saveMsg);
}

function updateRiskAssumptionTitles() {
  const stopOutRow = document.getElementById('boardStopOutRow');
  if (stopOutRow) {
    stopOutRow.title =
      `Estimate assumes the configured ${(TRADERNET_RULES.stopOutRatio * 100).toFixed(2)}% stop-out equity threshold and that the full allocated cushion qualifies as collateral. Actual broker requirements may differ.`;
  }
  const marginRiskEl = document.getElementById('boardMarginRisk');
  if (marginRiskEl && marginRiskEl.parentElement) {
    marginRiskEl.parentElement.title =
      `Estimated from portfolio equity and configured thresholds: ${(TRADERNET_RULES.maintenanceMarginRatio * 100).toFixed(2)}% maintenance equity and ${(TRADERNET_RULES.stopOutRatio * 100).toFixed(2)}% stop-out equity. Not a live broker risk indicator.`;
  }
}

function applyOvernightRollover() {
  const now = new Date();
  if (!Number.isFinite(Number(state.lastRolloverTimestamp)) || Number(state.lastRolloverTimestamp) <= 0) {
    state.lastRolloverTimestamp = getLatestRolloverTimestamp(now, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute, TRADERNET_RULES.rolloverTimeZone);
    saveState(state, pushStateToGist);
    syncStore();
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

    state.balance = -compoundedDebt;

    const tickers = Object.keys(state.positions);
    const totalInvested = getTotalPortfolioInvested(state);
    if (tickers.length === 0 || totalInvested === 0) {
      state.realizedMarginCharged = (state.realizedMarginCharged || 0) + interestAccrued;
    }

    state.lastRolloverTimestamp = now.getTime();
    saveState(state, pushStateToGist);
    syncStore();
    logTerminal(`[Broker ${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')} Armenia rollover]: Processed ${elapsedCycles} cycle(s). Accrued interest: +${formatUSD(interestAccrued)}. Margin Debt: -${formatUSD(compoundedDebt)}.`);
  } else if (elapsedCycles > 0) {
    state.lastRolloverTimestamp = now.getTime();
    saveState(state, pushStateToGist);
    syncStore();
  }
}

function setActiveView(view: string) {
  const normalizedView = view === 'BALANCE' ? 'CASH_CUSHION' : (view || 'COMBINED');
  state.activeView = normalizedView;
  saveState(state, pushStateToGist);
  syncStore();
  renderBoard();
}

const switchView = setActiveView;

function renderConsoleQuickActions() {
  const pos = state.positions[state.activeView];
  const cardContainer = document.getElementById('tradingConsoleCard');
  if (cardContainer) {
    render(
      h(TradingConsole, {
        position: pos,
        onExecuteCommand: (command?: string) => executeCommand(command)
      }),
      cardContainer
    );
    return;
  }

  const container = document.getElementById('consoleQuickActions');
  if (!container) return;
  render(h(ConsoleQuickActions, { position: pos }), container);
}

function updateCombinedBreakeven() {
  const beEl = document.getElementById('daysToBreakeven');
  if (!beEl) return;

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
    beEl.innerText = "Combined Breakeven: No active trades";
    return;
  }

  if (totalDebt <= 0) {
    beEl.innerText = "Combined Breakeven: No margin debt";
    return;
  }

  if (netTargetProfit <= 0) {
    beEl.innerText = "Combined Breakeven: 0 days (Net Target ≤ $0)";
    return;
  }

  if (getDailyRate() === 0) {
    beEl.innerText = "Combined Breakeven: 0 days (no ongoing margin interest)";
    return;
  }

  const beDays = calculateBreakevenDays(netTargetProfit, totalDebt, getDailyRate()) || 0;

  const beDate = new Date();
  beDate.setDate(beDate.getDate() + beDays);
  const beDateStr = beDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  beEl.innerText = `Combined Breakeven: ${beDays} days (${beDateStr})`;
}

function createStockPageLink(ticker: string, provider: string) {
  const link = document.createElement('a');
  const symbol = encodeURIComponent(ticker);
  let href = '';
  let brandClass = '';
  if (provider === 'Finviz') {
    href = `https://finviz.com/stock?t=${symbol}`;
    link.id = 'finvizLink';
    brandClass = 'stock-link-finviz';
  } else if (provider === 'Stocktwits') {
    href = `https://stocktwits.com/symbol/${symbol}`;
    link.id = 'stocktwitsLink';
    brandClass = 'stock-link-stocktwits';
  } else if (provider === 'TV Chart') {
    href = `https://tradingview.com/chart/?symbol=${symbol}`;
    link.id = 'tvChartLink';
    brandClass = 'stock-link-tv-chart';
  } else if (provider === 'TV Ideas') {
    href = `https://tradingview.com/symbols/${symbol}/ideas/?sort=recent`;
    link.id = 'tvIdeasLink';
    brandClass = 'stock-link-tv-ideas';
  }
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = `stock-external-link ${brandClass} px-2 py-1 rounded text-[10px] font-bold font-mono uppercase`;
  link.textContent = provider;
  link.title = `Open ${ticker} on ${provider} in a new tab`;
  link.setAttribute('aria-label', `Open ${ticker} on ${provider} in a new tab`);
  return link;
}

function renderBoardExternalLinks() {
  const activeTicker = state.positions[state.activeView] ? state.activeView : '';
  const stockPageLinks = document.getElementById('boardExternalLinks');
  if (!stockPageLinks) return;
  render(h(BoardExternalLinks, { ticker: activeTicker }), stockPageLinks);
}

function renderBoard() {
  renderBoardUI(state, {
    rules: TRADERNET_RULES as any,
    onSetActiveView: setActiveView,
    onRenderClosedHistory: renderClosedHistoryPanel,
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

  renderSettingsPanel();
}

function renderMarketInsightsComponent() {
  const panel = document.getElementById('marketInsightsPanel');
  if (!panel) return;
  const ticker = getMarketInsightsTicker();

  render(
    h(MarketInsightsPanel, {
      ticker,
      isOpen: true,
      activeSection: activeInsightSection as InsightSection,
      refreshTrigger: insightRequestId,
      onSelectSection: (section: InsightSection) => {
        activeInsightSection = section;
        renderMarketInsightsComponent();
      }
    }),
    panel
  );
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
  const panel = document.getElementById('marketInsightsPanel');
  if (!panel) return;

  // Market Insights is a permanent part of the Margin workspace, not a toggleable panel.
  marketInsightsOpen = true;
  renderMarketInsightsComponent();
}

function toggleMarketInsights() {
  const ticker = getMarketInsightsTicker();
  if (!ticker) return;
  marketInsightsOpen = !marketInsightsOpen;
  syncMarketInsightsPanel();
}

function renderClosedHistoryPanel() {
  const container = document.getElementById('closedHistoryContainer');
  if (!container) return;
  render(h(ClosedHistoryDesk, null), container);
}

function createInsightElement(tagName: string, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function sentimentBadge(direction: SentimentDirection, label = sentimentLabel(direction)) {
  const styles: Record<string, string> = {
    bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
    neutral: 'border-slate-700 bg-slate-900 text-slate-300',
    unknown: 'border-slate-800 bg-slate-950 text-slate-500'
  };
  const badge = createInsightElement(
    'span',
    `inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[direction]}`,
    label
  );
  badge.dataset.sentiment = direction;
  badge.title = direction === 'unknown'
    ? 'The selected data source did not provide a sentiment signal.'
    : 'A directional marker based only on the provider values shown in this section.';
  return badge;
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
  const container = document.getElementById('boardAnalystConsensus');
  if (!container) return;
  const hideConsensus = () => {
    container.textContent = '';
    container.removeAttribute('title');
    container.className = 'hidden';
  };
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
      container.textContent = `${snapshot.source} · ${formatUSD(snapshot.targetPrice)} · ${upside >= 0 ? '+' : ''}${upside.toFixed(2)}%`;
      container.title = `Target from ${snapshot.source}: ${formatUSD(snapshot.targetPrice)} versus current price ${formatUSD(currentPrice)}.`;
      container.className = `rounded border px-2.5 py-1 text-[10px] font-semibold ${color}`;
    } else {
      container.textContent = `${snapshot.source} price target · ${formatUSD(snapshot.targetPrice)} · current price unavailable`;
      container.title = `Price target from ${snapshot.source}.`;
      container.className = 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-300';
    }
    return;
  }

  if (!force && error && now - error.failedAt < BOARD_ANALYST_RETRY_MS) {
    container.textContent = 'Analyst target unavailable';
    container.title = error.message;
    container.className = 'rounded border border-amber-800 bg-amber-950/30 px-2.5 py-1 text-[10px] font-semibold text-amber-300';
    return;
  }

  if (initialQuoteRefreshPending && !snapshot) {
    container.textContent = 'Loading analyst target…';
    container.title = 'Waiting for the initial batch quote refresh.';
    container.className = 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400';
    return;
  }

  if (boardAnalystRequests.has(ticker)) {
    return;
  }

  container.textContent = 'Checking analyst target…';
  container.removeAttribute('title');
  container.className = 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400';

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

async function loadMarketInsight(section: string, force = false) {
  activeInsightSection = section;
  if (force) insightRequestId++;
  renderMarketInsightsComponent();
}

function refreshMarketInsight() {
  return loadMarketInsight(activeInsightSection, true);
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

  if (!state.cashCushion) state.cashCushion = { freeCash: 0, holdings: [] };
  if (!Array.isArray(state.cashCushion.holdings)) state.cashCushion.holdings = [];
  const existing = state.cashCushion.holdings.find((holding: any) => holding.ticker === symbol);
  const currentPrice = Number.isFinite(manualPrice) && manualPrice > 0
    ? manualPrice
    : (Number(existing?.price) || 0);

  if (existing) {
    existing.shares = (Number(existing.shares) || 0) + quantity;
  } else {
    state.cashCushion.holdings.push({ ticker: symbol, shares: quantity, price: currentPrice });
  }
  if (Number.isFinite(manualPrice) && manualPrice > 0) {
    recordTrackedPrice(symbol, manualPrice, 'Manual');
  }
  syncStore();
  return { ticker: symbol, shares: quantity, price: currentPrice };
}

function removeCashHolding(ticker: string) {
  const holdings = state.cashCushion?.holdings;
  if (!Array.isArray(holdings)) return null;
  const symbol = ticker.trim().toUpperCase();
  const index = holdings.findIndex((holding: any) => holding.ticker === symbol);
  const removed = index < 0 ? null : holdings.splice(index, 1)[0];
  if (removed) syncStore();
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

function saveCurrentBalanceFromInput() {
  const input = document.getElementById('freeCashInput') as HTMLInputElement | null;
  if (!input || !input.reportValidity()) return;

  const inputValue = input.valueAsNumber;
  const { balance, debt } = setCurrentBalance(inputValue);
  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Balance]: Current balance/debt updated. Balance: ${formatUSD(balance)} | Margin debt: -${formatUSD(debt)}.`);
  showToast(`Balance ${formatUSD(balance)} | Debt -${formatUSD(debt)}`, 'success');
}

async function addCashStockFromUI() {
  const tickerInput = document.getElementById('newCashTicker') as HTMLInputElement;
  const sharesInput = document.getElementById('newCashShares') as HTMLInputElement;
  const priceInput = document.getElementById('newCashPrice') as HTMLInputElement;

  const ticker = tickerInput.value.trim().toUpperCase();
  const shares = sharesInput.valueAsNumber;
  const manualPrice = priceInput.value === '' ? NaN : priceInput.valueAsNumber;

  if (!tickerInput.reportValidity() || !sharesInput.reportValidity() ||
    (priceInput.value !== '' && !priceInput.reportValidity())) return;

  if (!ticker) {
    logTerminal(`[Error]: Please enter valid ticker symbol and share count.`);
    tickerInput.focus();
    return;
  }

  addCashHolding(ticker, shares, manualPrice);

  tickerInput.value = '';
  sharesInput.value = '';
  priceInput.value = '';

  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Balance]: Added ${shares} ${ticker}. Fetching live online quote...`);
  showToast(`${shares} ${ticker} added to balance holdings.`, 'success');
  await fetchLivePrice(ticker);
}

function removeCashStock(index: number) {
  const holding = state.cashCushion?.holdings?.[index];
  if (!holding) return;
  const removed = removeCashHolding(holding.ticker);
  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Cash Cushion]: Removed ${removed.ticker} from cash holdings.`);
  showToast(`${removed.ticker} removed from cash holdings.`, 'info');
}

function updateEmptyStateVisibility(isEmpty: boolean) {
  const panel = document.getElementById('emptyStatePanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !isEmpty);
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
      syncStore();
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
      if (!document.hidden) document.getElementById('refreshQuotesButton')?.click();
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
    const previousState = state;
    state = importedState;
    try {
      if (!saveState(state, pushStateToGist)) {
        throw new Error('Could not persist the imported backup to browser storage.');
      }
      syncStore();
    } catch (error) {
      state = previousState;
      syncStore();
      throw error;
    }
    await pushStateToGist(true);
    renderBoard();
    logTerminal(`[Backup Import]: Imported ${file.name} into this browser. Check KV cloud status for sync results.`);
    showToast('Backup imported locally. Check KV cloud status for sync.', 'success');
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
  const todayDateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

  if (action.action === "buy") {
    const ticker = action.ticker.toUpperCase();
    const shares = Number(action.shares);
    const price = Number(action.price);
    const tradeCost = shares * price;
    const buyComm = calcCommission(shares, tradeCost);
    const totalOutlay = tradeCost + buyComm;

    if (!state.positions[ticker]) {
      state.positions[ticker] = {
        ticker: ticker,
        shares: 0,
        tranches: [],
        currentPrice: price,
        quoteSource: 'Trade input',
        pt: action.pt ? Number(action.pt) : Number((price * 1.05).toFixed(2)),
        commBuy: 0,
        startDate: new Date().toISOString().split('T')[0]
      };
    }

    const pos = state.positions[ticker];
    pos.shares += shares;
    pos.tranches.push({
      qty: shares,
      price: price,
      date: action.date || todayDateStr,
      acquiredAt: resolveTradeDateTimestamp(action.date),
      buyCommission: buyComm
    });
    pos.commBuy += buyComm;
    pos.currentPrice = price;
    pos.lastTradeAt = Date.now();
    pos.quoteSource = 'Trade input';
    delete pos.quoteUpdatedAt;
    delete pos.quoteDetails;
    if (action.pt) pos.pt = Number(action.pt);

    const currentFreeCash = Number(state.cashCushion?.freeCash) || 0;
    const cashUsed = Math.min(currentFreeCash, totalOutlay);
    const debtAdded = totalOutlay - cashUsed;

    if (cashUsed > 0) {
      state.cashCushion.freeCash = currentFreeCash - cashUsed;
    }

    state.balance = state.balance - debtAdded;
    state.activeView = ticker;

    saveState(state, pushStateToGist);
    syncStore();
    logTerminal(`[Executed Buy]: Added ${shares} ${ticker} @ ${formatUSD(price)}. Outlay: ${formatUSD(totalOutlay)} (Comm: ${formatUSD(buyComm)}). Funded: ${formatUSD(cashUsed)} cash | +${formatUSD(debtAdded)} margin debt. Free Cash remaining: ${formatUSD(state.cashCushion.freeCash)}. Total Margin Debt: -${formatUSD(Math.abs(state.balance))}.`);
    showToast(`${shares} ${ticker} bought at ${formatUSD(price)}.`, 'success');
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
    const grossProceeds = sharesToSell * sellPrice;
    const sellComm = calcCommission(sharesToSell, grossProceeds);
    const netCashCredited = grossProceeds - sellComm;

    const currentDebt = Math.abs(state.balance);
    let debtRepaid = 0;
    let cashSurplus = 0;

    if (currentDebt > 0) {
      debtRepaid = Math.min(currentDebt, netCashCredited);
      state.balance = currentDebt > debtRepaid ? -(currentDebt - debtRepaid) : 0;
      cashSurplus = netCashCredited - debtRepaid;
    } else {
      cashSurplus = netCashCredited;
    }

    if (cashSurplus > 0) {
      if (!state.cashCushion) state.cashCushion = { freeCash: 0.00, holdings: [] };
      state.cashCushion.freeCash = (Number(state.cashCushion.freeCash) || 0) + cashSurplus;
    }

    const resultMessage = `${sharesToSell} ${ticker} sold at ${formatUSD(sellPrice)}.`;

    if (isCashHolding) {
      if (sharesToSell >= pos.shares) {
        state.cashCushion.holdings.splice(cashHoldingIdx, 1);
        logTerminal(`[Cash Holding Closed]: Sold ${sharesToSell} ${ticker} @ ${formatUSD(sellPrice)}. Net credited: +${formatUSD(netCashCredited)} (Debt paid: ${formatUSD(debtRepaid)}, Free Cash added: ${formatUSD(cashSurplus)}).`);
      } else {
        pos.shares -= sharesToSell;
        logTerminal(`[Cash Holding Partial Sell]: Sold ${sharesToSell} ${ticker} @ ${formatUSD(sellPrice)}. Remaining: ${pos.shares} shares.`);
      }
    } else {
      const totalPortfolioInvested = getTotalPortfolioInvested(state);
      const positionInvested = (pos.tranches || []).reduce(
        (sum: number, tranche: any) => sum + (Number(tranche.qty) || 0) * (Number(tranche.price) || 0),
        0
      );
      const allocatedDebt = totalPortfolioInvested > 0
        ? currentDebt * (positionInvested / totalPortfolioInvested)
        : currentDebt;
      const accruedMarginInterest = calculateMarginInterest(pos.tranches || [], {
        dailyRate: getDailyRate(),
        marginDebt: allocatedDebt,
        totalDebt: currentDebt
      });
      const positionForClose = {
        ...pos,
        marginCharged: Math.max(Number(pos.marginCharged) || 0, accruedMarginInterest)
      };
      const realizedTrade = realizeClosedTrade(positionForClose, ticker, sharesToSell, sellPrice, sellComm, Date.now());
      delete (realizedTrade.position as any).marginCharged;
      state.positions[ticker] = realizedTrade.position;
      if (realizedTrade.trade) state.closedTrades.push(realizedTrade.trade);
      state.realizedMarginCharged = (state.realizedMarginCharged || 0) + realizedTrade.marginFee;

      if (realizedTrade.position.shares <= 1e-8) {
        delete state.positions[ticker];
        state.activeView = "COMBINED";
        logTerminal(`[Position Closed]: Sold ${sharesToSell} ${ticker} @ ${formatUSD(sellPrice)}. Net credited: +${formatUSD(netCashCredited)} (Debt paid: ${formatUSD(debtRepaid)}, Free Cash added: ${formatUSD(cashSurplus)}). Remaining Debt: -${formatUSD(Math.abs(state.balance))}. Free Cash: ${formatUSD(state.cashCushion.freeCash)}.`);
      } else {
        logTerminal(`[Partial Sell]: Sold ${sharesToSell} ${ticker} @ ${formatUSD(sellPrice)}. Net credited: +${formatUSD(netCashCredited)} (Debt paid: ${formatUSD(debtRepaid)}, Free Cash added: ${formatUSD(cashSurplus)}). Remaining: ${realizedTrade.position.shares} shares.`);
      }
    }

    saveState(state, pushStateToGist);
    syncStore();
    showToast(resultMessage, 'success');
  }
  else if (action.action === "set_pt") {
    const ticker = (action.ticker ? action.ticker.toUpperCase() : null) || (state.activeView !== "COMBINED" && state.activeView !== "CASH_CUSHION" && state.activeView !== "CLOSED_HISTORY" ? state.activeView : Object.keys(state.positions)[0]);
    if (state.positions[ticker] && Number(action.pt) > 0) {
      state.positions[ticker].pt = Number(action.pt);
      saveState(state, pushStateToGist);
      syncStore();
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
    state.balance = -Math.abs(Number(action.balance));
    saveState(state, pushStateToGist);
    syncStore();
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
    buy: `Buy ${action.shares} ${ticker} at $${action.price}?`,
    sell: `Sell ${action.shares == null ? 'all' : action.shares} ${ticker} at $${action.price}?`,
    set_pt: `Set ${ticker}'s target price to $${action.pt}?`,
    set_price: `Set ${ticker}'s tracked market price to $${action.price}?`,
    set_balance: `Set margin debt/balance to ${action.balance}?`,
    set_free_cash: `Set account balance/debt to ${action.amount}?`,
    add_cash_stock: `Add ${action.shares} shares of ${ticker} to cash holdings?`,
    remove_cash_stock: `Remove ${ticker} from cash holdings?`
  };
  const message = details[action.action];
  if (!message) {
    logTerminal(`[AI Action Error]: Unsupported action "${action.action}". No changes were made.`);
    return false;
  }
  return confirm(`Gemini interpreted your input as this portfolio change:\n\n${message}\n\nApply it?`);
}

function showScenarioModal(data: ScenarioModalData): void {
  document.getElementById('scenarioComparisonModal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'scenarioComparisonModal';
  overlay.className = 'fixed inset-0 z-[1000] flex items-center justify-center p-2 sm:p-4';
  overlay.style.background = 'rgba(10, 15, 25, 0.78)';
  overlay.style.backdropFilter = 'blur(8px)';
  overlay.style.setProperty('-webkit-backdrop-filter', 'blur(8px)');

  const dialog = document.createElement('section');
  dialog.className = 'w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-xl flex flex-col';
  dialog.style.background = '#0b0f17';
  dialog.style.border = '1px solid rgba(255,255,255,0.12)';
  dialog.style.borderRadius = '10px';
  dialog.style.boxShadow = '0 25px 50px -12px rgba(0,0,0,0.75)';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'scenarioComparisonTitle');

  const header = document.createElement('div');
  header.className = 'sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-slate-800 px-3 py-3 sm:px-4';
  header.style.background = 'rgba(11,15,23,0.94)';
  header.style.backdropFilter = 'blur(8px)';
  header.style.setProperty('-webkit-backdrop-filter', 'blur(8px)');
  const headingWrap = document.createElement('div');
  headingWrap.className = 'min-w-0';
  const title = document.createElement('h2');
  title.id = 'scenarioComparisonTitle';
  title.className = 'text-base sm:text-lg font-bold text-white';
  title.textContent = data.title;
  const subtitle = document.createElement('p');
  subtitle.className = 'mt-1 text-[11px] font-medium text-slate-400';
  subtitle.textContent = data.subtitle;
  headingWrap.append(title, subtitle);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white';
  closeButton.textContent = 'Close · Esc';
  closeButton.setAttribute('aria-label', 'Close scenario comparison');
  header.append(headingWrap, closeButton);

  const toolbar = document.createElement('div');
  toolbar.className = 'flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-3 py-2';
  const tableWrap = document.createElement('div');
  tableWrap.className = 'overflow-auto px-2 py-2 sm:px-3';
  const table = document.createElement('table');
  table.className = 'w-full border-collapse text-xs';
  table.style.fontVariantNumeric = 'tabular-nums';
  const mobileCards = document.createElement('div');
  mobileCards.className = 'flex flex-col gap-2';
  const isExit = data.kind === 'exit-comparison';
  const isBuyMore = data.kind === 'buy-more';
  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;
  let activeColumns = data.columns.map((_, index) => index);
  let activePreset = 0;

  const formatScenarioButton = (index: number) => {
    const row = data.rows.find(item => item.label === 'Net P&L');
    const isBest = row?.values[index]?.includes('BEST') ?? false;
    const value = row?.values[index]?.split(' · ')[0] ?? '';
    return { label: data.columns[index] + ' · ' + value + (isBest ? ' BEST' : ''), isBest };
  };

  function renderTable(columnIndexes: number[]): void {
    activeColumns = columnIndexes;
    table.replaceChildren();
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.className = 'border-b border-slate-700 text-slate-300';
    const firstHead = document.createElement('th');
    firstHead.className = 'px-2 py-2 text-left font-semibold';
    firstHead.textContent = isBuyMore ? 'Projection Date' : 'Metric';
    headRow.appendChild(firstHead);
    const shownColumns = isBuyMore ? data.columns.map((_, index) => index) : columnIndexes;
    shownColumns.forEach((columnIndex) => {
      const th = document.createElement('th');
      th.className = 'min-w-[90px] px-2 py-2 text-right font-semibold whitespace-nowrap ' + (isBuyMore && columnIndex % 2 === 1 ? 'text-emerald-300' : '');
      th.textContent = data.columns[columnIndex];
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    data.rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.className = row.kind === 'result'
        ? 'border-b border-emerald-900/70 bg-emerald-950/25 font-semibold text-emerald-300'
        : row.kind === 'risk'
          ? 'border-b border-rose-900/60 bg-rose-950/20 text-rose-300'
          : row.kind === 'balance'
            ? 'border-b border-cyan-900/50 bg-cyan-950/20 text-cyan-200'
            : 'border-b border-slate-800/80 text-slate-300';
      const labelCell = document.createElement('th');
      labelCell.className = 'px-2 py-2 text-left font-medium whitespace-nowrap';
      labelCell.textContent = row.label;
      tr.appendChild(labelCell);
      shownColumns.forEach((columnIndex) => {
        const td = document.createElement('td');
        td.className = 'px-2 py-2 text-right font-mono whitespace-nowrap ' + (isBuyMore ? (columnIndex % 2 === 0 ? 'text-slate-400 bg-slate-950/30' : 'text-emerald-200 bg-emerald-950/20 border-l border-emerald-900/40') : '');
        td.style.fontVariantNumeric = 'tabular-nums';
        const value = document.createElement('span');
        value.textContent = row.values[columnIndex] ?? '—';
        td.appendChild(value);
        const delta = row.deltas?.[columnIndex];
        if (delta) {
          const badge = document.createElement('span');
          badge.className = 'ml-1.5 inline-flex rounded px-1.5 py-0.5 align-middle text-[9px] font-semibold ' +
            (delta.includes('BEST') ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400');
          badge.textContent = delta;
          td.appendChild(badge);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    renderMobileCards(columnIndexes);
    renderToolbar();
  }

  function renderMobileCards(columnIndexes: number[]): void {
    mobileCards.replaceChildren();
    if (isBuyMore) {
      data.rows.forEach((row) => {
        const card = document.createElement('section');
        card.className = 'rounded-lg border border-slate-700 bg-slate-900/50 p-3';
        const heading = document.createElement('h3');
        heading.className = 'mb-2 border-b border-slate-800 pb-2 text-xs font-semibold text-white';
        heading.textContent = row.label;
        card.appendChild(heading);
        data.columns.forEach((column, index) => {
          const line = document.createElement('div');
          line.className = 'flex items-start justify-between gap-3 border-b border-slate-800/70 py-2 last:border-0';
          const label = document.createElement('span');
          label.className = 'text-[11px] text-slate-400';
          label.textContent = column;
          const value = document.createElement('span');
          value.className = 'text-right font-mono text-xs font-semibold ' + (isBuyMore ? (index % 2 === 0 ? 'text-slate-400' : 'text-emerald-200') : 'text-slate-200');
          value.textContent = row.values[index] ?? '—';
          if (index === 0 && row.kind === 'result') value.className += ' text-emerald-300';
          if (index === 3) value.className += ' text-cyan-200';
          line.append(label, value);
          card.appendChild(line);
        });
        mobileCards.appendChild(card);
      });
      return;
    }
    columnIndexes.forEach((columnIndex) => {
      const card = document.createElement('section');
      card.className = 'rounded-lg border border-slate-700 bg-slate-900/50 p-3';
      const cardHeading = document.createElement('div');
      cardHeading.className = 'mb-2 flex items-start justify-between gap-2 border-b border-slate-800 pb-2';
      const scenarioTitle = document.createElement('h3');
      scenarioTitle.className = 'text-xs font-semibold text-white';
      scenarioTitle.textContent = data.columns[columnIndex];
      const netRow = data.rows.find(row => row.label === 'Net P&L');
      const netValue = netRow?.values[columnIndex] ?? '—';
      const best = netValue.includes('BEST');
      const bestBadge = document.createElement('span');
      bestBadge.className = best ? 'rounded bg-emerald-950 px-2 py-1 text-[10px] font-bold text-emerald-300' : 'hidden';
      bestBadge.textContent = 'BEST';
      cardHeading.append(scenarioTitle, bestBadge);
      card.appendChild(cardHeading);
      data.rows.forEach((row) => {
        const line = document.createElement('div');
        line.className = 'flex items-start justify-between gap-3 border-b border-slate-800/70 py-2 last:border-0';
        const label = document.createElement('span');
        label.className = 'text-[11px] text-slate-400';
        label.textContent = row.label;
        const value = document.createElement('span');
        value.className = 'text-right font-mono text-xs font-semibold text-slate-200';
        value.style.fontVariantNumeric = 'tabular-nums';
        value.textContent = row.values[columnIndex] ?? '—';
        if (row.kind === 'result') value.className += ' text-emerald-300';
        if (row.kind === 'balance') value.className += ' text-cyan-200';
        value.style.fontVariantNumeric = 'tabular-nums';
        const delta = row.deltas?.[columnIndex];
        if (delta) {
          const badge = document.createElement('span');
          badge.className = 'mt-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-semibold ' +
            (delta.includes('BEST') ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-400');
          badge.textContent = delta;
          value.appendChild(document.createElement('br'));
          value.appendChild(badge);
        }
        line.append(label, value);
        card.appendChild(line);
      });
      mobileCards.appendChild(card);
    });
  }

  function renderToolbar(): void {
    toolbar.replaceChildren();
    const hasQuickActions = isExit && Boolean(data.quickActions?.length);
    const hasPresets = isExit && Boolean(data.presets?.length);
    if (!hasQuickActions && !hasPresets) {
      toolbar.className = 'hidden';
      return;
    }
    toolbar.className = 'flex flex-wrap items-center gap-1.5 border-b border-slate-800 px-3 py-2';

    if (hasQuickActions) {
      data.quickActions!.forEach((action) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rounded-full border border-cyan-900/80 bg-cyan-950/30 px-2.5 py-1.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-900/50';
        button.textContent = action.label;
        button.addEventListener('click', () => {
          if (action.command) {
            const input = document.getElementById('cmdInput') as HTMLInputElement | null;
            if (!input) return;
            input.value = action.command;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            close();
            return;
          }
          if (action.invert) {
            renderTable([...activeColumns].reverse());
            return;
          }
          if (action.columnIndexes?.length) {
            activePreset = data.presets?.findIndex(preset =>
              preset.columnIndexes.length === action.columnIndexes!.length &&
              preset.columnIndexes.every((value, index) => value === action.columnIndexes![index])
            ) ?? activePreset;
            renderTable(action.columnIndexes);
          }
        });
        toolbar.appendChild(button);
      });
    }

    if (isMobile()) {
      data.columns.forEach((_, index) => {
        const scenario = formatScenarioButton(index);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rounded-full border px-3 py-1.5 text-[11px] font-semibold ' +
          (activeColumns.includes(index) ? 'border-cyan-600 bg-cyan-950/60 text-cyan-100' : 'border-slate-700 text-slate-400');
        button.textContent = scenario.label;
        button.addEventListener('click', () => {
          activePreset = index;
          renderTable([index]);
        });
        toolbar.appendChild(button);
      });
      return;
    }

    if (hasPresets) {
      const label = document.createElement('span');
      label.className = 'mr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500';
      label.textContent = 'Compare';
      toolbar.appendChild(label);
      data.presets!.forEach((preset, presetIndex) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rounded-md border px-2 py-1 text-[10px] font-medium ' +
          (activePreset === presetIndex ? 'border-cyan-700 bg-cyan-950/50 text-cyan-200' : 'border-slate-700 text-slate-300');
        button.textContent = preset.label;
        button.addEventListener('click', () => {
          activePreset = presetIndex;
          renderTable(preset.columnIndexes);
        });
        toolbar.appendChild(button);
      });
    }
  }

  function renderLayout(): void {
    const mobile = isMobile();
    if (!mobile && isExit && data.presets?.length) {
      activePreset = Math.min(activePreset, data.presets.length - 1);
      activeColumns = data.presets[activePreset]?.columnIndexes ?? activeColumns;
    }
    tableWrap.replaceChildren();
    if (isExit && mobile) {
      tableWrap.appendChild(mobileCards);
    } else {
      tableWrap.appendChild(table);
    }
    renderToolbar();
  }

  let actionBar: HTMLDivElement | undefined;
  if (data.action) {
    actionBar = document.createElement('div');
    actionBar.className = 'flex items-center justify-between gap-3 border-t border-slate-800 px-3 py-2 sm:px-4';
    const actionNote = document.createElement('p');
    actionNote.className = 'text-[10px] leading-snug text-slate-500';
    actionNote.textContent = 'Prepares a terminal command only; no broker order is sent.';
    const actionButton = document.createElement('button');
    actionButton.type = 'button';
    actionButton.className = 'shrink-0 rounded-md border border-emerald-800 bg-emerald-950/60 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/70';
    actionButton.textContent = data.action.label;
    actionButton.addEventListener('click', () => {
      const input = document.getElementById('cmdInput') as HTMLInputElement | null;
      if (!input) return;
      input.value = data.action!.command;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      close();
    });
    actionBar.append(actionNote, actionButton);
  }

  const footer = document.createElement('div');
  footer.className = 'border-t border-slate-800 px-3 py-2 sm:px-4';
  const note = document.createElement('p');
  note.className = 'text-[10px] leading-snug text-slate-500';
  note.textContent = data.note;
  footer.appendChild(note);

  dialog.append(header, toolbar, tableWrap, ...(actionBar ? [actionBar] : []), footer);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('resize', renderLayout);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', handleKeyDown);
  closeButton.focus();
  renderTable(data.columns.map((_, index) => index));
  renderLayout();
  window.addEventListener('resize', renderLayout, { passive: true });
}

async function executeCommand(commandText?: string) {
  const input = document.getElementById("cmdInput") as HTMLInputElement | null;
  const text = (commandText ?? input?.value ?? '').trim();
  if (!text) return;

  logTerminal(text, true);
  if (input && commandText === undefined) input.value = "";

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
  const statusEl = document.getElementById("aiStatus");
  if (statusEl) statusEl.innerText = "CONNECTING...";

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

    if (statusEl) statusEl.innerText = "READY";
  } catch (err: any) {
    logTerminal(`[Error]: ${err.message}`);
    if (statusEl) statusEl.innerText = "READY";
  }
}

function renderSettingsPanel() {
  const container = document.getElementById('settings');
  if (!container) return;

  render(
    h(SettingsDesk, {
      rules: { ...TRADERNET_RULES },
      defaultRefreshIntervalMs: DEFAULT_QUOTE_REFRESH_INTERVAL_MS,
      onSaveBrokerRules: saveBrokerRuleInputs,
      onResetBrokerRules: () => {
        resetBrokerRules();
        renderSettingsPanel();
      },
      onSaveApiKeys: async (secret: string) => {
        const saved = await saveApiKeys({ secret, showToast: (message, type) => showToast(message, type as any), logTerminal });
        if (saved) {
          state.gatewaySecret = secret.trim();
          await syncCloudState('pull');
        }
      },
      onPullCloudState: () => syncCloudState('pull'),
      onChangeRefreshInterval: (val: string) => setQuoteRefreshInterval(val),
      onExportBackup: exportBackupJSON,
      onImportBackup: importBackupJSON,
      onResetToBlankState: resetToBlankState
    }),
    container
  );
}

let appInitialized = false;

function hideStartupLoading() {
  document.getElementById('startup-loading')?.classList.add('is-hidden');
}

setSecretGetter(() => state.gatewaySecret || getGatewaySecret());

async function handleSaveGatewaySecret(secret: string): Promise<boolean> {
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
  state.gatewaySecret = submittedSecret;
  if (!persisted) {
    showToast(
      'Gateway Secret is valid for this session, but secure device storage failed. You may be asked again after refresh.',
      'warning'
    );
  }

  window.dispatchEvent(new CustomEvent('gateway-secret-authenticated', { detail: { secret: submittedSecret } }));
  hideAuthContainer();
  if (!appInitialized) {
    appInitialized = true;
    await startApp(submittedSecret);
  }
  return true;
}

function renderAuthModal(isOpen: boolean) {
  const container = document.getElementById('auth-container');
  if (!container) return;
  container.style.display = isOpen ? 'flex' : 'none';
  render(
    h(AuthModal, {
      isOpen,
      onSaveSecret: handleSaveGatewaySecret
    }),
    container
  );
}

function showAuthContainer() {
  renderAuthModal(true);
}

function hideAuthContainer() {
  renderAuthModal(false);
}

async function startApp(secret: string) {
  loadTradernetRules();
  state.gatewaySecret = secret;
  state = loadSavedState(state);
  applyOvernightRollover();
  syncStore();

  if (secret) await syncCloudState('pull');

  const quoteRefreshInterval = document.getElementById('quoteRefreshInterval') as HTMLSelectElement | null;
  const initialQuoteRefreshInterval = getQuoteRefreshInterval(DEFAULT_QUOTE_REFRESH_INTERVAL_MS);

  if (quoteRefreshInterval) {
    quoteRefreshInterval.value = String(initialQuoteRefreshInterval);
    quoteRefreshInterval.addEventListener('change', () => setQuoteRefreshInterval(quoteRefreshInterval.value));
  }
  setQuoteRefreshInterval(initialQuoteRefreshInterval);

  if (rolloverTimer !== null) clearInterval(rolloverTimer);
  rolloverTimer = setInterval(() => {
    if (!document.hidden) applyOvernightRollover();
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyOvernightRollover();
  });

  setBrokerRuleInputs();

  // Avoid launching a duplicate per-ticker analyst request while the initial
  // batch already contains the same deep Yahoo data for all tracked symbols.
  initialQuoteRefreshPending = true;
  switchView(state.activeView);
  setTimeout(() => {
    const mainView = document.getElementById('mainTerminalView');
    if (mainView) {
      mainView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
  await refreshAllLivePrices();
  initialQuoteRefreshPending = false;
  renderBoardAnalystConsensus(getMarketInsightsTicker());
  hideStartupLoading();
}

async function initApp() {
  if (appInitialized) return;

  const rootEl = document.getElementById('root');
  if (rootEl && !document.getElementById('mainTerminalView')) {
    render(h(App, { onToggleMarketInsights: toggleMarketInsights }), rootEl);
  }

  try {
    const secret = await restoreGatewaySecret();
    if (secret) {
      appInitialized = true;
      hideAuthContainer();
      await startApp(secret);
    } else {
      loadTradernetRules();
      state = loadSavedState(state);
      applyOvernightRollover();
      syncStore();
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
  const loader = document.getElementById('startup-loading');
  if (!loader) return;
  const message = loader.querySelector('.startup-loading__message');
  const hint = loader.querySelector('.startup-loading__hint');
  const track = loader.querySelector('.startup-loading__track');
  const actions = loader.querySelector('.startup-loading__actions');
  if (message) message.textContent = 'Could not finish initializing the app.';
  if (hint) hint.textContent = 'Check your connection, then retry or continue offline.';
  if (track) (track as HTMLElement).style.display = 'none';
  if (actions) (actions as HTMLElement).hidden = false;
  const retryButton = document.getElementById('startup-retry');
  const offlineButton = document.getElementById('startup-continue-offline');
  if (retryButton) retryButton.onclick = () => {
    const message = loader.querySelector('.startup-loading__message');
    const hint = loader.querySelector('.startup-loading__hint');
    const track = loader.querySelector('.startup-loading__track');
    if (message) message.textContent = 'Initializing your portfolio…';
    if (hint) hint.textContent = 'Restoring saved data and market connections';
    if (track) (track as HTMLElement).style.display = '';
    if (actions) (actions as HTMLElement).hidden = true;
    loader.classList.remove('is-hidden');
    void initApp();
  };
  if (offlineButton) offlineButton.onclick = () => { void continueStartupOffline(); };
  loader.classList.remove('is-hidden');
}

async function continueStartupOffline() {
  appInitialized = true;
  state.gatewaySecret = '';
  try {
    await startApp('');
  } catch (error) {
    appInitialized = false;
    console.error('[Startup Error]: Could not continue offline.', error);
    showStartupFailure();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

Object.assign(window as any, {
  addCashStockFromUI,
  applyOvernightRollover,
  clearLocalData,
  createInsightElement,
  createStockPageLink,
  executeCommand,
  exportBackupJSON,
  getCashCushionTotal,
  importBackupJSON,
  loadMarketInsight,
  loadTradernetRules,
  logTerminal,
  normalizePortfolioState,
  processRollovers,
  renderBoard,
  renderBoardExternalLinks,
  renderCashCushion,
  renderPositionsTable,
  renderSummaryCards,
  saveStateToStorage,
  sentimentBadge,
  syncCloudState,
  pullCloudState: () => syncCloudState('pull'),
  pushCloudState: () => syncCloudState('push'),
  refreshAllLivePrices,
  refreshMarketInsight,
  resetToBlankState,
  saveApiKeys,
  saveCurrentBalanceFromInput,
  setActiveView,
  setQuoteRefreshInterval,
  showToast,
  switchView,
  updateEmptyStateVisibility
});
