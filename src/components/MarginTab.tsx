import React, { useState, useMemo } from 'react';
import { usePortfolio } from '../store/PortfolioContext';
import type { MarginPosition } from '../types/portfolio';

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

export const MarginTab: React.FC = () => {
  const {
    positions,
    quotes,
    brokerAssumptions,
    cashBalance,
    cashHoldings
  } = usePortfolio();

  const [selectedTicker, setSelectedTicker] = useState<string>('COMBINED');

  // List of active tickers
  const tickerList = useMemo(() => {
    return positions.map((p) => p.ticker.toUpperCase());
  }, [positions]);

  // Aggregate metrics per position
  const positionsMetrics = useMemo(() => {
    return positions.map((pos) => {
      const tickerUpper = pos.ticker.toUpperCase();
      const quote = quotes[tickerUpper];
      const totalShares = pos.tranches.reduce((sum, t) => sum + (t.shares || 0), 0);
      const totalInvested = pos.tranches.reduce((sum, t) => sum + (t.shares * t.entryPrice || 0), 0);
      const avgEntryPrice = totalShares > 0 ? totalInvested / totalShares : 0;
      const totalComms = pos.tranches.reduce((sum, t) => sum + (t.commission || 0), 0);

      const { price: currentPrice, badge } = getActivePrice(quote, avgEntryPrice);
      const marketValue = totalShares * currentPrice;
      const netPnL = marketValue - totalInvested - totalComms - (pos.accruedMarginDebt || 0);

      return {
        ...pos,
        totalShares,
        totalInvested,
        avgEntryPrice,
        totalComms,
        currentPrice,
        priceBadge: badge,
        marketValue,
        netPnL
      };
    });
  }, [positions, quotes]);

  // Selected view metrics (Combined vs single ticker)
  const activeMetrics = useMemo(() => {
    if (selectedTicker === 'COMBINED') {
      const totalInvested = positionsMetrics.reduce((s, p) => s + p.totalInvested, 0);
      const totalMarketValue = positionsMetrics.reduce((s, p) => s + p.marketValue, 0);
      const totalDebt = positionsMetrics.reduce((s, p) => s + (p.accruedMarginDebt || 0), 0);
      const totalComms = positionsMetrics.reduce((s, p) => s + p.totalComms, 0);
      const totalNetPnL = totalMarketValue - totalInvested - totalComms - totalDebt;
      const totalTranches = positions.reduce((s, p) => s + p.tranches.length, 0);

      return {
        title: 'COMBINED PORTFOLIO',
        tranchesCount: totalTranches,
        totalInvested,
        avgPrice: 0,
        currentPrice: 0,
        priceBadge: '',
        marketValue: totalMarketValue,
        marginDebt: totalDebt,
        commissions: totalComms,
        netPnL: totalNetPnL,
        isCombined: true
      };
    }

    const current = positionsMetrics.find((p) => p.ticker.toUpperCase() === selectedTicker);
    if (!current) {
      return null;
    }

    return {
      title: `${current.ticker.toUpperCase()} POSITION`,
      tranchesCount: current.tranches.length,
      totalInvested: current.totalInvested,
      avgPrice: current.avgEntryPrice,
      currentPrice: current.currentPrice,
      priceBadge: current.priceBadge,
      marketValue: current.marketValue,
      marginDebt: current.accruedMarginDebt || 0,
      commissions: current.totalComms,
      netPnL: current.netPnL,
      isCombined: false
    };
  }, [selectedTicker, positionsMetrics, positions]);

  // Total cushion value (Cash + Non-margin holdings)
  const totalCushionValue = useMemo(() => {
    const holdingsVal = cashHoldings.reduce((sum, h) => {
      const q = quotes[h.ticker.toUpperCase()];
      const { price } = getActivePrice(q, h.entryPrice);
      return sum + h.shares * price;
    }, 0);
    return cashBalance + holdingsVal;
  }, [cashBalance, cashHoldings, quotes]);

  // Account Equity & Risk Triggers
  const totalPortfolioMarketValue = positionsMetrics.reduce((s, p) => s + p.marketValue, 0);
  const totalMarginDebt = positionsMetrics.reduce((s, p) => s + (p.accruedMarginDebt || 0), 0);
  const accountEquity = totalPortfolioMarketValue + totalCushionValue - totalMarginDebt;

  // Margin Call & Stop-Out triggers
  const maintenanceRequirement = totalPortfolioMarketValue * brokerAssumptions.maintenanceMarginRatio;
  const stopOutRequirement = totalPortfolioMarketValue * brokerAssumptions.stopOutRatio;

  const isMarginCall = totalMarginDebt > 0 && accountEquity < maintenanceRequirement;
  const isStopOut = totalMarginDebt > 0 && accountEquity < stopOutRequirement;

  // Projection Table forward calculation (Next 10 days)
  const projections = useMemo(() => {
    if (!activeMetrics || activeMetrics.marginDebt <= 0) return [];

    const dailyRate = brokerAssumptions.annualMarginRate / brokerAssumptions.interestDayCount / 100;
    const dailyFee = activeMetrics.marginDebt * dailyRate;

    const rows = [];
    let accumulatedMarginFee = 0;
    const today = new Date();

    for (let day = 0; day <= 10; day++) {
      const dateObj = new Date(today);
      dateObj.setDate(today.getDate() + day);
      const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

      accumulatedMarginFee = dailyFee * day;
      const netPnLAtDate = activeMetrics.netPnL - accumulatedMarginFee;
      const projectedBalance = accountEquity - accumulatedMarginFee;

      rows.push({
        date: day === 0 ? 'Today' : dateStr,
        netPnL: netPnLAtDate,
        totalFees: activeMetrics.commissions,
        marginFee: accumulatedMarginFee,
        balance: projectedBalance
      });
    }

    return rows;
  }, [activeMetrics, brokerAssumptions, accountEquity]);

  if (positions.length === 0) {
    return (
      <div className="border-card p-6 sm:p-8 rounded-xl space-y-4">
        <div className="border border-dashed border-slate-700 bg-slate-900/40 rounded-lg p-6 text-center space-y-2">
          <div className="text-lg font-black text-slate-100 tracking-wide">NO ACTIVE MARGIN POSITIONS</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Pull your cloud backup from the <strong className="text-emerald-400">Settings</strong> tab or add non-margin collateral in the <strong className="text-cyan-400">Balance</strong> tab to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border-card p-4 sm:p-6 rounded-xl space-y-4">
      {/* Ticker Sub-Tabs */}
      <div className="border-b border-slate-800 pb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedTicker('COMBINED')}
            className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${selectedTicker === 'COMBINED'
                ? 'bg-emerald-600 text-black shadow-sm'
                : 'bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800'
              }`}
          >
            Combined
          </button>
          {tickerList.map((ticker) => {
            const isSelected = selectedTicker === ticker;
            return (
              <button
                key={ticker}
                type="button"
                onClick={() => setSelectedTicker(ticker)}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all font-mono ${isSelected
                    ? 'bg-cyan-600 text-black shadow-sm'
                    : 'bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800'
                  }`}
              >
                {ticker}
              </button>
            );
          })}
        </div>

        <div className="text-xs font-mono font-bold text-emerald-400">
          Equity Buffer: {formatCurrency(accountEquity - maintenanceRequirement)}
        </div>
      </div>

      {/* Main Board Metrics Grid */}
      {activeMetrics && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white tracking-wide">{activeMetrics.title}</h2>
            <div className="text-xs font-mono text-slate-400">
              Net Target P&amp;L:{' '}
              <span className={`font-bold ${activeMetrics.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatCurrency(activeMetrics.netPnL)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
            {/* Metric 1 */}
            <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Tranches
              </span>
              <span className="text-sm font-mono font-bold text-white mt-1">
                {activeMetrics.tranchesCount} tranche{activeMetrics.tranchesCount === 1 ? '' : 's'}
              </span>
            </div>

            {/* Metric 2 */}
            <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Total Invested
              </span>
              <span className="text-sm font-mono font-bold text-slate-200 mt-1">
                {formatCurrency(activeMetrics.totalInvested)}
                {!activeMetrics.isCombined && (
                  <span className="text-[10px] text-slate-400 block font-normal">
                    Avg: {formatCurrency(activeMetrics.avgPrice)}
                  </span>
                )}
              </span>
            </div>

            {/* Metric 3 */}
            <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Market Value
              </span>
              <span className="text-sm font-mono font-bold text-cyan-300 mt-1">
                {formatCurrency(activeMetrics.marketValue)}
                {!activeMetrics.isCombined && (
                  <span className="text-[10px] text-slate-400 block font-normal">
                    Price: {formatCurrency(activeMetrics.currentPrice)}
                    {activeMetrics.priceBadge && (
                      <span className="text-cyan-400 font-bold ml-1">({activeMetrics.priceBadge})</span>
                    )}
                  </span>
                )}
              </span>
            </div>

            {/* Metric 4 */}
            <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Margin Debt
              </span>
              <span className="text-sm font-mono font-bold text-rose-300 mt-1">
                -{formatCurrency(activeMetrics.marginDebt).replace('-', '')}
              </span>
            </div>

            {/* Metric 5 */}
            <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Commissions
              </span>
              <span className="text-sm font-mono font-bold text-slate-300 mt-1">
                {formatCurrency(activeMetrics.commissions)}
              </span>
            </div>

            {/* Metric 6 */}
            <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800 flex flex-col justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                Net Target P&amp;L
              </span>
              <span className={`text-sm font-mono font-bold mt-1 ${activeMetrics.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatCurrency(activeMetrics.netPnL)}
              </span>
            </div>
          </div>

          {/* Account Equity & Risk Strip */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-xs font-mono">
            <div>
              <span className="text-slate-500">Account Equity:</span>{' '}
              <span className="font-bold text-white">{formatCurrency(accountEquity)}</span>
            </div>
            <div>
              <span className="text-slate-500">Collateral / Cushion:</span>{' '}
              <span className="font-bold text-cyan-400">{formatCurrency(totalCushionValue)}</span>
            </div>
            <div>
              <span className="text-slate-500">Margin Risk:</span>{' '}
              <span
                className={`font-bold ${isStopOut
                    ? 'text-rose-500 animate-pulse'
                    : isMarginCall
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                  }`}
              >
                {isStopOut ? 'STOP-OUT RISK' : isMarginCall ? 'MARGIN CALL RISK' : 'Normal / Safe'}
              </span>
            </div>
            {totalMarginDebt > 0 && (
              <>
                <div>
                  <span className="text-slate-500">Maintenance Mgn:</span>{' '}
                  <span className="text-amber-400 font-bold">{formatCurrency(maintenanceRequirement)}</span>
                </div>
                <div>
                  <span className="text-slate-500">Stop-out Mgn:</span>{' '}
                  <span className="text-rose-400 font-bold">{formatCurrency(stopOutRequirement)}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 10-Day Projections Table */}
      {projections.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              10-Day Margin Accrual &amp; P&amp;L Projection
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">
              Daily rate: {(brokerAssumptions.annualMarginRate / brokerAssumptions.interestDayCount).toFixed(4)}% / day
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[500px] text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/70 text-slate-400 font-medium">
                  <th className="py-2 px-3 text-left">Date</th>
                  <th className="py-2 px-3 text-right">P&amp;L (Net)</th>
                  <th className="py-2 px-3 text-right">Commissions</th>
                  <th className="py-2 px-3 text-right">Margin Fee</th>
                  <th className="py-2 px-3 text-right">Projected Equity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {projections.map((row, idx) => (
                  <tr key={idx} className={idx === 0 ? 'bg-slate-900/50 font-bold' : 'hover:bg-slate-900/20'}>
                    <td className="py-2 px-3 text-slate-200">{row.date}</td>
                    <td className={`py-2 px-3 text-right ${row.netPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(row.netPnL)}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-400">{formatCurrency(row.totalFees)}</td>
                    <td className="py-2 px-3 text-right text-rose-300">{formatCurrency(row.marginFee)}</td>
                    <td className="py-2 px-3 text-right text-cyan-300">{formatCurrency(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};