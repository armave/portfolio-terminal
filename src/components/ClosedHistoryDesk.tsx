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
  const appTrades = (state.closedTrades || []).map((trade, index) => ({ trade: { ...(trade as any), source: 'app' as const }, index, source: 'app' as const, profit: Number((trade as any).netProfit ?? (trade as any).netRealizedGain ?? (trade as any).grossProfit ?? 0), fees: Number((trade as any).feesAndCommissions ?? (trade as any).totalCommissions ?? (trade as any).commissions ?? 0) }));
  // Calculate holding duration from the matched buy and sell executions.
  // Match FIFO by ticker; if the broker payload has no usable buy/sell history,
  // leave duration unknown instead of misleadingly displaying zero days.
  const brokerTradesWithDuration = (() => {
    const sorted = [...brokerTrades].filter((t: any) => t.ticker && t.executedAt)
      .sort((a: any, b: any) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
    const queues = new Map<string, { date: number; quantity: number }[]>();
    const durationByObject = new Map<any, number>();
    for (const trade of sorted) {
      const ticker = String(trade.ticker).trim().toUpperCase();
      const side = String(trade.side ?? '').toLowerCase();
      const qty = Math.abs(Number(trade.quantity ?? 0));
      const time = Date.parse(trade.executedAt);
      if (!Number.isFinite(time) || !Number.isFinite(qty) || qty <= 0) continue;
      const isBuy = ['buy', 'b', 'purchase', 'bought'].includes(side);
      const isSell = ['sell', 's', 'sale', 'sold'].includes(side);
      if (isBuy) {
        const queue = queues.get(ticker) ?? [];
        queue.push({ date: time, quantity: qty });
        queues.set(ticker, queue);
      } else if (isSell) {
        const queue = queues.get(ticker) ?? [];
        let remaining = qty;
        let weightedDays = 0;
        let matched = 0;
        while (remaining > 1e-8 && queue.length) {
          const lot = queue[0];
          const used = Math.min(remaining, lot.quantity);
          weightedDays += Math.max(0, time - lot.date) / 86400000 * used;
          matched += used;
          remaining -= used;
          lot.quantity -= used;
          if (lot.quantity <= 1e-8) queue.shift();
        }
        if (matched > 0) durationByObject.set(trade, weightedDays / matched);
      }
    }
    return durationByObject;
  })();
  const brokerRows = brokerTrades.map((broker: any, index) => ({ trade: { id: broker.id ?? ('tradenet-' + index), ticker: broker.ticker, shares: broker.quantity, exitDate: broker.executedAt, sellDate: broker.executedAt, holdingDays: brokerTradesWithDuration.get(broker), feesAndCommissions: broker.commission, netProfit: broker.profit, side: broker.side, price: broker.price, source: 'tradenet' as const }, index: -1, source: 'tradenet' as const, profit: broker.profit == null ? null : Number(broker.profit), fees: broker.commission == null ? 0 : Number(broker.commission) }));
  const trades = [...appTrades, ...brokerRows].sort((a, b) => String((b.trade as any).exitDate ?? '').localeCompare(String((a.trade as any).exitDate ?? '')));
  const realizedNet = trades.reduce((total, row) => total + (row.profit ?? 0), 0);
  const totalFees = trades.reduce((total, row) => total + (Number.isFinite(row.fees) ? row.fees : 0), 0);
  const profitKnownTrades = trades.filter((row) => row.profit !== null);
  const winningTrades = profitKnownTrades.filter((row) => (row.profit ?? 0) > 0).length;
  const knownDurations = trades.map((row) => Number((row.trade as any).holdingDays ?? (row.trade as any).daysHeld)).filter((days) => Number.isFinite(days) && days >= 0);
  const averageHoldingDays = knownDurations.length ? knownDurations.reduce((total, days) => total + days, 0) / knownDurations.length : null;
  const winRate = profitKnownTrades.length ? (winningTrades / profitKnownTrades.length) * 100 : 0;

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
          {trades.length} records ({appTrades.length} app · {brokerRows.length} Freedom)
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
          <div class="text-[10px] text-slate-500">{winningTrades} of {profitKnownTrades.length} records with known profit profitable</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Fees &amp; commissions</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">${formatUSD(totalFees)}</div>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Avg. holding time</div>
          <div class="mt-1 font-mono text-sm font-bold text-slate-200">{averageHoldingDays === null ? '—' : averageHoldingDays.toFixed(1) + ' days'}</div>
        </div>
      </div>

      <div class="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
        <table class="w-full text-left text-xs font-mono">
          <thead class="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-400">
            <tr>
              <th class="py-2.5 px-3">Source</th><th class="py-2.5 px-3">Ticker</th>
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
                <td colSpan={8} class="py-8 text-center text-slate-500 italic">
                  No closed trades recorded yet.
                </td>
              </tr>
            ) : (
              trades.map(({ trade, index, source, profit: rowProfit, fees: rowFees }) => {
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
                const rawDuration = (trade as any).holdingDays ?? (trade as any).daysHeld;
                let durationDays = rawDuration == null ? null : Number(rawDuration);
                if (durationDays !== null && (!Number.isFinite(durationDays) || durationDays < 0)) durationDays = null;
                if (
                  (durationDays === null || durationDays <= 0) &&
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
                    durationDays = Math.max(0, (sTime - bTime) / 86400000);
                  }
                }

                // 3. Resolve Fees & Commissions
                const fees = Number(rowFees ?? 0);

                // 4. Resolve Net Profit
                const netProfit = rowProfit === null ? null : Number(rowProfit ?? 0);

                const isPositive = (netProfit ?? 0) >= 0;
                const sign = isPositive ? '+' : '-';

                return (
                  <tr key={(trade as any).id || (source + "-" + index)} class="hover:bg-slate-900/40 text-slate-300">
                    <td class="py-2.5 px-3 text-[10px] uppercase text-slate-500">{source === "tradenet" ? "Freedom" : "App"}</td><td class="py-2.5 px-3 font-bold text-white">{(trade as any).ticker || "—"}</td>
                    <td class="py-2.5 px-3 whitespace-nowrap">
                      <span>{dateText}</span>
                      {closedDate && !Number.isNaN(closedDate.getTime()) ? (
                        <span class="mt-0.5 block text-[10px] text-slate-500" title={dateText}>
                          {formatRelativeTime(closedDate)}
                        </span>
                      ) : null}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      {(trade as any).shares ?? "—"}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-400">
                      {durationDays === null ? '—' : durationDays < 1 ? Math.round(durationDays * 24) + ' hrs' : durationDays.toFixed(1) + ' days'}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap text-slate-300 font-mono">
                      ${formatUSD(fees)}
                    </td>
                    <td
                      class={`py-2.5 px-3 text-right font-bold whitespace-nowrap font-mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {netProfit === null ? "—" : sign + "$" + formatUSD(Math.abs(netProfit))}
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap">{source === "app" ? <button type="button" onClick={() => handleDelete(index)} class="rounded border border-slate-700 px-2 py-1 text-[10px]">Delete</button> : <span class="text-[10px] text-slate-600">Read-only</span>}</td>
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