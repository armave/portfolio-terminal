import { render, h } from 'preact';
import { formatUSD } from '../utils/formatters';
import { getTotalPortfolioInvested } from '../domain/portfolioSelectors';
export { formatUSD } from '../utils/formatters';
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
  const container = document.getElementById('cashCushionContainer');
  if (container) {
    render(
      h(CashCushionDesk, {
        onFetchLivePrice,
        onRemoveCashStock,
        onSaveBalance,
        onAddCashStock,
        refreshIntervalMs
      }),
      container
    );
  }
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

interface RenderSummaryCardsOptions {
  rules: BrokerRules;
  refreshIntervalMs?: number;
  onRenderExternalLinks?: () => void;
  onRenderAnalystConsensus?: (ticker: string) => void;
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

function renderFreedomAccountSnapshot(state: BoardState): void {
  const host = document.getElementById('freedomAccountSnapshot');
  const parent = document.getElementById('mainDeskContainer');
  if (!parent) return;
  let section = host;
  if (!section) {
    section = document.createElement('section');
    section.id = 'freedomAccountSnapshot';
    section.className = 'rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-3';
    section.setAttribute('aria-label', 'Freedom broker account reconciliation');
    const titleRow = document.getElementById('boardTitleRow');
    if (titleRow?.parentElement === parent) parent.insertBefore(section, titleRow.nextSibling);
    else parent.prepend(section);
  }

  const snapshot = state.brokerAccountInfo;
  if (!snapshot?.loaded) {
    section.innerHTML = '<div class="text-xs text-slate-400">Freedom account data is loading. App-owned cash and margin classifications remain unchanged.</div>';
    return;
  }

  const money = (value: number | null | undefined) =>
    value == null || !Number.isFinite(Number(value)) ? '—' :
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value));
  const tickerKey = (value: unknown) => String(value || '').trim().toUpperCase();
  const marginTickers = new Set(Object.keys(state.positions || {}).map(tickerKey));
  const cashTickers = new Set((state.cashCushion?.holdings || []).map((item: any) => tickerKey(item?.ticker)));
  const cashStocks = new Set((state.cashStocks || []).map((item: any) => tickerKey(item?.ticker)));
  const positions = snapshot.positions || [];
  const matched = positions.filter(p => marginTickers.has(tickerKey(p.ticker)) || cashTickers.has(tickerKey(p.ticker)) || cashStocks.has(tickerKey(p.ticker)));
  const unmatched = positions.filter(p => !marginTickers.has(tickerKey(p.ticker)) && !cashTickers.has(tickerKey(p.ticker)) && !cashStocks.has(tickerKey(p.ticker)));
  const balance = (snapshot.balances || []).find(b => b.currency.toUpperCase() === 'USD');

  const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch] as string));
  const rows = positions.map(p => {
    const ticker = tickerKey(p.ticker);
    const category = marginTickers.has(ticker) ? 'App margin'
      : (cashTickers.has(ticker) || cashStocks.has(ticker)) ? 'App cash' : 'Unmatched';
    const appQty = marginTickers.has(ticker) ? Number(state.positions?.[ticker]?.shares)
      : (state.cashCushion?.holdings || []).find((item: any) => tickerKey(item?.ticker) === ticker)?.shares
        ?? (state.cashStocks || []).find((item: any) => tickerKey(item?.ticker) === ticker)?.shares;
    const qtyNote = appQty == null || !Number.isFinite(Number(appQty)) ? '—'
      : Number(appQty) === Number(p.quantity) ? 'Qty matches' : 'Qty differs: app ' + Number(appQty) + ' / broker ' + Number(p.quantity);
    return '<tr class="border-t border-slate-800"><td class="py-2 pr-3 font-semibold">' + esc(p.ticker) +
      '</td><td class="py-2 pr-3">' + esc(category) + '</td><td class="py-2 pr-3 text-right font-mono">' + esc(p.quantity) +
      '</td><td class="py-2 pr-3 text-right font-mono">' + esc(money(p.marketPrice)) +
      '</td><td class="py-2 pr-3 text-right font-mono">' + esc(money(p.marketValue)) +
      '</td><td class="py-2 text-xs text-slate-400">' + esc(qtyNote) + '</td></tr>';
  }).join('');

  section.innerHTML = '<div class="flex flex-wrap items-start justify-between gap-2"><div><h3 class="text-sm font-semibold text-white">Freedom account · USD</h3><p class="text-xs text-slate-400">Broker snapshot reconciled against app-owned classifications; no app positions or balances are overwritten.</p></div><div class="text-right"><div class="text-xs text-slate-400">Broker USD cash</div><div class="font-mono text-sm font-semibold">' + esc(balance ? money(balance.amount) : '—') + '</div></div></div>' +
    '<div class="flex flex-wrap gap-3 text-xs text-slate-300"><span>' + matched.length + ' matched</span><span>' + unmatched.length + ' unmatched broker position' + (unmatched.length === 1 ? '' : 's') + '</span><span>' + positions.length + ' broker positions</span></div>' +
    (positions.length ? '<div class="overflow-x-auto"><table class="w-full min-w-[620px] text-xs"><thead><tr class="text-slate-400 text-left"><th class="py-2 pr-3">Ticker</th><th class="py-2 pr-3">App classification</th><th class="py-2 pr-3 text-right">Broker qty</th><th class="py-2 pr-3 text-right">Market price</th><th class="py-2 pr-3 text-right">Market value</th><th class="py-2">Reconciliation</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<p class="text-xs text-slate-400">No USD broker positions were returned.</p>') +
    '<p class="text-[11px] text-slate-500">Unmatched broker positions are diagnostic only. Assign cash or margin classification in the app before they enter portfolio calculations.</p>';
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
    lastDeskView = null,
    onUpdateLastDeskView = () => { }
  } = options;

  if (!rules) return;

  const tickers = Object.keys(state.positions || {});
  const currentView = resolveActiveView(state);
  renderFreedomAccountSnapshot(state);

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';
  const viewChanged = currentView !== lastDeskView;

  const tabsContainer = document.getElementById('tickerTabs');
  if (tabsContainer) {
    render(h(TickerTabs, { state, onSetActiveView, onRefreshAllLivePrices }), tabsContainer);
  }

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
  if (viewChanged) hideAllDesks();

  const consoleCard = document.getElementById('tradingConsoleCard');
  if (consoleCard) {
    consoleCard.classList.toggle('hidden', isClosedHistoryActive || isSettingsActive);
  }
  const marketInsightsPanel = document.getElementById('marketInsightsPanel');
  if (marketInsightsPanel) {
    marketInsightsPanel.classList.toggle('hidden', isCushionActive || isClosedHistoryActive || isSettingsActive);
  }

  if (isCushionActive) {
    if (viewChanged) showDesk('cashCushionContainer');
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CASH_CUSHION');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    onRenderConsoleQuickActions();
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
    onRenderSettingsPanel();
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  if (viewChanged) showDesk('mainDeskContainer');
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
      render(
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

  renderSummaryCards(state, {
    rules,
    refreshIntervalMs,
    onRenderExternalLinks,
    onRenderAnalystConsensus
  });

  onRenderExternalLinks();
  onRenderConsoleQuickActions();
}
