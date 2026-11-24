import { useMemo, useRef, useState } from 'preact/hooks';
import { portfolioStore, usePortfolioSelector } from '../store/portfolioStore';
import type { ManualCashActivityCategory } from '../store/portfolioStore';
import type { PortfolioState } from '../types/portfolio';
import type { CashflowCategory, PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { classifyCashflow, hasKnownCashflowDirection, normalizeClassifiedCashflowAmount } from '../domain/cashflowClassification';
import { getAppLanguage, translateText } from '../services/i18n';
import { formatUSD } from '../utils/formatters';

interface CashActivityLedgerProps {
  accountId: string;
  canPostCashActivity: boolean;
  isSessionCurrent: () => boolean;
}

interface CashActivitySnapshot {
  cashflows: PortfolioState['cashflows'];
  transactionEvents: PortfolioState['transactionEvents'];
  cashCushion: PortfolioState['cashCushion'];
  balance: PortfolioState['balance'];
}

interface CashActivityRow {
  id: string;
  timestamp: number | null;
  category: CashflowCategory;
  description: string;
  amount: number | null;
  currency?: string;
  signedCash: number | null;
  source: 'TradeNet' | 'App';
  quality: 'verified' | 'provisional' | 'unclassified';
  debtOnly?: boolean;
}

const selectCashActivity = (state: PortfolioState): CashActivitySnapshot => ({
  cashflows: state.cashflows,
  transactionEvents: state.transactionEvents,
  cashCushion: state.cashCushion,
  balance: state.balance
});

function equalSnapshot(left: CashActivitySnapshot, right: CashActivitySnapshot): boolean {
  return left.cashflows === right.cashflows &&
    left.transactionEvents === right.transactionEvents &&
    left.cashCushion === right.cashCushion &&
    left.balance === right.balance;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function categoryFromEvent(event: PortfolioTransactionEvent): CashflowCategory {
  if (event.cashflowCategory) return event.cashflowCategory;
  switch (event.type) {
    case 'cash.deposit': return 'deposit';
    case 'cash.withdrawal': return 'withdrawal';
    case 'dividend': return 'dividend';
    case 'interest.income': return 'interest_income';
    case 'margin.interest': return 'margin_interest';
    case 'fee': return 'fee';
    case 'cash.transfer': return 'transfer';
    case 'cash.adjustment': return 'adjustment';
    case 'corporate-action': return 'corporate_action';
    default: return 'unclassified';
  }
}

function categoryLabel(category: CashflowCategory): string {
  const labels: Record<CashflowCategory, string> = {
    deposit: 'Deposit',
    withdrawal: 'Withdrawal',
    dividend: 'Dividend',
    interest_income: 'Interest income',
    commission: 'Commission',
    fee: 'Fee',
    tax: 'Tax',
    margin_interest: 'Margin interest',
    transfer: 'Transfer',
    adjustment: 'Adjustment',
    correction: 'Correction',
    corporate_action: 'Corporate action',
    unclassified: 'Unclassified'
  };
  return translateText(labels[category], getAppLanguage());
}

function formatMoney(amount: number | null, currency?: string): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  if (currency === 'USD') return formatUSD(Math.abs(amount));
  const locale = getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
  if (!currency || !/^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Math.abs(amount));
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Math.abs(amount));
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return '—';
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(timestamp);
}

function localDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function asLocalMiddayTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) && parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 && parsed.getDate() === day ? timestamp : null;
}

const MANUAL_CATEGORIES: Array<{ value: ManualCashActivityCategory; label: string }> = [
  { value: 'deposit', label: 'Deposit' },
  { value: 'withdrawal', label: 'Withdrawal' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'interest_income', label: 'Interest income' },
  { value: 'commission', label: 'Commission' },
  { value: 'fee', label: 'Fee' },
  { value: 'tax', label: 'Tax' },
  { value: 'margin_interest', label: 'Margin interest' },
  { value: 'transfer', label: 'Transfer' }
];

