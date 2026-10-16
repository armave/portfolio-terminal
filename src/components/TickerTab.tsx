import { BoardState, getCashCushionTotal } from '../ui/renderBoard';

export interface TickerTabsProps {
  state: BoardState;
  onSetActiveView?: (view: string) => void;
}

export function TickerTabs({ state, onSetActiveView }: TickerTabsProps) {
  const tickers = Object.keys(state.positions || {});
  const isCushionActive =
    state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isClosedHistoryActive = state.activeView === 'CLOSED_HISTORY';
  const isSettingsActive = state.activeView === 'SETTINGS';
  const isMarginDeskActive =
    !isCushionActive && !isClosedHistoryActive && !isSettingsActive;

  const cushionTotal = getCashCushionTotal(state);
  const closedTrades = state.closedTrades || [];

  const handleTabKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-nav-tab="true"]') || []
    );
    const currentIndex = buttons.indexOf(event.currentTarget as HTMLButtonElement);
    if (currentIndex < 0 || buttons.length < 2) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = buttons[(currentIndex + delta + buttons.length) % buttons.length];
    next.focus();
    next.click();
  };

  const handleRefreshQuotes = () => {
    if (
      typeof window !== 'undefined' &&
      typeof (window as any).refreshAllLivePrices === 'function'
    ) {
      (window as any).refreshAllLivePrices();
    }
  };

  return (
    <>
      {tickers.length > 0 && (
        <button
          id="refreshQuotesButton"
          type="button"
          title="Update quotes"
          onClick={handleRefreshQuotes}
          class="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
        >
          <span>↻</span>
        </button>
      )}

      {tickers.length === 0 && (
        <button
          type="button"
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
          onClick={() => onSetActiveView?.('COMBINED')}
          class={`px-3 py-1 rounded text-xs font-bold transition ${isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
        >
          MARGIN DESK
        </button>
      )}

      {tickers.length === 1 && (
        <button
          type="button"
          onClick={() => onSetActiveView?.(tickers[0])}
          class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0] && isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
        >
          MARGIN: {tickers[0]}
        </button>
      )}

      {tickers.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => onSetActiveView?.('COMBINED')}
            class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === 'COMBINED' && isMarginDeskActive
              ? 'bg-emerald-600 text-black'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
          >
            COMBINED PORTFOLIO
          </button>

          {tickers.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onSetActiveView?.(t)}
              class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t && isMarginDeskActive
                ? 'bg-emerald-600 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              {t}
            </button>
          ))}
        </>
      )}

      <button
        type="button"
        onClick={() => onSetActiveView?.('CASH_CUSHION')}
        class={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${isCushionActive
          ? 'bg-cyan-500 text-black'
          : 'bg-slate-900 border border-cyan-800/60 text-cyan-400 hover:bg-slate-800'
          }`}
      >
        <span>🛡️ BALANCE</span>
        <span
          class={`text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'
            }`}
        >
          +${cushionTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onSetActiveView?.('CLOSED_HISTORY')}
        class={`px-3 py-1 rounded text-xs font-bold transition ${isClosedHistoryActive
          ? 'bg-purple-500 text-black'
          : 'bg-slate-900 border border-purple-800/60 text-purple-300 hover:bg-slate-800'
          }`}
      >
        CLOSED HISTORY ({closedTrades.length})
      </button>

      <button
        id="settingsBtn"
        type="button"
        onClick={() => onSetActiveView?.('SETTINGS')}
        class={
          isSettingsActive
            ? 'px-3 py-1.5 rounded text-xs font-bold bg-blue-600 text-white transition'
            : 'px-3 py-1.5 rounded text-xs font-bold border-blue-600 text-white border border-slate-700 hover:bg-slate-800 transition'
        }
      >
        <span>⚙️ SETTINGS</span>
      </button>
    </>
  );
}