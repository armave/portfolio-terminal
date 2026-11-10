import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CommandDispatcher } from '../features/terminal/commandDispatcher';
import {
  loadBuyMorePreferences, saveBuyMorePreferences, type BuyMoreSavedResult
} from '../features/terminal/buyMorePreferences';
import type { ScenarioModalData } from '../features/terminal/scenarioContracts';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';
import { useDialogFocus } from '../ui/dialogFocus';
import { ModalFrame } from './ModalFrame';

interface BuyMoreModalProps { initialTicker?: string; storageKey: string; onClose: () => void; }
interface BuyMorePositionReference {
  shares?: number; currentPrice?: number; pt?: number;
  tranches?: Array<{ qty: number; price: number }>;
}
function getAverageEntry(position?: BuyMorePositionReference): number | null {
  if (!position) return null;
  const shares = Number(position.shares);
  const cost = (position.tranches || []).reduce((sum, tranche) => {
    const quantity = Number(tranche.qty), price = Number(tranche.price);
    return sum + (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price > 0 ? quantity * price : 0);
  }, 0);
  return Number.isFinite(shares) && shares > 0 && cost > 0 ? cost / shares : null;
}
function getReferencePrice(position?: BuyMorePositionReference): number | null {
  if (!position) return null;
  const quote = Number(position.currentPrice);
  return Number.isFinite(quote) && quote > 0 ? quote : getAverageEntry(position);
}
function makeDefaultInputs(ticker: string, position?: BuyMorePositionReference) {
  const reference = getReferencePrice(position);
  return {
    ticker,
    shares: String(Math.max(1, Math.floor((Number(position?.shares) || 0) / 2))),
    price: reference === null ? '' : reference.toFixed(2)
  };
}
function formatQuantity(value: number, language: 'en' | 'ru'): string {
  return new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 6 }).format(value);
}
function formatSavedTime(timestamp: number, language: 'en' | 'ru'): string {
  try {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
  } catch { return ''; }
}
function resultsMatch(left: BuyMoreSavedResult | null, right: BuyMoreSavedResult): boolean {
  if (!left) return false;
  const comparable = (value: BuyMoreSavedResult) => ({
    columns: value.columns, rows: value.rows, note: value.note, summary: value.summary
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}
function makeSavedResult(
  data: Extract<ScenarioModalData, { kind: 'buy-more' }>, summary: string
): BuyMoreSavedResult {
  return {
    savedAt: Date.now(), columns: [...data.columns],
    rows: data.rows.map(row => ({
      label: row.label, values: [...row.values], ...(row.kind ? { kind: row.kind } : {})
    })),
    note: data.note, summary
  };
}
function rowLabel(label: string, language: 'en' | 'ru'): string {
  return label.replace(/TODAY/g, translateText('TODAY', language));
}
function valueTone(value: string): string {
  if (value.startsWith('-') || value.startsWith('−')) return 'text-rose-300';
  if (value.startsWith('+')) return 'text-emerald-300';
  return 'text-slate-200';
}

export function BuyMoreModal({ initialTicker, storageKey, onClose }: BuyMoreModalProps) {
  const state = usePortfolio();
  const language = getAppLanguage();
  const tickers = Object.keys(state.positions || {}).filter(ticker => Number(state.positions[ticker]?.shares) > 0).sort();
  const savedPreferences = useMemo(() => loadBuyMorePreferences(storageKey), [storageKey]);
  const requestedTicker = initialTicker?.toUpperCase();
  const defaultTicker = requestedTicker && tickers.includes(requestedTicker)
    ? requestedTicker
    : savedPreferences?.ticker && tickers.includes(savedPreferences.ticker)
      ? savedPreferences.ticker
      : tickers.includes(String(state.activeView || '').toUpperCase())
        ? String(state.activeView).toUpperCase()
        : tickers[0] || '';
  const restoredPreferences = savedPreferences && savedPreferences.ticker === defaultTicker &&
    (!requestedTicker || requestedTicker === savedPreferences.ticker) ? savedPreferences : null;

  const [ticker, setTicker] = useState(defaultTicker);
  const [sharesInput, setSharesInput] = useState(() =>
    restoredPreferences?.shares ?? makeDefaultInputs(defaultTicker, state.positions[defaultTicker]).shares
  );
  const [priceInput, setPriceInput] = useState(() =>
    restoredPreferences?.price ?? makeDefaultInputs(defaultTicker, state.positions[defaultTicker]).price
  );
  const [savedResult, setSavedResult] = useState<BuyMoreSavedResult | null>(() => restoredPreferences?.lastResult ?? null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const requestClose = () => { closeRef.current?.(); };

  const position = ticker ? state.positions[ticker] : undefined;
  const currentShares = Number(position?.shares) || 0;
  const averageEntry = getAverageEntry(position);
  const marketQuote = Number(position?.currentPrice) > 0 ? Number(position?.currentPrice) : null;
  const targetPrice = Number(position?.pt) > 0 ? Number(position?.pt) : null;
  const shares = Number(sharesInput.trim());
  const purchasePrice = Number(priceInput.trim());
  const inputsValid = Boolean(position && currentShares > 0 &&
    Number.isFinite(shares) && shares > 0 && Number.isFinite(purchasePrice) && purchasePrice > 0 &&
    Number.isFinite(shares * purchasePrice));
  const preview = useMemo(() => {
    if (!ticker || !position || !inputsValid) return null;
    return CommandDispatcher.previewBuyMoreScenario(ticker, shares, purchasePrice);
  }, [state, ticker, sharesInput, priceInput, inputsValid]);
  const resultData = preview?.type === 'res' && preview.modal?.kind === 'buy-more' ? preview.modal : null;
  const resultError = preview?.type === 'err' ? preview.text : null;
  const displayedResult = resultError ? null : resultData ?? savedResult;
  const displayedSummary = resultError ? '' : resultData ? preview?.text ?? '' : savedResult?.summary ?? '';
  const isSavedFallback = !resultError && !resultData && Boolean(savedResult);

  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: requestClose });
  useEffect(() => {
    if (!ticker) return;
    let nextResult = savedResult;
    if (resultData && preview?.text) {
      const candidate = makeSavedResult(resultData, preview.text);
      if (resultsMatch(savedResult, candidate)) nextResult = savedResult;
      else { nextResult = candidate; setSavedResult(candidate); }
    }
    saveBuyMorePreferences(storageKey, { version: 1, ticker, shares: sharesInput, price: priceInput, lastResult: nextResult });
  }, [storageKey, ticker, sharesInput, priceInput, resultData, preview?.text, savedResult]);

  const changeTicker = (nextTicker: string) => {
    setTicker(nextTicker);
    const defaults = makeDefaultInputs(nextTicker, state.positions[nextTicker]);
    setSharesInput(defaults.shares);
    setPriceInput(defaults.price);
    setSavedResult(null);
  };
  const resetDefaults = () => {
    const defaults = makeDefaultInputs(ticker, position);
    setSharesInput(defaults.shares);
    setPriceInput(defaults.price);
    setSavedResult(null);
  };
  const useMarketQuote = () => { if (marketQuote !== null) setPriceInput(marketQuote.toFixed(2)); };

  const projectionPrice = targetPrice ?? marketQuote ?? averageEntry;
  const purchaseValue = inputsValid ? shares * purchasePrice : null;
  const projectedShares = inputsValid ? currentShares + shares : null;
  const projectedAverage = inputsValid && averageEntry !== null
    ? (averageEntry * currentShares + purchaseValue!) / (currentShares + shares) : null;
  const tableRows = displayedResult?.rows ?? [];

  return createPortal(
    <ModalFrame
      backdropId="buyMoreModal"
      backdropClassName="buy-more-backdrop fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-black/80 p-2 backdrop-blur-sm sm:p-4"
      dialogId="buyMoreDialog"
      dialogClassName="buy-more-dialog flex max-h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-purple-900/50 bg-slate-950 shadow-2xl shadow-black/60"
      dialogRef={dialogRef}
      ariaLabelledBy="buyMoreTitle"
      closeRef={closeRef}
      onClose={onClose}
    >
      <header class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-950 to-purple-950/30 px-4 py-3 sm:px-6 sm:py-4">
        <div class="min-w-0">
          <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-purple-300">{translateText('MARKET TOOLS', language)}</span>
          <h2 id="buyMoreTitle" class="mt-1 text-lg font-bold text-white sm:text-xl">{translateText('Buy More', language)}</h2>
          <p class="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">{translateText('Preview how a hypothetical purchase changes average entry, P&L and margin exposure. No order is placed.', language)}</p>
        </div>
        <button
          ref={closeButtonRef} type="button" onClick={requestClose}
          aria-label={translateText('Close Buy More', language)}
          class="min-h-11 shrink-0 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >{translateText('Close · Esc', language)}</button>
      </header>

      <div class="min-h-0 space-y-4 overflow-y-auto p-3 sm:p-5">
        <section class="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4" aria-label={translateText('Buy More Scenario', language)}>
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-xs font-bold uppercase tracking-[0.14em] text-slate-300">{translateText('Buy More Scenario', language)}</h3>
            <button type="button" onClick={resetDefaults} disabled={!position}
              class="min-h-10 rounded-lg border border-slate-700 px-3 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >{translateText('Reset defaults', language)}</button>
          </div>
          {tickers.length === 0 ? (
            <p role="status" class="rounded-lg border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-200">
              {translateText('There are no open positions available for a buy-more preview.', language)}
            </p>
          ) : (
            <>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                <label class="block min-w-0">
                  <span class="mb-1.5 block text-[11px] font-semibold text-slate-400">{translateText('Position', language)}</span>
                  <select value={ticker} onChange={event => changeTicker((event.currentTarget as HTMLSelectElement).value)}
                    class="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
                  >
                    <option value="">{translateText('Choose a position', language)}</option>
                    {tickers.map(symbol => <option key={symbol} value={symbol}>
                      {symbol} · {formatQuantity(Number(state.positions[symbol]?.shares) || 0, language)} {translateText('shares', language)}
                    </option>)}
                  </select>
                </label>
                <label class="block min-w-0">
                  <span class="mb-1.5 block text-[11px] font-semibold text-slate-400">{translateText('Additional shares', language)}</span>
                  <input type="number" inputMode="decimal" min="0.000001" step="any" value={sharesInput}
                    onInput={event => setSharesInput((event.currentTarget as HTMLInputElement).value)}
                    disabled={!position} aria-label={translateText('Additional shares', language)}
                    class="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-mono text-white tabular-nums disabled:opacity-50"
                  />
                </label>
                <label class="block min-w-0">
                  <span class="mb-1.5 block text-[11px] font-semibold text-slate-400">{translateText('Purchase price', language)}</span>
                  <div class="relative">
                    <span aria-hidden="true" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
                    <input type="number" inputMode="decimal" min="0.000001" step="any" value={priceInput}
                      onInput={event => setPriceInput((event.currentTarget as HTMLInputElement).value)}
                      disabled={!position} aria-label={translateText('Purchase price', language)}
                      class="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-7 pr-3 text-sm font-mono text-white tabular-nums disabled:opacity-50"
                    />
                  </div>
                </label>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={useMarketQuote} disabled={marketQuote === null}
                  class="min-h-10 rounded-lg border border-cyan-900/70 bg-cyan-950/20 px-3 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-950/50 disabled:cursor-not-allowed disabled:opacity-40"
                >{translateText('Use market quote', language)}</button>
                <button type="button" onClick={() => averageEntry !== null && setPriceInput(averageEntry.toFixed(2))}
                  disabled={averageEntry === null}
                  class="min-h-10 rounded-lg border border-slate-700 px-3 text-[11px] font-semibold text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >{translateText('Use average entry', language)}</button>
              </div>
            </>
          )}
        </section>

        {position && <section class="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={translateText('Current position', language)}>
          {[
            { label: 'Current shares', value: formatQuantity(currentShares, language) },
            { label: 'Average entry', value: averageEntry === null ? '—' : formatUSD(averageEntry) },
            { label: 'Market quote', value: marketQuote === null ? '—' : formatUSD(marketQuote) },
            { label: 'Target price', value: targetPrice === null ? '—' : formatUSD(targetPrice) }
          ].map(metric => <div key={metric.label} class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
            <div class="text-[10px] font-medium text-slate-500">{translateText(metric.label, language)}</div>
            <div class="mt-1 truncate text-sm font-semibold text-slate-100 tabular-nums">{metric.value}</div>
          </div>)}
        </section>}

        {position && inputsValid && <section class="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={translateText('After purchase', language)}>
          {[
            { label: 'Purchase value · excl fees', value: formatUSD(purchaseValue!) },
            { label: 'Projected shares', value: formatQuantity(projectedShares!, language) },
            { label: 'Projected average entry', value: projectedAverage === null ? '—' : formatUSD(projectedAverage) },
            { label: 'Projection price', value: projectionPrice === null ? '—' : formatUSD(projectionPrice) }
          ].map(metric => <div key={metric.label} class="min-w-0 rounded-lg border border-purple-900/60 bg-purple-950/20 px-3 py-2.5">
            <div class="text-[10px] font-medium text-purple-200/70">{translateText(metric.label, language)}</div>
            <div class="mt-1 truncate text-sm font-semibold text-purple-100 tabular-nums">{metric.value}</div>
          </div>)}
        </section>}

        {position && !inputsValid && <p role="status" class="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3 py-2.5 text-xs text-amber-200">
          {translateText('Enter a positive share amount and purchase price to calculate this scenario.', language)}
        </p>}
        {resultError && !resultData && <div role="alert" class="rounded-lg border border-rose-900/60 bg-rose-950/20 px-3 py-2.5 text-xs text-rose-200">
          <p>{translateText(resultError, language)}</p>
          {typeof preview?.maxSafeShares === 'number' && preview.maxSafeShares > 0 && <div class="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSharesInput(String(preview.maxSafeShares))}
              class="min-h-10 rounded-lg border border-rose-700/70 bg-rose-950/40 px-3 py-1.5 text-[11px] font-semibold text-rose-100 hover:bg-rose-900/50"
            >{translateText('Use maximum safe quantity', language)} · {formatQuantity(preview.maxSafeShares, language)}</button>
          </div>}
        </div>}

        {displayedResult && <section class="space-y-3" aria-label={translateText('Buy More results', language)}>
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-white">{translateText('Buy More results', language)}</h3>
              <p class="mt-1 text-[10px] text-slate-500">{displayedResult.note ? translateText(displayedResult.note, language) : ''}</p>
            </div>
            {resultData && <span class="rounded-full border border-emerald-800/60 bg-emerald-950/20 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">{translateText('Updated live', language)}</span>}
          </div>
          <div class="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/60">
            <table class="w-full min-w-[900px] border-collapse text-xs tabular-nums">
              <caption class="sr-only">{translateText('Current position and after purchase projection amounts by date.', language)}</caption>
              <thead>
                <tr class="border-b border-slate-700 bg-slate-900/90 text-[11px]">
                  <th scope="col" rowSpan={2} class="sticky left-0 z-20 min-w-32 bg-slate-900 px-3 py-3 text-left font-semibold text-slate-300">{translateText('Date', language)}</th>
                  <th scope="colgroup" colSpan={4} class="border-l border-slate-700 bg-slate-900/80 px-3 py-3 text-center font-bold text-cyan-200">{translateText('Current position', language)}</th>
                  <th scope="colgroup" colSpan={4} class="border-l border-slate-700 bg-purple-950/30 px-3 py-3 text-center font-bold text-purple-200">{translateText('After purchase', language)}</th>
                </tr>
                <tr class="border-b border-slate-700 bg-slate-900/70 text-[10px] font-semibold text-slate-400">
                  {['Net P&L', 'Fees & commissions', 'Margin fee', 'Balance', 'Net P&L', 'Fees & commissions', 'Margin fee', 'Balance'].map((heading,index) =>
                    <th key={heading + index} scope="col" class={(index === 0 || index === 4 ? 'border-l border-slate-700 ' : '') + 'whitespace-nowrap px-3 py-2 text-right'}>
                      {translateText(heading, language)}
                    </th>)}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row,index) => {
                  const current = [row.values[0],row.values[2],row.values[4],row.values[6]];
                  const projected = [row.values[1],row.values[3],row.values[5],row.values[7]];
                  const rowClass = row.kind === 'result' ? 'border-b border-cyan-900/60 bg-cyan-950/20'
                    : index % 2 === 0 ? 'border-b border-slate-800/70 bg-slate-900/20' : 'border-b border-slate-800/70';
                  return <tr key={row.label + '-' + index} class={rowClass}>
                    <th scope="row" class="sticky left-0 z-10 whitespace-nowrap bg-slate-950/95 px-3 py-2 text-left font-semibold text-slate-300">{rowLabel(row.label,language)}</th>
                    {current.map((value,valueIndex) => <td key={'current-' + valueIndex} class={'whitespace-nowrap px-3 py-2 text-right ' + valueTone(value)}>{value}</td>)}
                    {projected.map((value,valueIndex) => <td key={'projected-' + valueIndex} class={'whitespace-nowrap border-l border-slate-800/80 px-3 py-2 text-right ' + valueTone(value)}>{value}</td>)}
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {displayedSummary && <details class="rounded-lg border border-slate-800 bg-slate-900/40">
            <summary class="cursor-pointer px-3 py-2.5 text-xs font-semibold text-slate-300">{translateText('Scenario summary', language)}</summary>
            <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-slate-800 px-3 py-3 text-[11px] leading-relaxed text-slate-300">{translateText(displayedSummary, language)}</pre>
          </details>}
        </section>}

        {isSavedFallback && <p role="status" class="rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2.5 text-[11px] text-amber-200">
          {translateText('This is the last saved estimate. Current inputs or portfolio data do not support a fresh calculation.', language)}
        </p>}
        <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <p>{translateText('Inputs and latest results are saved automatically in this browser for this account.', language)}</p>
          {savedResult && <p>{translateText('Last saved', language)} · {formatSavedTime(savedResult.savedAt, language)}</p>}
        </div>
        <p class="rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2.5 text-[10px] leading-relaxed text-slate-400">
          {translateText('Estimate only. The model uses your saved shares, cost basis, commission settings, account balance and estimated margin interest. Future prices are assumptions; nothing is changed and no broker order is submitted.', language)}
        </p>
      </div>
    </ModalFrame>,
    document.body
  );
}
