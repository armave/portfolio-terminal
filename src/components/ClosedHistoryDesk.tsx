import { useEffect, useState } from 'preact/hooks';
import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';

export function ClosedHistoryDesk() {
  const state = usePortfolio();
  const [brokerTrades, setBrokerTrades] = useState<any[]>([]);
  useEffect(() => {
    const readCurrentTrades = () => {
      const current = (window as any).__tradenetExecutedTrades;
      if (Array.isArray(current)) setBrokerTrades(current);
    };
    const onTrades = (event: Event) => {
      const trades = (event as CustomEvent).detail;
      if (Array.isArray(trades)) setBrokerTrades(trades);
    };
    readCurrentTrades();
    window.addEventListener('tradenet:executed-trades', onTrades);
    return () => window.removeEventListener('tradenet:executed-trades', onTrades);
  }, []);
  const trades = (state.closedTrades || []).map((trade, index) => ({ trade, index }));
  const realizedNet = trades.reduce((total, { trade }) =>
    total + Number((trade as any).netProfit ?? (trade as any).netRealizedGain ?? (trade as any).grossProfit ?? 0), 0);
  const totalFees = trades.reduce((total, { trade }) =>
    total + Number((trade as any).feesAndCommissions ?? (trade as any).totalCommissions ?? (trade as any).commissions ?? 0), 0);
  const winningTrades = trades.filter(({ trade }) =>
    Number((trade as any).netProfit ?? (trade as any).netRealizedGain ?? (trade as any).grossProfit ?? 0) > 0).length;
  const averageHoldingDays = trades.length
    ? trades.reduce((total, { trade }) => total + Math.max(0, Number((trade as any).holdingDays ?? (trade as any).daysHeld ?? 0)), 0) / trades.length
    : 0;
  const winRate = trades.length ? (winningTrades / trades.length) * 100 : 0;

  const handleDelete = (index: number) => {
    const trade = state.closedTrades?.[index];
    const ticker = trade?.ticker || 'unknown';
    if (!confirm(`Delete the ${ticker} closed trade from history? This cannot be undone.`)) {
      return;
    }
    portfolioStore.deleteClosedTrade(index);
  };

  return (
    <div class="space-y-4">
      {brokerTrades.length > 0 && (
        <section class="space-y-2 rounded-lg border border-sky-900/60 bg-slate-950/40 p-3" aria-label="TradeNet closed history">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-sky-300">TradeNet execution history</h3>
            <span class="text-[10px] text-slate-500">{brokerTrades.length} executions · read-only</span>
          </div>
          <p class="text-[10px] text-slate-500">Broker executions are shown separately from app-recorded closed trades and do not overwrite them.</p>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs font-mono">
              <thead class="text-[10px] uppercase tracking-wider text-slate-500"><tr>
                <th class="px-2 py-2">Date</th><th class="px-2 py-2">Ticker</th><th class="px-2 py-2">Side</th>
                <th class="px-2 py-2 text-right">Shares</th><th class="px-2 py-2 text-right">Price</th>
                <th class="px-2 py-2 text-right">Commission</th><th class="px-2 py-2 text-right">Reported P&amp;L</th>
              </tr></thead>
              <tbody class="divide-y divide-slate-800/60">
                {brokerTrades.map((trade: any) => (
                  <tr key={trade.id} class="text-slate-300">
                    <td class="px-2 py-2 whitespace-nowrap">{trade.executedAt ? String(trade.executedAt).replace('T', ' ') : '—'}</td>
                    <td class="px-2 py-2 font-bold text-white">{trade.ticker || '—'}</td>
                    <td class="px-2 py-2">{trade.side || '—'}</td>
                    <td class="px-2 py-2 text-right">{trade.quantity ?? '—'}</td>
                    <td class="px-2 py-2 text-right">{trade.price === null ? '—' : Number(trade.price).toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                    <td class="px-2 py-2 text-right">{trade.commission === null ? '—' : Number(trade.commission).toLocaleString('en-US', { maximumFractionDigits: 2 })} {trade.commissionCurrency || ''}</td>
                    <td class="px-2 py-2 text-right">{trade.profit === null ? '—' : formatUSD(Number(trade.profit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 class="text-base font-black uppercase tracking-wider text-purple-300">
            Closed Trade History
          </h2>
          <p class="text-xs text-slate-400">
            Realized margin trades, including partial sales. Net profit includes commissions and allocated margin fees.
          </p>
        </div>
        <div class="text-xs font-mono text-slate-500">
          {trades.length} realized exit{trades.length === 1 ? '' : 's'}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Closed trade performance summary">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Realized net P&amp;L</div>
          <div class={`mt-1 font-mono text-sm font-bold ${realizedNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {realizedNet >= 0 ? '+' : '−'}${formatUSD(Math.abs(realizedNet))}
          </div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Win rate</div>
          <div class="mt-1 font-mono text-sm font-bold text-white">{winRate.toFixed(1)}%</div>
          <div class="text-[10px] text-slate-500">{winningTrades} of {trades.length} exits profitable</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fees &amp; commissions</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">${formatUSD(totalFees)}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Avg. holding time</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">{averageHoldingDays.toFixed(1)} days</div>
        </div>
      </div>

      <div class="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table class="w-full text-left text-xs font-mono">
          <thead class="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th class="py-2.5 px-3">Ticker</th>
              <th class="py-2.5 px-3">Date Closed</th>
              <th class="py-2.5 px-3 text-right">Shares</th>
              <th class="py-2.5 px-3 text-right">Duration</th>
              <th class="py-2.5 px-3 text-right">Fees & Comm.</th>
              <th class="py-2.5 px-3 text-right">Net Profit</th>
              <th class="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody id="closedTradesTableBody" class="divide-y divide-slate-800/60">
            {trades.length === 0 ? (
              <tr>
                <td colSpan={7} class="py-8 text-center text-slate-500 italic">
                  No closed trades recorded yet.
                </td>
              </tr>
            ) : (
              trades.map(({ trade, index }) => {
                // 1. Resolve Exit Date
                const rawDate =
                  (trade as any).exitDate ||
                  (trade as any).sellDate ||
                  (trade as any).closedAt ||
                  (trade as any).date;

                let closedDate: Date | null = null;
                if (typeof rawDate === 'number') {
                  closedDate = new Date(rawDate);
                } else if (typeof rawDate === 'string') {
                  const parsed = Date.parse(rawDate);
                  if (!Number.isNaN(parsed)) closedDate = new Date(parsed);
                }

                const dateText =
                  closedDate && !Number.isNaN(closedDate.getTime())
                    ? closedDate.toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric'
                    })
                    : 'Unknown';

                // 2. Resolve Duration in Days
                let durationDays = Number(
                  (trade as any).holdingDays ?? (trade as any).daysHeld ?? 0
                );
                if (
                  durationDays <= 0 &&
                  ((trade as any).buyDate || (trade as any).purchaseDate) &&
                  ((trade as any).sellDate || (trade as any).exitDate)
                ) {
                  const bTime = new Date(
                    (trade as any).buyDate || (trade as any).purchaseDate
                  ).getTime();
                  const sTime = new Date(
                    (trade as any).sellDate || (trade as any).exitDate
                  ).getTime();
                  if (!Number.isNaN(bTime) && !Number.isNaN(sTime)) {
                    durationDays = Math.max(0, Math.round(Math.abs(sTime - bTime) / 86400000));
                  }
                }

                // 3. Resolve Fees & Commissions
                const fees = Number(
                  (trade as any).feesAndCommissions ??
                  (trade as any).totalCommissions ??
                  (trade as any).commissions ??
                  0
                );

                // 4. Resolve Net Profit
                const netProfit = Number(
                  (trade as any).netProfit ??
                  (trade as any).netRealizedGain ??
                  (trade as any).grossProfit ??
                  0
                );

                const isPositive = netProfit >= 0;
                const sign = isPositive ? '+' : '-';

                return (
                  <tr key={(trade as any).id || index} class="hover:bg-slate-900/40 text-slate-300">
                    <td class="py-2.5 px-3 font-bold text-white">{(trade as any).ticker || '—'}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                      <span>{dateText}</span>
                      {closedDate && !Number.isNaN(closedDate.getTime()) ? (
                        <span class="mt-0.5 block text-[10px] text-slate-500" title={dateText}>
                          {formatRelativeTime(closedDate)}
                        </span>
                      ) : null}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      {(trade as any).shares}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-400">
                      {durationDays} {durationDays === 1 ? 'day' : 'days'}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-300 font-mono">
                      ${formatUSD(fees)}
                    </td>
                    <td
                      class={`py-2.5 px-3 text-right font-bold whitespace-nowrap font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {sign}${formatUSD(Math.abs(netProfit))}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleDelete(index)}
                        class="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-rose-800 hover:text-rose-300 transition"
                      >
                        Delete
                      </button>
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
}