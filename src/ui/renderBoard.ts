import {
  setBoardTitle, setCashCushionPropsState,
  setSummaryMetricsPropsState, setProjectionsPropsState
} from './uiStateStore';
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

export function resolveActiveView(state: BoardState): string {
  let currentView = state.activeView;
  if (!currentView || (!NON_POSITION_VIEWS.has(currentView) && !state.positions?.[currentView])) {
    currentView = 'COMBINED';
  }
  return currentView;
}

interface RenderCashCushionOptions {
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

interface RenderSummaryCardsOptions {
  rules: BrokerRules;
  refreshIntervalMs?: number;
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

  setSummaryMetricsPropsState({ rules, refreshIntervalMs });


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

export interface RenderBoardOptions extends RenderCashCushionOptions {
  rules: BrokerRules;
  onRenderAnalystConsensus?: (ticker: string) => void;
  onUpdateCombinedBreakeven?: () => void;
  lastDeskView?: string | null;
  onUpdateLastDeskView?: (view: string) => void;
}

export function renderBoard(state: BoardState, options: RenderBoardOptions): void {
  const {
    rules,
    onRenderAnalystConsensus = () => { },
    onUpdateCombinedBreakeven = () => { },
    refreshIntervalMs = 60000,
    onUpdateLastDeskView = () => { }
  } = options;

  if (!rules) return;

  const tickers = Object.keys(state.positions || {});
  const currentView = resolveActiveView(state);

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';

  // Hidden desks do not need their derived metrics or insights panel refreshed.
  // They will be updated when the user returns to a position/combined desk.
  if (!isCushionActive && !isClosedHistoryActive && !isSettingsActive) {
    onUpdateCombinedBreakeven();
  }


  if (isCushionActive) {
    
    onUpdateLastDeskView('CASH_CUSHION');
    renderCashCushion(state, { refreshIntervalMs });
    return;
  }

  if (isClosedHistoryActive) {
    onUpdateLastDeskView('CLOSED_HISTORY');
    return;
  }

  if (isSettingsActive) {
    onUpdateLastDeskView('SETTINGS');
    return;
  }

  onUpdateLastDeskView(currentView);


  if (tickers.length === 0) return;

  renderSummaryCards(state, {
    rules,
    refreshIntervalMs,
    onRenderAnalystConsensus
  });
}
