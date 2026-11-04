import { useEffect, useRef, useState } from 'preact/hooks';
import { buildFreedomMarketDepthStreamSocketUrl, createFreedomMarketDepthStreamTicket } from '../services/api';
import { groupFreedomMarketDepthByPrice } from '../services/freedomMarketDepth.js';
import { createFreedomMarketDepthStreamRuntime, type FreedomMarketDepthStreamRuntime, type FreedomMarketDepthStreamStatus } from '../services/freedomMarketDepthStreamRuntime';
import { useDialogFocus } from '../ui/dialogFocus';
import { getAppLanguage, translateText } from '../services/i18n';
import { createLatestFramePublisher, type LatestFramePublisher } from '../services/marketDepthFramePublisher';

export interface MarketDepthLevel {
  position: number;
  price: number;
  quantity: number;
}

export interface MarketDepthSnapshot {
  symbol: string;
  sequence?: number;
  reportedDepth?: number;
  minStep?: number;
  stepPrice?: number;
  updateCount?: number;
  insertionsApplied?: number;
  rowUpdatesApplied?: number;
  deletionsApplied?: number;
  captureDurationMs?: number;
  bids: MarketDepthLevel[];
  asks: MarketDepthLevel[];
  updatedAt: number;
}

interface MarketDepthModalProps {
  ticker: string;
  sessionKey: string;
  onClose: () => void;
}

export interface MarketDepthSummary {
  bestBid: MarketDepthLevel | null;
  bestAsk: MarketDepthLevel | null;
  spread: number | null;
  midpoint: number | null;
  spreadPercent: number | null;
  bidQuantity: number;
  askQuantity: number;
  imbalancePercent: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expectedDepthSymbol(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  return normalized.includes('.') ? normalized : `${normalized}.US`;
}

export type MarketDepthDisplayState = 'connecting' | 'waiting' | 'live' | 'disconnected' | 'error';

/** A ready socket is not a live order book until a valid depth payload arrives. */
export function getMarketDepthDisplayState(status: FreedomMarketDepthStreamStatus, snapshot: MarketDepthSnapshot | null): MarketDepthDisplayState {
  if (status === 'error') return 'error';
  if (status === 'disconnected') return 'disconnected';
  if (status === 'connected') return snapshot ? 'live' : 'waiting';
  return 'connecting';
}

function depthText(value: string): string {
  return translateText(value, getAppLanguage());
}

function isMarketDepthLevel(value: unknown): value is MarketDepthLevel {
  return isRecord(value) &&
    Number.isSafeInteger(value.position) && (value.position as number) >= 0 &&
    typeof value.price === 'number' && Number.isFinite(value.price) && value.price > 0 &&
    typeof value.quantity === 'number' && Number.isFinite(value.quantity) && value.quantity >= 0;
}

export function normalizeMarketDepthSnapshot(value: unknown, ticker: string): MarketDepthSnapshot {
  if (!isRecord(value)) {
    throw new Error('TradeNet did not return a Market Depth update.');
  }

  if (value.ok !== true && (typeof value.symbol !== 'string' || typeof value.updatedAt !== 'number')) {
    const message = typeof value.error === 'string'
      ? value.error
      : 'TradeNet did not return a Market Depth update.';
    throw new Error(message);
  }
  const data = isRecord(value.data) ? value.data : value;
  const expectedSymbol = expectedDepthSymbol(ticker);
  if (data.symbol !== expectedSymbol ||
      !Array.isArray(data.bids) || !data.bids.every(isMarketDepthLevel) ||
      !Array.isArray(data.asks) || !data.asks.every(isMarketDepthLevel) ||
      typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt) || value.updatedAt <= 0) {
    throw new Error('TradeNet returned an incomplete Market Depth snapshot.');
  }

