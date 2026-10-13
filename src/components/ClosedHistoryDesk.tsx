import { usePortfolio, portfolioStore } from '../store/portfolioStore';
import { formatUSD } from '../ui/renderBoard';
import { logTerminal, showToast } from '../ui/notifications';
import { saveState } from '../services/storage';
import { syncCloudState } from '../services/api';

export function ClosedHistoryDesk() {
  const state = usePortfolio();

  const trades = (state.closedTrades || [])
    .map((trade: any, index: number) => ({ trade, index }))
    .sort((a, b) => Number(b.trade.date) - Number(a.trade.date));

  const handleDelete = (index: number) => {
    const trade: any = state.closedTrades?.[index];
    if (!trade) return;
    if (!confirm(`Delete the ${trade.ticker || 'unknown'} closed trade from history? This cannot be undone.`)) {
      return;
    }

    const updatedTrades = [...(state.closedTrades || [])];
    updatedTrades.splice(index, 1);

    const nextState = { ...state, closedTrades: updatedTrades };
    portfolioStore.importState(nextState);
    saveState(nextState as any, () => syncCloudState('push', { state: nextState }));

    if (typeof window !== 'undefined' && typeof (window as any).renderBoard === 'function') {
      (window as any).renderBoard();
    }

    logTerminal(`[History]: Removed the ${trade.ticker || 'unknown'} closed trade from history.`);
    showToast('Closed trade removed from history.', 'info');
  };

  return (
    <>
      <div class="flex flex-wrap justify-between items-end gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 class="text-lg font-black text-purple-300 tracking-wide">CLOSED TRADE HISTORY</h2>
          <p class="text-xs text-slate-400">
            Realized margin trades, including partial sales. Net profit includes commissions and allocated margin fees.
          </p>
        </div>
        <span id="closedTradesCount" class="text-xs text-slate-400 font-mono">
          {trades.length} realized exit{trades.length === 1 ? '' : 's'}
        </span>
      </div>

      {trades.length === 0 ? (
        <div
          id="closedTradesEmptyState"
          class="rounded border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center text-xs text-slate-500"
        >
          No closed margin trades yet.
        </div>
      ) : (
        <div class="table-scroll-wrapper overflow-x-auto">
          <table class="w-full min-w-[700px] text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 font-medium">
                <th class="py-2 px-3">Ticker</th>
                <th class="py-2 px-3">Date Closed</th>
                <th class="py-2 px-3 text-right">Shares</th>
                <th class="py-2 px-3 text-right">Duration</th>
                <th class="py-2 px-3 text-right">Fees &amp; Comm.</th>
                <th class="py-2 px-3 text-right">Net Profit</th>
                <th class="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="closedTradesTableBody" class="divide-y divide-slate-800/60 font-mono">
              {trades.map(({ trade, index }) => {
                const dateValue = Number(trade.date);
                const closedDate = new Date(
                  Number.isFinite(dateValue) ? dateValue : Date.parse(trade.date)
                );
                const dateText = Number.isNaN(closedDate.getTime())
                  ? 'Unknown'
                  : closedDate.toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                  });
                const netProfit = Number(trade.netProfit) || 0;

                return (
                  <tr key={trade.id || index} class="border-b border-slate-800/60 text-slate-300">
                    <td class="py-2 px-3 font-bold text-white">{trade.ticker || '—'}</td>
                    <td class="py-2 px-3 whitespace-nowrap">{dateText}</td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      {formatUSD(trade.shares)} shares
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      {Math.max(0, Number(trade.holdingDays) || 0)} days
                    </td>
                    <td class="py-2 px-3 text-right whitespace-nowrap">
                      ${formatUSD(trade.feesAndCommissions)}
                    </td>
                    <td
                      class={`py-2 px-3 text-right font-bold ${netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                    >
                      {netProfit >= 0 ? '+' : '-'}${formatUSD(Math.abs(netProfit))}
                    </td>
                    <td class="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(index)}
                        aria-label={`Delete ${trade.ticker || 'unknown'} closed trade from history`}
                        class="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-400 hover:border-rose-800 hover:text-rose-300"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}