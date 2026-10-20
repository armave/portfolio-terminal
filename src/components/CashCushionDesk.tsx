import { useState, useEffect } from 'preact/hooks';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatQuoteMetadata } from '../utils/formatters';
import { sentimentLabel, SentimentDirection } from '../features/quotes/sentiment';
import { QuoteDetails } from '../types/portfolio';

export interface CashCushionDeskProps {
  onFetchLivePrice?: (ticker: string) => void;
  onRemoveCashStock?: (index: number) => void;
  onSaveBalance?: (signedValue: number) => void;
  onAddCashStock?: (ticker: string, shares: number, manualPrice: number) => void;
  refreshIntervalMs?: number;
}

const BADGE_STYLES: Record<string, string> = {
  bullish: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  bearish: 'border-rose-800 bg-rose-950/50 text-rose-300',
  neutral: 'border-slate-700 bg-slate-900 text-slate-300',
  unknown: 'border-slate-800 bg-slate-950 text-slate-500'
};

function renderDailyQuoteSubtext(details?: QuoteDetails | null) {
  if (!details || typeof details !== 'object') return null;
  const hasChange = Number.isFinite(details.change) && Number.isFinite(details.changePercent);
  const hasRange = Number.isFinite(details.high) && Number.isFinite(details.low);
  if (!hasChange && !hasRange) return null;

  const parts: string[] = [];
  let colorClass = 'text-slate-400';

  if (hasChange && details.change !== undefined && details.changePercent !== undefined) {
    const sign = details.change >= 0 ? '+' : '−';
    parts.push(
      `${sign}${formatUSD(Math.abs(details.change))}`
    );
    colorClass =
      details.change > 0
        ? 'text-emerald-400'
        : details.change < 0
          ? 'text-rose-400'
          : 'text-slate-400';
  }

  if (hasRange) {
    parts.push(`H {formatUSD(details.high)} / L {formatUSD(details.low)}`);
  }

  return (
    <span class={`mt-0.5 block text-[9px] font-normal tabular-nums ${colorClass}`}>
      Day: {parts.join(' · ')}
    </span>
  );
}

