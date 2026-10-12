import React, { useState, useEffect } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { proxyFetch } from '../services/api.js';

export function MarketInsightsDrawer() {
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
