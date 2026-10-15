import { render, h } from 'preact';
import { TickerTabs } from '../components/TickerTab';
import { EmptyStatePanel } from '../components/EmptyStatePanel';
import { SummaryMetricsGrid } from '../components/SummaryMetricsGrid';
import { ProjectionsTable } from '../components/ProjectionsTable';
import { CashCushionDesk } from '../components/CashCushionDesk';
import { ClosedHistoryDesk } from '../components/ClosedHistoryDesk';
import { calculateCommission, calculateMarginInterest } from '../domain/portfolio';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';
import {
  BrokerRules,
  PositionRecord,
  CashStockHolding,
  CashCushionState,
  QuoteDetails,
  TrancheItem,
  PortfolioState,
  BoardState
} from '../types/portfolio';

export type {
  BrokerRules,
  PositionRecord,
  CashStockHolding,
  CashCushionState,
  QuoteDetails,
  TrancheItem,
  PortfolioState,
  BoardState
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const NON_POSITION_VIEWS = new Set(['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS']);

export function formatTrancheDate(dateStr?: string | number | null): string {
  if (!dateStr || typeof dateStr !== 'string') return 'New';
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new') return 'New';

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
    }
  }

  const shortMatch =
    trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})/i) ||
    trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2})/i);
  if (shortMatch) {
    const isFirstNum = /^\d+$/.test(shortMatch[1]);
    const day = parseInt(isFirstNum ? shortMatch[1] : shortMatch[2], 10);
    const monStr = (isFirstNum ? shortMatch[2] : shortMatch[1]).slice(0, 3).toLowerCase();
    const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === monStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')}${MONTH_NAMES[monthIdx]}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const day = parsed.getDate();
    const month = parsed.getMonth();
    return `${String(day).padStart(2, '0')}${MONTH_NAMES[month]}`;
  }

  return trimmed;
}

export function formatUSD(val: unknown): string {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getTotalPortfolioInvested(state?: BoardState | null): number {
  if (!state || typeof state !== 'object') return 0;
  return Object.values(state.positions || {}).reduce((acc, pos) => {
    return acc + (pos?.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
  }, 0);
}

export function getCashCushionTotal(state?: BoardState | null): number {
  if (!state?.cashCushion) return 0;
  const cashVal = Number(state.cashCushion.freeCash) || 0;
  const stocksVal = (state.cashCushion.holdings || []).reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + (Number(h.shares) || 0) * price;
  }, 0);
  return cashVal + stocksVal;
}

export function createInsightElement(tagName: string, className = '', text = ''): HTMLElement {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function sentimentBadge(
  direction: SentimentDirection | string,
  label: string = sentimentLabel(direction as SentimentDirection)
): HTMLElement {
  const styles: Record<string, string> = {
    bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
    neutral: 'border-slate-700 bg-slate-900 text-slate-300',
    unknown: 'border-slate-800 bg-slate-950 text-slate-500'
  };
  const badge = createInsightElement(
    'span',
    `inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${styles[direction] || styles.unknown
    }`,
    label
  );
  badge.dataset.sentiment = direction;
  badge.title =
    direction === 'unknown'
      ? 'The selected data source did not provide a sentiment signal.'
      : 'A directional marker based only on the provider values shown in this section.';
  return badge;
}

export function formatQuoteMetadata(
  holding: { quoteUpdatedAt?: number; quoteSource?: string },
  refreshIntervalMs = 60000
): string {
  if (!holding.quoteUpdatedAt) return holding.quoteSource || 'Not fetched';

  const updatedAt = Number(holding.quoteUpdatedAt);
  if (!Number.isFinite(updatedAt)) return holding?.quoteSource || 'Not fetched';
  const time = new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const isStale = Date.now() - updatedAt > Math.max(5 * 60 * 1000, refreshIntervalMs * 2);
  return `${isStale ? 'Stale · ' : ''} ${holding.quoteSource ? holding.quoteSource + ' · ' : ''} ${time}`;
}

export function createDailyQuoteLabel(details?: QuoteDetails | null): HTMLSpanElement | null {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const label = document.createElement('span');
  label.className = 'mt-0.5 block text-[9px] font-normal tabular-nums';
  const parts: string[] = [];
  if (hasChange && details.change !== undefined && details.changePercent !== undefined) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(
      `${sign}${formatUSD(Math.abs(details.change))} (${sign}${Math.abs(details.changePercent).toFixed(2)}%)`
    );
    label.classList.add(
      details.change > 0
        ? 'text-emerald-400'
        : details.change < 0
        ? 'text-rose-400'
        : 'text-slate-400'
    );
  } else {
    label.classList.add('text-slate-400');
  }
  if (hasRange) parts.push(`H ${ formatUSD(details.high) } / L${formatUSD(details.low)}`);
label.textContent = `Day: ${parts.join(' · ')}`;
return label;
}

