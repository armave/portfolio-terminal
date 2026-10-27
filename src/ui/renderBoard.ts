import { formatUSD } from '../utils/formatters';
import { getTotalPortfolioInvested } from '../domain/portfolioSelectors';
export { formatUSD } from '../utils/formatters';
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


  if (isCombined) {
    const metrics = calculateCombinedMetrics(state, rules, tickers, dailyRate);

    window.dispatchEvent(new CustomEvent('terminal:board-title', { detail: {
      title: tickers.length > 0
        ? `COMBINED PORTFOLIO (${tickers.length} Positions | ${metrics.netPct >= 0 ? '+' : ''}${metrics.netPct.toFixed(2)}% Net Target)`
        : 'NO ACTIVE MARGIN POSITIONS',
      showDailyMove: true
    } }));

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

    window.dispatchEvent(new CustomEvent('terminal:board-title', { detail: {
      title: `${pos.ticker} (${pos.shares} Shares @ ${formatUSD(pos.pt)} PT | ${metrics.netPct >= 0 ? '+' : ''}${metrics.netPct.toFixed(2)}% Net Target)`,
      showDailyMove: false
    } }));

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

  // Hidden desks do not need their derived metrics or insights panel refreshed.
  // They will be updated when the user returns to a position/combined desk.
  if (!isCushionActive && !isClosedHistoryActive && !isSettingsActive) {
    onUpdateCombinedBreakeven();
    onSyncMarketInsightsPanel();
  }


  if (isCushionActive) {
    
    onUpdateLastDeskView('CASH_CUSHION');
    renderCashCushion(state, { onFetchLivePrice, onRemoveCashStock, refreshIntervalMs });
    onRenderConsoleQuickActions();
    return;
  }

  if (isClosedHistoryActive) {
    onUpdateLastDeskView('CLOSED_HISTORY');
    onRenderClosedHistory();
    return;
  }

  if (isSettingsActive) {
    onRenderSettingsPanel();
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  onUpdateLastDeskView(currentView);


  if (tickers.length === 0) {
    window.dispatchEvent(new CustomEvent('terminal:empty-state-props', {
      detail: {
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
      } satisfies import('../components/EmptyStatePanel').EmptyStatePanelProps
    }));
    onRenderConsoleQuickActions();
    return;
  }

  window.dispatchEvent(new CustomEvent('terminal:empty-state-props', { detail: null }));

  renderSummaryCards(state, {
    rules,
    refreshIntervalMs,
    onRenderExternalLinks,
    onRenderAnalystConsensus
  });

  onRenderExternalLinks();
  onRenderConsoleQuickActions();
}
