import React from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { formatUSD } from '../utils';

export function ClosedHistoryTable() {
  const { state } = usePortfolio();
  const trades = [...(state.closedTrades || [])].sort((a, b) => b.date - a.date);
  
  return (
    <div className="border-card p-6 rounded-lg space-y-4">
      <div className="flex flex-wrap justify-between items-end gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-lg font-black text-purple-300 tracking-wide">CLOSED TRADE HISTORY</h2>
          <p className="text-xs text-slate-400">Realized margin trades, including partial sales.</p>
        </div>
        <span className="text-xs text-slate-400 font-mono">{trades.length} realized exits</span>
      </div>
      <div className="table-scroll-wrapper overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-medium">
              <th className="py-2 px-3">Ticker</th>
              <th className="py-2 px-3">Date Closed</th>
              <th className="py-2 px-3 text-right">Shares</th>
              <th className="py-2 px-3 text-right">Duration</th>
              <th className="py-2 px-3 text-right">Fees &amp; Comm.</th>
              <th className="py-2 px-3 text-right">Net Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {trades.map((trade, idx) => (
              <tr key={idx} className="border-b border-slate-800/60 text-slate-300">
                <td className="py-2 px-3 font-bold text-white">{trade.ticker}</td>
                <td className="py-2 px-3 whitespace-nowrap">{new Date(trade.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{formatUSD(trade.shares)} shares</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">{trade.holdingDays} days</td>
                <td className="py-2 px-3 text-right whitespace-nowrap">${formatUSD(trade.feesAndCommissions)}</td>
                <td className={`py-2 px-3 text-right font-bold ${trade.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{trade.netProfit >= 0 ? '+' : '-'}${formatUSD(Math.abs(trade.netProfit))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