  return {
    symbol: data.symbol,
    ...(Number.isSafeInteger(data.sequence) ? { sequence: data.sequence as number } : {}),
    ...(Number.isSafeInteger(data.reportedDepth) ? { reportedDepth: data.reportedDepth as number } : {}),
    ...(typeof data.minStep === 'number' && Number.isFinite(data.minStep) ? { minStep: data.minStep } : {}),
    ...(typeof data.stepPrice === 'number' && Number.isFinite(data.stepPrice) ? { stepPrice: data.stepPrice } : {}),
    ...(Number.isSafeInteger(data.updateCount) ? { updateCount: data.updateCount as number } : {}),
    ...(Number.isSafeInteger(data.insertionsApplied) ? { insertionsApplied: data.insertionsApplied as number } : {}),
    ...(Number.isSafeInteger(data.rowUpdatesApplied) ? { rowUpdatesApplied: data.rowUpdatesApplied as number } : {}),
    ...(Number.isSafeInteger(data.deletionsApplied) ? { deletionsApplied: data.deletionsApplied as number } : {}),
    ...(typeof data.captureDurationMs === 'number' && Number.isFinite(data.captureDurationMs)
      ? { captureDurationMs: data.captureDurationMs }
      : {}),
    bids: data.bids,
    asks: data.asks,
    updatedAt: value.updatedAt as number
  };
}

export function summarizeMarketDepth(snapshot: MarketDepthSnapshot): MarketDepthSummary {
  const bestBid = snapshot.bids.reduce<MarketDepthLevel | null>(
    (best, level) => !best || level.price > best.price ? level : best,
    null
  );
  const bestAsk = snapshot.asks.reduce<MarketDepthLevel | null>(
    (best, level) => !best || level.price < best.price ? level : best,
    null
  );
  const bidQuantity = snapshot.bids.reduce((total, level) => total + level.quantity, 0);
  const askQuantity = snapshot.asks.reduce((total, level) => total + level.quantity, 0);
  const spread = bestBid && bestAsk ? bestAsk.price - bestBid.price : null;
  const midpoint = bestBid && bestAsk ? (bestBid.price + bestAsk.price) / 2 : null;
  const totalQuantity = bidQuantity + askQuantity;

  return {
    bestBid,
    bestAsk,
    spread,
    midpoint,
    spreadPercent: spread !== null && midpoint !== null && midpoint > 0 ? (spread / midpoint) * 100 : null,
    bidQuantity,
    askQuantity,
    imbalancePercent: totalQuantity > 0 ? ((bidQuantity - askQuantity) / totalQuantity) * 100 : null
  };
}

function formatDepthNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function MarketDepthSide({ side, levels, maxQuantity }: {
  side: 'bids' | 'asks';
  levels: MarketDepthLevel[];
  maxQuantity: number;
}) {
  const isBid = side === 'bids';
  let cumulativeQuantity = 0;
  // Provider position order is converted to price order by groupFreedomMarketDepthByPrice.
  const rows = levels.slice(0, 5).map((level) => {
    cumulativeQuantity += level.quantity;
    return {
      ...level,
      cumulativeQuantity,
      barWidth: maxQuantity > 0 ? Math.max(0, (level.quantity / maxQuantity) * 100) : 0
    };
  });

  return <section class="min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60" aria-label={depthText(isBid ? 'Bid liquidity ladder' : 'Ask liquidity ladder')}>
    <h3 class={`flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs font-bold uppercase tracking-wider ${isBid ? 'text-emerald-300' : 'text-rose-300'}`}>
      <span>{depthText(isBid ? 'Buyers · bids' : 'Sellers · asks')}</span>
      <span class="text-[10px] font-normal text-slate-500">{levels.length} {depthText('levels')}</span>
    </h3>
    {rows.length ? <ol class="space-y-1 p-2">
      {rows.map((level) => <li key={level.position} class="relative isolate grid grid-cols-[minmax(4.5rem,1fr)_minmax(4rem,auto)_minmax(4rem,1fr)] items-center gap-2 overflow-hidden rounded px-2 py-1.5 text-[11px] tabular-nums">
        <span class={`absolute inset-y-0 ${isBid ? 'right-1/2 rounded-l bg-emerald-500/10' : 'left-1/2 rounded-r bg-rose-500/10'}`} style={{ width: `${level.barWidth / 2}%` }} aria-hidden="true" />
        <span class={`relative ${isBid ? 'text-right text-emerald-200' : 'text-right text-slate-400'}`}>{formatDepthNumber(level.price)}</span>
        <span class="relative text-center font-bold text-slate-200">{formatDepthNumber(level.quantity)}</span>
        <span class={`relative ${isBid ? 'text-left text-slate-400' : 'text-left text-rose-200'}`}>{formatDepthNumber(level.cumulativeQuantity)} {depthText('cum.')}</span>
      </li>)}
    </ol> : <p class="px-3 py-5 text-center text-xs text-slate-500">{depthText(isBid ? 'No bid levels received.' : 'No ask levels received.')}</p>}
  </section>;
}

