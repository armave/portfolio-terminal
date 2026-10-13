import React, { useState } from 'react';
import { usePortfolio } from '../store/PortfolioContext';

function formatCurrency(val: number): string {
  const sign = val < 0 ? '-' : '';
  const abs = Math.abs(val);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getActivePrice(quote: any, fallbackPrice?: number): { price: number; badge: string } {
  if (!quote) {
    return { price: fallbackPrice ?? 0, badge: '' };
  }

  const state = quote.marketState || quote.marketStateCode || '';
  if ((state === 'PRE' || state === 'PREPRE') && typeof quote.preMarketPrice === 'number') {
    return { price: quote.preMarketPrice, badge: 'Pre' };
  }
  if ((state === 'POST' || state === 'CLOSED') && typeof quote.postMarketPrice === 'number') {
    return { price: quote.postMarketPrice, badge: 'Post' };
  }
  if (typeof quote.current === 'number') {
    return { price: quote.current, badge: '' };
  }
  if (typeof quote.regularMarketPrice === 'number') {
    return { price: quote.regularMarketPrice, badge: '' };
  }
  return { price: fallbackPrice ?? 0, badge: '' };
}

export const BalanceTab: React.FC = () => {
  const {
    cashBalance,
    setCashBalance,
    cashHoldings,
    addCashStock,
    removeCashStock,
    positions,
    quotes
  } = usePortfolio();

  // Balance edit input
  const [balanceInput, setBalanceInput] = useState<string>(cashBalance.toString());

  // New cash stock row inputs
  const [tickerInput, setTickerInput] = useState<string>('');
  const [sharesInput, setSharesInput] = useState<string>('');
  const [priceInput, setPriceInput] = useState<string>('');

  // Calculate total margin debt from active positions
  const totalMarginDebt = positions.reduce((acc, p) => acc + (p.accruedMarginDebt || 0), 0);

  // Calculate market value per cash holding
  const holdingsWithMetrics = cashHoldings.map((h) => {
    const quote = quotes[h.ticker.toUpperCase()];
    const { price, badge } = getActivePrice(quote, h.entryPrice);
    const marketValue = h.shares * price;
    return {
      ...h,
      currentPrice: price,
      marketStateBadge: badge,
      marketValue
    };
  });

  const totalHoldingsMarketValue = holdingsWithMetrics.reduce((acc, h) => acc + h.marketValue, 0);
  const totalCushionValue = cashBalance + totalHoldingsMarketValue;

  const handleUpdateBalance = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(balanceInput);
    if (!isNaN(parsed)) {
      setCashBalance(parsed);
    }
  };

  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTicker = tickerInput.trim().toUpperCase();
    const sharesNum = parseFloat(sharesInput);
    const priceNum = priceInput ? parseFloat(priceInput) : undefined;

    if (!cleanTicker || isNaN(sharesNum) || sharesNum <= 0) return;

    addCashStock(cleanTicker, sharesNum, !isNaN(priceNum || NaN) ? priceNum : undefined);
    setTickerInput('');
    setSharesInput('');
    setPriceInput('');
  };

  return (
    <div className="border-card p-4 sm:p-6 rounded-xl space-y-4">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800 pb-3 gap-2">
        <div>
          <h2 className="text-lg font-black text-cyan-400 tracking-wide">CASH &amp; NON-MARGIN HOLDINGS</h2>
          <p className="text-xs text-slate-400">
            Unleveraged cash collateral, non-margin long positions, and equity allocations.
          </p>
        </div>
        <div className="text-left sm:text-right">
          <span className="text-xs text-slate-500 block">Cash + Holdings Cushion</span>
          <span className="text-xl font-bold text-cyan-300 font-mono">
            {formatCurrency(totalCushionValue)}
          </span>
        </div>
      </div>

      {/* Streamlined Balance Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
        <div className="flex items-center gap-3 text-xs font-mono flex-wrap">
          <span className="text-slate-300">
            Balance: <span className={cashBalance >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{formatCurrency(cashBalance)}</span>
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-rose-300">
            Margin Debt: <span className="font-bold">-{formatCurrency(totalMarginDebt).replace('-', '')}</span>
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-slate-400">
            {cashHoldings.length} holdings · {formatCurrency(totalHoldingsMarketValue)} market value
          </span>
        </div>

        <form onSubmit={handleUpdateBalance} className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 whitespace-nowrap">
            Signed balance:
          </span>
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
              $
            </span>
            <input
              type="number"
              step="0.01"
              required
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-xs pl-5 pr-2 py-1 rounded w-32 text-right text-emerald-300 font-mono font-bold focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="submit"
            className="bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold px-3 py-1 rounded border border-slate-600 transition"
          >
            Update
          </button>
        </form>
      </div>

      {/* Holdings Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-0 table-fixed text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-medium">
              <th className="w-[15%] py-2.5 px-3">Ticker</th>
              <th className="w-[15%] py-2.5 px-3 text-right">Shares</th>
              <th className="w-[20%] py-2.5 px-3 text-right">Price · Mkt</th>
              <th className="w-[18%] py-2.5 px-3 text-right">Market Value</th>
              <th className="w-[17%] py-2.5 px-3 text-right">Eq. Alloc</th>
              <th className="w-[15%] py-2.5 px-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {holdingsWithMetrics.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No cash holdings registered. Use the row below to log non-margin shares.
                </td>
              </tr>
            ) : (
              holdingsWithMetrics.map((holding) => {
                const allocPct = totalHoldingsMarketValue > 0
                  ? ((holding.marketValue / totalHoldingsMarketValue) * 100).toFixed(1)
                  : '0.0';

                return (
                  <tr key={holding.ticker} className="hover:bg-slate-900/30 transition">
                    <td className="py-2.5 px-3 font-bold text-white tracking-wide">
                      {holding.ticker}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {holding.shares.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      <span>{formatCurrency(holding.currentPrice)}</span>
                      {holding.marketStateBadge && (
                        <span className="text-[10px] text-cyan-400 font-bold ml-1.5 font-sans">
                          ({holding.marketStateBadge})
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right text-cyan-300 font-bold">
                      {formatCurrency(holding.marketValue)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-400">
                      {allocPct}%
                    </td>
                    <td className="py-2.5 px-3 text-center font-sans">
                      <button
                        type="button"
                        onClick={() => removeCashStock(holding.ticker)}
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 border border-rose-900/40 rounded px-2 py-0.5 text-[11px] transition"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>

          {/* Quick-Add Row Form */}
          <tbody className="border-t border-slate-800 bg-slate-900/40 font-sans">
            <tr>
              <td className="py-2 px-3">
                <input
                  type="text"
                  placeholder="TICKER"
                  required
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                  className="bg-slate-950 border border-slate-700 text-xs px-2.5 py-1 rounded text-white w-full uppercase focus:outline-none focus:border-cyan-500 font-mono"
                />
              </td>
              <td className="py-2 px-3 text-right">
                <input
                  type="number"
                  placeholder="Shares"
                  min="0.001"
                  step="any"
                  required
                  value={sharesInput}
                  onChange={(e) => setSharesInput(e.target.value)}
                  className="bg-slate-950 border border-slate-700 text-xs px-2.5 py-1 rounded text-white w-full text-right focus:outline-none focus:border-cyan-500 font-mono"
                />
              </td>
              <td className="py-2 px-3 text-right">
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs font-mono">
                    $
                  </span>
                  <input
                    type="number"
                    placeholder="Auto quote"
                    min="0.01"
                    step="0.01"
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="bg-slate-950 border border-slate-700 text-xs pl-5 pr-2 py-1 rounded text-white w-full text-right focus:outline-none focus:border-cyan-500 font-mono"
                  />
                </div>
              </td>
              <td className="py-2 px-3" colSpan={2}></td>
              <td className="py-2 px-3 text-center">
                <button
                  type="button"
                  onClick={handleAddStock}
                  className="bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold px-3 py-1 rounded transition whitespace-nowrap"
                >
                  + Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};