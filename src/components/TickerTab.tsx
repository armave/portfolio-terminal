import { useEffect } from 'preact/hooks';
import { getCashCushionTotal, BoardState } from '../ui/renderBoard';

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

  const cushionTotal = getCashCushionTotal(state);
  const closedTradesCount = (state.closedTrades || []).length;

  useEffect(() => {
    if (isCushionActive || isClosedHistoryActive || isSettingsActive) {
      return undefined;
    }

    if (tickers.length === 0 && state.activeView !== 'COMBINED') {
      const timer = setTimeout(() => onSetActiveView?.('COMBINED'), 0);
      return () => clearTimeout(timer);
    }

    if (tickers.length === 1 && state.activeView !== tickers[0]) {
      const timer = setTimeout(() => onSetActiveView?.(tickers[0]), 0);
      return () => clearTimeout(timer);
    }

    if (
      tickers.length > 1 &&
      state.activeView !== 'COMBINED' &&
      !state.positions?.[state.activeView || '']
    ) {
      const timer = setTimeout(() => onSetActiveView?.('COMBINED'), 0);
      return () => clearTimeout(timer);
    }

    return undefined;
  }, [
    tickers.length,
    state.activeView,
    isCushionActive,
    isClosedHistoryActive,
    isSettingsActive
  ]);

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
        <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">
          NO ACTIVE TRADES
        </span>
      )}

      {tickers.length === 1 && (
        <button
          type="button"
          onClick={() => onSetActiveView?.(tickers[0])}
          class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0]
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
            class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === 'COMBINED'
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
              class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t
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
        CLOSED HISTORY ({closedTradesCount})
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