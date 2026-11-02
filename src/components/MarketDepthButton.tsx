import { createPortal } from 'preact/compat';
import { useRef, useState } from 'preact/hooks';
import { useDialogFocus } from '../ui/dialogFocus';
import { fetchFreedomTradeNetMarketDepth } from '../services/api';
import { getAppLanguage, translateText } from '../services/i18n';
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

  // A retained order book is useful only for the ticker it belongs to.
  const currentSnapshot = snapshot?.symbol === ticker.trim().toUpperCase() ? snapshot : null;
  const language = getAppLanguage();
  const depthTitle = `${translateText('Market depth', language)} · ${ticker}`;
  const loadingLabel = translateText('Loading market depth…', language);
  const refreshLabel = translateText(error ? 'Retry depth' : 'Refresh depth', language);
  const regionLabel = `${translateText('Market depth order book for', language)} ${ticker}`;

  const loadDepth = async () => {
    if (!ticker || isLoading) return;
    setIsLoading(true);
    setError('');
    try {
      const response = await fetchFreedomTradeNetMarketDepth(ticker);
      setSnapshot(normalizeFreedomMarketDepth(response, ticker));
    } catch (loadError) {
      // Preserve a successful same-ticker snapshot so a transient refresh
      // failure does not erase the last usable order book.
      setError(loadError instanceof Error ? loadError.message : 'TradeNet market-depth feed is unavailable.');
    } finally {
      setIsLoading(false);
    }
  };

  const openModal = () => {
    setIsOpen(true);
    setError('');
    void loadDepth();
  };

  const bestBid = currentSnapshot?.bids[0]?.price;
  const bestAsk = currentSnapshot?.asks[0]?.price;
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;
  const spreadPercent = spread !== null && bestBid ? spread / bestBid * 100 : null;
  const maxQuantity = Math.max(1, ...(currentSnapshot?.bids.map(level => level.quantity) || []), ...(currentSnapshot?.asks.map(level => level.quantity) || []));

  const renderLevels = (levels: FreedomMarketDepthLevel[], side: 'bid' | 'ask') => {
    const textClass = side === 'bid' ? 'text-emerald-300' : 'text-rose-300';
    const barClass = side === 'bid' ? 'bg-emerald-500/20' : 'bg-rose-500/20';
    const caption = translateText(side === 'bid' ? 'Bid prices and quantities' : 'Ask prices and quantities', language);
    return (
      <table class="w-full table-fixed border-collapse text-right font-mono text-[11px] tabular-nums">
        <caption class="sr-only">{caption}</caption>
        <thead>
          <tr class="border-b border-slate-800 text-[9px] uppercase tracking-wider text-slate-500">
            <th scope="col" class="px-2 py-1 text-left">{translateText('Price', language)}</th>
            <th scope="col" class="px-2 py-1 text-right">{translateText('Quantity', language)}</th>
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
      <button ref={triggerRef} type="button" onClick={openModal} title={depthTitle} aria-label={`${translateText('Open market depth for', language)} ${ticker}`}
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
                <h2 id="marketDepthModalTitle" class="text-base font-black tracking-wide text-cyan-300">{depthTitle}</h2>
                <p class="mt-0.5 text-[10px] text-slate-500">{translateText('Read-only order book snapshot · TradeNet', language)}</p>
              </div>
              <div class="flex items-center gap-2">
                <button type="button" onClick={() => void loadDepth()} disabled={isLoading}
                  aria-label={isLoading ? loadingLabel : refreshLabel}
                  aria-busy={isLoading}
                  class="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-cyan-300 hover:bg-slate-800 disabled:opacity-50">
                  {isLoading ? loadingLabel : refreshLabel}
                </button>
                <button ref={closeButtonRef} type="button" onClick={closeModal}
                  class="rounded border border-slate-700 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:bg-slate-800" aria-label={translateText('Close market depth', language)}>{translateText('Close', language)}</button>
              </div>
            </header>
            <div class="market-depth-content min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5" role="region" aria-label={regionLabel} tabIndex={0} aria-busy={isLoading}>
              {isLoading && !currentSnapshot && <div class="py-12 text-center text-sm text-cyan-300" role="status">{loadingLabel}</div>}
              {currentSnapshot && isLoading && (
                <p class="mb-3 text-[10px] text-cyan-300" role="status">
                  {translateText('Refreshing order book; previous snapshot remains visible.', language)}
                </p>
              )}
              {error && (
                <div class="mb-3 rounded-lg border border-amber-800/70 bg-amber-950/30 p-4 text-sm leading-relaxed text-amber-200" role="alert">
                  {currentSnapshot
                    ? `${translateText('Refresh failed; showing the last successful order-book snapshot.', language)} ${translateText(error, language)}`
                    : translateText(error, language)}
                  {error.includes('API keys') && <p class="mt-2 text-xs text-amber-300/80">{translateText('Check that FREEDOM_PUBLIC_KEY and FREEDOM_PRIVATE_KEY are configured as Cloudflare Worker secrets. Never expose the private key in browser code.', language)}</p>}
                </div>
              )}
              {currentSnapshot && <>
                <div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div class="rounded-lg border border-emerald-900/70 bg-emerald-950/20 p-3"><p class="text-[9px] uppercase tracking-wider text-emerald-400">{translateText('Best bid', language)}</p><p class="mt-1 font-mono text-sm font-bold text-emerald-300">{bestBid !== undefined ? formatPrice(bestBid) : '—'}</p></div>
                  <div class="rounded-lg border border-rose-900/70 bg-rose-950/20 p-3"><p class="text-[9px] uppercase tracking-wider text-rose-400">{translateText('Best ask', language)}</p><p class="mt-1 font-mono text-sm font-bold text-rose-300">{bestAsk !== undefined ? formatPrice(bestAsk) : '—'}</p></div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><p class="text-[9px] uppercase tracking-wider text-slate-500">{translateText('Spread', language)}</p><p class="mt-1 font-mono text-sm font-bold text-slate-100">{spread !== null ? formatPrice(spread) : '—'}</p>{spreadPercent !== null && <p class="text-[9px] text-slate-500">{spreadPercent.toFixed(3)}%</p>}</div>
                  <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3"><p class="text-[9px] uppercase tracking-wider text-slate-500">{translateText('Depth', language)}</p><p class="mt-1 font-mono text-sm font-bold text-slate-100">{currentSnapshot.depth}</p>{currentSnapshot.minPriceStep !== null && <p class="text-[9px] text-slate-500">{translateText('Tick', language)} {formatPrice(currentSnapshot.minPriceStep)}</p>}</div>
                </div>
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <section class="min-w-0">
                    <div class="mb-2 flex items-center justify-between border-b border-emerald-900/60 pb-2"><h3 class="text-xs font-black uppercase tracking-wider text-emerald-300">{translateText('Bids · buyers', language)}</h3><span class="text-[9px] text-slate-500">{currentSnapshot.bids.length} levels</span></div>
                    {renderLevels(currentSnapshot.bids, 'bid')}
                    {currentSnapshot.bids.length === 0 && <p class="py-5 text-center text-xs text-slate-500">{translateText('No bid levels returned.', language)}</p>}
                  </section>
                  <section class="min-w-0">
                    <div class="mb-2 flex items-center justify-between border-b border-rose-900/60 pb-2"><h3 class="text-xs font-black uppercase tracking-wider text-rose-300">{translateText('Asks · sellers', language)}</h3><span class="text-[9px] text-slate-500">{currentSnapshot.asks.length} levels</span></div>
                    {renderLevels(currentSnapshot.asks, 'ask')}
                    {currentSnapshot.asks.length === 0 && <p class="py-5 text-center text-xs text-slate-500">{translateText('No ask levels returned.', language)}</p>}
                  </section>
                </div>
                <p class="mt-4 border-t border-slate-800 pt-3 text-right text-[9px] text-slate-500">{translateText('Updated', language)} {formatTime(currentSnapshot.updatedAt)}</p>
              </>}
            </div>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