function buildLedgerRows(snapshot: CashActivitySnapshot): CashActivityRow[] {
  const rows: CashActivityRow[] = [];
  for (const row of snapshot.cashflows || []) {
    const classification = classifyCashflow({
      type: row.type, description: row.description, raw: row.raw || {}
    });
    const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null;
    const description = [row.type, row.description].filter(Boolean).join(' — ');
    const classificationText = [row.type, row.description, ...Object.values(row.raw || {})].filter(Boolean).join(' ');
    const rowCurrency = typeof row.currency === 'string' && /^[A-Z]{3}$/i.test(row.currency.trim())
      ? row.currency.trim().toUpperCase()
      : undefined;
    const rowTimestamp = parseTimestamp(row.date);
    rows.push({
      id: 'broker:' + row.id,
      timestamp: rowTimestamp,
      category: classification.category,
      description: description || translateText('Broker cashflow', getAppLanguage()),
      amount: amount === null || !classification.classified
        ? amount
        : Math.abs(normalizeClassifiedCashflowAmount(classification.category, amount, classificationText)),
      currency: rowCurrency,
      signedCash: amount === null || !classification.classified || !hasKnownCashflowDirection(classification.category)
        ? null
        : normalizeClassifiedCashflowAmount(classification.category, amount, classificationText),
      source: 'TradeNet',
      quality: !classification.classified
        ? 'unclassified'
        : !hasKnownCashflowDirection(classification.category) || row.identityQuality === 'fallback' || /^freedom-\d{4}-\d{2}-\d{2}\|/i.test(row.id) || !rowCurrency || rowTimestamp === null
          ? 'provisional'
          : 'verified'
    });
  }

  const displayableTypes = new Set<PortfolioTransactionEvent['type']>([
    'cash.deposit', 'cash.withdrawal', 'cash.transfer', 'cash.adjustment',
    'dividend', 'interest.income', 'fee', 'margin.interest', 'corporate-action'
  ]);
  for (const event of snapshot.transactionEvents || []) {
    if (!event || event.actor.type === 'broker' || !displayableTypes.has(event.type)) continue;
    const category = categoryFromEvent(event);
    const amountValue = event.grossAmount ?? event.financingCost ?? event.externalCashFlowAmount;
    const amount = typeof amountValue === 'number' && Number.isFinite(amountValue)
      ? Math.abs(amountValue)
      : null;
    const signedCash = typeof event.cashDelta === 'number' && Number.isFinite(event.cashDelta)
      ? event.cashDelta
      : event.type === 'margin.interest' ? 0 : null;
    const eventCurrency = typeof event.currency === 'string' && /^[A-Z]{3}$/i.test(event.currency.trim())
      ? event.currency.trim().toUpperCase()
      : undefined;
    rows.push({
      id: 'app:' + event.id,
      timestamp: event.effectiveAt,
      category,
      description: event.note || categoryLabel(category),
      amount,
      currency: eventCurrency,
      signedCash,
      source: 'App',
      quality: eventCurrency ? 'verified' : 'provisional',
      debtOnly: event.type === 'margin.interest' && signedCash === 0
    });
  }

  return rows.sort((left, right) =>
    (right.timestamp ?? Number.NEGATIVE_INFINITY) - (left.timestamp ?? Number.NEGATIVE_INFINITY) ||
    left.id.localeCompare(right.id)
  );
}

