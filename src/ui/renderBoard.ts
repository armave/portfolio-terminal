import {
  setActiveDeskViewState, setBoardTitle, setCashCushionPropsState, setTickerTabsPropsState,
  setSummaryMetricsPropsState, setProjectionsPropsState, setEmptyStatePropsState
} from './uiStateStore';
import { emitUiEvent } from './uiEventBus';
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
  const refreshIntervalMs = options.refreshIntervalMs ?? 60000;
  // The App component owns this desk's Preact instance. Send changing action
  // handlers as props rather than mounting a second renderer into its container.
  setCashCushionPropsState({ refreshIntervalMs });
}

export function resolvePositionEntryDate(
  tranches: Array<{ date?: string; purchaseDate?: string; acquiredAt?: number }> | undefined,
  fallbackDate?: string,
  now: Date = new Date()
): string | undefined {
  const parseTrancheDate = (value: unknown): string | undefined => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined;
    }
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const raw = value.trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const [, year, month, day] = iso;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      return date.getUTCFullYear() === Number(year) &&
        date.getUTCMonth() === Number(month) - 1 &&
        date.getUTCDate() === Number(day)
        ? `${year}-${month}-${day}`
        : undefined;
    }

    // Tranche dates are also persisted/displayed in the legacy "22 Oct" form.
    const short = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,})$/) ||
      raw.match(/^([A-Za-z]{3,})\s+(\d{1,2})$/);
    if (!short) return undefined;
    const dayFirst = /^\d+$/.test(short[1]);
    const day = Number(dayFirst ? short[1] : short[2]);
    const monthName = (dayFirst ? short[2] : short[1]).slice(0, 3).toLowerCase();
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(monthName);
    if (month < 0 || day < 1 || day > 31) return undefined;
    const year = now.getFullYear();
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return undefined;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const firstActiveTrancheDate = (tranches || [])
    .map((tranche) => parseTrancheDate(tranche.date ?? tranche.purchaseDate ?? tranche.acquiredAt))
    .find((date): date is string => Boolean(date));

  // Use the first active tranche in the current position's tranche order.
  // Legacy tranche dates may be stored as "22 Oct", not ISO dates.
  return firstActiveTrancheDate || fallbackDate;
}

function renderPositionsTable(
  gross: number,
  totalComms: number,
  debtToUse: number,
  marginChargedToUse: number,
  entryDate?: string,
  dailyRate: number = 0
): void {
  setProjectionsPropsState({ gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate });
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

  setSummaryMetricsPropsState({ state, rules, refreshIntervalMs });


  if (isCombined) {
    const metrics = calculateCombinedMetrics(state, rules, tickers, dailyRate);

    setBoardTitle({
      title: tickers.length > 0
        ? `COMBINED PORTFOLIO (${tickers.length} Positions | ${metrics.netPct >= 0 ? '+' : ''}${metrics.netPct.toFixed(2)}% Net Target)`
        : 'NO ACTIVE MARGIN POSITIONS',
      showDailyMove: true
    });

    if (typeof onRenderAnalystConsensus === 'function' && tickers[0]) {
      onRenderAnalystConsensus(tickers[0]);
    }

    renderPositionsTable(
      metrics.totalGrossTarget,
      metrics.totalComms,
      metrics.totalDebt,
      metrics.totalMarginCharged,
      resolvePositionEntryDate(collectOpenPositionTranches(state.positions || {}), state.startDate),
      dailyRate
    );
  } else {
    const pos = (state.activeView ? state.positions?.[state.activeView] : undefined) || state.positions?.[tickers[0]];
    if (!pos) return;

    const metrics = calculatePositionMetrics(state, pos, rules, dailyRate);

    setBoardTitle({
      title: `${pos.ticker} (${pos.shares} Shares @ ${formatUSD(pos.pt)} PT | ${metrics.netPct >= 0 ? '+' : ''}${metrics.netPct.toFixed(2)}% Net Target)`,
      showDailyMove: false
    });

    if (typeof onRenderAnalystConsensus === 'function') {
      onRenderAnalystConsensus(pos.ticker);
    }

    renderPositionsTable(
      metrics.gross,
      metrics.totalComms,
      metrics.allocatedDebt,
      metrics.posMarginCharged,
      resolvePositionEntryDate(pos.tranches, pos.startDate || state.startDate),
      dailyRate
    );
  }
}

function prefillTerminalCommand(command: string): void {
  // The TradingConsole owns its controlled input and selection state.
  emitUiEvent('terminal:command-prefill', { command });
}

export interface RenderBoardOptions extends RenderCashCushionOptions {
  rules: BrokerRules;
  onSetActiveView?: (view: string) => void;
  onRefreshAllLivePrices?: () => void | Promise<void>;
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
  setActiveDeskViewState(currentView);

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';

  setTickerTabsPropsState({ state, onSetActiveView, onRefreshAllLivePrices });

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
    return;
  }

  if (isSettingsActive) {
    onRenderSettingsPanel();
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  onUpdateLastDeskView(currentView);


  if (tickers.length === 0) {
    setEmptyStatePropsState({
        onQuickBuy: () => {
          const todayIso = new Date().toISOString().split('T')[0];
          prefillTerminalCommand(`bought [shares] [TICKER] for [price] on [${todayIso}]`);
        },
        onAddCashStock: () => {
          prefillTerminalCommand('add cash stock [shares] [TICKER] for [price]');
        },
        onImportBackup: () => {
          emitUiEvent('terminal:backup-import-request');
        }
      } satisfies import('../components/EmptyStatePanel').EmptyStatePanelProps);
    onRenderConsoleQuickActions();
    return;
  }

  setEmptyStatePropsState(null);

  renderSummaryCards(state, {
    rules,
    refreshIntervalMs,
    onRenderExternalLinks,
    onRenderAnalystConsensus
  });

  onRenderExternalLinks();
  onRenderConsoleQuickActions();
}
