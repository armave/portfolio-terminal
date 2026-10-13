import { render, h } from 'preact';
import { ClosedHistoryDesk } from './src/components/ClosedHistoryDesk';

import {
  calculateBreakevenDays,
  calculateCommission,
  calculateCompoundedDebt,
  calculateMarginInterest,
  createBlankState,
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
import {
  fetchYahooStockData,
  proxyFetch,
  setSecretGetter,
  syncCloudState as syncCloudStateService
} from './src/services/api';
import {
  areHeaderCredentialsConfigured,
  clearBrokerRules,
  clearLocalData,
  getGatewaySecret,
  getQuoteRefreshInterval,
  loadBrokerRules,
  loadGatewaySecret,
  loadSavedState,
  saveApiKeys,
  saveBrokerRules,
  saveGatewaySecret,
  saveQuoteRefreshInterval,
  saveState,
  saveStateToStorage
} from './src/services/storage';
import {
  logTerminal,
  showToast
} from './src/ui/notifications';
import {
  formatUSD,
  getCashCushionTotal,
  getTotalPortfolioInvested,
  renderBoard as renderBoardUI,
  renderCashCushion,
  renderPositionsTable,
  renderSummaryCards
} from './src/ui/renderBoard';
import { portfolioStore } from './src/store/portfolioStore';
import { BoardExternalLinks } from './src/components/BoardExternalLinks';
import { ConsoleQuickActions } from './src/components/ConsoleQuickActions';

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
let lastRenderedDeskView: string | null = null;
const livePriceRequests = new Map<string, Promise<any>>();
let marketInsightsOpen = false;
let activeInsightSection = 'news';
let loadedInsightTicker = '';
let insightRequestId = 0;
const boardAnalystSnapshots = new Map<string, any>();
const boardAnalystErrors = new Map<string, any>();
const boardAnalystRequests = new Map<string, Promise<void>>();
const BOARD_ANALYST_CACHE_TTL_MS = 5 * 60 * 1000;
const BOARD_ANALYST_RETRY_MS = 60 * 1000;

export const QUOTE_REFRESH_INTERVAL_KEY = 'quote_refresh_interval_ms';
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
  state = { ...state, ...parsedState };
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

let headerCredentialsHidden = false;

function updateHeaderCredentialsVisibility() {
  const isConfigured = areHeaderCredentialsConfigured();
  const fieldsContainer = document.getElementById('headerCredentialsFields');
  const actionsContainer = document.getElementById('headerCredentialsActions');
  const toggleBtn = document.getElementById('toggleHeaderCredentialsButton');

  if (!toggleBtn || !fieldsContainer) return;

  if (isConfigured) {
    toggleBtn.classList.remove('hidden');
    fieldsContainer.style.display = headerCredentialsHidden ? 'none' : 'flex';
    if (actionsContainer) {
      actionsContainer.style.display = headerCredentialsHidden ? 'none' : 'flex';
    }
    toggleBtn.textContent = headerCredentialsHidden ? 'Show keys' : 'Hide keys';
    toggleBtn.setAttribute('aria-expanded', String(!headerCredentialsHidden));
  } else {
    toggleBtn.classList.add('hidden');
    fieldsContainer.style.display = 'flex';
    if (actionsContainer) {
      actionsContainer.style.display = 'flex';
    }
    headerCredentialsHidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
  }
}

function toggleHeaderCredentialsVisibility() {
  headerCredentialsHidden = !headerCredentialsHidden;
  updateHeaderCredentialsVisibility();
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

export function loadTradernetRules() {
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
    state.lastRolloverTimestamp = getLatestRolloverTimestamp();
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
    state.lastRolloverTimestamp = getLatestRolloverTimestamp();
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

function getZonedDateParts(date: Date, timeZone = TRADERNET_RULES.rolloverTimeZone): Record<string, number> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function zonedLocalTimeToTimestamp(year: number, month: number, day: number, hour: number, minute: number, timeZone = TRADERNET_RULES.rolloverTimeZone) {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = targetUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = getZonedDateParts(new Date(timestamp), timeZone);
    const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const adjustment = targetUtc - representedUtc;
    if (adjustment === 0) return timestamp;
    timestamp += adjustment;
  }
  return timestamp;
}

function shiftCalendarDate(year: number, month: number, day: number, offset: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + offset));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function getRolloverTimestampForLocalDate(year: number, month: number, day: number) {
  return zonedLocalTimeToTimestamp(
    year, month, day, TRADERNET_RULES.rolloverHour, TRADERNET_RULES.rolloverMinute
  );
}

function getLatestRolloverTimestamp(now = new Date()) {
  const local = getZonedDateParts(now);
  let rollover = getRolloverTimestampForLocalDate(local.year, local.month, local.day);
  if (rollover > now.getTime()) {
    const previousDate = shiftCalendarDate(local.year, local.month, local.day, -1);
    rollover = getRolloverTimestampForLocalDate(previousDate.year, previousDate.month, previousDate.day);
  }
  return rollover;
}

export function applyOvernightRollover() {
  const now = new Date();
  if (!Number.isFinite(Number(state.lastRolloverTimestamp)) || Number(state.lastRolloverTimestamp) <= 0) {
    state.lastRolloverTimestamp = getLatestRolloverTimestamp(now);
    saveState(state, pushStateToGist);
    syncStore();
    return;
  }

  let elapsedCycles = 0;
  const lastRolloverTimestamp = Number(state.lastRolloverTimestamp);
  const last = getZonedDateParts(new Date(lastRolloverTimestamp));
  let rolloverDate = { year: last.year, month: last.month, day: last.day };
  let cursor = getRolloverTimestampForLocalDate(rolloverDate.year, rolloverDate.month, rolloverDate.day);
  if (cursor <= lastRolloverTimestamp) {
    rolloverDate = shiftCalendarDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, 1);
    cursor = getRolloverTimestampForLocalDate(rolloverDate.year, rolloverDate.month, rolloverDate.day);
  }
  while (cursor <= now.getTime()) {
    elapsedCycles++;
    rolloverDate = shiftCalendarDate(rolloverDate.year, rolloverDate.month, rolloverDate.day, 1);
    cursor = getRolloverTimestampForLocalDate(rolloverDate.year, rolloverDate.month, rolloverDate.day);
  }

  if (elapsedCycles > 0 && Math.abs(state.balance) > 0) {
    const currentDebt = Math.abs(state.balance);
    const compoundedDebt = calculateCompoundedDebt(currentDebt, getDailyRate(), elapsedCycles);
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
    logTerminal(`[Broker ${String(TRADERNET_RULES.rolloverHour).padStart(2, '0')}:${String(TRADERNET_RULES.rolloverMinute).padStart(2, '0')} Armenia rollover]: Processed ${elapsedCycles} cycle(s). Accrued interest: +$${formatUSD(interestAccrued)}. Margin Debt: -$${formatUSD(compoundedDebt)}.`);
  } else if (elapsedCycles > 0) {
    state.lastRolloverTimestamp = now.getTime();
    saveState(state, pushStateToGist);
    syncStore();
  }
}