export function MarketDepthModal({ ticker, sessionKey, onClose }: MarketDepthModalProps) {
  const [snapshot, setSnapshot] = useState<MarketDepthSnapshot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const snapshotPublisherRef = useRef<LatestFramePublisher<MarketDepthSnapshot> | null>(null);
  if (!snapshotPublisherRef.current) {
    snapshotPublisherRef.current = createLatestFramePublisher(setSnapshot);
  }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [streamStatus, setStreamStatus] = useState<FreedomMarketDepthStreamStatus>('connecting');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const streamRef = useRef<FreedomMarketDepthStreamRuntime | null>(null);
  if (!streamRef.current) {
    streamRef.current = createFreedomMarketDepthStreamRuntime({
      createTicket: createFreedomMarketDepthStreamTicket,
      buildSocketUrl: buildFreedomMarketDepthStreamSocketUrl,
      onDepth: (symbol, data, updatedAt, activeSessionKey) => {
        if (activeSessionKey !== sessionKey || symbol !== expectedDepthSymbol(ticker)) return;
        try {
          snapshotPublisherRef.current?.publish(groupFreedomMarketDepthByPrice(normalizeMarketDepthSnapshot({
            symbol,
            data,
            updatedAt
          }, ticker)));
          setError('');
          setLoading(false);
        } catch (snapshotError) {
          snapshotPublisherRef.current?.clear();
          setSnapshot(null);
          setLoading(false);
          setError(snapshotError instanceof Error ? snapshotError.message : 'TradeNet Market Depth update was invalid.');
        }
      },
      onStatus: (status, message) => {
        setStreamStatus(status);
        if (status === 'connecting') {
          snapshotPublisherRef.current?.clear();
          setSnapshot(null);
          setError('');
          setLoading(true);
        } else if (status === 'connected') {
          // Transport readiness is not book readiness. Wait for valid depth rows.
          setError('');
          setLoading(false);
        } else if (status === 'error' || status === 'disconnected') {
          // A book from a failed session must never remain visible.
          snapshotPublisherRef.current?.clear();
          setSnapshot(null);
          setError(message || (status === 'error'
            ? 'The live TradeNet Market Depth connection failed.'
            : 'The live Market Depth connection is disconnected.'));
          setLoading(false);
        }
      }
    });
  }
  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: onClose });

  useEffect(() => {
    let active = true;
    snapshotPublisherRef.current?.clear();
    setLoading(true);
    setError('');
    setSnapshot(null);
    setDetailsOpen(false);
    setStreamStatus('connecting');
    const runtime = streamRef.current!;
    void runtime.start(ticker, sessionKey).then((opened) => {
      if (active && !opened && !runtime.isConnected()) {
        setLoading(false);
        setError((current) => current || 'Could not establish the live TradeNet Market Depth stream.');
      }
    });
    return () => {
      active = false;
      snapshotPublisherRef.current?.clear();
      runtime.stop();
    };
  }, [ticker, sessionKey, connectionAttempt]);

  const displayState = getMarketDepthDisplayState(streamStatus, snapshot);
  const liveSnapshot = displayState === 'live' ? snapshot : null;
  const summary = liveSnapshot ? summarizeMarketDepth(liveSnapshot) : null;
  const levelCount = liveSnapshot ? liveSnapshot.bids.length + liveSnapshot.asks.length : 0;
  // Scale the ladder against the same top-five levels that are actually drawn.
  const maxDisplayedBid = liveSnapshot?.bids
    .slice(0, 5)
    .reduce((max, level) => Math.max(max, level.quantity), 0) ?? 0;
  const maxDisplayedAsk = liveSnapshot?.asks
    .slice(0, 5)
    .reduce((max, level) => Math.max(max, level.quantity), 0) ?? 0;
  const maxQuantity = Math.max(maxDisplayedBid, maxDisplayedAsk);
  const hasLevels = Boolean(liveSnapshot && levelCount > 0);
  const imbalanceLabel = summary?.imbalancePercent === null || summary?.imbalancePercent === undefined
    ? '—'
    : `${summary.imbalancePercent > 0 ? '+' : ''}${summary.imbalancePercent.toFixed(1)}% ${depthText(summary.imbalancePercent > 0 ? 'bid-heavy' : summary.imbalancePercent < 0 ? 'ask-heavy' : 'balanced')}`;
  const statusLabel = displayState === 'live' ? 'Live'
    : displayState === 'waiting' ? 'Connected · awaiting data'
      : displayState === 'connecting' ? 'Connecting…'
        : displayState === 'error' ? 'Stream error' : 'Disconnected';
  const statusTone = displayState === 'live'
    ? 'border-emerald-800 bg-emerald-950/30 text-emerald-300'
    : displayState === 'error' || displayState === 'disconnected'
      ? 'border-rose-800 bg-rose-950/30 text-rose-300'
      : 'border-cyan-900 bg-cyan-950/20 text-cyan-200';

  return <div
    class="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/85 p-2 backdrop-blur-sm sm:p-4"
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
  >
    <section
      ref={dialogRef}
      class="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-emerald-900/60 bg-slate-950 shadow-2xl shadow-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="marketDepthTitle"
      tabIndex={-1}
    >
      <header class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-emerald-950/40 via-slate-950 to-rose-950/30 px-4 py-3 sm:px-5">
        <div>
          <div class="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-emerald-300">{depthText('TradeNet · Order Book')}</div>
          <h2 id="marketDepthTitle" class="mt-1 text-xl font-black tracking-tight text-white">{ticker.trim().toUpperCase()} {depthText('Market Depth')}</h2>
          <p class="mt-1 text-xs text-slate-400">{depthText('Authenticated live book · read-only · maximum depth available to this account')}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${statusTone}`} role="status" aria-live="polite" aria-label={depthText(statusLabel)}>
            {displayState === 'live' ? '● ' : ''}{depthText(statusLabel)}
          </span>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={depthText('Close')} class="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800">{depthText('Close')}</button>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5" role="region" aria-labelledby="marketDepthTitle" tabIndex={0}>
        {loading && <p class="mb-3 rounded-lg border border-cyan-900/50 bg-cyan-950/20 px-3 py-3 text-xs text-cyan-200" role="status" aria-live="polite">
          {depthText('Opening the authenticated live book stream…')}
        </p>}
        {error && <div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-800/60 bg-rose-950/30 px-3 py-3 text-xs text-rose-200" role="alert">
          <span>{depthText(error)}</span>
          <button type="button" onClick={() => setConnectionAttempt((attempt) => attempt + 1)} class="shrink-0 rounded-md border border-rose-700/70 px-3 py-1.5 font-semibold text-rose-100 hover:bg-rose-900/40">{depthText('Retry connection')}</button>
        </div>}
        {displayState === 'waiting' && !loading && !error && <p role="status" class="mb-3 rounded-lg border border-cyan-900/50 bg-cyan-950/20 px-3 py-3 text-xs text-cyan-200">{depthText('The live stream is connected. Waiting for the first TradeNet depth update…')}</p>}

        {liveSnapshot && summary && <>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
            <span>{liveSnapshot.symbol} · {depthText('Last depth update')} {new Date(liveSnapshot.updatedAt).toLocaleTimeString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US')}</span>
            <span>
              {liveSnapshot.bids.length} {depthText('bid prices')} / {liveSnapshot.asks.length} {depthText('ask prices')}
              {liveSnapshot.updateCount !== undefined ? ` · ${liveSnapshot.updateCount} updates` : ''}
              {liveSnapshot.sequence !== undefined ? ` · seq ${liveSnapshot.sequence}` : ''}
            </span>
          </div>

          <div class="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
            <div class="rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-3">
              <p class="text-[10px] uppercase tracking-wider text-slate-500">{depthText('Best bid')}</p>
              <p class="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-300">{summary.bestBid ? formatDepthNumber(summary.bestBid.price) : '—'}</p>
              <p class="text-[10px] text-slate-500">{summary.bestBid ? `${formatDepthNumber(summary.bestBid.quantity)} ${depthText('shares')}` : depthText('No quote')}</p>
            </div>
            <div class="rounded-xl border border-rose-900/60 bg-rose-950/20 p-3">
              <p class="text-[10px] uppercase tracking-wider text-slate-500">{depthText('Best ask')}</p>
              <p class="mt-1 font-mono text-lg font-bold tabular-nums text-rose-300">{summary.bestAsk ? formatDepthNumber(summary.bestAsk.price) : '—'}</p>
              <p class="text-[10px] text-slate-500">{summary.bestAsk ? `${formatDepthNumber(summary.bestAsk.quantity)} ${depthText('shares')}` : depthText('No quote')}</p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p class="text-[10px] uppercase tracking-wider text-slate-500">{depthText('Spread')}</p>
              <p class="mt-1 font-mono text-lg font-bold tabular-nums text-white">{summary.spread !== null ? formatDepthNumber(summary.spread) : '—'}</p>
              <p class="text-[10px] text-slate-500">{summary.spreadPercent !== null ? `${summary.spreadPercent.toFixed(3)}% ${depthText('of midpoint')}` : depthText('Two-sided quote unavailable')}</p>
            </div>
            <div class="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
              <p class="text-[10px] uppercase tracking-wider text-slate-500">{depthText('Visible size')}</p>
              <p class="mt-1 font-mono text-sm font-bold tabular-nums text-slate-100">{formatDepthNumber(summary.bidQuantity)} <span class="text-emerald-300">{depthText('bid')}</span></p>
              <p class="font-mono text-sm font-bold tabular-nums text-slate-100">{formatDepthNumber(summary.askQuantity)} <span class="text-rose-300">{depthText('ask')}</span></p>
            </div>
            <div class="col-span-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3 lg:col-span-1">
              <p class="text-[10px] uppercase tracking-wider text-slate-500">{depthText('Book balance')}</p>
              <p class={`mt-1 font-mono text-lg font-bold tabular-nums ${summary.imbalancePercent === null ? 'text-slate-400' : summary.imbalancePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{imbalanceLabel}</p>
              <p class="text-[10px] text-slate-500">{depthText('Visible size imbalance')}</p>
            </div>
          </div>
          {summary.spread !== null && summary.spread < 0 && <p role="alert" class="mb-4 rounded-lg border border-rose-800/70 bg-rose-950/30 px-3 py-2 text-xs font-semibold text-rose-200">
            {depthText('Crossed order book: highest bid is above lowest ask. Treat this snapshot as inconsistent and do not rely on its displayed liquidity.')}
          </p>}

          {hasLevels ? <section aria-label={depthText('Proportional market depth ladder')} class="mb-4">
            <div class="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div><h3 class="text-sm font-bold text-slate-100">{depthText('Price-grouped liquidity ladder')}</h3><p class="text-[10px] text-slate-500">{depthText('Quantities at identical prices are combined · bars scale to the largest displayed price level')}</p></div>
              {summary.midpoint !== null && <span class="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[10px] font-mono text-slate-300">{depthText('Mid')} {formatDepthNumber(summary.midpoint)}</span>}
            </div>
            <div class="grid gap-3 md:grid-cols-2">
              <MarketDepthSide side="bids" levels={liveSnapshot.bids} maxQuantity={maxQuantity} />
              <MarketDepthSide side="asks" levels={liveSnapshot.asks} maxQuantity={maxQuantity} />
            </div>
          </section> : <div class="mb-4 rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-200" role="status">
            {depthText('No price levels were received for this symbol. TradeNet may not provide depth for every instrument or market session.')}
          </div>}

          <details
            class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60"
            onToggle={(event: Event) => setDetailsOpen((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary class="cursor-pointer list-none px-3 py-3 text-xs font-bold text-cyan-200 hover:bg-slate-900/70">
              <span class="mr-2 text-cyan-400">＋</span>{depthText('Detailed level table')} · {levelCount} {depthText('distinct prices')}
            </summary>
            {detailsOpen && <div class="max-h-80 overflow-y-auto border-t border-slate-800 p-3">
              <div class="grid gap-3 md:grid-cols-2">
              {(['bids', 'asks'] as const).map((side) => <div key={side} class="min-w-0 overflow-x-auto">
                <h4 class={`mb-1 text-[10px] font-bold uppercase tracking-wider ${side === 'bids' ? 'text-emerald-300' : 'text-rose-300'}`}>{depthText(side === 'bids' ? 'Bids' : 'Asks')}</h4>
                <table class="w-full min-w-[300px] text-right text-[10px] tabular-nums">
                  <thead class="sticky top-0 bg-slate-950 text-slate-500"><tr>
                    <th scope="col" class="px-2 py-1 text-left">{depthText('Level')}</th>
                    <th scope="col" class="px-2 py-1">{depthText('Price')}</th>
                    <th scope="col" class="px-2 py-1">{depthText('Size')}</th>
                    <th scope="col" class="px-2 py-1">{depthText('Cumulative')}</th>
                  </tr></thead>
                  <tbody>{(() => {
                    let cumulative = 0;
                    const rows = liveSnapshot[side].map((level) => {
                      cumulative += level.quantity;
                      return { level, cumulative };
                    });
                    return rows.length ? rows.map(({ level, cumulative: cumulativeQuantity }) => <tr key={level.position} class="border-t border-slate-800 text-slate-300">
                      <td class="px-2 py-1.5 text-left">{level.position + 1}</td>
                      <td class="px-2 py-1.5">{formatDepthNumber(level.price)}</td>
                      <td class="px-2 py-1.5">{formatDepthNumber(level.quantity)}</td>
                      <td class="px-2 py-1.5">{formatDepthNumber(cumulativeQuantity)}</td>
                    </tr>) : <tr><td colSpan={4} class="px-2 py-3 text-center text-slate-500">{depthText('No levels received.')}</td></tr>;
                  })()}</tbody>
                </table>
              </div>)}
              </div>
            </div>}
          </details>

          <p class="mt-3 text-[10px] leading-relaxed text-slate-500">
            {depthText('Displayed size is the quantity visible in this live book, not total exchange liquidity. Rows at identical prices are combined.')}
            {' '}{depthText('Visible levels:')} {liveSnapshot.bids.length} {depthText('bid')} / {liveSnapshot.asks.length} {depthText('ask')}.
            {liveSnapshot.reportedDepth !== undefined ? ` ${depthText('TradeNet depth indicator:')} ${liveSnapshot.reportedDepth} (${depthText('provider metadata, not a UI level target')}).` : ''}
            {liveSnapshot.insertionsApplied !== undefined || liveSnapshot.rowUpdatesApplied !== undefined || liveSnapshot.deletionsApplied !== undefined
              ? ` ${depthText('Changes captured:')} +${liveSnapshot.insertionsApplied ?? 0} / ~${liveSnapshot.rowUpdatesApplied ?? 0} / −${liveSnapshot.deletionsApplied ?? 0}.`
              : ''}
          </p>
        </>}
        {displayState === 'disconnected' && !error && !loading && <p role="status" class="rounded-lg border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-200">
          {depthText('No live Market Depth data is available.')}
        </p>}
      </div>
    </section>
  </div>;
}
