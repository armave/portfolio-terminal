import { render, h, type ComponentChild } from 'preact';

/** Centralize Preact mount calls for board UI. This keeps mount ownership explicit
 * while legacy shell containers are migrated into a single application tree. */
function renderInto(vnode: ComponentChild, container: Element): void {
  render(vnode, container);
}

import { formatUSD } from '../utils/formatters';
import { getTotalPortfolioInvested } from '../domain/portfolioSelectors';
export { formatUSD } from '../utils/formatters';
import { EmptyStatePanel } from '../components/EmptyStatePanel';
import { calculateCommission, calculateMarginInterest, collectOpenPositionTranches } from '../domain/portfolio';
import {
  BrokerRules,
  PositionRecord,
  BoardState
} from '../types/portfolio';

export type {
  PositionRecord,
  BoardState
};

const NON_POSITION_VIEWS = new Set(['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS']);

function resolveActiveView(state: BoardState): string {
  let currentView = state.activeView;
  if (!currentView || (!NON_POSITION_VIEWS.has(currentView) && !state.positions?.[currentView])) {
    currentView = 'COMBINED';
  }
  return currentView;
}

interface RenderCashCushionOptions {
  onFetchLivePrice?: (ticker: string) => void;
  onRemoveCashStock?: (index: number) => void;
  onSaveBalance?: (signedValue: number) => void;
  onAddCashStock?: (ticker: string, shares: number, manualPrice: number) => void;
  refreshIntervalMs?: number;
}

function renderCashCushion(
  _state: BoardState,
  options: RenderCashCushionOptions = {}
): void {
  const {
    onFetchLivePrice,
    onRemoveCashStock,
    onSaveBalance,
    onAddCashStock,
    refreshIntervalMs = 60000
  } = options;
  // The App component owns this desk's Preact instance. Send changing action
  // handlers as props rather than mounting a second renderer into its container.
  window.dispatchEvent(new CustomEvent('terminal:cash-cushion-props', {
    detail: { onFetchLivePrice, onRemoveCashStock, onSaveBalance, onAddCashStock, refreshIntervalMs }
  }));
}