export function CashCushionDesk({
  onFetchLivePrice,
  onRemoveCashStock,
  refreshIntervalMs = 60000
}: CashCushionDeskProps) {
  const state = usePortfolio();

  const freeCash = Number(state.cashCushion?.freeCash) || 0;
  const signedBalance = freeCash + (Number(state.balance) || 0);
  const holdings = state.cashCushion?.holdings || [];

  const [balanceInput, setBalanceInput] = useState<string>(signedBalance.toFixed(2));

  useEffect(() => {
    setBalanceInput(signedBalance.toFixed(2));
  }, [signedBalance]);

  const stocksTotal = holdings.reduce((sum, h) => {
    const price = Number(h.currentPrice ?? h.price) || 0;
    return sum + (Number(h.shares) || 0) * price;
  }, 0);

  const totalCushion = freeCash + stocksTotal;

  const handleUpdateBalance = () => {
    if (typeof window !== 'undefined' && typeof (window as any).saveCurrentBalanceFromInput === 'function') {
      (window as any).saveCurrentBalanceFromInput();
    }
  };

  const handleAddStock = () => {
    if (typeof window !== 'undefined' && typeof (window as any).addCashStockFromUI === 'function') {
      (window as any).addCashStockFromUI();
    }
  };

  return (
    <>
      <div class="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <h2 class="text-lg font-black text-cyan-400 tracking-wide">
            CASH &amp; NON-MARGIN HOLDINGS
          </h2>
        </div>
        <div class="text-right">
          <span class="text-xs text-slate-500 block">Cash + Holdings</span>
          <span class="text-xl font-bold text-cyan-300 font-mono" id="cushionTotalValue">
            {formatUSD(totalCushion)}
          </span>
        </div>
      </div>

      <div class="space-y-2">
        <div class="flex items-center gap-2" style={{ justifyContent: 'end' }}>
          <div class="relative">
            <span
              class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs"
              aria-hidden="true"
            >
              $
            </span>
            <input
              type="number"
              id="freeCashInput"
              step="0.01"
              required
              inputMode="decimal"
              value={balanceInput}
              onInput={(e) => setBalanceInput((e.target as HTMLInputElement).value)}
              aria-label="Signed balance or margin debt in US dollars"
              title="Positive values are cash balance; negative values are margin debt"
              class="number-input bg-slate-950 border border-slate-700 text-xs pl-5 pr-2 py-1 rounded w-36 text-right text-emerald-300 font-mono font-bold focus:outline-none focus:border-cyan-500"
            />
          </div>
          <button
            type="button"
            onClick={handleUpdateBalance}
            class="bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-bold px-2.5 py-1 rounded border border-slate-600 transition"
          >
            Update
          </button>
        </div>

        <div class="table-scroll-wrapper overflow-x-auto">
          <table class="w-full min-w-0 table-fixed text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 font-medium">
                <th class="w-[15%] py-2 px-2">Ticker</th>
                <th class="w-[15%] py-2 px-2 text-right">Shares</th>
                <th class="w-[20%] py-2 px-2 text-right">Price · Mkt</th>
                <th class="w-[15%] py-2 px-2 text-right">Mkt Value</th>
                <th class="w-[15%] py-2 px-2 text-right">Eq. Alloc</th>
                <th class="w-[15%] py-2 px-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody id="cashStocksTableBody" class="divide-y divide-slate-800/60 font-mono">
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={6} class="py-3 text-center text-slate-500 italic">
                    No cash stocks entered. Add unleveraged stocks below (price auto-fetches).
                  </td>
                </tr>
              ) : (
                holdings.map((h, idx) => {
                  const shares = Number(h.shares) || 0;
                  const price = Number(h.currentPrice ?? h.price) || 0;
                  const val = shares * price;
                  const allocation = stocksTotal > 0 ? (val / stocksTotal) * 100 : 0;
                  const quoteMeta = formatQuoteMetadata(h, refreshIntervalMs);

                  const hasChange = Number.isFinite(h.quoteDetails?.change);
                  const direction: SentimentDirection = hasChange
                    ? h.quoteDetails!.change! > 0
                      ? 'bullish'
                      : h.quoteDetails!.change! < 0
                        ? 'bearish'
                        : 'neutral'
                    : 'unknown';
                  const badgeText =
                    hasChange && h.quoteDetails?.changePercent !== undefined
                      ? `${h.quoteDetails.changePercent.toFixed(2)}%`
                      : sentimentLabel(direction);

                  return (
                    <tr key={`${h.ticker}-${idx}`} class="hover:bg-slate-900/40">
                      <td class="py-2 px-3 text-cyan-300 font-bold">
                        <div class="inline-flex items-center gap-1.5">
                          <span>{h.ticker}</span>
                          <span
                            data-sentiment={direction}
                            title={
                              direction === 'unknown'
                                ? 'The selected data source did not provide a sentiment signal.'
                                : 'A directional marker based only on the provider values shown in this section.'
                            }
                            class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${BADGE_STYLES[direction] || BADGE_STYLES.unknown
                              }`}
                          >
                            {badgeText}
                          </span>
                        </div>
                      </td>
                      <td class="py-2 px-3 text-right text-slate-200 tabular-nums w-20 whitespace-nowrap">
                        {shares.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                      </td>
                      <td class="py-2 px-3 text-right text-emerald-400 font-semibold tabular-nums">
                        <span>{formatUSD(price)}</span>
                        {renderDailyQuoteSubtext(h.quoteDetails)}
                        <span class="mt-0.5 block text-[9px] font-normal text-slate-500">
                          {quoteMeta}
                        </span>
                      </td>
                      <td class="py-2 px-3 text-right text-white font-semibold">
                        {formatUSD(val)}
                      </td>
                      <td class="py-2 px-3 text-right text-slate-300 tabular-nums">
                        {allocation.toFixed(1)}%
                      </td>
                      <td class="py-2 px-3 text-center space-x-2">
                        <button
                          type="button"
                          title="Refresh Live Price"
                          aria-label={`Refresh ${h.ticker} quote`}
                          onClick={() => onFetchLivePrice?.(h.ticker)}
                          class="text-cyan-400 hover:text-cyan-300 text-xs font-bold"
                        >
                          ↻
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveCashStock?.(idx)}
                          class="text-rose-400 hover:text-rose-300 text-xs font-bold"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            <tfoot id="cashStocksTableFooter" class="border-t border-slate-700 font-mono">
              {holdings.length > 0 && (
                <tr>
                  <td class="py-2 px-3 text-slate-300 font-bold" colSpan={3}>
                    {holdings.length} holding{holdings.length === 1 ? '' : 's'}
                  </td>
                  <td class="py-2 px-3 text-right text-white font-bold">
                    {formatUSD(stocksTotal)}
                  </td>
                  <td class="py-2 px-3 text-right text-slate-300 font-bold">
                    {stocksTotal > 0 ? '100.0%' : '—'}
                  </td>
                  <td></td>
                </tr>
              )}
            </tfoot>
            <tbody class="border-t border-slate-800 bg-slate-900/30">
              <tr>
                <td class="py-2 px-3">
                  <input
                    type="text"
                    id="newCashTicker"
                    placeholder="TICKER"
                    required
                    aria-label="Stock ticker symbol"
                    autoComplete="off"
                    autoCapitalize="characters"
                    class="bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-white w-full min-w-0 uppercase focus:outline-none focus:border-cyan-500"
                  />
                </td>
                <td class="py-2 px-3 text-right">
                  <input
                    type="number"
                    id="newCashShares"
                    placeholder="Shares"
                    min="0.01"
                    step="0.01"
                    required
                    inputMode="decimal"
                    aria-label="Number of shares"
                    class="number-input bg-slate-950 border border-slate-700 text-xs px-2 py-1 rounded text-white w-full min-w-0 text-right font-mono tabular-nums focus:outline-none focus:border-cyan-500"
                  />
                </td>
                <td class="py-2 px-3 text-right">
                  <div class="w-full min-w-0 relative">
                    <span
                      class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 text-xs"
                      aria-hidden="true"
                    >
                      $
                    </span>
                    <input
                      type="number"
                      id="newCashPrice"
                      placeholder="Auto"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      aria-label="Optional price per share in US dollars"
                      class="number-input bg-slate-950 border border-slate-700 text-xs pl-4 pr-1 py-1 rounded text-white w-full min-w-0 text-right font-mono tabular-nums focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </td>
                <td class="py-2 px-3" colSpan={2}></td>
                <td class="py-2 px-3 text-center">
                  <button
                    type="button"
                    onClick={handleAddStock}
                    class="bg-cyan-700 hover:bg-cyan-600 text-white text-xs font-bold px-2 py-1 rounded transition whitespace-nowrap"
                  >
                    + Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}