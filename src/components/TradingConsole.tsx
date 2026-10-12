import React, { useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { useNotifications } from '../contexts/NotificationContext';
import { getActivePrice } from '../utils';

export function TradingConsole() {
  const { state, executeCommand } = usePortfolio();
  const { logs } = useNotifications();
  const [input, setInput] = useState('');

  const activeTicker = state.activeView !== "COMBINED" && state.activeView !== "CASH_CUSHION" && state.activeView !== "CLOSED_HISTORY" ? state.activeView : Object.keys(state.positions || {})[0];
  const activePos = activeTicker ? state.positions[activeTicker] : null;
  const activePrice = activePos ? (getActivePrice(activePos.quoteDetails) || activePos.currentPrice) : 0;

  const suggestions = activeTicker && activePrice > 0
    ? [`Buy 10 ${activeTicker} @ ${activePrice}`, `Sell all ${activeTicker}`, 'What is my breakeven?']
    : ['Buy 10 AAPL', 'Sell all', 'What is my breakeven?'];

  return (
    <div className="trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 max-w-2xl mx-auto w-full lg:max-w-none lg:mx-0">
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
        <span>Trading Console <span className="hidden sm:inline">(Deterministic Engine + Gemini AI)</span></span>
        <span className="text-slate-500 text-[8px]">READY</span>
      </div>
      <div className="h-64 overflow-y-auto bg-slate-950 p-3 rounded text-xs space-y-2 border border-slate-800/80 flex flex-col">
        {logs.map((log: any) => (
          <div key={log.id} className={log.isUser ? "text-cyan-400 font-semibold" : "text-slate-300"} dangerouslySetInnerHTML={log.isHtml ? { __html: log.content } : undefined}>
            {!log.isHtml && (log.isUser ? `> ${log.content}` : log.content)}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { executeCommand(input); setInput(''); } }} placeholder="e.g. sell today for [current price] vs sell 14 days later for [target price]" className="flex-1 bg-slate-900 border border-slate-700 text-xs px-3 py-2 rounded focus:outline-none focus:border-emerald-500 text-white" />
        <button onClick={() => { executeCommand(input); setInput(''); }} className="bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-4 py-2 rounded transition">Send</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {suggestions.map(cmd => (
          <button key={cmd} onClick={() => setInput(cmd)} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] px-2 py-1 rounded border border-slate-700 transition">{cmd}</button>
        ))}
      </div>
    </div>
  );
}
