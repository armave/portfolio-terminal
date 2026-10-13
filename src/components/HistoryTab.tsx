import React from 'react';
import { usePortfolio } from '../store/PortfolioContext';

function formatCurrency(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const HistoryTab: React.FC = () => {
  const { closedTrades } = usePortfolio();

  const totalRealizedProfit = closedTrades.reduce((acc, t) => acc + (t.netProfit || 0), 0);
  const totalFeesPaid = closedTrades.reduce((acc, t) => acc + (t.totalFeesAndComms || 0), 0);

  const profitableTradesCount = closedTrades.filter((t) => (t.netProfit || 0) > 0).length;
  const winRate = closedTrades.length > 0
    ? ((profitableTradesCount / closedTrades.length) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="border-card p-4 sm:p-6 rounded-xl space-y-4">
      {/* Header and Summary Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
        <div>
          <h2 className="text-lg font-black text-purple-300 tracking-wide">CLOSED TRADE HISTORY</h2>
          <p className="text-xs text-slate-400">
            Realized positions including partial executions. Net profit includes broker commissions and financing fees.
          </p>
        </div>
        <div className="text-left sm:text-right font-mono text-xs">
          <span className="text-slate-500 block">Total Realized Net P&amp;L</span>
          <span
            className={`text-xl font-bold ${totalRealizedProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
          >
            {formatCurrency(totalRealizedProfit)}
          </span>
        </div>
      </div>

      {/* Stats Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800 text-xs font-mono">
        <div>
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Closed Trades</span>
          <span className="text-slate-200 font-bold">{closedTrades.length}</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Win Rate</span>
          <span className="text-cyan-400 font-bold">{winRate}%</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Total Fees &amp; Comms</span>
          <span className="text-slate-300 font-bold">{formatCurrency(totalFeesPaid)}</span>
        </div>
        <div>
          <span className="text-[10px] text-slate-500 block uppercase font-sans">Net P&amp;L</span>
          <span className={totalRealizedProfit >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
            {formatCurrency(totalRealizedProfit)}
          </span>
        </div>
      </div>

      {/* Trades Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[650px] table-fixed text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-medium">
              <th className="w-[15%] py-2.5 px-3">Ticker</th>
              <th className="w-[18%] py-2.5 px-3">Date Closed</th>
              <th className="w-[15%] py-2.5 px-3 text-right">Shares</th>
              <th className="w-[15%] py-2.5 px-3 text-right">Duration</th>
              <th className="w-[18%] py-2.5 px-3 text-right">Fees &amp; Comm.</th>
              <th className="w-[19%] py-2.5 px-3 text-right">Net Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {closedTrades.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  No closed margin trades logged in history.
                </td>
              </tr>
            ) : (
              closedTrades.map((trade, idx) => {
                const isProfit = (trade.netProfit || 0) >= 0;
                return (
                  <tr key={trade.id || `${trade.ticker}-${idx}`} className="hover:bg-slate-900/30 transition">
                    <td className="py-2.5 px-3 font-bold text-white tracking-wide">
                      {trade.ticker}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">
                      {trade.dateClosed || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {trade.shares?.toLocaleString() ?? 0}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400">
                      {trade.durationDays ?? 0} d
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400">
                      {formatCurrency(trade.totalFeesAndComms || 0)}
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {formatCurrency(trade.netProfit || 0)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};