function renderPositionsTable(
  gross: number,
  totalComms: number,
  debtToUse: number,
  marginChargedToUse: number,
  entryDate?: string,
  dailyRate: number = 0
): void {
  const tableBody = document.getElementById('projectionTableBody');
  if (!tableBody) return;

  const table = tableBody.closest('table');
  if (table) {
    const parent = table.parentElement;
    if (parent && parent.id === 'projectionTableContainer') {
      parent.classList.add('table-scroll-wrapper');
    } else if (parent && !parent.classList.contains('table-scroll-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'table-scroll-wrapper';
      parent.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
  }

  window.dispatchEvent(new CustomEvent('terminal:projections-props', {
    detail: { gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate }
  }));
}

function calculateCombinedMetrics(state: BoardState, rules: BrokerRules, tickers: string[], dailyRate: number) {
  let totalInvested = 0;
  let totalCommBuy = 0;
  let totalCommSell = 0;
  let totalGrossTarget = 0;

  tickers.forEach((t) => {
    const pos = state.positions![t];
    const cost = (pos.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
    totalInvested += cost;
    totalCommBuy += pos.commBuy;
    const valSell = pos.shares * pos.pt;
    totalCommSell += calculateCommission(pos.shares, valSell, rules as any);
    totalGrossTarget += valSell - cost;
  });

  const tranchesForCombined = collectOpenPositionTranches(state.positions || {});

  const totalDebt = Math.abs(Number(state.balance) || 0);
  const openMarginCharged = calculateMarginInterest(tranchesForCombined as any, {
    dailyRate,
    marginDebt: totalDebt,
    totalDebt: totalDebt
  } as any);

  const totalMarginCharged = (state.realizedMarginCharged || 0) + openMarginCharged;
  const totalComms = totalCommBuy + totalCommSell;
  const net0 = totalGrossTarget - totalComms - totalMarginCharged;
  const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

  return { totalInvested, totalGrossTarget, totalComms, totalMarginCharged, totalDebt, netPct };
}

function calculatePositionMetrics(state: BoardState, pos: PositionRecord, rules: BrokerRules, dailyRate: number) {
  const totalInvested = (pos.tranches || []).reduce((sum, t) => sum + t.qty * t.price, 0);
  const valSell = pos.shares * pos.pt;
  const commSell = calculateCommission(pos.shares, valSell, rules as any);
  const totalComms = pos.commBuy + commSell;
  const gross = valSell - totalInvested;

  const portfolioInvested = getTotalPortfolioInvested(state);
  const weight = portfolioInvested > 0 ? totalInvested / portfolioInvested : 1;

  const totalAccountDebt = Math.abs(Number(state.balance) || 0);
  const allocatedDebt = totalAccountDebt * weight;

  const tranches = pos.tranches || [];

  const posMarginCharged = calculateMarginInterest(tranches as any, {
    dailyRate,
    marginDebt: allocatedDebt,
    totalDebt: totalAccountDebt
  } as any);

  const net0 = gross - totalComms - posMarginCharged;
  const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

  return { gross, totalComms, allocatedDebt, posMarginCharged, netPct };
}

interface RenderSummaryCardsOptions {
  rules: BrokerRules;
  refreshIntervalMs?: number;
  onRenderExternalLinks?: () => void;
  onRenderAnalystConsensus?: (ticker: string) => void;
}


function renderPositionBasis(state: BoardState, currentView: string, tickers: string[]): void {
  const tranchesEl = document.getElementById('boardTranches');
  const investedEl = document.getElementById('boardInvested');
  if (!tranchesEl || !investedEl) return;

  // POSITION BASIS represents only the app's current open margin tranches.
  // Do not substitute broker positions or executed-trade history here.
  const isCombined = currentView === 'COMBINED' || !state.positions?.[currentView];
  const positions = isCombined
    ? tickers.map((ticker) => state.positions?.[ticker]).filter(Boolean) as PositionRecord[]
    : [state.positions![currentView]];
  const displayLots = positions.flatMap((pos) => (pos.tranches || []).map((lot) => ({
    qty: Number(lot.qty) || 0,
    price: Number(lot.price) || 0,
    date: lot.date
  })).filter((lot) => lot.qty > 0 && lot.price > 0));

  const displayShares = displayLots.reduce((sum, lot) => sum + lot.qty, 0);
  const displayInvested = displayLots.reduce((sum, lot) => sum + lot.qty * lot.price, 0);
  const formatPrice = (value: number) => value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const formatShortDate = (value?: string) => {
    if (!value) return '';
    const parsed = /^\\d{4}-\\d{2}-\\d{2}$/.test(value)
      ? new Date(value + 'T12:00:00')
      : new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  if (displayShares <= 0 || displayLots.length === 0) {
    tranchesEl.textContent = 'No open margin tranches';
    investedEl.textContent = '—';
    return;
  }

  const average = displayInvested / displayShares;
  tranchesEl.textContent = `${displayLots.map((lot) => {
    const shortDate = formatShortDate(lot.date);
    return `${lot.qty} @ ${formatPrice(lot.price)}${shortDate ? ` (${shortDate})` : ''}`;
  }).join(' + ')}`;
  investedEl.textContent = `${formatPrice(displayInvested)} | ${formatPrice(average)}`;
}

function renderSummaryCards(
  state: BoardState,
  options: RenderSummaryCardsOptions
): void {
  const { rules, onRenderAnalystConsensus, refreshIntervalMs = 60000 } = options;
  if (!rules) return;

  const dailyRate = rules.annualRate / rules.dayCountBasis;
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === 'COMBINED' || (tickers.length !== 1 && !state.positions?.[state.activeView || '']);

  window.dispatchEvent(new CustomEvent('terminal:summary-metrics-props', {
    detail: { state, rules, refreshIntervalMs }
  }));

  const titleEl = document.getElementById('boardTitle');
  const moveEl = document.getElementById('boardDailyMove');

  if (isCombined) {
    const metrics = calculateCombinedMetrics(state, rules, tickers, dailyRate);

    if (titleEl) {
      titleEl.innerText = tickers.length > 0
        ? `COMBINED PORTFOLIO (${tickers.length} Positions | ${metrics.netPct >= 0 ? '+' : ''}${metrics.netPct.toFixed(2)}% Net Target)`
        : `NO ACTIVE MARGIN POSITIONS`;
    }
    if (moveEl) moveEl.classList.remove('hidden');

    if (typeof onRenderAnalystConsensus === 'function' && tickers[0]) {
      onRenderAnalystConsensus(tickers[0]);
    }

    renderPositionsTable(
      metrics.totalGrossTarget,
      metrics.totalComms,
      metrics.totalDebt,
      metrics.totalMarginCharged,
      state.startDate,
      dailyRate
    );
  } else {
    const pos = (state.activeView ? state.positions?.[state.activeView] : undefined) || state.positions?.[tickers[0]];
    if (!pos) return;

    const metrics = calculatePositionMetrics(state, pos, rules, dailyRate);

    if (titleEl) {
      titleEl.innerText = `${pos.ticker} (${pos.shares} Shares @ ${formatUSD(pos.pt)} PT | ${metrics.netPct >= 0 ? '+' : ''}${metrics.netPct.toFixed(2)}% Net Target)`;
    }

    if (typeof onRenderAnalystConsensus === 'function') {
      onRenderAnalystConsensus(pos.ticker);
    }

    renderPositionsTable(
      metrics.gross,
      metrics.totalComms,
      metrics.allocatedDebt,
      metrics.posMarginCharged,
      pos.startDate || state.startDate,
      dailyRate
    );
  }
}

function prefillTerminalCommand(command: string): void {
  const input = document.getElementById('cmdInput') as HTMLInputElement | null;
  if (!input) return;

  input.value = command;
  // Notify Preact's controlled input so its internal command state stays in sync.
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();

  const start = input.value.indexOf('[');
  const end = start >= 0 ? input.value.indexOf(']', start) + 1 : -1;
  if (start >= 0 && end > start) {
    requestAnimationFrame(() => input.setSelectionRange(start, end));
  }
}

export interface RenderBoardOptions extends RenderCashCushionOptions {
  rules: BrokerRules;
  onSetActiveView?: (view: string) => void;
  onRefreshAllLivePrices?: () => void | Promise<void>;
  onRenderClosedHistory?: () => void;
  onRenderSettingsPanel?: () => void;
  onRenderAnalystConsensus?: (ticker: string) => void;
  onRenderExternalLinks?: () => void;
  onRenderConsoleQuickActions?: () => void;
  onUpdateCombinedBreakeven?: () => void;
  onSyncMarketInsightsPanel?: () => void;
  lastDeskView?: string | null;
  onUpdateLastDeskView?: (view: string) => void;
}

export function renderBoard(state: BoardState, options: RenderBoardOptions): void {
  const {
    rules,
    onSetActiveView = () => { },
    onRefreshAllLivePrices = () => { },
    onRenderClosedHistory = () => { },
    onRenderSettingsPanel = () => { },
    onRenderAnalystConsensus = () => { },
    onFetchLivePrice = () => { },
    onRemoveCashStock = () => { },
    onRenderExternalLinks = () => { },
    onRenderConsoleQuickActions = () => { },
    onUpdateCombinedBreakeven = () => { },
    onSyncMarketInsightsPanel = () => { },
    refreshIntervalMs = 60000,
    onUpdateLastDeskView = () => { }
  } = options;

  if (!rules) return;

  const tickers = Object.keys(state.positions || {});
  const currentView = resolveActiveView(state);
  window.dispatchEvent(new CustomEvent('terminal:active-view', { detail: { view: currentView } }));

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';

  window.dispatchEvent(new CustomEvent('terminal:ticker-tabs-props', {
    detail: { state, onSetActiveView, onRefreshAllLivePrices }
  }));

  const closedTrades = state.closedTrades || [];
  const closedTradesCount = document.getElementById('closedTradesCount');
  if (closedTradesCount) {
    closedTradesCount.textContent = `${closedTrades.length} realized exit${closedTrades.length === 1 ? '' : 's'}`;
  }

  // Hidden desks do not need their derived metrics or insights panel refreshed.
  // They will be updated when the user returns to a position/combined desk.
  if (!isCushionActive && !isClosedHistoryActive && !isSettingsActive) {
    onUpdateCombinedBreakeven();
    onSyncMarketInsightsPanel();
  }

  const daysEl = document.getElementById('daysToBreakeven');

  const consoleCard = document.getElementById('tradingConsoleCard');
  if (consoleCard) {
    consoleCard.classList.toggle('hidden', isClosedHistoryActive || isSettingsActive);
  }
  const marketInsightsPanel = document.getElementById('marketInsightsPanel');
  if (marketInsightsPanel) {
    marketInsightsPanel.classList.toggle('hidden', isCushionActive || isClosedHistoryActive || isSettingsActive);
  }

  if (isCushionActive) {
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CASH_CUSHION');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    onRenderConsoleQuickActions();
    return;
  }

  if (isClosedHistoryActive) {
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CLOSED_HISTORY');
    onRenderClosedHistory();
    return;
  }

  if (isSettingsActive) {
    onRenderSettingsPanel();
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  if (consoleCard) consoleCard.classList.remove('hidden');
  if (daysEl) daysEl.classList.remove('hidden');
  onUpdateLastDeskView(currentView);

  const emptyPanel = document.getElementById('emptyStatePanel');
  const titleRow = document.getElementById('boardTitleRow');
  const metricsGrid = document.querySelector('.portfolio-metrics-grid');
  const workspaceGrid = document.querySelector('.desktop-workspace-grid');
  const projTableContainer = document.getElementById('projectionTableContainer');

  if (tickers.length === 0) {
    if (emptyPanel) {
      emptyPanel.classList.remove('hidden');
      renderInto(
        h(EmptyStatePanel, {
          onQuickBuy: () => {
            const todayIso = new Date().toISOString().split('T')[0];
            prefillTerminalCommand(`bought [shares] [TICKER] for [price] on [${todayIso}]`);
          },
          onAddCashStock: () => {
            prefillTerminalCommand('add cash stock [shares] [TICKER] for [price]');
          },
          onImportBackup: () => {
            document.getElementById('importFileInput')?.click();
          }
        }),
        emptyPanel
      );
    }
    if (titleRow) titleRow.classList.add('hidden');
    if (metricsGrid) metricsGrid.classList.add('hidden');
    if (projTableContainer) projTableContainer.classList.add('hidden');
    if (workspaceGrid) {
      workspaceGrid.classList.remove('lg:grid-cols-[3fr_7fr]');
      workspaceGrid.classList.add('lg:grid-cols-1');
    }
    if (daysEl) daysEl.innerText = 'No Active Positions';
    onRenderConsoleQuickActions();
    return;
  }

  if (emptyPanel) emptyPanel.classList.add('hidden');
  if (titleRow) titleRow.classList.remove('hidden');
  if (metricsGrid) metricsGrid.classList.remove('hidden');
  if (projTableContainer) projTableContainer.classList.remove('hidden');
  if (workspaceGrid) {
    workspaceGrid.classList.remove('lg:grid-cols-1');
    workspaceGrid.classList.add('lg:grid-cols-[3fr_7fr]');
  }

  renderPositionBasis(state, currentView, tickers);

  renderSummaryCards(state, {
    rules,
    refreshIntervalMs,
    onRenderExternalLinks,
    onRenderAnalystConsensus
  });

  onRenderExternalLinks();
  onRenderConsoleQuickActions();
}
