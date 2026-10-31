import { setBoardTitle } from './uiStateStore';
import {
  calculateCombinedMetrics,
  calculatePositionMetrics
} from '../domain/portfolioSelectors';
export { resolvePositionEntryDate } from '../domain/portfolioSelectors';
import { formatUSD } from '../utils/formatters';
export { formatUSD } from '../utils/formatters';
import {
  BrokerRules,
  PositionRecord,
  BoardState
} from '../types/portfolio';

export type {
  PositionRecord,
  BoardState
};

const NON_POSITION_VIEWS = new Set(['COMBINED', 'CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'GUEST_HISTORY', 'SETTINGS']);

export function resolveActiveView(state: BoardState): string {
  let currentView = state.activeView;
  if (!currentView || (!NON_POSITION_VIEWS.has(currentView) && !state.positions?.[currentView])) {
    currentView = 'COMBINED';
  }
  return currentView;
}

interface RenderSummaryCardsOptions {
  rules: BrokerRules;
  onRenderAnalystConsensus?: (ticker: string) => void;
}


function renderSummaryCards(
  state: BoardState,
  options: RenderSummaryCardsOptions
): void {
  const { rules, onRenderAnalystConsensus } = options;
  if (!rules) return;

  const dailyRate = rules.annualRate / rules.dayCountBasis;
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === 'COMBINED' || (tickers.length !== 1 && !state.positions?.[state.activeView || '']);

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


  }
}

export interface RenderBoardOptions {
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
    onUpdateLastDeskView = () => { }
  } = options;

  if (!rules) return;

  const tickers = Object.keys(state.positions || {});
  const currentView = resolveActiveView(state);

  const isCushionActive = currentView === 'CASH_CUSHION' || currentView === 'BALANCE';
  const isClosedHistoryActive = currentView === 'CLOSED_HISTORY';
  const isGuestHistoryActive = currentView === 'GUEST_HISTORY';
  const isSettingsActive = currentView === 'SETTINGS';

  // Hidden desks do not need their derived metrics or insights panel refreshed.
  // They will be updated when the user returns to a position/combined desk.
  if (!isCushionActive && !isClosedHistoryActive && !isGuestHistoryActive && !isSettingsActive) {
    onUpdateCombinedBreakeven();
  }


  if (isCushionActive) {
    
    onUpdateLastDeskView('CASH_CUSHION');
    return;
  }

  if (isClosedHistoryActive) {
    onUpdateLastDeskView('CLOSED_HISTORY');
    return;
  }

  if (isGuestHistoryActive) {
    onUpdateLastDeskView('GUEST_HISTORY');
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
    onRenderAnalystConsensus
  });
}