export function setActiveView(view: string) {
  const normalizedView = view === 'BALANCE' ? 'CASH_CUSHION' : (view || 'COMBINED');
  state.activeView = normalizedView;
  saveState(state, pushStateToGist);
  syncStore();
  renderBoard();
}

export const switchView = setActiveView;

function renderConsoleQuickActions() {
  const container = document.getElementById('consoleQuickActions');
  if (!container) return;
  const pos = state.positions[state.activeView];
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

  const tranchesForCombined = state.tranches || tickers.flatMap(t => state.positions[t]?.tranches || []);
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

export function createStockPageLink(ticker: string, provider: string) {
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

export function renderBoardExternalLinks() {
  const activeTicker = state.positions[state.activeView] ? state.activeView : '';
  const stockPageLinks = document.getElementById('boardExternalLinks');
  if (!stockPageLinks) return;
  render(h(BoardExternalLinks, { ticker: activeTicker }), stockPageLinks);
}

export function renderBoard() {
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
}

function getMarketInsightsTicker() {
  const currentView = state.activeView;
  if (currentView && currentView !== 'COMBINED' && currentView !== 'CASH_CUSHION') {
    return currentView;
  }
  const tickers = Object.keys(state.positions || {});
  return tickers.length === 1 ? tickers[0] : '';
}

function syncMarketInsightsPanel() {
  const ticker = getMarketInsightsTicker();
  const toggle = document.getElementById('marketInsightsToggle');
  const panel = document.getElementById('marketInsightsPanel');
  if (!toggle || !panel) return;

  toggle.classList.toggle('hidden', !ticker);
  panel.classList.toggle('hidden', !marketInsightsOpen || !ticker);
  toggle.setAttribute('aria-expanded', String(marketInsightsOpen && Boolean(ticker)));
  toggle.textContent = marketInsightsOpen ? 'HIDE INSIGHTS' : 'MARKET INSIGHTS';

  if (!ticker) {
    marketInsightsOpen = false;
    loadedInsightTicker = '';
    return;
  }

  const tickerBadge = document.getElementById('marketInsightsTicker');
  if (tickerBadge) tickerBadge.textContent = `· ${ticker}`;

  if (marketInsightsOpen && loadedInsightTicker !== ticker) {
    loadedInsightTicker = ticker;
    loadMarketInsight(activeInsightSection);
  }
}

export function toggleMarketInsights() {
  const ticker = getMarketInsightsTicker();
  if (!ticker) return;
  const tickerWasLoaded = loadedInsightTicker === ticker;
  marketInsightsOpen = !marketInsightsOpen;
  syncMarketInsightsPanel();
  if (marketInsightsOpen && tickerWasLoaded) loadMarketInsight(activeInsightSection);
}

export function renderCashCushionPanel() {
  renderCashCushion(state, {
    onFetchLivePrice: fetchLivePrice,
    onRemoveCashStock: removeCashStock,
    refreshIntervalMs: getQuoteRefreshInterval(DEFAULT_QUOTE_REFRESH_INTERVAL_MS)
  });
}

function renderClosedHistoryPanel() {
  const container = document.getElementById('closedHistoryContainer');
  if (!container) return;
  render(h(ClosedHistoryDesk, null), container);
}

export function formatQuoteMetadata(holding: any) {
  if (!holding.quoteUpdatedAt) return holding.quoteSource || 'Not fetched';

  const updatedAt = Number(holding.quoteUpdatedAt);
  if (!Number.isFinite(updatedAt)) return holding.quoteSource || 'Not fetched';
  const time = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const refreshInterval = getQuoteRefreshInterval(DEFAULT_QUOTE_REFRESH_INTERVAL_MS);
  const isStale = Date.now() - updatedAt > Math.max(5 * 60 * 1000, refreshInterval * 2);
  return `${isStale ? 'Stale · ' : ''}${holding.quoteSource || 'Quote'} · ${time}`;
}

export function createDailyQuoteLabel(details: any) {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const label = document.createElement('span');
  label.className = 'mt-0.5 block text-[9px] font-normal tabular-nums';
  const parts: string[] = [];
  if (hasChange) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(`${sign}$${formatUSD(Math.abs(details.change))} (${sign}${Math.abs(details.changePercent).toFixed(2)}%)`);
    label.classList.add('text-slate-400');
  } else {
    label.classList.add('text-slate-400');
  }
  if (hasRange) parts.push(`H $${formatUSD(details.high)} / L $${formatUSD(details.low)}`);
  label.textContent = `Day: ${parts.join(' · ')}`;
  return label;
}

export function createInsightElement(tagName: string, className = '', text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function sentimentBadge(direction: SentimentDirection, label = sentimentLabel(direction)) {
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

async function fetchBoardAnalystTarget(ticker: string) {
  if (!ticker) return null;
  const cleanTicker = ticker.trim().toUpperCase();

  try {
    const data = await proxyFetch('', { symbol: cleanTicker }, { method: 'POST' });
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
      container.textContent = `${snapshot.source} · $${formatUSD(snapshot.targetPrice)} · ${upside >= 0 ? '+' : ''}${upside.toFixed(2)}%`;
      container.title = `Target from ${snapshot.source}: $${formatUSD(snapshot.targetPrice)} versus current price $${formatUSD(currentPrice)}.`;
      container.className = `rounded border px-2.5 py-1 text-[10px] font-semibold ${color}`;
    } else {
      container.textContent = `${snapshot.source} price target · $${formatUSD(snapshot.targetPrice)} · current price unavailable`;
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

  if (boardAnalystRequests.has(ticker)) {
    return;
  }

  container.textContent = 'Checking analyst target…';
  container.removeAttribute('title');
  container.className = 'rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-semibold text-slate-400';

  const request = fetchBoardAnalystTarget(ticker).then(result => {
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

export async function loadMarketInsight(section: string, _force = false) {
  const ticker = getMarketInsightsTicker();
  const content = document.getElementById('marketInsightsContent');
  const tickerBadge = document.getElementById('marketInsightsTicker');

  if (!content) return;

  const currentRequestId = ++insightRequestId;

  if (!ticker) {
    content.innerHTML = '<div class="py-4 text-center text-xs text-slate-500">Select a margin position to load its market insights.</div>';
    return;
  }

  activeInsightSection = section;
  if (tickerBadge) tickerBadge.textContent = `· ${ticker}`;

  document.querySelectorAll<HTMLElement>('[data-insight]').forEach(button => {
    const selected = button.dataset.insight === section;
    button.className = `insight-tab whitespace-nowrap rounded px-3 py-1.5 text-[10px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 ${selected ? 'bg-cyan-400 text-slate-950 shadow-sm shadow-cyan-950' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  content.innerHTML = '<div class="py-4 text-center text-xs text-slate-500 font-mono animate-pulse">Loading live data...</div>';

  try {
    if (section === 'news') {
      const news = await proxyFetch('news', { symbol: ticker }, { method: 'POST' });

      if (currentRequestId !== insightRequestId) return;

      if (!Array.isArray(news) || news.length === 0) {
        content.innerHTML = '<div class="py-3 text-slate-500 text-xs">No recent news found.</div>';
        return;
      }

      content.innerHTML = '<div class="space-y-2 mt-2">' + news.slice(0, 5).map((n: any) => `
        <a href="${n.url}" target="_blank" rel="noopener noreferrer" class="block bg-slate-900/60 p-2.5 rounded border border-slate-800 hover:border-cyan-800 transition">
          <div class="text-[10px] text-cyan-400 mb-1">${new Date(n.datetime * 1000).toLocaleDateString()} · ${n.source || 'News'}</div>
          <div class="text-slate-200 text-xs font-semibold leading-snug">${n.headline}</div>
        </a>
      `).join('') + '</div>';
      return;
    }

    const data = await proxyFetch('', { symbol: ticker }, { method: 'POST' });

    if (currentRequestId !== insightRequestId) return;

    if (section === 'fundamentals') {
      const val = data.valuation || {};
      const fh = data.financialHealth || {};

      content.innerHTML = `
        <div class="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Trailing P/E</span>
              <span class="text-white font-bold">${val.peTrailing ? Number(val.peTrailing).toFixed(2) : '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Forward P/E</span>
              <span class="text-white font-bold">${val.peForward ? Number(val.peForward).toFixed(2) : '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">PEG Ratio</span>
              <span class="text-white font-bold">${val.pegRatio ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Short % Float</span>
              <span class="text-amber-400 font-bold">${val.shortPercentOfFloat ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Profit Margin</span>
              <span class="text-white font-bold">${fh.profitMargin ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">ROE</span>
              <span class="text-white font-bold">${fh.returnOnEquity ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Price to Book</span>
              <span class="text-white font-bold">${val.priceToBook ?? '—'}</span>
            </div>
            <div class="bg-slate-900/70 p-2 rounded border border-slate-800/80">
              <span class="text-[10px] text-slate-500 uppercase block">Total Debt</span>
              <span class="text-rose-400 font-bold">${fh.totalDebt ? '$' + (fh.totalDebt / 1e9).toFixed(2) + 'B' : '—'}</span>
            </div>
          </div>
        </div>
      `;
    } else if (section === 'analysts') {
      const t = data.analystTargets || {};
      const upDown = data.upgradesDowngrades || [];

      const udHtml = upDown.length > 0
        ? upDown.slice(0, 4).map((u: any) => `
            <div class="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0">
              <span class="text-slate-300">${u.firm}</span>
              <span class="text-[10px] font-bold ${u.action === 'up' ? 'text-emerald-400' : u.action === 'down' ? 'text-rose-400' : 'text-cyan-400'}">${(u.action || '').toUpperCase()}: ${u.fromGrade || ''} ➝ ${u.toGrade || ''}</span>
            </div>`).join('')
        : '<div class="text-slate-500">No recent actions</div>';

      content.innerHTML = `
        <div class="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-slate-800/60 pb-3">
            <div><span class="text-slate-500 block text-[10px]">Mean Target</span><span class="text-emerald-400 font-bold">$${t.mean ? t.mean.toFixed(2) : '—'}</span></div>
            <div><span class="text-slate-500 block text-[10px]">High Target</span><span class="text-emerald-400 font-bold">$${t.high ? t.high.toFixed(2) : '—'}</span></div>
            <div><span class="text-slate-500 block text-[10px]">Low Target</span><span class="text-rose-400 font-bold">$${t.low ? t.low.toFixed(2) : '—'}</span></div>
            <div><span class="text-slate-500 block text-[10px]">Consensus</span><span class="text-cyan-300 font-bold uppercase">${t.consensusRecommendation || '—'}</span></div>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 uppercase block mb-2">Recent Firm Actions</span>
            ${udHtml}
          </div>
        </div>
      `;
    } else if (section === 'earnings') {
      const cal = data.calendar || {};
      const eh = data.earningsHistory || [];

      const ehHtml = eh.length > 0
        ? eh.map((e: any) => `
            <div class="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0">
              <span class="text-slate-300 font-bold">${e.quarter}</span>
              <span class="text-[10px]">Est: ${e.epsEstimate} | Act: <span class="${e.epsDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-bold">${e.epsActual}</span> (${e.surprisePercent})</span>
            </div>`).join('')
        : '<div class="text-slate-500">No recent earnings history</div>';

      content.innerHTML = `
        <div class="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div class="bg-slate-900/70 p-2.5 rounded border border-slate-800/80 mb-3">
            <span class="text-[10px] text-slate-500 uppercase block">Next Earnings Date</span>
            <span class="text-purple-300 font-bold text-sm">${cal.earningsDate || 'TBD'}</span>
          </div>
          <div>
            <span class="text-[10px] text-slate-500 uppercase block mb-2">Past Earnings Surprises</span>
            ${ehHtml}
          </div>
        </div>
      `;
    }
  } catch (err: any) {
    content.innerHTML = `<div class="py-3 text-rose-400 text-xs">Failed to load insights: ${err.message}</div>`;
  }
}

export function refreshMarketInsight() {
  return loadMarketInsight(activeInsightSection, true);
}

function handleMarketInsightsTabKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('#marketInsightsTabs [role="tab"]'));
  const currentIndex = tabs.indexOf(event.target as HTMLElement);
  if (currentIndex < 0 || tabs.length === 0) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
  const nextTab = tabs[nextIndex];
  nextTab.focus();
  if (nextTab.dataset.insight) {
    loadMarketInsight(nextTab.dataset.insight);
  }
}

function recordTrackedPrice(ticker: string, price: number, sourceName: string, updatedAt: number | null = null, quoteDetails: any = null) {
  const symbol = ticker.toUpperCase();
  let matched = false;
  const updateQuoteMetadata = (holding: any) => {
    holding.quoteSource = sourceName;
    if (updatedAt === null) delete holding.quoteUpdatedAt;
    else holding.quoteUpdatedAt = updatedAt;
    if (quoteDetails) holding.quoteDetails = quoteDetails;
    else delete holding.quoteDetails;
  };

  if (state.positions[symbol]) {
    state.positions[symbol].currentPrice = price;
    updateQuoteMetadata(state.positions[symbol]);
    matched = true;
  }
  const cashHolding = state.cashCushion?.holdings?.find((holding: any) => holding.ticker === symbol);
  if (cashHolding) {
    cashHolding.price = price;
    cashHolding.currentPrice = price;
    updateQuoteMetadata(cashHolding);
    matched = true;
  }
  if (matched) syncStore();
  return matched;
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
  const signedBalance = Number.isFinite(Number(value)) ? Number(value) : 0;
  state.cashCushion.freeCash = Math.max(0, signedBalance);
  state.balance = Math.min(0, signedBalance);
  syncStore();
  return {
    balance: Math.max(0, signedBalance),
    debt: Math.max(0, -signedBalance)
  };
}

export function saveCurrentBalanceFromInput() {
  const input = document.getElementById('freeCashInput') as HTMLInputElement | null;
  if (!input || !input.reportValidity()) return;

  const inputValue = input.valueAsNumber;
  const { balance, debt } = setCurrentBalance(inputValue);
  saveState(state, pushStateToGist);
  renderBoard();
  logTerminal(`[Balance]: Current balance/debt updated. Balance: $${formatUSD(balance)} | Margin debt: -$${formatUSD(debt)}.`);
  showToast(`Balance $${formatUSD(balance)} | Debt -$${formatUSD(debt)}`, 'success');
}

export async function addCashStockFromUI() {
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

export function updateEmptyStateVisibility(isEmpty: boolean) {
  const panel = document.getElementById('emptyStatePanel');
  if (!panel) return;
  panel.classList.toggle('hidden', !isEmpty);
}

async function requestLivePrice(symbol: string) {
  const existingRequest = livePriceRequests.get(symbol);
  if (existingRequest) return existingRequest;

  const request = fetchLivePriceFromProviders(symbol).then(result => ({
    ...result,
    matched: result.price !== null
      ? recordTrackedPrice(symbol, result.price, result.sourceName, result.updatedAt, result.quoteDetails)
      : false
  }));
  livePriceRequests.set(symbol, request);
  try {
    return await request;
  } finally {
    if (livePriceRequests.get(symbol) === request) livePriceRequests.delete(symbol);
  }
}

async function fetchLivePriceFromProviders(symbol: string) {
  symbol = symbol.toUpperCase();
  let price: number | null = null;
  let sourceName = "";
  let quoteDetails: any = null;

  try {
    const data = await fetchYahooStockData(symbol);

    if (data?.price?.current > 0) {
      price = data.price.current;
      sourceName = "Yahoo Proxy";

      const prevClose = data.price.previousClose ?? data.price.regularMarketPreviousClose;
      let change = data.price.change ?? data.price.regularMarketChange ?? (price! - prevClose);
      let current = price ?? data.regularMarketPrice ?? data.price;

      // "PRE", "REGULAR", "POST", or "CLOSED"
      const marketState = data.price?.marketState;
      if (marketState === 'PRE') {
        current = data.price.preMarketPrice ?? data.price.postMarketPrice;
        change = current - data.price.current;
      }
      else if (marketState === 'POST' || marketState === 'CLOSED') {
        current = data.price.postMarketPrice;
        change = current - data.price.current;
      }

      quoteDetails = {
        marketState,
        price: current,
        change,
        changePercent: prevClose ? (change / prevClose) * 100 : 0
      };
    }
  } catch (e: any) {
    console.warn(`[Proxy Quote Error for ${symbol}]:`, e.message);
  }

  const updatedAt = price ? Date.now() : null;

  return {
    price,
    sourceName,
    updatedAt,
    quoteDetails,
    error: price ? null : "Quote unavailable via Cloudflare proxy"
  };
}

async function fetchLivePrice(ticker: string, silent = false) {
  const symbol = ticker.toUpperCase();
  const result = await requestLivePrice(symbol);

  if (result.price !== null) {
    saveState(state, pushStateToGist);
    renderBoard();
    if (!silent) {
      logTerminal(`[${result.sourceName}]: ${symbol} updated to $${formatUSD(result.price)}${result.matched ? '' : ' (quote only)'}.`);
    }
    return result.price;
  }

  const tracked = state.positions[symbol]?.currentPrice || (state.cashCushion?.holdings?.find((h: any) => h.ticker === symbol)?.price) || 0;
  if (!silent) {
    logTerminal(`[Market Data Error]: Could not fetch ${symbol}. ${result.error}. Retained tracked price: $${formatUSD(tracked)}. Set manually via: price ${symbol} <number>.`);
  }
  return null;
}

export async function refreshAllLivePrices() {
  const cashHoldings = state.cashCushion && state.cashCushion.holdings;

  const allTickers = new Set<string>([
    ...Object.keys(state.positions || {}),
    ...(cashHoldings || []).map((h: any) => h.ticker)
  ]);

  const tickersArray = Array.from(allTickers);
  if (tickersArray.length === 0) return;

  const queryStr = tickersArray.join(',');
  logTerminal(`[System]: Polling batch live quotes for ${queryStr}...`);

  try {
    const responseData = await fetchYahooStockData(queryStr);
    const results = Array.isArray(responseData) ? responseData : [responseData];
    let updatedCount = 0;

    for (const data of results) {
      if (!data || data.error || !data.price) {
        console.warn(`[Quote Warning]: Missing or failed data for ${data?.symbol}`, data?.error);
        continue;
      }

      const ticker = data.symbol;

      let current = data.price.current ?? data.regularMarketPrice ?? data.price;
      const previous = data.price.previousClose ?? data.regularMarketPreviousClose;
      let change = data.price.change ?? data.regularMarketChange ?? (current - previous);

      // "PRE", "REGULAR", "POST", or "CLOSED"
      const marketState = data.price?.marketState;
      if (marketState === 'PRE') {
        current = data.price.preMarketPrice ?? data.price.postMarketPrice;
        change = current - data.price.current;
      }
      else if (marketState === 'POST' || marketState === 'CLOSED') {
        current = data.price.postMarketPrice;
        change = current - data.price.current;
      }

      const quoteDetails = {
        marketState,
        price: current,
        change,
        changePercent: previous ? (change / previous) * 100 : 0
      };

      if (state.positions[ticker]) {
        state.positions[ticker].currentPrice = current;
        state.positions[ticker].quoteDetails = quoteDetails;
        state.positions[ticker].quoteUpdatedAt = Date.now();
        updatedCount++;
      }

      if (Array.isArray(cashHoldings)) {
        const cashPos = cashHoldings.find((h: any) => h.ticker === ticker);
        if (cashPos) {
          cashPos.price = current;
          cashPos.currentPrice = current;
          cashPos.quoteDetails = quoteDetails;
          cashPos.quoteUpdatedAt = Date.now();
          updatedCount++;
        }
      }
    }

    if (updatedCount > 0) {
      saveState(state, pushStateToGist);
      syncStore();
      renderBoard();
      logTerminal(`[System]: Live market quotes refreshed for ${updatedCount} assets.`);
    } else {
      logTerminal(`[Market Data Warning]: No quotes updated during batch fetch.`);
    }
  } catch (err: any) {
    console.error('Batch quote fetch failed:', err);
    logTerminal(`[Market Data Error]: Batch fetch failed - ${err.message}`);
  }
}

export function setQuoteRefreshInterval(interval: number | string) {
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

export function exportBackupJSON() {
  delete state.gatewaySecret;
  if ('marginBalance' in state) {
    delete state.marginBalance;
  }
  const exportState = { ...state };
  delete exportState.gatewaySecret;
  if ('marginBalance' in exportState) {
    delete exportState.marginBalance;
  }
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

export async function importBackupJSON(event: Event) {
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
      saveState(state, pushStateToGist);
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

export function runLadderSimulation(data: any, activeState = state) {
  const targetState = activeState || state;
  const positions = targetState?.positions || {};
  const ticker = data.ticker || (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(positions)[0]);
  const pos = positions[ticker];
  if (!pos || pos.shares <= 0) {
    logTerminal(`[Ladder Error]: No active position found for ${ticker}.`);
    return;
  }

  const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
  const portfolioInvested = getTotalPortfolioInvested(targetState);
  const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;

  let runningDebt = Math.abs(state.balance) * weight;
  let totalAccruedMargin = calculateMarginInterest(state.tranches || pos.tranches || [], {
    dailyRate: getDailyRate(),
    marginDebt: runningDebt,
    totalDebt: Math.abs(state.balance)
  });
  let totalComms = pos.commBuy;
  let totalGrossProceeds = 0;
  let currentDay = 0;

  const stepsRender: string[] = [];

  data.steps.forEach((step: any, idx: number) => {
    const stepDays = Math.max(0, step.days - currentDay);
    if (stepDays > 0 && runningDebt > 0) {
      const compounded = calculateCompoundedDebt(runningDebt, getDailyRate(), stepDays);
      totalAccruedMargin += calculateMarginInterest(runningDebt, getDailyRate(), stepDays);
      runningDebt = compounded;
    }
    currentDay = step.days;

    const proceeds = step.shares * step.price;
    totalGrossProceeds += proceeds;
    const commSell = calcCommission(step.shares, proceeds);
    totalComms += commSell;

    const netCashCredited = proceeds - commSell;
    runningDebt = Math.max(0, runningDebt - netCashCredited);

    stepsRender.push(`
      <div class="border-l-2 border-cyan-500/50 pl-2 space-y-0.5">
        <div class="text-slate-200 font-semibold">Stage ${idx + 1} (${step.label || '+' + step.days + 'd'}): Sell ${step.shares} @ $${formatUSD(step.price)}</div>
        <div class="text-slate-400">Proceeds: $${formatUSD(proceeds)} | Comm: $${formatUSD(commSell)} | Remaining Debt: <span class="text-rose-400 font-mono">-$${formatUSD(runningDebt)}</span></div>
      </div>
    `);
  });

  const grossPnl = totalGrossProceeds - totalInvested;
  const netPnl = grossPnl - totalComms - totalAccruedMargin;
  const netPct = totalInvested > 0 ? (netPnl / totalInvested) * 100 : 0;
  const netColor = netPnl >= 0 ? "text-emerald-400" : "text-rose-400";
  const netSign = netPnl >= 0 ? "+" : "";

  const html = `
    <div class="border border-purple-800/80 bg-purple-950/20 p-3 rounded my-2 text-xs space-y-2">
      <div class="font-bold text-purple-300 border-b border-purple-800/60 pb-1 flex justify-between items-center">
        <span>[LADDERED SCALE-OUT SIMULATION]: ${ticker}</span>
        <span class="${netColor} font-black text-sm">${netSign}$${formatUSD(netPnl)} (${netSign}${netPct.toFixed(2)}% Net)</span>
      </div>
      <div class="space-y-1.5 py-1">
        ${stepsRender.join('')}
      </div>
      <div class="border-t border-purple-800/60 pt-1.5 grid grid-cols-2 gap-2 text-slate-300">
        <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(totalGrossProceeds)} (Gross: ${grossPnl >= 0 ? '+' : ''}$${formatUSD(grossPnl)})</div>
        <div><span class="text-slate-500">Total Comms:</span> $${formatUSD(totalComms)}</div>
        <div><span class="text-slate-500">Accrued Margin Drag:</span> <span class="text-rose-400">$${formatUSD(totalAccruedMargin)}</span></div>
        <div><span class="text-slate-500">Debt Reduction Benefit:</span> <span class="text-emerald-400 font-semibold">Reduced Bleed Applied</span></div>
      </div>
    </div>
  `;
  logTerminal(html, false, true);
}

export function runComparison(data: any, activeState = state) {
  const targetState = activeState || state;
  const positions = targetState?.positions || {};
  const ticker = data.ticker || (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(positions)[0]);
  const pos = positions[ticker];
  if (!pos || pos.shares <= 0) {
    logTerminal(`[Comparison Error]: No active position found for ${ticker}.`);
    return;
  }

  const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
  const portfolioInvested = getTotalPortfolioInvested(targetState);
  const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;
  const debtToUse = Math.abs(state.balance) * weight;
  const marginChargedToUse = calculateMarginInterest(state.tranches || pos.tranches || [], {
    dailyRate: getDailyRate(),
    marginDebt: debtToUse,
    totalDebt: Math.abs(state.balance)
  });

  const computed = data.scenarios.map((s: any) => {
    const grossProceeds = pos.shares * s.price;
    const grossPnl = grossProceeds - totalInvested;
    const commSell = calcCommission(pos.shares, grossProceeds);
    const totalComms = pos.commBuy + commSell;

    const additionalMargin = calculateMarginInterest(debtToUse, getDailyRate(), s.days);
    const totalMargin = marginChargedToUse + additionalMargin;

    const netPnl = grossPnl - totalComms - totalMargin;
    const netPct = (netPnl / totalInvested) * 100;
    const resultingBalance = state.balance + (grossProceeds - commSell);

    return {
      ...s,
      grossProceeds,
      grossPnl,
      commSell,
      totalComms,
      totalMargin,
      additionalMargin,
      netPnl,
      netPct,
      resultingBalance
    };
  });

  const sA = computed[0];
  const sB = computed[1];
  const diffNet = sB.netPnl - sA.netPnl;
  const diffMargin = sB.totalMargin - sA.totalMargin;

  const diffColor = diffNet >= 0 ? "text-emerald-400 font-black" : "text-rose-400 font-black";
  const diffSign = diffNet >= 0 ? "+" : "";

  const html = `
    <div class="border border-cyan-800 bg-cyan-950/20 p-3 rounded my-2 text-xs space-y-3">
      <div class="font-bold text-cyan-300 border-b border-cyan-800/60 pb-1 flex justify-between items-center">
        <span>[COMPARISON]: ${pos.shares} ${ticker} — ${sA.label} VS ${sB.label}</span>
        <span class="${diffColor}">Diff: ${diffSign}$${formatUSD(diffNet)} Net</span>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="bg-slate-900/60 p-2.5 rounded border border-slate-800 space-y-1">
          <div class="font-bold text-slate-200 border-b border-slate-800 pb-1 flex justify-between">
            <span>${sA.label}</span>
            <span class="${sA.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sA.netPnl >= 0 ? '+' : ''}$${formatUSD(sA.netPnl)} (${sA.netPct.toFixed(2)}%)</span>
          </div>
          <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(sA.grossProceeds)}</div>
          <div><span class="text-slate-500">Commissions:</span> $${formatUSD(sA.totalComms)}</div>
          <div><span class="text-slate-500">Margin Accrued:</span> $${formatUSD(sA.totalMargin)}</div>
          <div><span class="text-slate-500">Resulting Balance:</span> <span class="${sA.resultingBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sA.resultingBalance >= 0 ? '+' : '-'}$${formatUSD(Math.abs(sA.resultingBalance))}</span></div>
        </div>

        <div class="bg-slate-900/60 p-2.5 rounded border border-slate-800 space-y-1">
          <div class="font-bold text-slate-200 border-b border-slate-800 pb-1 flex justify-between">
            <span>${sB.label}</span>
            <span class="${sB.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sB.netPnl >= 0 ? '+' : ''}$${formatUSD(sB.netPnl)} (${sB.netPct.toFixed(2)}%)</span>
          </div>
          <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(sB.grossProceeds)}</div>
          <div><span class="text-slate-500">Commissions:</span> $${formatUSD(sB.totalComms)}</div>
          <div><span class="text-slate-500">Margin Accrued:</span> $${formatUSD(sB.totalMargin)} (+${formatUSD(sB.additionalMargin)})</div>
          <div><span class="text-slate-500">Resulting Balance:</span> <span class="${sB.resultingBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${sB.resultingBalance >= 0 ? '+' : '-'}$${formatUSD(Math.abs(sB.resultingBalance))}</span></div>
        </div>
      </div>

      <div class="text-[11px] text-slate-400 border-t border-slate-800 pt-1.5 flex justify-between">
        <span>Tradernet margin penalty for waiting: <strong class="text-rose-400">+$${formatUSD(diffMargin)}</strong></span>
        <span>Net advantage: <strong class="${diffColor}">${diffSign}$${formatUSD(diffNet)}</strong></span>
      </div>
    </div>
  `;

  logTerminal(html, false, true);
}

export function runSimulation(simPrice: number, daysOffset: number, label: string, tickerTarget: string, activeState = state) {
  const targetState = activeState || state;
  const positions = targetState?.positions || {};
  const ticker = tickerTarget || (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(positions)[0]);
  const pos = positions[ticker];
  if (!pos || pos.shares <= 0) {
    logTerminal(`[Simulation Error]: No active position open for ${ticker}.`);
    return;
  }

  const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
  const grossProceeds = pos.shares * simPrice;
  const grossPnl = grossProceeds - totalInvested;
  const commSell = calcCommission(pos.shares, grossProceeds);
  const totalComms = pos.commBuy + commSell;

  const portfolioInvested = getTotalPortfolioInvested(targetState);
  const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;
  const debtToUse = Math.abs(state.balance) * weight;

  const additionalMargin = calculateMarginInterest(debtToUse, getDailyRate(), daysOffset);
  const currentMarginInterest = calculateMarginInterest(state.tranches || pos.tranches || [], {
    dailyRate: getDailyRate(),
    marginDebt: debtToUse,
    totalDebt: Math.abs(state.balance)
  });
  const totalMarginAtDate = currentMarginInterest + additionalMargin;

  const netPnl = grossPnl - totalComms - totalMarginAtDate;
  const netPct = totalInvested > 0 ? (netPnl / totalInvested) * 100 : 0;
  const resultingBalance = (state.balance + (grossProceeds - commSell));

  const netColor = netPnl >= 0 ? "text-emerald-400" : "text-rose-400";
  const netSign = netPnl >= 0 ? "+" : "";
  const balColor = resultingBalance >= 0 ? "text-emerald-400" : "text-rose-400";
  const balSign = resultingBalance >= 0 ? "+" : "-";

  const html = `
    <div class="border border-cyan-800/80 bg-cyan-950/20 p-3 rounded my-2 text-xs space-y-1">
      <div class="font-bold text-cyan-300 flex justify-between border-b border-cyan-800/50 pb-1">
        <span>[SIMULATION]: Sell ${pos.shares} ${ticker} @ $${formatUSD(simPrice)} (${label})</span>
        <span class="${netColor} font-black">${netSign}$${formatUSD(netPnl)} (${netSign}${netPct.toFixed(2)}%)</span>
      </div>
      <div class="grid grid-cols-2 gap-2 text-slate-300 pt-1">
        <div><span class="text-slate-500">Gross Proceeds:</span> $${formatUSD(grossProceeds)} (Gross: ${grossPnl >= 0 ? '+' : ''}$${formatUSD(grossPnl)})</div>
        <div><span class="text-slate-500">Commissions:</span> $${formatUSD(totalComms)} ($${formatUSD(pos.commBuy)} buy / $${formatUSD(commSell)} sell)</div>
        <div><span class="text-slate-500">Margin Accrued:</span> $${formatUSD(totalMarginAtDate)} (+$${formatUSD(additionalMargin)} over ${daysOffset}d)</div>
        <div><span class="text-slate-500">Resulting Balance:</span> <span class="${balColor} font-semibold">${balSign}$${formatUSD(Math.abs(resultingBalance))}</span></div>
      </div>
    </div>
  `;
  logTerminal(html, false, true);
}

// ==========================================
// PORTFOLIO ACTIONS (CASH-FIRST ORDER FLOW)
// ==========================================
async function applyPortfolioActions(action: any) {
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
    logTerminal(`[Executed Buy]: Added ${shares} ${ticker} @ $${formatUSD(price)}. Outlay: $${formatUSD(totalOutlay)} (Comm: $${formatUSD(buyComm)}). Funded: $${formatUSD(cashUsed)} cash | +$${formatUSD(debtAdded)} margin debt. Free Cash remaining: $${formatUSD(state.cashCushion.freeCash)}. Total Margin Debt: -$${formatUSD(Math.abs(state.balance))}.`);
    showToast(`${shares} ${ticker} bought at $${formatUSD(price)}.`, 'success');
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

    const resultMessage = `${sharesToSell} ${ticker} sold at $${formatUSD(sellPrice)}.`;

    if (isCashHolding) {
      if (sharesToSell >= pos.shares) {
        state.cashCushion.holdings.splice(cashHoldingIdx, 1);
        logTerminal(`[Cash Holding Closed]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Net credited: +$${formatUSD(netCashCredited)} (Debt paid: $${formatUSD(debtRepaid)}, Free Cash added: $${formatUSD(cashSurplus)}).`);
      } else {
        pos.shares -= sharesToSell;
        logTerminal(`[Cash Holding Partial Sell]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Remaining: ${pos.shares} shares.`);
      }
    } else {
      const realizedTrade = realizeClosedTrade(pos, ticker, sharesToSell, sellPrice, sellComm, Date.now());
      delete (realizedTrade.position as any).marginCharged;
      state.positions[ticker] = realizedTrade.position;
      if (realizedTrade.trade) state.closedTrades.push(realizedTrade.trade);
      state.realizedMarginCharged = (state.realizedMarginCharged || 0) + realizedTrade.marginFee;

      if (realizedTrade.position.shares <= 1e-8) {
        delete state.positions[ticker];
        state.activeView = "COMBINED";
        logTerminal(`[Position Closed]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Net credited: +$${formatUSD(netCashCredited)} (Debt paid: $${formatUSD(debtRepaid)}, Free Cash added: $${formatUSD(cashSurplus)}). Remaining Debt: -$${formatUSD(Math.abs(state.balance))}. Free Cash: $${formatUSD(state.cashCushion.freeCash)}.`);
      } else {
        logTerminal(`[Partial Sell]: Sold ${sharesToSell} ${ticker} @ $${formatUSD(sellPrice)}. Net credited: +$${formatUSD(netCashCredited)} (Debt paid: $${formatUSD(debtRepaid)}, Free Cash added: $${formatUSD(cashSurplus)}). Remaining: ${realizedTrade.position.shares} shares.`);
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
      logTerminal(`[Target Updated]: ${ticker} PT updated to $${formatUSD(action.pt)}.`);
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
      logTerminal(`[Price Updated]: ${ticker} market price set to $${formatUSD(newP)}.`);
    }
  }
  else if (action.action === "set_balance") {
    state.balance = -Math.abs(Number(action.balance));
    saveState(state, pushStateToGist);
    syncStore();
    logTerminal(`[Margin Synced]: Total margin balance explicitly set to -$${formatUSD(Math.abs(state.balance))}.`);
  }
  else if (action.action === "set_free_cash") {
    const { balance, debt } = setCurrentBalance(action.amount);
    saveState(state, pushStateToGist);
    logTerminal(`[Balance]: Current balance/debt updated. Balance: $${formatUSD(balance)} | Margin debt: -$${formatUSD(debt)}.`);
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

export function confirmAiPortfolioAction(action: any) {
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

export async function executeCommand(activeState = state) {
  const targetState = activeState || state;
  const input = document.getElementById("cmdInput") as HTMLInputElement | null;
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  logTerminal(text, true);
  input.value = "";

  if (/^(?:pull|sync cloud|cloud pull|pull cloud|load cloud)$/i.test(text)) {
    await syncCloudState();
    return;
  }

  const balanceMatch = text.match(/^(?:b:|balance:?)\s*(-?\d+(?:\.\d+)?)$/i);
  if (balanceMatch) {
    const val = Number(balanceMatch[1]);
    const { balance, debt } = setCurrentBalance(val);
    saveState(state, pushStateToGist);
    renderBoard();
    logTerminal(`[Balance]: Current balance/debt updated. Balance: $${formatUSD(balance)} | Margin debt: -$${formatUSD(debt)}.`);
    showToast(`Balance $${formatUSD(balance)} | Debt -$${formatUSD(debt)}`, 'success');
    return;
  }

  const quoteMatch = text.match(/^(?:quote|price of|fetch price|get price)\s+([A-Za-z]+)$/i);
  if (quoteMatch) {
    fetchLivePrice(quoteMatch[1].toUpperCase());
    return;
  }

  const aiStatus = document.getElementById("aiStatus");
  if (aiStatus) {
    aiStatus.innerText = "CONNECTING...";
    aiStatus.className = "text-amber-400 text-[10px]";
  }

  try {
    const prompt = buildIntentPrompt({
      text,
      state: targetState,
      activeTickers: Object.keys(targetState?.positions || {}),
      activeView: targetState?.activeView,
      today: new Date().toISOString().split("T")[0]
    });

    if (aiStatus) aiStatus.innerText = "PARSING...";

    const data = await proxyFetch('gemini', {}, {
      method: "POST",
      body: JSON.stringify({ prompt })
    });
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("No response content generated by Gemini.");

    const parsed: any = evaluateIntent(parseAiIntent(rawText) as any);

    if (parsed.intent === "ladder") {
      runLadderSimulation(parsed, targetState);
      logTerminal("[Ladder Exit Evaluated via Gemini Proxy]");
    } else if (parsed.intent === "comparison") {
      runComparison(parsed, targetState);
      logTerminal("[Comparison Evaluated via Gemini Proxy]");
    } else if (parsed.intent === "simulation") {
      runSimulation(parsed.simPrice, parsed.daysOffset, parsed.label, parsed.ticker, targetState);
      logTerminal("[Simulation Evaluated via Gemini Proxy]");
    } else if (parsed.intent === "fetch_quote") {
      const tickerToFetch = parsed.ticker ? parsed.ticker.toUpperCase() : (targetState.activeView !== "COMBINED" && targetState.activeView !== "CASH_CUSHION" && targetState.activeView !== "CLOSED_HISTORY" ? targetState.activeView : Object.keys(targetState.positions || {})[0]);
      if (tickerToFetch) fetchLivePrice(tickerToFetch);
      else logTerminal("[Notice]: No active ticker specified to fetch quote for.");
    } else if (parsed.intent === "action") {
      if (confirmAiPortfolioAction(parsed)) await applyPortfolioActions(parsed);
      else logTerminal("[AI Action]: Cancelled. No portfolio changes were made.");
    } else if (parsed.intent === "chat") {
      logTerminal(`[AI Advisor]: ${parsed.response}`);
    }

    if (aiStatus) {
      aiStatus.innerText = "READY";
      aiStatus.className = "text-slate-500 text-[10px]";
    }
  } catch (err: any) {
    logTerminal(`[Error]: ${err.message}`);
    if (aiStatus) {
      aiStatus.innerText = "ERROR";
      aiStatus.className = "text-rose-400 text-[10px]";
    }
  }
}

let appInitialized = false;

setSecretGetter(() => state.gatewaySecret || getGatewaySecret());

function showAuthContainer() {
  const container = document.getElementById('auth-container');
  if (container) {
    container.style.display = 'flex';
    const input = document.getElementById('gatewaySecretInput') as HTMLInputElement | null;
    input?.focus();
  }
}

function hideAuthContainer() {
  const container = document.getElementById('auth-container');
  if (container) {
    container.style.display = 'none';
  }
}

async function startApp(secret: string) {
  loadTradernetRules();
  state.gatewaySecret = secret;
  state = loadSavedState(state);
  applyOvernightRollover();
  syncStore();

  const headerGatewayInput = document.getElementById('headerGatewaySecretInput') as HTMLInputElement | null;
  if (headerGatewayInput) headerGatewayInput.value = secret;

  if (secret) await syncCloudState('pull');

  ['gatewaySecretInput', 'headerGatewaySecretInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateHeaderCredentialsVisibility);
  });

  headerCredentialsHidden = areHeaderCredentialsConfigured();

  const quoteRefreshInterval = document.getElementById('quoteRefreshInterval') as HTMLSelectElement | null;
  const initialQuoteRefreshInterval = getQuoteRefreshInterval(DEFAULT_QUOTE_REFRESH_INTERVAL_MS);

  if (quoteRefreshInterval) {
    quoteRefreshInterval.value = String(initialQuoteRefreshInterval);
    quoteRefreshInterval.addEventListener('change', () => setQuoteRefreshInterval(quoteRefreshInterval.value));
  }
  setQuoteRefreshInterval(initialQuoteRefreshInterval);

  setBrokerRuleInputs();
  document.getElementById('brokerRulesForm')?.addEventListener('submit', saveBrokerRuleInputs);
  document.getElementById('resetBrokerRulesButton')?.addEventListener('click', resetBrokerRules);
  document.getElementById('marketInsightsTabs')?.addEventListener('keydown', handleMarketInsightsTabKeydown as EventListener);

  updateHeaderCredentialsVisibility();

  switchView(state.activeView);
  setTimeout(() => {
    const mainView = document.getElementById('mainTerminalView');
    if (mainView) {
      mainView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 100);
  await refreshAllLivePrices();
}

async function initApp() {
  if (appInitialized) return;

  const authSaveBtn = document.getElementById('authSaveButton');
  const authInput = document.getElementById('gatewaySecretInput') as HTMLInputElement | null;

  if (authSaveBtn) {
    authSaveBtn.onclick = async () => {
      const secret = authInput?.value?.trim() || '';
      if (!secret) {
        showToast('Please enter the Gateway Secret.', 'error');
        return;
      }
      saveGatewaySecret(secret);
      hideAuthContainer();
      if (!appInitialized) {
        appInitialized = true;
        await startApp(secret);
      } else {
        state.gatewaySecret = secret;
        await syncCloudState('pull');
      }
    };
  }

  if (authInput) {
    authInput.onkeydown = e => {
      if (e.key === 'Enter') {
        authSaveBtn?.click();
      }
    };
  }

  const secret = loadGatewaySecret();
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
    showAuthContainer();
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
  createDailyQuoteLabel,
  createInsightElement,
  createStockPageLink,
  executeCommand,
  exportBackupJSON,
  formatQuoteMetadata,
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
  renderCashCushionPanel,
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
  toggleMarketInsights,
  toggleHeaderCredentialsVisibility,
  updateEmptyStateVisibility
});