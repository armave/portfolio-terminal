import React from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { getCashCushionTotal, formatUSD } from '../utils';

export function NavigationTabs() {
  const { state, setActiveView, getCombinedBreakeven } = usePortfolio();
  const tickers = Object.keys(state.positions || {});
  const isCushionActive = state.activeView === "CASH_CUSHION" || state.activeView === "BALANCE";
  const isClosedHistoryActive = state.activeView === "CLOSED_HISTORY";
  const cushionTotal = getCashCushionTotal(state);
  const closedTrades = state.closedTrades || [];

  return (
    <div className="board-header-banner border-b border-slate-800 pb-3 flex flex-wrap items-center gap-2 justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {tickers.length === 0 && !isCushionActive && !isClosedHistoryActive && (
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">NO ACTIVE TRADES</span>
        )}
        {tickers.length === 1 && (
          <button className={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === tickers[0] ? 'bg-emerald-600 text-black' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`} onClick={() => setActiveView(tickers[0])}>MARGIN: {tickers[0]}</button>
        )}
        {tickers.length > 1 && (
          <>
            <button className={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === "COMBINED" ? 'bg-emerald-600 text-black' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`} onClick={() => setActiveView("COMBINED")}>COMBINED PORTFOLIO</button>
            {tickers.map(t => (
              <button key={t} className={`px-3 py-1 rounded text-xs font-bold transition ${state.activeView === t ? 'bg-emerald-600 text-black' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`} onClick={() => setActiveView(t)}>{t}</button>
            ))}
          </>
        )}
        <button className={`px-3 py-1 rounded text-xs font-bold transition flex items-center gap-1.5 ${isCushionActive ? 'bg-cyan-500 text-black' : 'bg-slate-900 border border-cyan-800/60 text-cyan-400 hover:bg-slate-800'}`} onClick={() => setActiveView("CASH_CUSHION")}>
          <span>🛡️ BALANCE</span> <span className={`text-[10px] px-1.5 py-0.2 rounded ${isCushionActive ? 'bg-cyan-800 text-white' : 'bg-cyan-950 text-cyan-300 font-mono'}`}>+${formatUSD(cushionTotal)}</span>
        </button>
        <button className={`px-3 py-1 rounded text-xs font-bold transition ${isClosedHistoryActive ? 'bg-purple-500 text-black' : 'bg-slate-900 border border-purple-800/60 text-purple-300 hover:bg-slate-800'}`} onClick={() => setActiveView("CLOSED_HISTORY")}>
          CLOSED HISTORY ({closedTrades.length})
        </button>
      </div>
      <div className="text-sm font-semibold text-emerald-400 font-mono tracking-tight shrink-0">
        {getCombinedBreakeven()}
      </div>
    </div>
  );
}
