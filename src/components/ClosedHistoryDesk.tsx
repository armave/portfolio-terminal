import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../ui/renderBoard';

export function ClosedHistoryDesk() {
  const state = usePortfolio();
  const trades = (state.closedTrades || []).map((trade, index) => ({ trade, index }));

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
          {trades.length} realized exit{trades.length === 1 ? '' : 's'}
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
                    <td class="py-2.5 px-3 whitespace-nowrap">{dateText}</td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap font-mono">
                      {(trade as any).shares} shares
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