export function CashActivityLedger({
  accountId,
  canPostCashActivity,
  isSessionCurrent
}: CashActivityLedgerProps) {
  const snapshot = usePortfolioSelector(selectCashActivity, equalSnapshot);
  const rows = useMemo(() => buildLedgerRows(snapshot), [
    snapshot.cashflows, snapshot.transactionEvents
  ]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [entryCategory, setEntryCategory] = useState<ManualCashActivityCategory>('deposit');
  const [entryDirection, setEntryDirection] = useState<'in' | 'out'>('out');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryDate, setEntryDate] = useState(localDateInputValue);
  const [entryNote, setEntryNote] = useState('');
  const [entryMessage, setEntryMessage] = useState('');
  const [entryError, setEntryError] = useState(false);
  const lastSubmittedRequest = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const filteredRows = useMemo(() => {
    const now = Date.now();
    const startAt = periodFilter === '30'
      ? now - 30 * 86_400_000
      : periodFilter === '90'
        ? now - 90 * 86_400_000
        : periodFilter === 'year'
          ? new Date(new Date().getFullYear(), 0, 1).getTime()
          : null;
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (startAt !== null && (row.timestamp === null || row.timestamp < startAt)) return false;
      if (query && !(row.description + ' ' + categoryLabel(row.category) + ' ' + row.currency)
        .toLowerCase().includes(query)) return false;
      return true;
    });
  }, [rows, search, categoryFilter, periodFilter]);

  const usdRows = filteredRows.filter(row => row.quality === 'verified' && row.currency === 'USD' && row.signedCash !== null);
  const knownInflows = usdRows.reduce((sum, row) => sum + Math.max(0, row.signedCash || 0), 0);
  const knownOutflows = usdRows.reduce((sum, row) => sum + Math.max(0, -(row.signedCash || 0)), 0);
  const marginInterest = filteredRows
    .filter(row => row.quality === 'verified' && row.category === 'margin_interest' && row.currency === 'USD' && row.amount !== null)
    .reduce((sum, row) => sum + (row.debtOnly ? (row.amount || 0) : -(row.signedCash || 0)), 0);
  const otherCurrencyCount = filteredRows.filter(row => row.currency && row.currency !== 'USD').length;
  const unknownCount = filteredRows.filter(row =>
    row.quality !== 'verified' || row.amount === null || !row.currency || row.timestamp === null || row.signedCash === null
  ).length;
  const currentCash = typeof snapshot.cashCushion?.freeCash === 'number' &&
    Number.isFinite(snapshot.cashCushion.freeCash) ? snapshot.cashCushion.freeCash : null;
  const currentDebt = typeof snapshot.balance === 'number' && Number.isFinite(snapshot.balance)
    ? Math.abs(snapshot.balance) : null;

  const submitEntry = (event: Event) => {
    event.preventDefault();
    setEntryMessage('');
    setEntryError(false);
    if (!canPostCashActivity || !isSessionCurrent()) {
      setEntryError(true);
      setEntryMessage(translateText('This account cannot post cash activity.', getAppLanguage()));
      return;
    }
    const amount = Number(entryAmount);
    const effectiveAt = asLocalMiddayTimestamp(entryDate);
    if (!Number.isFinite(amount) || amount <= 0 || effectiveAt === null) {
      setEntryError(true);
      setEntryMessage(translateText('Enter a positive amount and a valid activity date.', getAppLanguage()));
      return;
    }
    const fingerprint = JSON.stringify([
      accountId, entryCategory, amount, 'USD', effectiveAt, entryNote.trim(),
      entryCategory === 'transfer' ? entryDirection : null
    ]);
    const idempotencyKey = lastSubmittedRequest.current?.fingerprint === fingerprint
      ? lastSubmittedRequest.current.idempotencyKey
      : 'cash-activity:' + accountId + ':' + Date.now().toString(36) + ':' +
        Math.random().toString(36).slice(2, 10);
    const result = portfolioStore.postCashActivity({
      category: entryCategory,
      amount,
      currency: 'USD',
      effectiveAt,
      note: entryNote.trim(),
      direction: entryCategory === 'transfer' ? entryDirection : undefined,
      idempotencyKey
    });
    if (!result) {
      setEntryError(true);
      setEntryMessage(translateText(
        'Activity was not posted. Check available USD cash, the amount and local storage, then retry.',
        getAppLanguage()
      ));
      return;
    }
    lastSubmittedRequest.current = { fingerprint, idempotencyKey };
    setEntryAmount('');
    setEntryNote('');
    setEntryMessage(translateText('Cash activity was posted and saved.', getAppLanguage()));
  };

  const currencyAmount = (value: number | null, sign = '') =>
    value === null ? '—' : sign + formatMoney(value, 'USD');

  return (
    <section class="space-y-4" aria-label={translateText('Cash Activity ledger', getAppLanguage())}>
      <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Available USD cash', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{currencyAmount(currentCash)}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Margin debt', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{currencyAmount(currentDebt)}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Known inflows · USD', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-300">{currencyAmount(knownInflows, '+')}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Known outflows · USD', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-rose-300">{currencyAmount(knownOutflows, '−')}</p>
          {Math.abs(marginInterest) > 0 && <p class="mt-1 text-[10px] text-slate-500">{translateText('Margin interest recorded', getAppLanguage())}: {marginInterest < 0 ? '−' : ''}{formatMoney(marginInterest, 'USD')}</p>}
        </div>
      </div>

      {unknownCount > 0 && (
        <p role="status" class="rounded border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          {unknownCount} {translateText('records have incomplete classification, amount, currency, date or source identity. They remain visible and are excluded from USD totals.', getAppLanguage())}
        </p>
      )}
      {otherCurrencyCount > 0 && (
        <p class="text-[10px] text-slate-500">{translateText('Other-currency records are shown but excluded from USD summary totals.', getAppLanguage())}</p>
      )}

      {canPostCashActivity && (
        <form onSubmit={submitEntry} class="rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-slate-100">{translateText('Record manual cash activity', getAppLanguage())}</h3>
            <span class="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400">{translateText('Posts to USD cash ledger', getAppLanguage())}</span>
          </div>
          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {translateText('Activity type', getAppLanguage())}
              <select value={entryCategory} onChange={event => { lastSubmittedRequest.current = null; setEntryCategory((event.currentTarget as HTMLSelectElement).value as ManualCashActivityCategory); }}
                class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
                {MANUAL_CATEGORIES.map(item => <option value={item.value}>{translateText(item.label, getAppLanguage())}</option>)}
              </select>
            </label>
            <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {translateText('Amount · USD', getAppLanguage())}
              <input type="number" min="0.01" step="0.01" value={entryAmount}
                onInput={event => { lastSubmittedRequest.current = null; setEntryAmount((event.currentTarget as HTMLInputElement).value); }}
                required class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-right font-mono text-sm text-slate-100" />
            </label>
            <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {translateText('Activity date', getAppLanguage())}
              <input type="date" value={entryDate} onInput={event => { lastSubmittedRequest.current = null; setEntryDate((event.currentTarget as HTMLInputElement).value); }}
                required class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100" />
            </label>
            <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {translateText('Note (optional)', getAppLanguage())}
              <input value={entryNote} maxLength={240} onInput={event => { lastSubmittedRequest.current = null; setEntryNote((event.currentTarget as HTMLInputElement).value); }}
                placeholder={translateText('Description or reference', getAppLanguage())}
                class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100" />
            </label>
          </div>
          {entryCategory === 'transfer' && (
            <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span>{translateText('Transfer direction', getAppLanguage())}</span>
              <label class="inline-flex items-center gap-1.5"><input type="radio" name="cash-transfer-direction" checked={entryDirection === 'in'} onChange={() => { lastSubmittedRequest.current = null; setEntryDirection('in'); }} />{translateText('Inflow', getAppLanguage())}</label>
              <label class="inline-flex items-center gap-1.5"><input type="radio" name="cash-transfer-direction" checked={entryDirection === 'out'} onChange={() => { lastSubmittedRequest.current = null; setEntryDirection('out'); }} />{translateText('Outflow', getAppLanguage())}</label>
            </div>
          )}
          <p class="mt-2 text-[10px] leading-relaxed text-slate-500">
            {translateText('Withdrawals, fees and transfers out use available cash only. They never create margin debt. Margin interest increases debt only when explicitly recorded as this activity type.', getAppLanguage())}
          </p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" class="min-h-10 rounded border border-cyan-700/70 bg-cyan-950/30 px-4 text-xs font-semibold text-cyan-200 hover:bg-cyan-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              {translateText('Save activity', getAppLanguage())}
            </button>
            {entryMessage && <p role={entryError ? 'alert' : 'status'} class={entryError ? 'text-xs text-rose-300' : 'text-xs text-emerald-300'}>{entryMessage}</p>}
          </div>
        </form>
      )}

      <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Search activity', getAppLanguage())}
            <input value={search} onInput={event => setSearch((event.currentTarget as HTMLInputElement).value)}
              placeholder={translateText('Description, reference or type', getAppLanguage())}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100" />
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Category', getAppLanguage())}
            <select value={categoryFilter} onChange={event => setCategoryFilter((event.currentTarget as HTMLSelectElement).value)}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
              <option value="all">{translateText('All categories', getAppLanguage())}</option>
              {Array.from(new Set(rows.map(row => row.category))).sort().map(category =>
                <option value={category}>{categoryLabel(category)}</option>
              )}
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Period', getAppLanguage())}
            <select value={periodFilter} onChange={event => setPeriodFilter((event.currentTarget as HTMLSelectElement).value)}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
              <option value="all">{translateText('All time', getAppLanguage())}</option>
              <option value="30">{translateText('Last 30 days', getAppLanguage())}</option>
              <option value="90">{translateText('Last 90 days', getAppLanguage())}</option>
              <option value="year">{translateText('This year', getAppLanguage())}</option>
            </select>
          </label>
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>{filteredRows.length} {translateText('records shown', getAppLanguage())}</span>
          <span>{translateText('Known net cash movement', getAppLanguage())}: {currencyAmount(knownInflows - knownOutflows, knownInflows >= knownOutflows ? '+' : '−')}</span>
        </div>

        <div class="mt-3 space-y-2">
          {filteredRows.length === 0 ? (
            <p class="rounded border border-slate-800 px-3 py-8 text-center text-xs text-slate-500">{translateText('No cash activity matches these filters.', getAppLanguage())}</p>
          ) : filteredRows.map(row => {
            const signedDisplay = row.debtOnly
              ? (row.amount === null ? null : -row.amount)
              : row.signedCash;
            const isInflow = signedDisplay !== null && signedDisplay >= 0;
            return (
              <article key={row.id} class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-slate-800/80 bg-slate-950/60 p-3 sm:grid-cols-[minmax(8rem,1.1fr)_minmax(12rem,2fr)_minmax(7rem,0.8fr)_auto] sm:items-center">
                <div class="min-w-0">
                  <p class="text-[10px] text-slate-500">{formatDate(row.timestamp)}</p>
                  <p class="mt-0.5 text-xs font-semibold text-slate-200">{categoryLabel(row.category)}</p>
                </div>
                <div class="min-w-0 sm:col-auto">
                  <p class="break-words text-xs text-slate-300">{row.description}</p>
                  <p class="mt-1 text-[10px] text-slate-500">{row.source} · {row.quality === 'verified' ? translateText('Provider ID / app record', getAppLanguage()) : row.quality === 'provisional' ? translateText('Provisional source identity', getAppLanguage()) : translateText('Unclassified source row', getAppLanguage())}</p>
                </div>
                <p class="text-[10px] text-slate-500">{row.currency || '—'}{row.debtOnly ? ' · ' + translateText('Debt only', getAppLanguage()) : ''}</p>
                <p class={'text-right font-mono text-sm font-semibold tabular-nums ' + (signedDisplay === null ? 'text-amber-300' : isInflow ? 'text-emerald-300' : 'text-rose-300')}>
                  {signedDisplay === null ? '—' : (isInflow ? '+' : '−') + formatMoney(signedDisplay, row.currency)}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
