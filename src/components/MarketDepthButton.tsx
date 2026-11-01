import { createPortal } from 'preact/compat';
import { useRef, useState } from 'preact/hooks';
import { useDialogFocus } from '../ui/dialogFocus';
import { fetchFreedomTradeNetMarketDepth } from '../services/api';
import { normalizeFreedomMarketDepth, type FreedomMarketDepthLevel, type FreedomMarketDepthSnapshot } from '../services/freedomMarketDepth';
interface MarketDepthButtonProps { ticker: string; compact?: boolean; }

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}
function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function MarketDepthButton({ ticker, compact = false }: MarketDepthButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<FreedomMarketDepthSnapshot | null>(null);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeModal = () => setIsOpen(false);
  useDialogFocus(dialogRef, {
    active: isOpen,
    initialFocusRef: closeButtonRef,
    restoreFocusRef: triggerRef,
    onEscape: closeModal
  });

  const loadDepth = async () => {
    if (!ticker || isLoading) return;
    setIsLoading(true);
    setError('');
    try {
      const response = await fetchFreedomTradeNetMarketDepth(ticker);
      setSnapshot(normalizeFreedomMarketDepth(response, ticker));
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError instanceof Error ? loadError.message : 'TradeNet market-depth feed is unavailable.');
    } finally {
      setIsLoading(false);
    }
  };

  const openModal = () => {
    setIsOpen(true);
    setSnapshot(null);
    setError('');
    void loadDepth();
  };

  const bestBid = snapshot?.bids[0]?.price;
  const bestAsk = snapshot?.asks[0]?.price;
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;
  const spreadPercent = spread !== null && bestBid ? spread / bestBid * 100 : null;
  const maxQuantity = Math.max(1, ...(snapshot?.bids.map(level => level.quantity) || []), ...(snapshot?.asks.map(level => level.quantity) || []));

  const renderLevels = (levels: FreedomMarketDepthLevel[], side: 'bid' | 'ask') => {
    const textClass = side === 'bid' ? 'text-emerald-300' : 'text-rose-300';
    const barClass = side === 'bid' ? 'bg-emerald-500/20' : 'bg-rose-500/20';
    const caption = side === 'bid' ? 'Bid prices and quantities' : 'Ask prices and quantities';
    return (
      <table class="w-full table-fixed border-collapse text-right font-mono text-[11px] tabular-nums">
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr class="border-b border-slate-800 text-[9px] uppercase tracking-wider text-slate-500">
            <th scope="col" class="px-2 py-1 text-left">Price</th>
            <th scope="col" class="px-2 py-1 text-right">Quantity</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level, index) => (
            <tr key={level.position ?? index} class="border-b border-slate-900/70 last:border-0">
              <td class={'px-2 py-1 text-left ' + textClass}>{formatPrice(level.price)}</td>
              <td class="relative overflow-hidden rounded-r px-2 py-1 text-slate-200">
                <span class="relative z-10">{formatQuantity(level.quantity)}</span>
                <span aria-hidden="true" class={'pointer-events-none absolute inset-y-0 right-0 rounded ' + barClass} style={{ width: (level.quantity / maxQuantity * 100) + '%' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div class="inline-flex">
      <button ref={triggerRef} type="button" onClick={openModal} title={'Market depth · ' + ticker} aria-label={'Open market depth for ' + ticker}
        class={'inline-flex shrink-0 items-center gap-1 rounded border border-cyan-800/80 bg-slate-900 text-cyan-300 hover:border-cyan-500 hover:bg-cyan-950/50 transition ' + (compact ? 'px-1.5 py-0.5 text-[9px] font-bold' : 'px-2 py-1 text-[10px] font-bold')}>
        <span aria-hidden="true">≋</span><span>Depth</span>
      </button>
      {isOpen && createPortal(
        <div class="market-depth-modal fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto overscroll-contain bg-slate-950/85 backdrop-blur-sm"
          role="presentation" onClick={closeModal}>
          <section ref={dialogRef} tabIndex={-1} class="market-depth-dialog flex min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-cyan-900/70 bg-slate-950 shadow-2xl"
            role="dialog" aria-modal="true" aria-labelledby="marketDepthModalTitle"
            onClick={(event) => event.stopPropagation()}>
            <header class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
              <div>
                <h2 id="marketDepthModalTitle" class="text-base font-black tracking-wide text-cyan-300">Market depth · {ticker}</h2>
                <p class="mt-0.5 text-[10px] text-slate-500">Read-only order book snapshot · TradeNet</p>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" onClick={() => void loadDepth()} disabled={isLoading}
                  class="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-cyan-300 hover:bg-slate-800 disabled:opacity-50">
                  {isLoading ? 'Loading market depth…' : 'Refresh depth'}
                </button>
                <button ref={closeButtonRef} type="button" onClick={closeModal}
                  class="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800" aria-label="Close market depth">Close</button>
              </div>
            </header>
            <div class="market-depth-content min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5" role="region" aria-label={`Market depth order book for ${ticker}`} tabIndex={0}>
              {isLoading && !snapshot && <div class="py-12 text-center text-sm text-cyan-300" role="status">Loading market depth…</div>}
              {error && (
                <div class="rounded-lg border border-amber-800/70 bg-amber-950/30 p-4 text-sm leading-relaxed text-amber-200" role="alert">
                  {error}
                  {error.includes('API keys') && <p class="mt-2 text-xs text-amber-300/80">Check that FREEDOM_PUBLIC_KEY and FREEDOM_PRIVATE_KEY are configured as Cloudflare Worker secrets. Never expose the private key in browser code.</p>}
                </div>
              )}
              {snapshot && <>
                <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div class="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-3"><p class="text-[9px] uppercase tracking-wider text-emerald-400">Best bid</p><p class="mt-1 font-mono text-sm font-bold text-emerald-300">{bestBid !== undefined ? formatPrice(bestBid) : '—'}</p></div>
                  <div class="rounded-lg border border-rose-900/70 bg-rose-950/20 p-3"><p class="text-[9px] uppercase tracking-wider text-rose-400">Best ask</p><p class="mt-1 font-mono text-sm font-bold text-rose-300">{bestAsk !== undefined ? formatPrice(bestAsk) : '—'}</p></div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><p class="text-[9px] uppercase tracking-wider text-slate-500">Spread</p><p class="mt-1 font-mono text-sm font-bold text-slate-100">{spread !== null ? formatPrice(spread) : '—'}</p>{spreadPercent !== null && <p class="text-[9px] text-slate-500">{spreadPercent.toFixed(3)}%</p>}</div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><p class="text-[9px] uppercase tracking-wider text-slate-500">Depth</p><p class="mt-1 font-mono text-sm font-bold text-slate-100">{snapshot.depth}</p>{snapshot.minPriceStep !== null && <p class="text-[9px] text-slate-500">Tick {formatPrice(snapshot.minPriceStep)}</p>}</div>
                </div>
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <section class="min-w-0">
                    <div class="mb-2 flex items-center justify-between border-b border-emerald-900/60 pb-2"><h3 class="text-xs font-black uppercase tracking-wider text-emerald-300">Bids · buyers</h3><span class="text-[9px] text-slate-500">{snapshot.bids.length} levels</span></div>
                    {renderLevels(snapshot.bids, 'bid')}
                    {snapshot.bids.length === 0 && <p class="py-5 text-center text-xs text-slate-500">No bid levels returned.</p>}
                  </section>
                  <section class="min-w-0">
                    <div class="mb-2 flex items-center justify-between border-b border-rose-900/60 pb-2"><h3 class="text-xs font-black uppercase tracking-wider text-rose-300">Asks · sellers</h3><span class="text-[9px] text-slate-500">{snapshot.asks.length} levels</span></div>
                    {renderLevels(snapshot.asks, 'ask')}
                    {snapshot.asks.length === 0 && <p class="py-5 text-center text-xs text-slate-500">No ask levels returned.</p>}
                  </section>
                </div>
                <p class="mt-4 border-t border-slate-800 pt-3 text-right text-[9px] text-slate-500">Updated {formatTime(snapshot.updatedAt)}</p>
              </>}
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
