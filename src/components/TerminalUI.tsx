import React, { useState, useEffect } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { useNotifications } from '../contexts/NotificationContext';
import { formatUSD, formatTrancheDate, getTotalPortfolioInvested, getCashCushionTotal, formatQuoteMetadata, DailyQuoteLabel, SentimentBadge } from '../utils';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { calculateCommission, calculateCompoundedDebt, calculateMarginInterest, calculateAccruedFees } from '../domain/portfolio';
import { proxyFetch } from '../services/api.js';
import { saveBrokerRules } from '../services/storage.js';

export function BrokerRulesForm() {
  const { rules, setRules } = usePortfolio();
  const { showToast } = useNotifications();
  const [formData, setFormData] = useState({
    annualRate: (rules.annualRate * 100).toFixed(2),
    dayCountBasis: String(rules.dayCountBasis),
    maintenanceMarginRatio: (rules.maintenanceMarginRatio * 100).toFixed(2),
    stopOutRatio: (rules.stopOutRatio * 100).toFixed(2),
    rolloverTime: `${String(rules.rolloverHour).padStart(2, '0')}:${String(rules.rolloverMinute).padStart(2, '0')}`,
    commPerShare: String(rules.commPerShare),
    commVolumePct: (rules.commVolumePct * 100).toFixed(2),
    minCommOrder: rules.minCommOrder.toFixed(2)
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const [rolloverHour, rolloverMinute] = formData.rolloverTime.split(':').map(Number);
    const updatedRules = {
      ...rules,
      annualRate: Number(formData.annualRate) / 100,
      dayCountBasis: Number(formData.dayCountBasis),
      maintenanceMarginRatio: Number(formData.maintenanceMarginRatio) / 100,
      stopOutRatio: Number(formData.stopOutRatio) / 100,
      rolloverHour,
      rolloverMinute,
      commPerShare: Number(formData.commPerShare),
      commVolumePct: Number(formData.commVolumePct) / 100,
      minCommOrder: Number(formData.minCommOrder)
    };
    if (updatedRules.stopOutRatio > updatedRules.maintenanceMarginRatio) {
      showToast('Stop-out equity must not exceed maintenance equity.', 'error');
      return;
    }
    setRules(updatedRules);
    saveBrokerRules(updatedRules);
    showToast('Broker assumptions saved in this browser.', 'success');
  };

  return (
    <details className="rounded border border-slate-800 bg-slate-950/40 p-3">
      <summary className="cursor-pointer text-xs font-bold text-slate-300 hover:text-cyan-300">Broker Rules</summary>
      <div className="mt-3">
        <form onSubmit={handleSubmit} className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-slate-500">Margin and commission rules (USD)</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Annual margin rate (%)
              <input name="annualRate" value={formData.annualRate} onChange={handleChange} type="number" min="0" max="100" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Interest day-count
              <select name="dayCountBasis" value={formData.dayCountBasis} onChange={handleChange} className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white">
                <option value="365">365 days</option>
                <option value="360">360 days</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Maintenance equity (%)
              <input name="maintenanceMarginRatio" value={formData.maintenanceMarginRatio} onChange={handleChange} type="number" min="0" max="99.99" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Stop-out equity (%)
              <input name="stopOutRatio" value={formData.stopOutRatio} onChange={handleChange} type="number" min="0" max="99.99" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Rollover time (ARM)
              <input name="rolloverTime" value={formData.rolloverTime} onChange={handleChange} type="time" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Commission / share ($)
              <input name="commPerShare" value={formData.commPerShare} onChange={handleChange} type="number" min="0" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Commission by value (%)
              <input name="commVolumePct" value={formData.commVolumePct} onChange={handleChange} type="number" min="0" max="100" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-slate-400">Min comm. / order ($)
              <input name="minCommOrder" value={formData.minCommOrder} onChange={handleChange} type="number" min="0" step="0.01" required className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-white" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="rounded bg-cyan-800 px-3 py-1.5 text-xs font-bold text-cyan-100 hover:bg-cyan-700">Save rules</button>
            <span className="text-[10px] text-slate-500">Saved in this browser. Confirm rates with your broker.</span>
          </div>
        </form>
      </div>
    </details>
  );
}

export function Toolbar() {
  const { syncCloudState, refreshAllLivePrices, refreshInterval, setRefreshInterval, cloudStatus } = usePortfolio();
  const [keysHidden, setKeysHidden] = useState(true);

  return (
    <div className="border-card p-4 sm:p-5 rounded-xl space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-emerald-400 tracking-wider">MARGIN DESK TERMINAL</h1>
          <span className="bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-black px-2 py-0.5 rounded tracking-wide">BROKER MODEL</span>
        </div>
        <div className="flex items-center gap-2">
          <span id="cloudStatusDot" className={`w-1.5 h-1.5 rounded-full ${cloudStatus.status === 'synced' ? 'bg-emerald-400' : cloudStatus.status === 'syncing' ? 'bg-amber-400 animate-pulse' : 'bg-slate-500'}`}></span>
          <span id="cloudStatusText" className="text-[10px] font-bold text-slate-400 tracking-wider">KV: {cloudStatus.text}</span>
        </div>
      </div>
      
      <BrokerRulesForm />

      <div className="terminal-toolbar flex flex-col lg:flex-row w-full items-center lg:divide-x divide-slate-700 gap-y-3 lg:gap-y-0 py-1">
        <div className="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2">
          <button onClick={() => setKeysHidden(!keysHidden)} className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs font-bold px-2.5 py-1 rounded transition">
            {keysHidden ? 'Show keys' : 'Hide keys'}
          </button>
          <button onClick={() => syncCloudState('pull')} className="h-8 bg-slate-800 hover:bg-slate-700 border border-purple-600 text-purple-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center gap-1">
            <span>☁↓</span> Pull
          </button>
        </div>
        <div className="flex-1 w-full flex flex-wrap items-center justify-center gap-1.5 lg:px-2">
          <button onClick={refreshAllLivePrices} className="h-8 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded transition flex items-center gap-1">
            <span>↻</span> Quotes
          </button>
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-500">
            Auto
            <select value={refreshInterval} onChange={e => setRefreshInterval(Number(e.target.value))} className="h-8 bg-slate-900 border border-slate-700 text-xs px-2 py-1 rounded text-slate-300 focus:outline-none focus:border-cyan-500">
              <option value="0">Off</option>
              <option value="15000">15 sec</option>
              <option value="30000">30 sec</option>
              <option value="60000">1 min</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
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
        <div className="min-w-0 flex-1 text-lg font-bold text-white">{title}</div>
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
    </>
  );
}

export function ProjectionTable() {
  const { state, rules } = usePortfolio();
  const tickers = Object.keys(state.positions || {});
  const isCombined = state.activeView === "COMBINED" || (tickers.length !== 1 && !state.positions[state.activeView]);
  const dailyRate = rules.annualRate / rules.dayCountBasis;
  
  let debtToUse = 0, gross = 0, totalComms = 0, marginChargedToUse = 0, entryDate = state.startDate;
  
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

export function Console() {
  const { executeCommand } = usePortfolio();
  const { logs } = useNotifications();
  const [input, setInput] = useState('');

  return (
    <div className="trading-console-card border-card p-4 sm:p-5 rounded-xl space-y-3 max-w-2xl mx-auto w-full lg:max-w-none lg:mx-0">
      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex justify-between items-center">
        <span>Trading Console <span className="hidden sm:inline">(Deterministic Engine + Gemini AI)</span></span>
        <span className="text-slate-500 text-[8px]">READY</span>
      </div>
      <div className="h-64 overflow-y-auto bg-slate-950 p-3 rounded text-xs space-y-2 border border-slate-800/80 flex flex-col">
        {logs.map(log => (
          <div key={log.id} className={log.isUser ? "text-cyan-400 font-semibold" : "text-slate-300"} dangerouslySetInnerHTML={log.isHtml ? { __html: log.content } : undefined}>
            {!log.isHtml && (log.isUser ? `> ${log.content}` : log.content)}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { executeCommand(input); setInput(''); } }} placeholder="e.g. sell today for [current price] vs sell 14 days later for [target price]" className="flex-1 bg-slate-900 border border-slate-700 text-xs px-3 py-2 rounded focus:outline-none focus:border-emerald-500 text-white" />
        <button onClick={() => { executeCommand(input); setInput(''); }} className="bg-emerald-600 hover:bg-emerald-500 text-black text-xs font-bold px-4 py-2 rounded transition">Send</button>
      </div>
    </div>
  );
}

export function Holdings({ type }: { type: 'cushion' | 'history' }) {
  const { state, mutateState, fetchLivePrice } = usePortfolio();
  const [newTicker, setNewTicker] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newPrice, setNewPrice] = useState('');
  
  if (type === 'history') {
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

  const freeCash = Number(state.cashCushion?.freeCash) || 0;
  const marginDebt = Math.abs(Number(state.balance) || 0);
  const holdings = state.cashCushion?.holdings || [];
  let stocksTotal = 0;
  holdings.forEach((h: any) => { stocksTotal += (Number(h.shares) || 0) * (Number(h.currentPrice ?? h.price) || 0); });

  const handleAddCashStock = () => {
    if (!newTicker || !newShares) return;
    const ticker = newTicker.toUpperCase();
    const shares = Number(newShares);
    const price = Number(newPrice) || 0;
    mutateState(draft => {
      if (!draft.cashCushion) draft.cashCushion = { freeCash: 0, holdings: [] };
      const existing = draft.cashCushion.holdings.find((h: any) => h.ticker === ticker);
      if (existing) {
        existing.shares = (Number(existing.shares) || 0) + shares;
      } else {
        draft.cashCushion.holdings.push({ ticker, shares, price });
      }
    });
    setNewTicker('');
    setNewShares('');
    setNewPrice('');
    setTimeout(() => fetchLivePrice(ticker), 100);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
        <div><h2 className="text-lg font-black text-cyan-400 tracking-wide">CASH &amp; NON-MARGIN HOLDINGS</h2></div>
        <div className="text-right">
          <span className="text-xs text-slate-500 block">Cash + Holdings</span>
          <span className="text-xl font-bold text-cyan-300 font-mono">${formatUSD(freeCash + stocksTotal)}</span>
        </div>
      </div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-300 font-mono">Balance: ${formatUSD(freeCash)} | Debt: -${formatUSD(marginDebt)}</span>
        </div>
      </div>
      <div className="table-scroll-wrapper overflow-x-auto">
        <table className="w-full min-w-0 table-fixed text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 font-medium">
              <th className="w-[15%] py-2 px-2">Ticker</th>
              <th className="w-[15%] py-2 px-2 text-right">Shares</th>
              <th className="w-[20%] py-2 px-2 text-right">Price · Mkt</th>
              <th className="w-[15%] py-2 px-2 text-right">Market Value</th>
              <th className="w-[15%] py-2 px-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {holdings.map((h: any, idx: number) => {
              const price = Number(h.currentPrice ?? h.price) || 0;
              const val = (Number(h.shares) || 0) * price;
              return (
                <tr key={idx} className="hover:bg-slate-900/40">
                  <td className="py-2 px-3 text-cyan-300 font-bold">
                    <div className="inline-flex items-center gap-1.5">
                      <span>{h.ticker}</span>
                      <SentimentBadge direction={Number.isFinite(h.quoteDetails?.change) ? (h.quoteDetails.change > 0 ? 'bullish' : h.quoteDetails.change < 0 ? 'bearish' : 'neutral') : 'unknown'} />
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap">{Number(h.shares).toLocaleString('en-US', { maximumFractionDigits: 3 })}</td>
                  <td className="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums">
                    <span>${formatUSD(price)}</span>
                    <DailyQuoteLabel details={h.quoteDetails} />
                    <span className="mt-0.5 block text-[9px] font-normal text-slate-500">{formatQuoteMetadata(h)}</span>
                  </td>
                  <td className="py-2 px-3 text-right text-white font-semibold">${formatUSD(val)}</td>
                  <td className="py-2 px-3 text-center space-x-2">
                    <button onClick={() => fetchLivePrice(h.ticker)} className="text-cyan-400 hover:text-cyan-300 text-xs font-bold">↻</button>
                    <button onClick={() => mutateState(draft => { draft.cashCushion.holdings.splice(idx, 1); })} className="text-rose-400 hover:text-rose-300 text-xs font-bold">Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tbody className="border-t border-slate-800 bg-slate-900/30">
            <tr>
              <td className="py-2 px-3">
                <input type="text" value={newTicker} onChange={e => setNewTicker(e.target.value)} placeholder="TICKER" className="bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-white w-full min-w-0 uppercase focus:outline-none focus:border-cyan-500" />
              </td>
              <td className="py-2 px-3 text-right">
                <input type="number" value={newShares} onChange={e => setNewShares(e.target.value)} placeholder="Shares" min="0.01" step="0.01" className="number-input bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-white w-full min-w-0 text-right font-mono tabular-nums focus:outline-none focus:border-cyan-500" />
              </td>
              <td className="py-2 px-3 text-right">
                <div className="w-full min-w-0 relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                  <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Auto" min="0.01" step="0.01" className="number-input bg-slate-950 border border-slate-700 text-xs pl-4 pr-1 py-1 rounded text-white w-full min-w-0 text-right font-mono tabular-nums focus:outline-none focus:border-cyan-500" />
                </div>
              </td>
              <td className="py-2 px-3" colSpan={1}></td>
              <td className="py-2 px-3 text-center">
                <button type="button" onClick={handleAddCashStock} className="bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold px-2 py-1 rounded transition whitespace-nowrap">+ Add</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Insights() {
  const { marketInsightsOpen, activeInsightSection, setActiveInsightSection, state } = usePortfolio();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticker = state.activeView !== "COMBINED" && state.activeView !== "CASH_CUSHION" && state.activeView !== "CLOSED_HISTORY" ? state.activeView : Object.keys(state.positions || {})[0];

  useEffect(() => {
    if (!marketInsightsOpen || !ticker) return;
    let isMounted = true;
    setLoading(true);
    setError(null);

    const fetchData = async () => {
      try {
        const endpoint = activeInsightSection === 'news' ? 'news' : '';
        const result = await proxyFetch(endpoint, { symbol: ticker }, { method: 'POST' });
        if (isMounted) setData(result);
      } catch (err: any) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, [marketInsightsOpen, activeInsightSection, ticker]);

  if (!marketInsightsOpen) return null;

  const renderContent = () => {
    if (loading) return <div className="py-4 text-center text-xs text-slate-500 font-mono animate-pulse">Loading live data...</div>;
    if (error) return <div className="py-3 text-rose-400 text-xs">Failed to load insights: {error}</div>;
    if (!data) return <div className="py-4 text-center text-xs text-slate-500">No data available.</div>;

    if (activeInsightSection === 'news') {
      if (!Array.isArray(data) || data.length === 0) return <div className="py-3 text-slate-500 text-xs">No recent news found.</div>;
      return (
        <div className="space-y-2 mt-2">
          {data.slice(0, 5).map((n: any, i: number) => (
            <a key={i} href={n.url} target="_blank" rel="noopener noreferrer" className="block bg-slate-900/60 p-2.5 rounded border border-slate-800 hover:border-cyan-800 transition">
              <div className="text-[10px] text-cyan-400 mb-1">{new Date(n.datetime * 1000).toLocaleDateString()} · {n.source || 'News'}</div>
              <div className="text-slate-200 text-xs font-semibold leading-snug">{n.headline}</div>
            </a>
          ))}
        </div>
      );
    }

    if (activeInsightSection === 'fundamentals') {
      const val = data.valuation || {};
      const fh = data.financialHealth || {};
      return (
        <div className="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">Trailing P/E</span><span className="text-white font-bold">{val.peTrailing ? Number(val.peTrailing).toFixed(2) : '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">Forward P/E</span><span className="text-white font-bold">{val.peForward ? Number(val.peForward).toFixed(2) : '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">PEG Ratio</span><span className="text-white font-bold">{val.pegRatio ?? '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">Short % Float</span><span className="text-amber-400 font-bold">{val.shortPercentOfFloat ?? '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">Profit Margin</span><span className="text-white font-bold">{fh.profitMargin ?? '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">ROE</span><span className="text-white font-bold">{fh.returnOnEquity ?? '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">Price to Book</span><span className="text-white font-bold">{val.priceToBook ?? '—'}</span></div>
            <div className="bg-slate-900/70 p-2 rounded border border-slate-800/80"><span className="text-[10px] text-slate-500 uppercase block">Total Debt</span><span className="text-rose-400 font-bold">{fh.totalDebt ? '$' + (fh.totalDebt / 1e9).toFixed(2) + 'B' : '—'}</span></div>
          </div>
        </div>
      );
    }

    if (activeInsightSection === 'analysts') {
      const t = data.analystTargets || {};
      const upDown = data.upgradesDowngrades || [];
      return (
        <div className="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-slate-800/60 pb-3">
            <div><span className="text-slate-500 block text-[10px]">Mean Target</span><span className="text-emerald-400 font-bold">${t.mean ? t.mean.toFixed(2) : '—'}</span></div>
            <div><span className="text-slate-500 block text-[10px]">High Target</span><span className="text-emerald-400 font-bold">${t.high ? t.high.toFixed(2) : '—'}</span></div>
            <div><span className="text-slate-500 block text-[10px]">Low Target</span><span className="text-rose-400 font-bold">${t.low ? t.low.toFixed(2) : '—'}</span></div>
            <div><span className="text-slate-500 block text-[10px]">Consensus</span><span className="text-cyan-300 font-bold uppercase">{t.consensusRecommendation || '—'}</span></div>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block mb-2">Recent Firm Actions</span>
            {upDown.length > 0 ? upDown.slice(0, 4).map((u: any, i: number) => (
              <div key={i} className="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0">
                <span className="text-slate-300">{u.firm}</span>
                <span className={`text-[10px] font-bold ${u.action === 'up' ? 'text-emerald-400' : u.action === 'down' ? 'text-rose-400' : 'text-cyan-400'}`}>{(u.action || '').toUpperCase()}: {u.fromGrade || ''} ➝ {u.toGrade || ''}</span>
              </div>
            )) : <div className="text-slate-500">No recent actions</div>}
          </div>
        </div>
      );
    }

    if (activeInsightSection === 'earnings') {
      const cal = data.calendar || {};
      const eh = data.earningsHistory || [];
      return (
        <div className="p-3 bg-slate-950/60 rounded border border-slate-800 space-y-3 font-mono text-xs mt-2">
          <div className="bg-slate-900/70 p-2.5 rounded border border-slate-800/80 mb-3">
            <span className="text-[10px] text-slate-500 uppercase block">Next Earnings Date</span>
            <span className="text-purple-300 font-bold text-sm">{cal.earningsDate || 'TBD'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block mb-2">Past Earnings Surprises</span>
            {eh.length > 0 ? eh.map((e: any, i: number) => (
              <div key={i} className="flex justify-between items-center border-b border-slate-800/60 py-1.5 last:border-0">
                <span className="text-slate-300 font-bold">{e.quarter}</span>
                <span className="text-[10px]">Est: {e.epsEstimate} | Act: <span className={`${e.epsDifference >= 0 ? 'text-emerald-400' : 'text-rose-400'} font-bold`}>{e.epsActual}</span> ({e.surprisePercent})</span>
              </div>
            )) : <div className="text-slate-500">No recent earnings history</div>}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <section className="space-y-4 rounded-lg border border-cyan-900/50 bg-gradient-to-br from-slate-900/80 to-slate-950/90 p-4 shadow-lg shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-100">Market insights <span className="text-cyan-300">· {ticker}</span></h2>
          </div>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto border-b border-slate-800 pb-2">
        {['news', 'fundamentals', 'earnings', 'analysts'].map(tab => (
          <button key={tab} onClick={() => setActiveInsightSection(tab)} className={`insight-tab whitespace-nowrap rounded px-3 py-1.5 text-[10px] font-bold transition ${activeInsightSection === tab ? 'bg-cyan-400 text-slate-950 shadow-sm shadow-cyan-950' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
      {renderContent()}
    </section>
  );
}
