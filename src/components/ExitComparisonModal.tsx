import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { CommandDispatcher } from '../features/terminal/commandDispatcher';
import {
  addCalendarDays,
  getExitDayOffset,
  getExitDurationParts,
  loadExitComparisonPreferences,
  saveExitComparisonPreferences,
  toLocalIsoDate,
  type ExitComparisonPeriodInput,
  type ExitComparisonSavedResult
} from '../features/terminal/exitComparisonPreferences';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatUSDDisplayValue } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';
import { useDialogFocus } from '../ui/dialogFocus';
import { ModalFrame } from './ModalFrame';
import { scheduleDialogClose } from '../ui/dialogClose';

interface ExitComparisonModalProps {
  initialTicker?: string;
  storageKey: string;
  onClose: () => void;
}

const PERIOD_PRESETS = [0, 7, 14, 30, 60, 90, 180];

interface ExitPositionReference {
  currentPrice?: number;
  shares?: number;
  tranches?: Array<{ qty: number; price: number }>;
}

function getReferencePrice(position?: ExitPositionReference): number | null {
  if (!position) return null;
  const quote = Number(position.currentPrice);
  if (Number.isFinite(quote) && quote > 0) return quote;
  const shares = Number(position.shares);
  const cost = (position.tranches || []).reduce((sum, tranche) => {
    const quantity = Number(tranche.qty);
    const price = Number(tranche.price);
    return sum + (Number.isFinite(quantity) && quantity > 0 && Number.isFinite(price) && price > 0 ? quantity * price : 0);
  }, 0);
  return Number.isFinite(shares) && shares > 0 && cost > 0 ? cost / shares : null;
}

function makeDefaultPeriods(position?: ExitPositionReference, today = toLocalIsoDate()): [ExitComparisonPeriodInput, ExitComparisonPeriodInput] {
  const reference = getReferencePrice(position);
  const firstPrice = reference === null ? '' : reference.toFixed(2);
  const secondPrice = reference === null ? '' : (reference * 1.03).toFixed(2);
  return [
    { date: today, price: firstPrice },
    { date: addCalendarDays(today, 14), price: secondPrice }
  ];
}

