import { render, h } from 'preact';
import { formatUSD } from '../utils/formatters';
import { getTotalPortfolioInvested } from '../domain/portfolioSelectors';
export { formatTrancheDate, formatUSD, formatQuoteMetadata, formatRiskTrigger } from '../utils/formatters';
import { TickerTabs } from '../components/TickerTab';
import { EmptyStatePanel } from '../components/EmptyStatePanel';
import { SummaryMetricsGrid } from '../components/SummaryMetricsGrid';
import { ProjectionsTable } from '../components/ProjectionsTable';
import { CashCushionDesk } from '../components/CashCushionDesk';
import { ClosedHistoryDesk } from '../components/ClosedHistoryDesk';
import { calculateCommission, calculateMarginInterest, collectOpenPositionTranches } from '../domain/portfolio';
import {
  BrokerRules,
  PositionRecord,
  QuoteDetails,
  BoardState
} from '../types/portfolio';

export type {
  BrokerRules,
  PositionRecord,
  QuoteDetails,
  BoardState
};

const NON_POSITION_VIEWS = new Set(['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS']);

export { getTotalPortfolioInvested, getCashCushionTotal } from '../domain/portfolioSelectors';

function resolveActiveView(state: BoardState): string {
  let currentView = state.activeView;
  if (!currentView || (!NON_POSITION_VIEWS.has(currentView) && !state.positions?.[currentView])) {
    currentView = 'COMBINED';
    state.activeView = 'COMBINED';
  }
  return currentView;
}

export interface RenderCashCushionOptions {
  onFetchLivePrice?: (ticker: string) => void;
  onRemoveCashStock?: (index: number) => void;
  refreshIntervalMs?: number;
}

export function renderCashCushion(
  state: BoardState,
  options: RenderCashCushionOptions = {}
): void {
  const { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs = 60000 } = options;
  if (!state.cashCushion) state.cashCushion = { freeCash: 0.0, holdings: [] };

  const container = document.getElementById('cashCushionContainer');
  if (container) {
    render(
      h(CashCushionDesk, {
        onFetchLivePrice,
        onRemoveCashStock,
        refreshIntervalMs
      }),
      container
    );
  }
}

export function renderPositionsTable(
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

  render(
    h(ProjectionsTable, {
      gross,
      totalComms,
      debtToUse,
      marginChargedToUse,
      entryDate,
      dailyRate
    }),
    tableBody
  );
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

export interface RenderSummaryCardsOptions {
  rules: BrokerRules;
  refreshIntervalMs?: number;
  onRenderExternalLinks?: () => void;
  onRenderAnalystConsensus?: (ticker: string) => void;
}

export function renderSummaryCards(
  state: BoardState,
  options: RenderSummaryCardsOptions
): void {
  const { rules, onRenderAnalystConsensus, refreshIntervalMs = 60000 } = options;
  if (!rules) return;

  const dailyRate = rules.annualRate / rules.dayCountBasis;
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === 'COMBINED' || (tickers.length !== 1 && !state.positions?.[state.activeView || '']);

  const metricsGridContainer = document.querySelector('.portfolio-metrics-grid');
  if (metricsGridContainer) {
    render(
      h(SummaryMetricsGrid, { state, rules, refreshIntervalMs }),
      metricsGridContainer
    );
  }

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

function hideAllDesks() {
  const desks = ['mainDeskContainer', 'cashCushionContainer', 'closedHistoryContainer', 'settings'];
  desks.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('hidden');
      el.classList.remove('ui-view-enter');
    }
  });
}

function showDesk(id: string) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    // Trigger reflow to restart animation
    void el.offsetWidth;
    el.classList.add('ui-view-enter');
  }
}

export interface RenderBoardOptions extends RenderCashCushionOptions {
  rules: BrokerRules;
  onSetActiveView?: (view: string) => void;
  onRenderClosedHistory?: () => void;
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
    onRenderClosedHistory = () => { },
    onRenderAnalystConsensus = () => { },
    onFetchLivePrice = () => { },
    onRemoveCashStock = () => { },
    onRenderExternalLinks = () => { },
    onRenderConsoleQuickActions = () => { },
    onUpdateCombinedBreakeven = () => { },
    onSyncMarketInsightsPanel = () => { },
    refreshIntervalMs = 60000,
    lastDeskView = null,
    onUpdateLastDeskView = () => { }
  } = options;

  if (!rules) return;

  const tickers = Object.keys(state.positions || {});
  const currentView = resolveActiveView(state);

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';
  const viewChanged = currentView !== lastDeskView;

  const tabsContainer = document.getElementById('tickerTabs');
  if (tabsContainer) {
    render(h(TickerTabs, { state, onSetActiveView }), tabsContainer);
  }

  const closedTrades = state.closedTrades || [];
  const closedTradesCount = document.getElementById('closedTradesCount');
  if (closedTradesCount) {
    closedTradesCount.textContent = `${closedTrades.length} realized exit${closedTrades.length === 1 ? '' : 's'}`;
  }

  onUpdateCombinedBreakeven();
  onSyncMarketInsightsPanel();

  const daysEl = document.getElementById('daysToBreakeven');
  if (viewChanged) hideAllDesks();

  if (isCushionActive) {
    if (viewChanged) showDesk('cashCushionContainer');
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CASH_CUSHION');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    return;
  }

  if (isClosedHistoryActive) {
    if (viewChanged) showDesk('closedHistoryContainer');
    const closedDesk = document.getElementById('closedHistoryContainer');
    if (closedDesk) render(h(ClosedHistoryDesk, {}), closedDesk);
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CLOSED_HISTORY');
    onRenderClosedHistory();
    return;
  }

  if (isSettingsActive) {
    if (viewChanged) showDesk('settings');
    if (typeof window !== 'undefined' && typeof (window as any).renderSettingsPanel === 'function') {
      (window as any).renderSettingsPanel();
    }
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  if (viewChanged) showDesk('mainDeskContainer');
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
      render(
        h(EmptyStatePanel, {
          onQuickBuy: () => {
            const cmdInput = document.getElementById('cmdInput') as HTMLInputElement | null;
            if (cmdInput) {
              const todayIso = new Date().toISOString().split('T')[0];
              cmdInput.value = `bought [shares] [TICKER] for [price] on [${todayIso}]`;
              cmdInput.focus();
            }
          },
          onAddCashStock: () => {
            const cmdInput = document.getElementById('cmdInput') as HTMLInputElement | null;
            if (cmdInput) {
              cmdInput.value = 'add cash stock [shares] [TICKER] for [price]';
              cmdInput.focus();
            }
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

  renderSummaryCards(state, {
    rules,
    refreshIntervalMs,
    onRenderExternalLinks,
    onRenderAnalystConsensus
  });

  onRenderExternalLinks();
  onRenderConsoleQuickActions();
}
