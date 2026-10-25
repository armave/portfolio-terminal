import { useEffect, useState } from 'preact/hooks';
import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { formatRelativeTime } from '../utils/relativeTime';

export function ClosedHistoryDesk() {
  const state = usePortfolio();
  const [brokerTrades, setBrokerTrades] = useState<any[]>([]);
  const [brokerTradesLoading, setBrokerTradesLoading] = useState(true);
  const [brokerTradesError, setBrokerTradesError] = useState(false);
  useEffect(() => {
    const readCurrentTrades = () => {
      const current = (window as any).__tradenetExecutedTrades;
      if (Array.isArray(current)) { setBrokerTrades(current); setBrokerTradesLoading(false); setBrokerTradesError(false); }
    };
    const onTrades = (event: Event) => {
      const trades = (event as CustomEvent).detail;
      if (Array.isArray(trades)) { setBrokerTrades(trades); setBrokerTradesLoading(false); setBrokerTradesError(false); }
    };
    readCurrentTrades();
    // If the route opens directly, App's initial fetch may already have fired.
    // Ask App to fetch now as well; both the event and shared cache are supported.
    const onTradesError = () => { setBrokerTradesLoading(false); setBrokerTradesError(true); };
    window.addEventListener('tradenet:executed-trades', onTrades);
    window.addEventListener('tradenet:executed-trades-error', onTradesError);
    window.dispatchEvent(new CustomEvent('tradenet:request-executed-trades'));
    return () => { window.removeEventListener('tradenet:executed-trades', onTrades); window.removeEventListener('tradenet:executed-trades-error', onTradesError); };
  }, []);
  const appTrades = (state.closedTrades || []).map((trade, index) => {
    const marginFee = Math.abs(Number((trade as any).marginFee ?? (trade as any).marginInterest ?? 0)) || 0;
    const baseProfit = Number((trade as any).netProfit ?? (trade as any).netRealizedGain ?? (trade as any).grossProfit ?? 0);
    const existingFees = Number((trade as any).feesAndCommissions ?? (trade as any).totalCommissions ?? (trade as any).commissions ?? 0);
    // External cash-flow margin fees are tracked separately from broker commissions.
    // Add them to both displayed costs and net P&L exactly once.
    const profitAlreadyIncludesMargin = Boolean((trade as any).marginFeeIncludedInNetProfit);
    return {
      trade: { ...(trade as any), source: 'app' as const },
      index,
      source: 'app' as const,
      profit: baseProfit - (profitAlreadyIncludesMargin ? 0 : marginFee),
      fees: existingFees + ((trade as any).marginFeeIncludedInFees ? 0 : marginFee)
    };
  });
  // Match buy lots FIFO to sell executions so both entry and exit commissions
  // are reflected in the closed-history row. Fees are allocated per share for partial closes.
  const brokerTradeMetrics = (() => {
    const sorted = [...brokerTrades].filter((t: any) => t.ticker && t.executedAt)
      .sort((a: any, b: any) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
    const queues = new Map<string, { date: number; quantity: number; commissionPerShare: number | null }[]>();
    const metricsByObject = new Map<any, { holdingDays: number | null; buyCommission: number }>();
    for (const trade of sorted) {
      const ticker = String(trade.ticker).trim().toUpperCase();
      const side = String(trade.side ?? '').toLowerCase();
      const qty = Math.abs(Number(trade.quantity ?? 0));
      const time = Date.parse(trade.executedAt);
      if (!Number.isFinite(time) || !Number.isFinite(qty) || qty <= 0) continue;
      const isBuy = ['buy', 'b', 'purchase', 'bought', '1'].includes(side);
      const isSell = ['sell', 's', 'sale', 'sold', '2'].includes(side);
      const commission = trade.commission == null ? null : Math.abs(Number(trade.commission));
      if (isBuy) {
        const queue = queues.get(ticker) ?? [];
        queue.push({ date: time, quantity: qty, commissionPerShare: commission !== null && Number.isFinite(commission) ? commission / qty : null });
        queues.set(ticker, queue);
      } else if (isSell) {
        const queue = queues.get(ticker) ?? [];
        let remaining = qty;
        let weightedDays = 0;
        let matched = 0;
        let buyCommission = 0;
        let commissionKnown = true;
        while (remaining > 1e-8 && queue.length) {
          const lot = queue[0];
          const used = Math.min(remaining, lot.quantity);
          weightedDays += Math.max(0, time - lot.date) / 86400000 * used;
          matched += used;
          if (lot.commissionPerShare === null) commissionKnown = false;
          else buyCommission += lot.commissionPerShare * used;
          remaining -= used;
          lot.quantity -= used;
          if (lot.quantity <= 1e-8) queue.shift();
        }
        metricsByObject.set(trade, { holdingDays: matched > 0 ? weightedDays / matched : null, buyCommission: commissionKnown && matched > 0 ? buyCommission : 0 });
      }
    }
    return metricsByObject;
  })();
  const brokerRows = brokerTrades.filter((broker: any) => ['sell', 's', 'sale', 'sold', '2'].includes(String(broker.side ?? '').toLowerCase())).map((broker: any, index) => {
    const marginFee = Math.abs(Number(broker.marginFee ?? 0)) || 0;
    const tradeFees = (broker.commission == null ? 0 : Math.abs(Number(broker.commission))) + (brokerTradeMetrics.get(broker)?.buyCommission ?? 0);
    return {
      trade: { id: broker.id ?? ('tradenet-' + index), ticker: broker.ticker, shares: broker.quantity, exitDate: broker.executedAt, sellDate: broker.executedAt, holdingDays: brokerTradeMetrics.get(broker)?.holdingDays, feesAndCommissions: tradeFees + marginFee, netProfit: broker.profit, side: broker.side, price: broker.price, source: 'tradenet' as const },
      index: -1,
      source: 'tradenet' as const,
      profit: broker.profit == null ? null : Number(broker.profit) - marginFee,
      fees: tradeFees + marginFee
    };
  });
  // Group same-ticker sell executions that occur within one hour into one closed-history row.
  // Keep separate groups when the gap from the previous execution exceeds one hour.
  const groupedBrokerRows = (() => {
    const sorted = [...brokerRows].sort((a, b) => Date.parse(String((a.trade as any).exitDate ?? '')) - Date.parse(String((b.trade as any).exitDate ?? '')));
    const groups: typeof brokerRows = [];
    for (const row of sorted) {
      const ticker = String((row.trade as any).ticker ?? '').trim().toUpperCase();
      const time = Date.parse(String((row.trade as any).exitDate ?? ''));
      const previous = groups[groups.length - 1];
      const previousTicker = previous ? String((previous.trade as any).ticker ?? '').trim().toUpperCase() : '';
      const previousTime = previous ? Date.parse(String((previous.trade as any).exitDate ?? '')) : NaN;
      if (previous && ticker && ticker === previousTicker && Number.isFinite(time) && Number.isFinite(previousTime) && time - previousTime <= 60 * 60 * 1000) {
        const oldQty = Number((previous.trade as any).shares ?? 0);
        const newQty = Number((row.trade as any).shares ?? 0);
        const oldProfit = previous.profit;
        const newProfit = row.profit;
        const oldFees = previous.fees;
        const newFees = row.fees;
        const oldDuration = (previous.trade as any).holdingDays;
        const newDuration = (row.trade as any).holdingDays;
        const totalQty = oldQty + newQty;
        (previous.trade as any).shares = totalQty;
        (previous.trade as any).exitDate = (row.trade as any).exitDate;
        (previous.trade as any).sellDate = (row.trade as any).exitDate;
        (previous.trade as any).id = String((previous.trade as any).id) + '+' + String((row.trade as any).id);
        (previous.trade as any).holdingDays = oldDuration != null && newDuration != null && totalQty > 0 ? (Number(oldDuration) * oldQty + Number(newDuration) * newQty) / totalQty : oldDuration ?? newDuration;
        previous.profit = oldProfit == null || newProfit == null ? null : oldProfit + newProfit;
        previous.fees = oldFees + newFees;
        (previous.trade as any).price = totalQty > 0 ? (Number((previous.trade as any).price ?? 0) * oldQty + Number((row.trade as any).price ?? 0) * newQty) / totalQty : (row.trade as any).price;
      } else {
        groups.push({ ...row, trade: { ...(row.trade as any) } });
      }
    }
    return groups;
  })();
  const trades = [...appTrades, ...groupedBrokerRows].sort((a, b) => String((b.trade as any).exitDate ?? (b.trade as any).sellDate ?? '').localeCompare(String((a.trade as any).exitDate ?? (a.trade as any).sellDate ?? '')));
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
    <section class="rounded-xl border-card p-4 space-y-4" aria-label="Closed trade history">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 class="text-base font-black uppercase tracking-wider text-purple-300">
            Closed Trade History
          </h2>
          <p class="text-xs text-slate-400">
            Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.
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
            {brokerTradesLoading && brokerTrades.length === 0 ? (
              <tr><td colSpan={8} class="py-8 text-center text-slate-400">
                <span class="inline-flex items-center gap-2"><span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-purple-400" aria-hidden="true" />Loading closed trade history…</span>
              </td></tr>
            ) : brokerTradesError && trades.length === 0 ? (
              <tr><td colSpan={8} class="py-8 text-center text-rose-400">Unable to load TradeNet history. Please retry.</td></tr>
            ) : trades.length === 0 ? (
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
                    <td class="py-2.5 px-3 font-bold text-white">{(trade as any).ticker || "—"}</td>
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
    </section>
  );
}