function parseSignedMoney(value?: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '').replace(/[^0-9.+-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSignedMoney(value: number): string {
  return (value > 0 ? '+' : value < 0 ? '−' : '') + formatUSD(Math.abs(value));
}

function formatSavedTime(timestamp: number, language: 'en' | 'ru'): string {
  try {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function formatDurationUnit(value: number, unit: 'month' | 'day', language: 'en' | 'ru'): string {
  try {
    return new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      style: 'unit',
      unit,
      unitDisplay: 'long'
    }).format(value);
  } catch {
    const englishUnit = unit === 'month'
      ? (value === 1 ? 'month' : 'months')
      : (value === 1 ? 'day' : 'days');
    return value + ' ' + englishUnit;
  }
}

function formatLongDuration(days: number, language: 'en' | 'ru'): string {
  const parts = getExitDurationParts(days);
  if (!parts) return formatDurationUnit(days, 'day', language);
  const units: string[] = [];
  if (parts.months > 0) units.push(formatDurationUnit(parts.months, 'month', language));
  if (parts.days > 0) units.push(formatDurationUnit(parts.days, 'day', language));
  return units.join(language === 'ru' ? ' и ' : ' and ');
}

function formatPresetPeriod(days: number, language: 'en' | 'ru'): string {
  if (days === 0) return translateText('Today', language);
  if (days <= 31) return days + 'd';
  return formatLongDuration(days, language);
}

function translatePeriodName(days: number, language: 'en' | 'ru'): string {
  if (days === 0) return translateText('Today', language);
  if (days > 31) {
    return translateText('In {duration}', language).replace('{duration}', formatLongDuration(days, language));
  }
  return translateText('In {days} days', language).replace('{days}', String(days));
}

function formatResultColumn(
  column: string,
  index: number,
  isFresh: boolean,
  offsets: Array<number | null>,
  prices: number[],
  language: 'en' | 'ru'
): string {
  const days = offsets[index];
  if (isFresh && days !== null && Number.isFinite(prices[index]) && prices[index] > 0) {
    return translatePeriodName(days, language) + ' · ' + formatUSD(prices[index]);
  }
  return column
    .replace(/\s·\sBEST$/, '')
    .replace(/^Today(?=\s·)/, translateText('Today', language))
    .replace(/^(\d+) Days(?=\s·)/, (_match, value: string) => translatePeriodName(Number(value), language));
}

function resultsMatch(left: ExitComparisonSavedResult | null, right: ExitComparisonSavedResult): boolean {
  if (!left || left.columns.some((value, index) => value !== right.columns[index]) || left.rows.length !== right.rows.length) return false;
  return left.rows.every((row, index) => {
    const other = right.rows[index];
    return row.label === other.label &&
      row.values.every((value, valueIndex) => value === other.values[valueIndex]) &&
      (row.deltas || []).every((value, valueIndex) => value === (other.deltas || [])[valueIndex]);
  });
}

export function ExitComparisonModal({ initialTicker, storageKey, onClose }: ExitComparisonModalProps) {
  const state = usePortfolio();
  const language = getAppLanguage();
  const tickers = Object.keys(state.positions || {}).filter((ticker) => Number(state.positions[ticker]?.shares) > 0).sort();
  const savedPreferences = useMemo(() => loadExitComparisonPreferences(storageKey), [storageKey]);
  const requestedTicker = initialTicker?.toUpperCase();
  const defaultTicker = requestedTicker && tickers.includes(requestedTicker)
    ? requestedTicker
    : savedPreferences?.ticker && tickers.includes(savedPreferences.ticker)
      ? savedPreferences.ticker
      : tickers.includes(String(state.activeView || '').toUpperCase())
        ? String(state.activeView).toUpperCase()
        : tickers[0] || '';
  const restoredPreferences = savedPreferences && savedPreferences.ticker === defaultTicker &&
    (!requestedTicker || requestedTicker === savedPreferences.ticker)
    ? savedPreferences
    : null;

  const [ticker, setTicker] = useState(defaultTicker);
  const [periods, setPeriods] = useState<[ExitComparisonPeriodInput, ExitComparisonPeriodInput]>(() =>
    restoredPreferences?.periods ?? makeDefaultPeriods(state.positions[defaultTicker])
  );
  const [savedResult, setSavedResult] = useState<ExitComparisonSavedResult | null>(() => restoredPreferences?.lastResult ?? null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => restoredPreferences?.lastResult?.savedAt ?? null);
  const [isClosing, setIsClosing] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const closingRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const cancelCloseRef = useRef<(() => void) | null>(null);
  const today = toLocalIsoDate();
  const maximumDate = addCalendarDays(today, 3650);
  const position = ticker ? state.positions[ticker] : undefined;
  const referencePrice = getReferencePrice(position);
  const shares = Number(position?.shares) || 0;

  const offsets = periods.map((period) => getExitDayOffset(period.date, today));
  const prices = periods.map((period) => Number(period.price));
  const inputsValid = Boolean(position && shares > 0 &&
    offsets.every((days) => days !== null) &&
    prices.every((price) => Number.isFinite(price) && price > 0));

  const preview = useMemo(() => {
    if (!ticker || !position || !inputsValid) return null;
    const scenarios = offsets.map((days, index) => ({
      label: translatePeriodName(days as number, language),
      days: days as number,
      price: prices[index]
    }));
    return CommandDispatcher.previewExitComparison(ticker, scenarios);
  }, [state, ticker, periods[0].date, periods[0].price, periods[1].date, periods[1].price, inputsValid, language]);
  const resultData = preview?.type === 'res' && preview.modal?.kind === 'exit-comparison' ? preview.modal : null;
  const displayedResult = resultData ?? (!inputsValid ? savedResult : null);
  const netRow = displayedResult?.rows.find((row) => row.label === 'Net P&L');
  const netValues = netRow?.values.map(parseSignedMoney) ?? [];
  const netDifference = netValues.length === 2 && netValues[0] !== null && netValues[1] !== null
    ? netValues[1] - netValues[0]
    : null;
  const bestIndex = netRow?.deltas?.findIndex((delta) => delta?.includes('BEST')) ?? -1;

  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setIsClosing(true);
    const prefersReducedMotion = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    cancelCloseRef.current = scheduleDialogClose(onClose, prefersReducedMotion ? 0 : 200);
  };

  useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onEscape: requestClose });

  useEffect(() => () => {
    cancelCloseRef.current?.();
    cancelCloseRef.current = null;
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!closingRef.current) setIsOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!ticker) return;
    const nextResult: ExitComparisonSavedResult | null = resultData ? {
      savedAt: Date.now(),
      columns: [resultData.columns[0], resultData.columns[1]],
      rows: resultData.rows.map((row) => ({
        label: row.label,
        values: [row.values[0] ?? '—', row.values[1] ?? '—'],
        ...(row.kind ? { kind: row.kind } : {}),
        ...(row.deltas ? { deltas: [row.deltas[0], row.deltas[1]] } : {})
      })),
      note: resultData.note,
      summary: preview?.text ?? ''
    } : savedResult;
    if (nextResult) {
      const snapshot = nextResult;
      if (resultData && resultsMatch(savedResult, snapshot) && lastSavedAt !== null) {
        snapshot.savedAt = lastSavedAt;
      }
      saveExitComparisonPreferences(storageKey, {
        version: 1,
        ticker,
        periods,
        lastResult: snapshot
      });
      if (resultData && snapshot.savedAt !== lastSavedAt) {
        setSavedResult(snapshot);
        setLastSavedAt(snapshot.savedAt);
      }
    } else {
      saveExitComparisonPreferences(storageKey, {
        version: 1,
        ticker,
        periods,
        lastResult: null
      });
    }
  }, [storageKey, ticker, periods[0].date, periods[0].price, periods[1].date, periods[1].price, resultData?.columns.join('|'), preview?.text, savedResult, lastSavedAt]);

  const updatePeriod = (index: 0 | 1, changes: Partial<ExitComparisonPeriodInput>) => {
    setPeriods((previous) => previous.map((period, periodIndex) =>
      periodIndex === index ? { ...period, ...changes } : period
    ) as [ExitComparisonPeriodInput, ExitComparisonPeriodInput]);
  };

  const changeTicker = (nextTicker: string) => {
    setTicker(nextTicker);
    setPeriods(makeDefaultPeriods(state.positions[nextTicker]));
    setSavedResult(null);
    setLastSavedAt(null);
  };

  const setPeriodOffset = (index: 0 | 1, days: number) => {
    updatePeriod(index, { date: addCalendarDays(today, days) });
  };

  const resetPeriods = () => {
    setPeriods(makeDefaultPeriods(position));
    setSavedResult(null);
    setLastSavedAt(null);
  };

  const swapPeriods = () => {
    setPeriods(([first, second]) => [second, first]);
    setSavedResult(null);
    setLastSavedAt(null);
  };

  const useReferencePrice = (index: 0 | 1, increase = 1) => {
    if (referencePrice === null) return;
    updatePeriod(index, { price: (referencePrice * increase).toFixed(2) });
  };

  const periodCards = ([0, 1] as const).map((index) => {
    const offset = offsets[index];
    const periodName = offset === null ? translateText('Choose a valid date', language) : translatePeriodName(offset, language);
    const label = index === 0 ? translateText('Period A', language) : translateText('Period B', language);
    const period = periods[index];
    return (
      <section key={label} class="min-w-0 rounded-xl border border-slate-700/80 bg-slate-900/65 p-3 sm:p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div>
            <span class="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">{label}</span>
            <h3 class="mt-1 text-sm font-semibold text-white">{periodName}</h3>
          </div>
          {bestIndex === index && <span class="rounded-full border border-emerald-700/60 bg-emerald-950/60 px-2 py-1 text-[10px] font-bold text-emerald-300">{translateText('BEST RESULT', language)}</span>}
        </div>
        <label class="mb-1 block text-[11px] font-medium text-slate-400" for={`exitDate${index}`}>{translateText('Exit date', language)}</label>
        <input
          id={`exitDate${index}`}
          aria-label={label + ' · ' + translateText('Exit date', language)}
          type="date"
          min={today}
          max={maximumDate}
          value={period.date}
          onInput={(event) => updatePeriod(index, { date: (event.currentTarget as HTMLInputElement).value })}
          class="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 [color-scheme:dark] focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
        />
        <label class="mb-1 mt-3 block text-[11px] font-medium text-slate-400" for={`exitPrice${index}`}>{translateText('Expected exit price', language)}</label>
        <div class="flex gap-2">
          <div class="relative min-w-0 flex-1">
            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
            <input
              id={`exitPrice${index}`}
              aria-label={label + ' · ' + translateText('Expected exit price', language)}
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={period.price}
              placeholder="0.00"
              onInput={(event) => updatePeriod(index, { price: (event.currentTarget as HTMLInputElement).value })}
              class="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-7 pr-3 text-right font-mono text-sm text-slate-100 tabular-nums focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
            />
          </div>
          <button
            type="button"
            disabled={referencePrice === null}
            onClick={() => useReferencePrice(index)}
            class="min-h-11 shrink-0 rounded-lg border border-slate-700 px-3 text-[11px] font-semibold text-slate-300 hover:border-cyan-700 hover:bg-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            title={translateText('Use the latest available quote, or average entry if no quote is available', language)}
          >{translateText('Use reference', language)}</button>
        </div>
        <div class="mt-3 flex flex-wrap gap-1.5" aria-label={label + ' · ' + translateText('Exit date presets', language)}>
          {PERIOD_PRESETS.map((days) => <button
            key={days}
            type="button"
            onClick={() => setPeriodOffset(index, days)}
            class={'min-h-11 rounded-lg border px-2.5 text-[10px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ' +
              (offset === days ? 'border-cyan-600 bg-cyan-950/60 text-cyan-100' : 'border-slate-700 bg-slate-950/70 text-slate-400 hover:border-slate-500 hover:text-slate-200')}
          >{formatPresetPeriod(days, language)}</button>)}
        </div>
      </section>
    );
  });

  const resultRows = displayedResult?.rows ?? [];
  const hasLiveResult = Boolean(resultData);
  const savedFallback = !hasLiveResult && Boolean(savedResult);
  const positionSummary = position
    ? `${shares.toLocaleString()} ${translateText('shares', language)} · ${referencePrice === null ? translateText('Reference price unavailable', language) : translateText('Reference', language) + ' ' + formatUSD(referencePrice)}`
    : translateText('No open position selected', language);

  return createPortal(
    <ModalFrame
      backdropId="exitComparisonModal"
      backdropClassName={'exit-comparison-backdrop fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm transition-opacity duration-200 ease-out motion-reduce:transition-none ' + (isClosing || !isOpen ? 'opacity-0' : 'opacity-100')}
      dialogId="exitComparisonDialog"
      dialogClassName={'exit-comparison-dialog flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-900/50 bg-slate-950 shadow-2xl shadow-black/60 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ' + (isClosing || !isOpen ? 'translate-y-3 scale-[0.985] opacity-0' : 'translate-y-0 scale-100 opacity-100')}
      dialogRef={dialogRef}
      ariaLabelledBy="exitComparisonTitle"
      onBackdropClick={requestClose}
    >
        <header class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/30 px-4 py-4 sm:px-6">
          <div class="min-w-0">
            <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">{translateText('MARKET TOOLS', language)}</span>
            <h2 id="exitComparisonTitle" class="mt-1 text-lg font-bold text-white sm:text-xl">{translateText('Compare Exits', language)}</h2>
            <p class="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">{translateText('Compare two hypothetical exit periods by date and price. Results update as you edit.', language)}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={requestClose}
            aria-label={translateText('Close exit comparison', language)}
            class="min-h-11 shrink-0 rounded-lg border border-slate-700 px-3 text-xs font-semibold text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >{translateText('Close · Esc', language)}</button>
        </header>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5 sm:py-4">
          <div class="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/45 p-3">
            <div class="min-w-0 flex-1 sm:max-w-xs">
              <label for="exitComparisonTicker" class="mb-1 block text-[11px] font-semibold text-slate-400">{translateText('Position', language)}</label>
              <select
                id="exitComparisonTicker"
                value={ticker}
                disabled={tickers.length === 0}
                onChange={(event) => changeTicker((event.currentTarget as HTMLSelectElement).value)}
                class="min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-white focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50"
              >
                {tickers.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
              </select>
              <p class="mt-1 text-[10px] text-slate-500">{positionSummary}</p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" onClick={swapPeriods} class="min-h-11 rounded-lg border border-slate-700 px-3 text-[11px] font-semibold text-slate-300 hover:border-cyan-700 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">{translateText('Swap periods', language)}</button>
              <button type="button" onClick={resetPeriods} class="min-h-11 rounded-lg border border-slate-700 px-3 text-[11px] font-semibold text-slate-300 hover:border-slate-500 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">{translateText('Reset defaults', language)}</button>
            </div>
          </div>

          {tickers.length === 0 ? (
            <div class="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 text-sm text-amber-200">
              {translateText('There are no open positions with shares available to compare.', language)}
            </div>
          ) : (
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">{periodCards}</div>
          )}

          <section class="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/45">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-3 sm:px-4">
              <div>
                <h3 class="text-sm font-bold text-white">{translateText('Comparison results', language)}</h3>
                <p class="mt-0.5 text-[10px] text-slate-500">{translateText('All open shares · estimated after fees and financing', language)}</p>
              </div>
              {netDifference !== null && <div class="text-right">
                <span class="block text-[10px] uppercase tracking-wider text-slate-500">{translateText('Period B vs. Period A', language)}</span>
                <strong class={'font-mono text-sm tabular-nums ' + (netDifference > 0 ? 'text-emerald-300' : netDifference < 0 ? 'text-rose-300' : 'text-slate-200')}>{formatSignedMoney(netDifference)}</strong>
              </div>}
            </div>

            {displayedResult ? (
              <div class="overflow-x-auto">
                <table class="w-full min-w-[30rem] border-collapse text-xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  <thead><tr class="border-b border-slate-800 text-slate-400">
                    <th scope="col" class="px-3 py-2.5 text-left font-semibold">{translateText('Metric', language)}</th>
                    {displayedResult.columns.map((column, index) => <th key={index} scope="col" class={'px-3 py-2.5 text-right font-semibold ' + (bestIndex === index ? 'text-emerald-300' : 'text-cyan-200')}>{index === 0 ? translateText('Period A', language) : translateText('Period B', language)}<span class="mt-1 block whitespace-normal text-[10px] font-normal text-slate-500">{formatResultColumn(column, index, hasLiveResult, offsets, prices, language)}</span></th>)}
                  </tr></thead>
                  <tbody>
                    {resultRows.map((row, rowIndex) => <tr key={row.label + rowIndex} class={
                      row.kind === 'result' ? 'border-b border-emerald-900/50 bg-emerald-950/20 font-semibold text-emerald-200' :
                      row.kind === 'balance' ? 'border-b border-cyan-900/40 bg-cyan-950/20 text-cyan-100' :
                      'border-b border-slate-800/70 text-slate-300'
                    }>
                      <th scope="row" class="px-3 py-3 text-left font-medium">{translateText(row.label, language)}</th>
                      {row.values.slice(0, 2).map((value, index) => <td key={index} class={'px-3 py-3 text-right font-mono whitespace-nowrap ' + (row.kind === 'result' ? 'font-bold' : '')}>{formatUSDDisplayValue(value)}</td>)}
                    </tr>)}
                  </tbody>
                </table>
              </div>
            ) : (
              <div class="p-4 text-sm text-slate-400">
                {preview?.type === 'err'
                  ? translateText(preview.text, language)
                  : translateText('Enter a valid positive price and exit date for both periods to calculate the comparison.', language)}
              </div>
            )}
            {savedFallback && <p class="border-t border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200">{translateText('This is the last saved estimate. Current inputs or portfolio data do not support a fresh calculation.', language)}</p>}
          </section>

          <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
            <p>{translateText('Inputs and latest results are saved automatically in this browser for this account.', language)}</p>
            {lastSavedAt !== null && <p>{translateText('Last saved', language)} · {formatSavedTime(lastSavedAt, language)}</p>}
          </div>
          <p class="rounded-lg border border-slate-800 bg-slate-900/45 px-3 py-2.5 text-[10px] leading-relaxed text-slate-400">{translateText('Estimate only. The model uses your saved shares, cost basis, commission settings, account balance and estimated margin interest. Future prices are assumptions; nothing is changed and no broker order is submitted.', language)}</p>
        </div>
      </ModalFrame>,
    document.body
  );
}
