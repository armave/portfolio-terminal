import React from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { formatUSD, formatTrancheDate, getTotalPortfolioInvested, getCashCushionTotal } from '../utils';
import { calculateCommission, calculateMarginInterest } from '../domain/portfolio';

export function MarginDesk() {
  const { state, rules, setMarketInsightsOpen, marketInsightsOpen } = usePortfolio();
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === "COMBINED" || (tickers.length !== 1 && !state.positions[state.activeView]);
  const dailyRate = rules.annualRate / rules.dayCountBasis;

  let title = "NO ACTIVE MARGIN POSITIONS";
  let totalInvested = 0, totalMarketValue = 0, totalDebt = Math.abs(state.balance), totalComms = 0, totalMarginCharged = state.realizedMarginCharged || 0;
  let cushionTotal = getCashCushionTotal(state);
  let allocatedDebt = totalDebt, allocatedCushion = cushionTotal;
  let tranchesText = "None", investedText = "$0.00 | $0.00", priceHtml = "$0.00 | $0.00 – +$0.00 (+0.00%)";
  let marginText = `-$0.00`, commsText = "$0.00", marginChargedText = "$0.00";
  let equityText = "$0.00 (0.00%)";
  let activePos = null;

  if (isCombined && tickers.length > 0) {
    let totalCommBuy = 0, totalCommSell = 0, totalGrossTarget = 0;
    tickers.forEach(t => {
      const pos = state.positions[t];
      const cost = (pos.tranches || []).reduce((sum: number, tr: any) => sum + (tr.qty * tr.price), 0);
      totalInvested += cost;
      totalMarketValue += pos.shares * pos.currentPrice;
      totalCommBuy += pos.commBuy;
      const valSell = pos.shares * pos.pt;
      totalCommSell += calculateCommission(pos.shares, valSell, rules);
      totalGrossTarget += (valSell - cost);
    });
    const tranchesForCombined = state.tranches || tickers.flatMap(t => state.positions[t]?.tranches || []);
    totalMarginCharged += calculateMarginInterest(tranchesForCombined, { dailyRate, marginDebt: totalDebt, totalDebt });
    totalComms = totalCommBuy + totalCommSell;
    const net0 = totalGrossTarget - totalComms - totalMarginCharged;
    const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;
    const totalUnrealized = totalMarketValue - totalInvested;
    const unrealizedPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0;
    
    title = `COMBINED PORTFOLIO (${tickers.length} Positions | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Combined Target)`;
    tranchesText = tickers.map(t => `${t}: ${state.positions[t].shares}sh @ PT $${formatUSD(state.positions[t].pt)}`).join(' | ');
    investedText = `$${formatUSD(totalInvested)} | Across ${tickers.length} Assets`;
    const unSign = totalUnrealized >= 0 ? '+' : '';
    priceHtml = `$${formatUSD(totalMarketValue)} – <span class="${totalUnrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${unSign}$${formatUSD(totalUnrealized)} (${unSign}${unrealizedPct.toFixed(2)}%)</span>`;
    marginText = `-$${formatUSD(totalDebt)} ($${formatUSD(totalDebt * dailyRate)}/day @ ${(dailyRate * 100).toFixed(4)}%)`;
    commsText = `$${formatUSD(totalComms)} ($${formatUSD(totalCommBuy)} buy / $${formatUSD(totalCommSell)} sell)`;
    marginChargedText = `$${formatUSD(totalMarginCharged)}`;
    
    const totalAccountEquity = (totalMarketValue + cushionTotal) - totalDebt;
    const totalAccountAssets = totalMarketValue + cushionTotal;
    equityText = `$${formatUSD(totalAccountEquity)} (${totalAccountAssets > 0 ? ((totalAccountEquity / totalAccountAssets) * 100).toFixed(2) : 0}%)`;
  } else if (!isCombined) {
    const pos = state.positions[state.activeView] || state.positions[tickers[0]];
    if (pos) {
      activePos = pos;
      totalInvested = (pos.tranches || []).reduce((sum: number, t: any) => sum + (t.qty * t.price), 0);
      const avgPrice = pos.shares > 0 ? totalInvested / pos.shares : 0;
      const valSell = pos.shares * pos.pt;
      const commSell = calculateCommission(pos.shares, valSell, rules);
      totalComms = pos.commBuy + commSell;
      const gross = valSell - totalInvested;
      const portfolioInvested = getTotalPortfolioInvested(state);
      const weight = portfolioInvested > 0 ? (totalInvested / portfolioInvested) : 1;
      allocatedDebt = totalDebt * weight;
      allocatedCushion = cushionTotal * weight;
      totalMarginCharged = calculateMarginInterest(state.tranches || pos.tranches || [], { dailyRate, marginDebt: allocatedDebt, totalDebt });
      const net0 = gross - totalComms - totalMarginCharged;
      const netPct = totalInvested > 0 ? (net0 / totalInvested) * 100 : 0;
      totalMarketValue = pos.shares * pos.currentPrice;
      const unrealized = totalMarketValue - totalInvested;
      const unrealizedPct = avgPrice > 0 ? ((pos.currentPrice - avgPrice) / avgPrice) * 100 : 0;

      title = `${pos.ticker} (${pos.shares} Shares @ $${formatUSD(pos.pt)} PT | ${netPct >= 0 ? '+' : ''}${netPct.toFixed(2)}% Net Target)`;
      tranchesText = (pos.tranches && pos.tranches.length > 0) ? pos.tranches.map((t: any) => `${t.qty} @ $${formatUSD(t.price)} (${formatTrancheDate(t.date)})`).join(' + ') : "None";
      investedText = `$${formatUSD(totalInvested)} | $${formatUSD(avgPrice)}`;
      const unSign = unrealized >= 0 ? '+' : '';
      priceHtml = `$${formatUSD(pos.currentPrice)} | $${formatUSD(totalMarketValue)} – <span class="${unrealized >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${unSign}$${formatUSD(unrealized)} (${unSign}${unrealizedPct.toFixed(2)}%)</span>`;
      marginText = `-$${formatUSD(allocatedDebt)} ($${formatUSD(allocatedDebt * dailyRate)}/day)`;
      commsText = `$${formatUSD(totalComms)} ($${formatUSD(pos.commBuy)} buy / $${formatUSD(commSell)} sell)`;
      marginChargedText = `$${formatUSD(totalMarginCharged)} (Position To Date)`;
      
      const positionAssets = totalMarketValue + allocatedCushion;
      const positionEquity = positionAssets - allocatedDebt;
      equityText = `$${formatUSD(positionEquity)} (${positionAssets > 0 ? ((positionEquity / positionAssets) * 100).toFixed(2) : 0}%)`;
    }
  }

  return (
    <>
      <div className="board-title-row flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-lg font-bold text-white flex items-center gap-3">
          {title}
          {!isCombined && activePos && (
            <div className="flex gap-2">
              <a href={`https://finviz.com/quote.ashx?t=${activePos.ticker}`} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-900">Finviz</a>
              <a href={`https://stocktwits.com/symbol/${activePos.ticker}`} target="_blank" rel="noreferrer" className="text-[10px] text-cyan-400 hover:underline bg-cyan-950/50 px-2 py-0.5 rounded border border-cyan-900">Stocktwits</a>
            </div>
          )}
        </div>
        <div className="board-title-actions flex flex-wrap items-center gap-2">
          {!isCombined && <button onClick={() => setMarketInsightsOpen(!marketInsightsOpen)} className="rounded border border-cyan-800/70 bg-cyan-950/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300 transition hover:bg-cyan-900/50">{marketInsightsOpen ? 'HIDE INSIGHTS' : 'MARKET INSIGHTS'}</button>}
        </div>
      </div>
      <div className="portfolio-metrics-grid gap-2 text-xs text-slate-300">
        <div className="portfolio-metric px-3 py-1.5"><span className="portfolio-metric-label text-[10px]">Tranches / Holdings</span><span className="portfolio-metric-value text-xs sm:text-sm">{tranchesText}</span></div>
        <div className="portfolio-metric px-3 py-1.5"><span className="portfolio-metric-label text-[10px]">Total Invested | Avg</span><span className="portfolio-metric-value text-xs sm:text-sm">{investedText}</span></div>
        <div className="portfolio-metric px-3 py-1.5">
          <span className="portfolio-metric-label text-[10px]">Share Price | Market Value</span>
          <span className="portfolio-metric-value text-xs sm:text-sm text-emerald-400" dangerouslySetInnerHTML={{ __html: priceHtml }}></span>
        </div>
        <div className="portfolio-metric px-3 py-1.5"><span className="portfolio-metric-label text-[10px]">Margin Debt</span><span className="portfolio-metric-value text-xs sm:text-sm text-rose-300">{marginText}</span></div>
        <div className="portfolio-metric px-3 py-1.5"><span className="portfolio-metric-label text-[10px]">Total Commissions</span><span className="portfolio-metric-value text-xs sm:text-sm">{commsText}</span></div>
        <div className="portfolio-metric px-3 py-1.5"><span className="portfolio-metric-label text-[10px]">Margin Charged</span><span className="portfolio-metric-value text-xs sm:text-sm">{marginChargedText}</span></div>
        <div className="portfolio-risk-summary flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-300">
          <div><span className="text-slate-500">Account Equity:</span> <span className="text-white font-bold font-mono">{equityText}</span></div>
          <div><span className="text-slate-500">Allocated Cash / Collateral:</span> <span className="text-cyan-400 font-bold font-mono">+${formatUSD(allocatedCushion)}</span></div>
        </div>
      </div>
      
      {!isCombined && activePos && activePos.tranches && activePos.tranches.length > 0 && (
        <div className="mt-4 bg-slate-900/40 rounded-lg border border-slate-800 p-3">
          <h3 className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-wider">Active Tranches</h3>
          <div className="table-scroll-wrapper overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse min-w-[400px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-500">
                  <th className="py-1.5 px-2">Date</th>
                  <th className="py-1.5 px-2 text-right">Shares</th>
                  <th className="py-1.5 px-2 text-right">Price</th>
                  <th className="py-1.5 px-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {activePos.tranches.map((t: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-800/30">
                    <td className="py-1.5 px-2">{formatTrancheDate(t.date)}</td>
                    <td className="py-1.5 px-2 text-right">{t.qty}</td>
                    <td className="py-1.5 px-2 text-right">${formatUSD(t.price)}</td>
                    <td className="py-1.5 px-2 text-right">${formatUSD(t.qty * t.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
