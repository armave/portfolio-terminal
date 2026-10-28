import { useState } from 'preact/hooks';
import type { BoardState } from '../types/portfolio';
import { getCashCushionTotal } from '../domain/portfolioSelectors';

export interface TickerTabsProps {
  state: BoardState;
  onSetActiveView?: (view: string) => void;
  onRefreshAllLivePrices?: () => void | Promise<void>;
}

export function TickerTabs({ state, onSetActiveView, onRefreshAllLivePrices }: TickerTabsProps) {
  const [isRefreshingQuotes, setIsRefreshingQuotes] = useState(false);
  const selectView = (view: string) => {
    // Persist at the actual navigation click site as well as through the store,
    // so a view change is durable even if a later render/hydration races it.
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('portfolio_active_view', view);
    } catch {
      // Continue navigation when storage is unavailable.
    }
    onSetActiveView?.(view);
    if (!['CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS'].includes(view) &&
        typeof window !== 'undefined') {
      window.dispatchEvent(new Event('tradenet:request-active-orders'));
    }
    // Entering or switching within the Margin workspace should pull fresh
    // quotes immediately instead of waiting for the polling interval.
    if (!['CASH_CUSHION', 'BALANCE', 'CLOSED_HISTORY', 'SETTINGS'].includes(view)) {
      void handleRefreshQuotes();
    }
  };

  const tickers = Object.keys(state.positions || {});
  const isCushionActive =
    state.activeView === 'CASH_CUSHION' || state.activeView === 'BALANCE';
  const isClosedHistoryActive = state.activeView === 'CLOSED_HISTORY';
  const isSettingsActive = state.activeView === 'SETTINGS';
  const isMarginDeskActive =
    !isCushionActive && !isClosedHistoryActive && !isSettingsActive;

  const cushionTotal = getCashCushionTotal(state);

  const handleTabKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentButton = event.currentTarget as HTMLButtonElement;
    const buttons = Array.from(
      currentButton.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-nav-tab="true"]') || []
    );
    const currentIndex = buttons.indexOf(currentButton);
    if (currentIndex < 0 || buttons.length < 2) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    next.focus();
    next.click();
  };

  const handleRefreshQuotes = async () => {
    if (isRefreshingQuotes) return;

    setIsRefreshingQuotes(true);
    try {
      await onRefreshAllLivePrices?.();
    } finally {
      setIsRefreshingQuotes(false);
    }
  };

  return (
    <>
      {tickers.length > 0 && (
        <button
          id="refreshQuotesButton"
          type="button"
          title="Update quotes"
          aria-label="Refresh live quotes"
          disabled={isRefreshingQuotes}
          onClick={handleRefreshQuotes}
          class="h-8 bg-slate-800 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center justify-center text-center gap-1"
        >
          <span>↻</span>
        </button>
      )}

      {tickers.length === 0 && (
        <button
          type="button"
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
          onClick={() => selectView('COMBINED')}
          aria-pressed={isMarginDeskActive}
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
          onClick={() => selectView(tickers[0])}
          aria-pressed={state.activeView === tickers[0]}
          class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0] && isMarginDeskActive
            ? 'bg-emerald-600 text-black'
            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
        >
          MARGIN: {tickers[0]}
        </button>
      )}

      {tickers.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => selectView('COMBINED')}
            aria-pressed={state.activeView === 'COMBINED'}
            class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === 'COMBINED' && isMarginDeskActive
              ? 'bg-emerald-600 text-black'
              : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
          >
            COMBINED PORTFOLIO
          </button>

          {tickers.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectView(t)}
              aria-pressed={state.activeView === t}
              class={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t && isMarginDeskActive
                ? 'bg-emerald-600 text-black'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
            >
              {t}
            </button>
          ))}
        </>
      )}

      <button
        type="button"
        onClick={() => selectView('BALANCE')}
        aria-pressed={isCushionActive}
        class={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${isCushionActive
          ? 'bg-cyan-500 text-black'
          : 'bg-slate-900 border border-cyan-800/60 text-cyan-400 hover:bg-slate-800'
          }`}
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
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
        onClick={() => selectView('CLOSED_HISTORY')}
        aria-pressed={isClosedHistoryActive}
        class={`px-3 py-1 rounded text-xs font-bold transition ${isClosedHistoryActive
          ? 'bg-purple-500 text-black'
          : 'bg-slate-900 border border-purple-800/60 text-purple-300 hover:bg-slate-800'
          }`}
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
      >
        CLOSED HISTORY
      </button>

      <button
        id="settingsBtn"
        type="button"
        aria-pressed={isSettingsActive}
        onClick={() => selectView('SETTINGS')}
        class={
          isSettingsActive
            ? 'px-3 py-1.5 rounded text-xs font-bold bg-blue-600 text-white transition'
            : 'px-3 py-1.5 rounded text-xs font-bold border-blue-600 text-white border border-slate-700 hover:bg-slate-800 transition'
        }
          data-nav-tab="true"
          onKeyDown={handleTabKeyDown}
      >
        <span>⚙️ SETTINGS</span>
      </button>
    </>
  );
}
