import { useMemo, useState } from 'preact/hooks';
import { usePortfolioSelector } from '../store/portfolioStore';
import type { PortfolioState } from '../types/portfolio';
import type { CashflowCategory, PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { classifyCashflow, hasKnownCashflowDirection, normalizeClassifiedCashflowAmount } from '../domain/cashflowClassification';
import { parseFreedomCashflowDate } from '../domain/freedomCashflows';
import { getAppLanguage, translateText } from '../services/i18n';
import { formatUSD } from '../utils/formatters';
import { TablePagination } from './TablePagination';
import { TableScrollRegion } from './TableScrollRegion';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';

interface CashActivitySnapshot {
  cashflows: PortfolioState['cashflows'];
  transactionEvents: PortfolioState['transactionEvents'];
  cashCushion: PortfolioState['cashCushion'];
  balance: PortfolioState['balance'];
}

interface CashActivityRow {
  id: string;
  timestamp: number | null;
  dateOnly?: boolean;
  category: CashflowCategory;
  description: string;
  amount: number | null;
  reportedAmount?: number | null;
  currency?: string;
  signedCash: number | null;
  signedDebt?: number | null;
  providerReference?: string;
  identityQuality?: 'provider' | 'fallback' | 'app';
  source: 'TradeNet' | 'App';
  quality: 'verified' | 'provisional' | 'unclassified';
  debtOnly?: boolean;
  legacyManual?: boolean;
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
    case 'cash.adjustment':
    case 'margin.adjustment': return 'adjustment';
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
    trade: 'Trade settlement',
    order_reservation: 'Order reservation',
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

function formatDate(timestamp: number | null, dateOnly = false): string {
  if (timestamp === null) return '—';
  const locale = getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { dateStyle: 'medium', timeZone: 'UTC' }
    : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(locale, options).format(timestamp);
}

function signedAmountText(amount: number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  const prefix = amount > 0 ? '+' : amount < 0 ? '−' : '';
  return prefix + formatMoney(amount, currency);
}

function cashImpact(row: CashActivityRow): number | null {
  return row.debtOnly
    ? (row.signedDebt === null || row.signedDebt === undefined ? null : -row.signedDebt)
    : row.signedCash;
}

function qualityLabel(row: CashActivityRow): string {
  if (row.legacyManual) return 'Historical manual entry · unverified';
  if (row.quality === 'verified') return 'Provider ID / app record';
  if (row.quality === 'provisional') {
    if (row.identityQuality === 'fallback') return 'Provisional source identity';
    if (!row.currency) return 'Missing currency · provisional';
    if (row.timestamp === null) return 'Missing date · provisional';
    if (!hasKnownCashflowDirection(row.category) && row.category !== 'order_reservation')
      return 'Cash impact unavailable · provisional';
    return 'Provisional record';
  }
  return row.identityQuality === 'provider'
    ? 'Unclassified · provider ID'
    : 'Unclassified · provisional ID';
}

function buildLedgerRows(snapshot: CashActivitySnapshot): CashActivityRow[] {
  const rows: CashActivityRow[] = [];
  for (const row of snapshot.cashflows || []) {
    const raw = row.raw || {};
    const classification = classifyCashflow({
      type: row.type,
      description: row.description,
      typeCode: raw.type_code,
      typeCodeName: raw.type_code_name,
      raw
    });
    const amount = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : null;
    const description = [row.type, row.description].filter(Boolean).join(' — ');
    const classificationText = [row.type, row.description, raw.type_code, raw.type_code_name]
      .filter(Boolean).join(' ');
    const rowCurrency = typeof row.currency === 'string' && /^[A-Z]{3}$/i.test(row.currency.trim())
      ? row.currency.trim().toUpperCase()
      : undefined;
    const parsedDate = parseFreedomCashflowDate(row.date);
    const rowTimestamp = parsedDate?.timestamp ?? null;
    const hasProviderSignedSum = typeof raw.sum === 'string' && raw.sum.trim() !== '';
    const fallbackIdentity = row.identityQuality === 'fallback' || /^freedom-\d{4}-\d{2}-\d{2}\|/i.test(row.id);
    const providerReference = !fallbackIdentity && row.id.startsWith('freedom-')
      ? row.id.slice('freedom-'.length)
      : undefined;
    const signedCash = amount === null || !classification.classified || !hasKnownCashflowDirection(classification.category)
      ? null
      : hasProviderSignedSum
        ? amount
        : normalizeClassifiedCashflowAmount(classification.category, amount, classificationText);
    rows.push({
      id: 'broker:' + row.id,
      timestamp: rowTimestamp,
      dateOnly: parsedDate?.dateOnly ?? false,
      category: classification.category,
      description: description || translateText('Broker cashflow', getAppLanguage()),
      amount: amount === null ? null : Math.abs(signedCash ?? amount),
      reportedAmount: amount,
      providerReference,
      identityQuality: fallbackIdentity ? 'fallback' : providerReference ? 'provider' : undefined,
      currency: rowCurrency,
      signedCash,
      source: 'TradeNet',
      quality: !classification.classified
        ? 'unclassified'
        : (!hasKnownCashflowDirection(classification.category) && classification.category !== 'order_reservation') ||
            fallbackIdentity || !rowCurrency || rowTimestamp === null
          ? 'provisional'
          : 'verified'
    });
  }

  const displayableTypes = new Set<PortfolioTransactionEvent['type']>([
    'cash.deposit', 'cash.withdrawal', 'cash.transfer', 'cash.adjustment', 'margin.adjustment',
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
    const signedDebt = typeof event.marginDebtDelta === 'number' && Number.isFinite(event.marginDebtDelta)
      ? event.marginDebtDelta
      : event.type === 'margin.interest' && amount !== null ? amount : null;
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
      signedDebt,
      source: 'App',
      identityQuality: 'app',
      legacyManual: event.source === 'manual-cash-activity' ||
        event.source === 'manual-cash-adjustment' ||
        event.source === 'manual-margin-adjustment',
      quality: event.source === 'manual-cash-activity' ||
        event.source === 'manual-cash-adjustment' ||
        event.source === 'manual-margin-adjustment' || !eventCurrency
        ? 'provisional'
        : 'verified',
      debtOnly: (event.type === 'margin.interest' && signedCash === 0) || event.type === 'margin.adjustment'
    });
  }

  return rows.sort((left, right) =>
    (right.timestamp ?? Number.NEGATIVE_INFINITY) - (left.timestamp ?? Number.NEGATIVE_INFINITY) ||
    left.id.localeCompare(right.id)
  );
}

export function CashActivityLedger() {
  const snapshot = usePortfolioSelector(selectCashActivity, equalSnapshot);
  const rows = useMemo(() => buildLedgerRows(snapshot), [
    snapshot.cashflows, snapshot.transactionEvents
  ]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [qualityFilter, setQualityFilter] = useState('all');

  const filteredRows = useMemo(() => {
    const now = Date.now();
    const startAt = periodFilter === '30'
      ? now - 30 * 86_400_000
      : periodFilter === '90'
        ? now - 90 * 86_400_000
        : periodFilter === 'year'
          ? new Date(new Date().getFullYear(), 0, 1).getTime()
          : null;
    const periodStartDate = startAt === null ? null : new Date(startAt);
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
      if (qualityFilter !== 'all' && row.quality !== qualityFilter) return false;
      if (startAt !== null) {
        if (row.timestamp === null) return false;
        const rowPeriodStart = row.dateOnly && periodStartDate
          ? Date.UTC(periodStartDate.getFullYear(), periodStartDate.getMonth(), periodStartDate.getDate())
          : startAt;
        if (row.timestamp < rowPeriodStart) return false;
      }
      const searchableText = [
        row.id, row.description, categoryLabel(row.category), row.currency || '',
        row.source, row.quality, row.providerReference || '', row.legacyManual ? 'historical manual entry' : ''
      ].join(' ').toLowerCase();
      if (query && !searchableText.includes(query)) return false;
      return true;
    });
  }, [rows, search, categoryFilter, periodFilter, sourceFilter, qualityFilter]);
  const pagination = useTablePagination('cash-activity', filteredRows.length, 10);
  const visibleRows = sliceTablePage(filteredRows, pagination.currentPage, pagination.pageSize);
  const hasActiveFilters = Boolean(search.trim()) || categoryFilter !== 'all' ||
    periodFilter !== 'all' || sourceFilter !== 'all' || qualityFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setPeriodFilter('all');
    setSourceFilter('all');
    setQualityFilter('all');
    pagination.setPage(1);
  };

  const usdRows = filteredRows.filter(row =>
    row.quality === 'verified' && row.currency === 'USD' && !row.debtOnly &&
    row.amount !== null && row.timestamp !== null && row.signedCash !== null
  );
  const knownInflows = usdRows.reduce((sum, row) => sum + Math.max(0, row.signedCash!), 0);
  const knownOutflows = usdRows.reduce((sum, row) => sum + Math.max(0, -row.signedCash!), 0);
  const marginInterestRows = filteredRows.filter(row =>
    row.quality === 'verified' && row.category === 'margin_interest' && row.currency === 'USD' &&
    row.amount !== null && row.timestamp !== null &&
    (row.debtOnly ? row.signedDebt !== null && row.signedDebt !== undefined : row.signedCash !== null)
  );
  const marginInterest = marginInterestRows.reduce((sum, row) =>
    sum + (row.debtOnly ? row.amount! : -row.signedCash!), 0);
  const otherCurrencyCount = filteredRows.filter(row => row.currency && row.currency !== 'USD').length;
  const excludedCount = filteredRows.filter(row =>
    row.quality !== 'verified' || row.amount === null || !row.currency || row.timestamp === null ||
      (row.debtOnly ? row.signedDebt === null || row.signedDebt === undefined : row.signedCash === null)
  ).length;
  const unclassifiedCount = filteredRows.filter(row => row.quality === 'unclassified').length;
  const provisionalCount = filteredRows.filter(row => row.quality === 'provisional').length;
  const missingAmountCount = filteredRows.filter(row => row.amount === null).length;
  const missingDateCount = filteredRows.filter(row => row.timestamp === null).length;
  const missingCurrencyCount = filteredRows.filter(row => !row.currency).length;
  const orderReservationCount = filteredRows.filter(row => row.category === 'order_reservation').length;
  const hasVerifiedUsdCashActivity = usdRows.length > 0;
  const netUsdMovement = knownInflows - knownOutflows;
  const netMovementTone = netUsdMovement > 0
    ? 'text-emerald-300'
    : netUsdMovement < 0 ? 'text-rose-300' : 'text-slate-100';
  const netMovementSign = netUsdMovement > 0 ? '+' : netUsdMovement < 0 ? '−' : '';
  const currentCash = typeof snapshot.cashCushion?.freeCash === 'number' &&
    Number.isFinite(snapshot.cashCushion.freeCash) ? snapshot.cashCushion.freeCash : null;
  const currentDebt = typeof snapshot.balance === 'number' && Number.isFinite(snapshot.balance)
    ? Math.max(0, -snapshot.balance) : null;

  const currencyAmount = (value: number | null, sign = '') =>
    value === null ? '—' : sign + formatMoney(value, 'USD');
  const historyAmount = (value: number, sign = '') =>
    hasVerifiedUsdCashActivity ? currencyAmount(value, sign) : '—';

  return (
    <section class="space-y-4" aria-label={translateText('Cash Activity ledger', getAppLanguage())}>
      <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Current available USD cash', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{currencyAmount(currentCash)}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Current margin debt', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{currencyAmount(currentDebt)}</p>
        </div>
        <div class="col-span-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 md:col-span-1">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Net cash result · USD', getAppLanguage())}</p>
          <p class={'mt-1 font-mono text-xl font-bold tabular-nums ' + netMovementTone}>{historyAmount(netUsdMovement, netMovementSign)}</p>
          <p class="mt-1 text-[10px] text-slate-500">{translateText('Verified inflows less outflows across the current filters · not realized trading P&L', getAppLanguage())}</p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500">
        <span>{usdRows.length} {translateText('verified USD cash movements included in totals.', getAppLanguage())}</span>
        {excludedCount > 0 && (
          <span role="status" class="text-amber-300">
            {excludedCount} {translateText('records are excluded from verified USD totals because their classification, amount, currency, date or source identity is incomplete or unverified, or because they are not settled cash movements.', getAppLanguage())}
          </span>
        )}
        {(unclassifiedCount > 0 || provisionalCount > 0 || missingAmountCount > 0 || missingDateCount > 0 || missingCurrencyCount > 0 || orderReservationCount > 0) && (
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-amber-200">
            <span>{translateText('Data quality details:', getAppLanguage())}</span>
            {unclassifiedCount > 0 && <span>{unclassifiedCount} {translateText('unclassified operations', getAppLanguage())}</span>}
            {provisionalCount > 0 && <span>{provisionalCount} {translateText('provisional records', getAppLanguage())}</span>}
            {missingAmountCount > 0 && <span>{missingAmountCount} {translateText('missing amounts', getAppLanguage())}</span>}
            {missingDateCount > 0 && <span>{missingDateCount} {translateText('missing dates', getAppLanguage())}</span>}
            {missingCurrencyCount > 0 && <span>{missingCurrencyCount} {translateText('missing currencies', getAppLanguage())}</span>}
            {orderReservationCount > 0 && <span>{orderReservationCount} {translateText('order reservations / releases', getAppLanguage())}</span>}
            <span>{translateText('Data-quality reason counts may overlap.', getAppLanguage())}</span>
          </div>
        )}
        {otherCurrencyCount > 0 && (
          <span>{otherCurrencyCount} {translateText('non-USD records are excluded from USD totals.', getAppLanguage())}</span>
        )}
        {Math.abs(marginInterest) > 0 && (
          <span>{translateText('Margin interest recorded separately', getAppLanguage())}: {currencyAmount(marginInterest, marginInterest > 0 ? '+' : marginInterest < 0 ? '−' : '')}</span>
        )}
      </div>

      <div class="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Search activity', getAppLanguage())}
            <input value={search} onInput={event => { setSearch((event.currentTarget as HTMLInputElement).value); pagination.setPage(1); }}
              placeholder={translateText('Search description, source, ID or type', getAppLanguage())}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100" />
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Category', getAppLanguage())}
            <select value={categoryFilter} onChange={event => { setCategoryFilter((event.currentTarget as HTMLSelectElement).value); pagination.setPage(1); }}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
              <option value="all">{translateText('All categories', getAppLanguage())}</option>
              {Array.from(new Set(rows.map(row => row.category))).sort().map(category =>
                <option value={category}>{categoryLabel(category)}</option>
              )}
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Period', getAppLanguage())}
            <select value={periodFilter} onChange={event => { setPeriodFilter((event.currentTarget as HTMLSelectElement).value); pagination.setPage(1); }}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
              <option value="all">{translateText('All time', getAppLanguage())}</option>
              <option value="30">{translateText('Last 30 days', getAppLanguage())}</option>
              <option value="90">{translateText('Last 90 days', getAppLanguage())}</option>
              <option value="year">{translateText('This year', getAppLanguage())}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Source', getAppLanguage())}
            <select value={sourceFilter} onChange={event => { setSourceFilter((event.currentTarget as HTMLSelectElement).value); pagination.setPage(1); }}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
              <option value="all">{translateText('All sources', getAppLanguage())}</option>
              <option value="TradeNet">TradeNet</option>
              <option value="App">App</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {translateText('Data quality', getAppLanguage())}
            <select value={qualityFilter} onChange={event => { setQualityFilter((event.currentTarget as HTMLSelectElement).value); pagination.setPage(1); }}
              class="min-h-10 rounded border border-slate-700 bg-slate-950 px-2.5 text-xs font-normal normal-case tracking-normal text-slate-100">
              <option value="all">{translateText('All qualities', getAppLanguage())}</option>
              <option value="verified">{translateText('Verified', getAppLanguage())}</option>
              <option value="provisional">{translateText('Provisional', getAppLanguage())}</option>
              <option value="unclassified">{translateText('Unclassified', getAppLanguage())}</option>
            </select>
          </label>
        </div>
        <div class="mt-2 flex justify-end">
          <button type="button" disabled={!hasActiveFilters} onClick={clearFilters}
            class="min-h-8 rounded border border-slate-700 px-3 text-[10px] font-semibold text-slate-400 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">
            {translateText('Clear filters', getAppLanguage())}
          </button>
        </div>

        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span>{filteredRows.length} {translateText('records match filters', getAppLanguage())} · {rows.length} {translateText('total records', getAppLanguage())}</span>
          <span>{translateText('Current cash and debt are account-state values. History totals include all records matching filters, not only the current page.', getAppLanguage())}</span>
        </div>

        {filteredRows.length === 0 ? (
          <p class="mt-3 rounded border border-slate-800 px-3 py-8 text-center text-xs text-slate-500">{translateText('No cash activity matches these filters.', getAppLanguage())}</p>
        ) : (
          <>
            <div class="mt-3 space-y-2 sm:hidden">
              {visibleRows.map(row => {
                const signedDisplay = cashImpact(row);
                const amountTone = signedDisplay === null
                  ? 'text-amber-300'
                  : signedDisplay >= 0 ? 'text-emerald-300' : 'text-rose-300';
                return (
                  <article key={row.id} class="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <span class="text-xs text-slate-400">{formatDate(row.timestamp, row.dateOnly)}</span>
                      <span class="rounded bg-slate-800/80 px-2 py-1 text-[11px] font-semibold text-slate-200">{categoryLabel(row.category)}</span>
                    </div>
                    <p class="mt-2 break-words text-sm leading-5 text-slate-200 line-clamp-2">{row.description}</p>
                    <details class="mt-1 text-[11px] text-slate-500">
                      <summary class="cursor-pointer select-none py-1">{translateText('Show full description', getAppLanguage())}</summary>
                      <p class="break-words pb-1 text-slate-300">{row.description}</p>
                    </details>
                    <div class="mt-2 grid grid-cols-2 gap-3 border-t border-slate-800 pt-2 text-xs">
                      <div class="min-w-0">
                        <p class="text-[10px] uppercase tracking-wide text-slate-500">{translateText('Source / quality', getAppLanguage())}</p>
                        <p class="mt-1 text-slate-200">{row.source}</p>
                        <p class="mt-0.5 break-words text-[10px] text-slate-500">{translateText(qualityLabel(row), getAppLanguage())}</p>
                        {row.providerReference && <p class="mt-0.5 break-all font-mono text-[10px] text-slate-500">{row.providerReference}</p>}
                      </div>
                      <div>
                        <p class="text-[10px] uppercase tracking-wide text-slate-500">{translateText('Currency', getAppLanguage())}</p>
                        <p class="mt-1 text-slate-200">{row.currency || '—'}</p>
                        {row.debtOnly && <p class="mt-0.5 text-[10px] text-slate-500">{translateText('Debt only', getAppLanguage())}</p>}
                      </div>
                      {row.reportedAmount !== undefined && (
                        <div>
                          <p class="text-[10px] uppercase tracking-wide text-slate-500">{translateText('Broker-reported amount', getAppLanguage())}</p>
                          <p class="mt-1 font-mono font-semibold tabular-nums text-slate-100">{signedAmountText(row.reportedAmount, row.currency)}</p>
                        </div>
                      )}
                      <div>
                        <p class="text-[10px] uppercase tracking-wide text-slate-500">{translateText('Cash / debt impact', getAppLanguage())}</p>
                        <p class={'mt-1 font-mono font-semibold tabular-nums ' + amountTone}>{signedAmountText(signedDisplay, row.currency)}</p>
                        {row.category === 'order_reservation' && (
                          <p class="mt-0.5 text-[10px] text-slate-500">{translateText('Reservation only · no settled cash impact', getAppLanguage())}</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div class="hidden sm:block">
              <TableScrollRegion
                label={translateText('Cash activity records', getAppLanguage())}
                className="mt-3"
              >
                <table class="min-w-[68rem] w-full border-collapse text-left text-xs">
                <thead class="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Activity date', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Category', getAppLanguage())}</th>
                    <th scope="col" class="px-3 py-2.5 font-semibold">{translateText('Description', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Source / quality', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Currency', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{translateText('Broker-reported amount', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{translateText('Cash / debt impact', getAppLanguage())}</th>
                  </tr>
                </thead>
                <tbody id="cashActivityTable" class="divide-y divide-slate-800/80 bg-slate-950/40">
                  {visibleRows.map(row => {
                    const signedDisplay = cashImpact(row);
                    const isInflow = signedDisplay !== null && signedDisplay >= 0;
                    const amountTone = signedDisplay === null
                      ? 'text-amber-300'
                      : isInflow ? 'text-emerald-300' : 'text-rose-300';
                    return (
                      <tr key={row.id} class="align-top transition-colors hover:bg-slate-900/40">
                        <td class="whitespace-nowrap px-3 py-3 text-slate-400">{formatDate(row.timestamp, row.dateOnly)}</td>
                        <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-200">{categoryLabel(row.category)}</td>
                        <td class="max-w-[28rem] whitespace-normal px-3 py-3 text-slate-300">
                          <p class="break-words">{row.description}</p>
                        </td>
                        <td class="whitespace-nowrap px-3 py-3">
                          <p class="text-slate-300">{row.source}</p>
                          <p class="mt-1 text-[10px] text-slate-500">{translateText(qualityLabel(row), getAppLanguage())}</p>
                          {row.providerReference && <p class="mt-1 break-all font-mono text-[10px] text-slate-500">{row.providerReference}</p>}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-slate-400">
                          {row.currency || '—'}
                          {row.debtOnly && <p class="mt-1 text-[10px] text-slate-500">{translateText('Debt only', getAppLanguage())}</p>}
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums text-slate-200">
                          {row.reportedAmount === undefined ? '—' : signedAmountText(row.reportedAmount, row.currency)}
                        </td>
                        <td class={'whitespace-nowrap px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums ' + amountTone}>
                          {signedDisplay === null ? '—' : signedAmountText(signedDisplay, row.currency)}
                          {row.category === 'order_reservation' && (
                            <p class="mt-1 text-left text-[10px] font-sans font-normal text-slate-500">{translateText('Reservation only · no settled cash impact', getAppLanguage())}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                </table>
              </TableScrollRegion>
            </div>
            <TablePagination
              tableLabel={translateText('Cash Activity ledger', getAppLanguage())}
              page={pagination.currentPage}
              pageCount={pagination.pageCount}
              pageSize={pagination.pageSize}
              start={pagination.start}
              end={pagination.end}
              total={filteredRows.length}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              className="mt-1"
              controlsId="cashActivityTable"
            />
          </>
        )}
      </div>
    </section>
  );
}
