import React from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { formatUSD, getTotalPortfolioInvested, getActivePrice } from '../utils';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { calculateCommission, calculateCompoundedDebt, calculateMarginInterest, calculateAccruedFees } from '../domain/portfolio';

export function ProjectionTable() {
  const { state, rules } = usePortfolio();
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === "COMBINED" || (tickers.length !== 1 && !state.positions[state.activeView]);
  const dailyRate = rules.annualRate / rules.dayCountBasis;
  
  let debtToUse = 0, gross = 0, totalComms = 0, marginChargedToUse = 0, entryDate = state.startDate;
  let activePrice = 0;
  
  if (isCombined) {
    debtToUse = Math.abs(state.balance);
    tickers.forEach(t => {
      const pos = state.positions[t];
      const cost = (pos.tranches || []).reduce((sum: number, tr: any) => sum + (tr.qty * tr.price), 0);
      const valSell = pos.shares * pos.pt;
      gross += (valSell - cost);
      totalComms += (pos.commBuy || 0) + calculateCommission(pos.shares, valSell, rules);
    });
    const tranchesForCombined = state.tranches || tickers.flatMap(t => state.positions[t]?.tranches || []);
    marginChargedToUse = (state.realizedMarginCharged || 0) + calculateMarginInterest(tranchesForCombined, { dailyRate, marginDebt: debtToUse, totalDebt: debtToUse });
  } else {
    const pos = state.positions[state.activeView] || state.positions[tickers[0]];
    if (pos) {
      activePrice = getActivePrice(pos.quoteDetails) || pos.currentPrice;
      const totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
      const valSell = pos.shares * pos.pt;
      gross = valSell - totalInvested;
      totalComms = pos.commBuy + calculateCommission(pos.shares, valSell, rules);
      const portfolioInvested = getTotalPortfolioInvested(state);
      const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;
      debtToUse = Math.abs(state.balance) * weight;
      marginChargedToUse = calculateMarginInterest(state.tranches || pos.tranches || [], { dailyRate, marginDebt: debtToUse, totalDebt: Math.abs(state.balance) });
      entryDate = pos.startDate || state.startDate;
    }
  }

  const dates = getUsEquityProjectionDates(new Date(), entryDate);

  return (
    <div className="table-scroll-wrapper overflow-x-auto pt-2 max-w-2xl mx-auto w-full lg:max-w-none lg:mx-0">
      {(!isCombined && activePrice > 0 && gross > 0) && (
        <div className="text-[10px] text-slate-400 mb-2">
          Projecting exit at <span className="text-cyan-400 font-bold">${formatUSD(state.positions[state.activeView]?.pt)}</span> 
          (Current: ${formatUSD(activePrice)}, Delta: {(((state.positions[state.activeView]?.pt - activePrice) / activePrice) * 100).toFixed(2)}%)
        </div>
      )}
      <table className="w-full min-w-[300px] text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400">
            <th className="py-2 px-3 text-left">Date</th>
            <th className="py-2 px-3 text-right">P&L (Net)</th>
            <th className="py-2 px-3 text-right">Fee&Com</th>
            <th className="py-2 px-3 text-right">Margin Fee</th>
            <th className="py-2 px-3 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 font-mono">
          {(debtToUse > 0 || gross > 0) ? dates.map((item, idx) => {
            const { date, daysFromToday, kind } = item;
            const dateFormatted = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            if (kind === 'entry') {
              return (
                <tr key={idx} className="border-b border-slate-800/50 text-slate-500">
                  <td className="py-1.5 px-3 text-left projection-date-cell"><span className="text-[10px] font-medium text-slate-400">Entry</span><span className="text-[10px] text-slate-500 font-mono">{dateFormatted}</span></td>
                  <td colSpan={4} className="py-1.5 px-3 text-[10px] italic text-left">Position opened · projection values start today</td>
                </tr>
              );
            }
            const b_t = calculateCompoundedDebt(debtToUse, dailyRate, daysFromToday);
            const additionalAccrual = calculateMarginInterest(debtToUse, dailyRate, daysFromToday);
            const m_d = marginChargedToUse + additionalAccrual;
            const fee_c = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
            const net_p = gross - fee_c;
            const dr = b_t * dailyRate;
            const netClass = net_p >= 0 ? "text-emerald-400" : "text-rose-400";
            const netSign = net_p >= 0 ? "+" : "";
            
            return (
              <tr key={idx} className={kind === 'today' ? "bg-slate-900/80 font-bold" : "hover:bg-slate-900/40"}>
                <td className="py-2 px-3 text-left text-slate-300 font-semibold projection-date-cell">
                  <span>{dateFormatted}</span>
                  {kind === 'today' ? <span className="text-xs text-sky-400 font-mono">TODAY</span> : <span className="text-xs text-slate-500 font-mono">+{daysFromToday}d</span>}
                </td>
                <td className={`py-2 px-3 text-right ${netClass} font-semibold`}>{netSign}${formatUSD(net_p)}</td>
                <td className="py-2 px-3 text-right text-slate-200">${formatUSD(fee_c)}</td>
                <td className="py-2 px-3 text-right text-slate-400">${formatUSD(m_d)} (${formatUSD(dr)})</td>
                <td className="py-2 px-3 text-right text-rose-400">-${formatUSD(b_t)}</td>
              </tr>
            );
          }) : <tr><td colSpan={5} className="py-4 text-center text-slate-500 italic">No active position to project.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