export function formatRiskTrigger(triggerValue: number, currentValue: number): string {
  if (currentValue <= 0) return `Position value ${formatUSD(triggerValue)}`;

  const bufferPct = ((currentValue - triggerValue) / currentValue) * 100;
  if (bufferPct < 0) {
    return `Position value ${formatUSD(triggerValue)} (already${Math.abs(bufferPct).toFixed(
      1
    )}% below trigger)`;
  }
  return `Position value ${formatUSD(triggerValue)} (${bufferPct.toFixed(1)}% buffer)`;
}

function createTabButtonElement(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderTickerTabs(
  state: BoardState,
  onSelectTab: (view: string) => void = () => { }
): string {
  const tickers = Object.keys(state.positions || {});
  const tabsContainer = document.getElementById('tickerTabs');
  if (!tabsContainer) return state.activeView || 'COMBINED';
  tabsContainer.innerHTML = '';

  let currentView = state.activeView;
  if (!currentView || (!NON_POSITION_VIEWS.has(currentView) && !state.positions?.[currentView])) {
    currentView = 'COMBINED';
    state.activeView = 'COMBINED';
  }

  // Always render the Margin Desk / Combined tab so the user can always access the Trading Console
  const combinedLabel = tickers.length > 0 ? 'COMBINED' : 'MARGIN DESK';
  const isCombinedActive = currentView === 'COMBINED';
  tabsContainer.appendChild(
    createTabButtonElement(
      combinedLabel,
      `px-3 py-1 rounded text-xs font-bold transition ${isCombinedActive ? 'tab-active' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
      }`,
      () => onSelectTab('COMBINED')
    )
  );

  tickers.forEach((sym) => {
    const isActive = currentView === sym;
    tabsContainer.appendChild(
      createTabButtonElement(
        sym,
        `px-3 py-1 rounded text-xs font-bold transition ${isActive ? 'tab-active' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
        }`,
        () => onSelectTab(sym)
      )
    );
  });

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';
  const closedCount = Array.isArray(state.closedTrades) ? state.closedTrades.length : 0;

  tabsContainer.appendChild(
    createTabButtonElement(
      'CASH HOLDINGS',
      `px-3 py-1 rounded text-xs font-bold transition border ${isCushionActive
        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-lg shadow-cyan-950'
        : 'bg-slate-950 text-cyan-400 border-cyan-800 hover:bg-slate-900'
      }`,
      () => onSelectTab('CASH_CUSHION')
    )
  );

  tabsContainer.appendChild(
    createTabButtonElement(
      closedCount > 0 ? `CLOSED (${closedCount})` : 'CLOSED',
      `px-3 py-1 rounded text-xs font-bold transition border ${isClosedHistoryActive
        ? 'bg-purple-400 text-slate-950 border-purple-300 shadow-lg shadow-purple-950'
        : 'bg-slate-950 text-purple-300 border-purple-800 hover:bg-slate-900'
      }`,
      () => onSelectTab('CLOSED_HISTORY')
    )
  );

  tabsContainer.appendChild(
    createTabButtonElement(
      'SETTINGS',
      `px-3 py-1 rounded text-xs font-bold transition border ${isSettingsActive
        ? 'bg-slate-200 text-slate-950 border-slate-100 shadow-lg shadow-slate-950'
        : 'bg-slate-950 text-slate-300 border-slate-700 hover:bg-slate-900'
      }`,
      () => onSelectTab('SETTINGS')
    )
  );

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
  const isCombined =
    state.activeView === 'COMBINED' ||
    (tickers.length !== 1 && !state.positions?.[state.activeView || '']);

  const metricsGridContainer =
    document.getElementById('portfolioMetricsGrid') ||
    document.querySelector('.portfolio-metrics-grid');
  if (metricsGridContainer) {
    render(
      h(SummaryMetricsGrid, {
        state,
        rules,
        refreshIntervalMs
      }),
      metricsGridContainer
    );
  }

  if (isCombined) {
    let totalInvested = 0;
    let totalCommBuy = 0;
    let totalCommSell = 0;
    let totalGrossTarget = 0;
    let totalMarginCharged = state.realizedMarginCharged || 0;

    tickers.forEach((t) => {
      const pos = state.positions![t];
      const cost = (pos.tranches || []).reduce((sum, tr) => sum + tr.qty * tr.price, 0);
      totalInvested += cost;
      totalCommBuy += pos.commBuy;
      const valSell = pos.shares * pos.pt;
      totalCommSell += calculateCommission(pos.shares, valSell, rules as any);
      totalGrossTarget += valSell - cost;
    });

    const tranchesForCombined =
      state.tranches || tickers.flatMap((t) => state.positions![t]?.tranches || []);
    const openMarginCharged = calculateMarginInterest(tranchesForCombined as any, {
      dailyRate,
      marginDebt: Math.abs(Number(state.balance) || 0),
      totalDebt: Math.abs(Number(state.balance) || 0)
    } as any);
    totalMarginCharged += openMarginCharged;

    const totalComms = totalCommBuy + totalCommSell;
    const net0 = totalGrossTarget - totalComms - totalMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;
    const totalDebt = Math.abs(Number(state.balance) || 0);

    const titleEl = document.getElementById('boardTitle');
    if (titleEl) {
      titleEl.innerText =
        tickers.length > 0
          ? `COMBINED PORTFOLIO (${tickers.length} Positions | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Combined Target)`
          : `NO ACTIVE MARGIN POSITIONS`;
    }

    const moveEl = document.getElementById('boardDailyMove');
    if (moveEl) moveEl.classList.remove('hidden');

    if (typeof onRenderAnalystConsensus === 'function' && tickers[0]) {
      onRenderAnalystConsensus(tickers[0]);
    }

    renderPositionsTable(
      totalGrossTarget,
      totalComms,
      totalDebt,
      totalMarginCharged,
      state.startDate,
      dailyRate
    );
  } else {
    const pos =
      (state.activeView ? state.positions?.[state.activeView] : undefined) ||
      state.positions?.[tickers[0]];
    if (!pos) return;

    const totalInvested = (pos.tranches || []).reduce((sum, t) => sum + t.qty * t.price, 0);
    const valSell = pos.shares * pos.pt;
    const commSell = calculateCommission(pos.shares, valSell, rules as any);
    const totalComms = pos.commBuy + commSell;
    const gross = valSell - totalInvested;

    const portfolioInvested = getTotalPortfolioInvested(state);
    const weight = portfolioInvested > 0 ? totalInvested / portfolioInvested : 1;

    const totalAccountDebt = Math.abs(Number(state.balance) || 0);
    const allocatedDebt = totalAccountDebt * weight;
    const tranches = state.tranches || pos.tranches || [];
    const posMarginCharged = calculateMarginInterest(tranches as any, {
      dailyRate,
      marginDebt: allocatedDebt,
      totalDebt: totalAccountDebt
    } as any);

    const net0 = gross - totalComms - posMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;

    const titleEl = document.getElementById('boardTitle');
    if (titleEl) {
      titleEl.innerText = `${pos.ticker} (${pos.shares} Shares @ ${formatUSD(pos.pt)} PT | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Target)`;
    }

    if (typeof onRenderAnalystConsensus === 'function') {
      onRenderAnalystConsensus(pos.ticker);
    }

    renderPositionsTable(
      gross,
      totalComms,
      allocatedDebt,
      posMarginCharged,
      pos.startDate || state.startDate,
      dailyRate
    );
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
  const currentView = renderTickerTabs(state, onSetActiveView);

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';

  const tabsContainer = document.getElementById('tickerTabs');
  if (tabsContainer) {
    render(h(TickerTabs, { state, onSetActiveView }), tabsContainer);
  }

  const closedTrades = state.closedTrades || [];
  const closedTradesCount = document.getElementById('closedTradesCount');
  if (closedTradesCount) {
    closedTradesCount.textContent = `${closedTrades.length} realized exit${closedTrades.length === 1 ? '' : 's'
      }`;
  }

  onUpdateCombinedBreakeven();
  onSyncMarketInsightsPanel();

  const mainDesk = document.getElementById('mainDeskContainer');
  const cushionDesk = document.getElementById('cashCushionContainer');
  const closedDesk = document.getElementById('closedHistoryContainer');
  const settingsDesk = document.getElementById('settings');
  const daysEl = document.getElementById('daysToBreakeven');

  if (mainDesk) mainDesk.classList.add('hidden');
  if (cushionDesk) cushionDesk.classList.add('hidden');
  if (closedDesk) closedDesk.classList.add('hidden');
  if (settingsDesk) settingsDesk.classList.add('hidden');
  if (daysEl) daysEl.classList.remove('hidden');

  if (isCushionActive) {
    if (cushionDesk) cushionDesk.classList.remove('hidden');
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CASH_CUSHION');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    return;
  }

  if (isClosedHistoryActive) {
    if (closedDesk) {
      closedDesk.classList.remove('hidden');
      render(h(ClosedHistoryDesk, {}), closedDesk);
    }
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('CLOSED_HISTORY');
    onRenderClosedHistory();
    return;
  }

  if (isSettingsActive) {
    if (settingsDesk) {
      settingsDesk.classList.remove('hidden');
      if (typeof window !== 'undefined' && typeof (window as any).renderSettingsPanel === 'function') {
        (window as any).renderSettingsPanel();
      }
    }
    if (daysEl) daysEl.classList.add('hidden');
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  if (mainDesk) mainDesk.classList.remove('hidden');
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
              cmdInput.value = 'bought [shares] [TICKER] for [price]';
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
      workspaceGrid.classList.remove('hidden');
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
    workspaceGrid.classList.remove('hidden');
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

  if (lastDeskView !== currentView) {
    // Preserve view transition hook
  }
}