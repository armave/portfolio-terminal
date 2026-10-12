import React, { useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import { formatUSD, formatQuoteMetadata, DailyQuoteLabel, SentimentBadge, getActivePrice, getMarketStateBadge } from '../utils';

export function HoldingsTable() {
  const { state, mutateState, fetchLivePrice, cashHoldings, cashBalance } = usePortfolio();
  const [newTicker, setNewTicker] = useState('');
  const [newShares, setNewShares] = useState('');
  const [newPrice, setNewPrice] = useState('');

  const marginDebt = Math.abs(Number(state.balance) || 0);
  
  let stocksTotal = 0;
  cashHoldings.forEach((h: any) => { 
    const price = getActivePrice(h.quoteDetails) || Number(h.currentPrice ?? h.price) || 0;
    stocksTotal += (Number(h.shares) || 0) * price; 
  });

  const handleAddCashStock = () => {
    if (!newTicker || !newShares) return;
    const ticker = newTicker.toUpperCase();
    const shares = Number(newShares);
    const price = Number(newPrice) || 0;
    mutateState((draft: any) => {
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
          <span id="cushionTotalValue" className="text-xl font-bold text-cyan-300 font-mono">${formatUSD(cashBalance + stocksTotal)}</span>
        </div>
      </div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 py-1">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-slate-300 font-mono">Balance: ${formatUSD(cashBalance)} | Debt: -${formatUSD(marginDebt)}</span>
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
          <tbody id="cashStocksTableBody" className="divide-y divide-slate-800/60 font-mono">
            {cashHoldings.map((h: any, idx: number) => {
              const price = getActivePrice(h.quoteDetails) || Number(h.currentPrice ?? h.price) || 0;
              const badge = getMarketStateBadge(h.quoteDetails?.marketState);
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
                    <div className="flex items-center justify-end gap-1">
                      <span>${formatUSD(price)}</span>
                      {badge && <span className="text-[9px] bg-slate-800 text-slate-300 px-1 py-0.5 rounded uppercase">{badge}</span>}
                    </div>
                    <DailyQuoteLabel details={h.quoteDetails} />
                    <span className="mt-0.5 block text-[9px] font-normal text-slate-500">{formatQuoteMetadata(h)}</span>
                  </td>
                  <td className="py-2 px-3 text-right text-white font-semibold">${formatUSD(val)}</td>
                  <td className="py-2 px-3 text-center space-x-2">
                    <button onClick={() => fetchLivePrice(h.ticker)} className="text-cyan-400 hover:text-cyan-300 text-xs font-bold">↻</button>
                    <button onClick={() => mutateState((draft: any) => { draft.cashCushion.holdings.splice(idx, 1); })} className="text-rose-400 hover:text-rose-300 text-xs font-bold">Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tbody className="border-t border-slate-800 bg-slate-900/30">
            <tr>
              <td className="py-2 px-3">
                <input type="text" value={newTicker} onChange={e => setNewTicker(e.target.value)} placeholder="TICKER" className="bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-white w-full min-w-0 box-border uppercase focus:outline-none focus:border-cyan-500" />
              </td>
              <td className="py-2 px-3 text-right">
                <input type="number" value={newShares} onChange={e => setNewShares(e.target.value)} placeholder="Shares" min="0.01" step="0.01" className="number-input bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-white w-full min-w-0 box-border text-right font-mono tabular-nums focus:outline-none focus:border-cyan-500" />
              </td>
              <td className="py-2 px-3 text-right">
                <div className="w-full min-w-0 box-border relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">$</span>
                  <input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="Auto" min="0.01" step="0.01" className="number-input bg-slate-950 border border-slate-700 text-xs pl-4 pr-1 py-1 rounded text-white w-full min-w-0 box-border text-right font-mono tabular-nums focus:outline-none focus:border-cyan-500" />
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
