import { useMemo, useState } from 'preact/hooks';
import { usePortfolioSelector } from '../store/portfolioStore';
import type { PortfolioState } from '../types/portfolio';
import type { CashflowCategory, PortfolioTransactionEvent } from '../types/portfolioTransaction';
import { classifyCashflow, hasKnownCashflowDirection, normalizeClassifiedCashflowAmount } from '../domain/cashflowClassification';
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
  category: CashflowCategory;
  description: string;
  amount: number | null;
  currency?: string;
  signedCash: number | null;
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
      legacyManual: event.source === 'manual-cash-activity' ||
        event.source === 'manual-cash-adjustment' ||
        event.source === 'manual-margin-adjustment',
      quality: event.source === 'manual-cash-activity' ||
        event.source === 'manual-cash-adjustment' ||
        event.source === 'manual-margin-adjustment' || !eventCurrency
        ? 'provisional'
        : 'verified',
      debtOnly: event.type === 'margin.interest' && signedCash === 0
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
    const query = search.trim().toLowerCase();
    return rows.filter(row => {
      if (categoryFilter !== 'all' && row.category !== categoryFilter) return false;
      if (sourceFilter !== 'all' && row.source !== sourceFilter) return false;
      if (qualityFilter !== 'all' && row.quality !== qualityFilter) return false;
      if (startAt !== null && (row.timestamp === null || row.timestamp < startAt)) return false;
      const searchableText = [
        row.id, row.description, categoryLabel(row.category), row.currency || '',
        row.source, row.quality, row.legacyManual ? 'historical manual entry' : ''
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
    ? Math.max(0, -snapshot.balance) : null;

  const currencyAmount = (value: number | null, sign = '') =>
    value === null ? '—' : sign + formatMoney(value, 'USD');

  return (
    <section class="space-y-4" aria-label={translateText('Cash Activity ledger', getAppLanguage())}>
      <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Current available USD cash', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{currencyAmount(currentCash)}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Current margin debt', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-slate-100">{currencyAmount(currentDebt)}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Filtered verified inflows · USD', getAppLanguage())}</p>
          <p class="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-300">{currencyAmount(knownInflows, '+')}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Filtered verified outflows · USD', getAppLanguage())}</p>
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
          <span>{filteredRows.length} {translateText('records shown', getAppLanguage())} · {rows.length} {translateText('total records', getAppLanguage())}</span>
          <span>{translateText('Summary reflects current filters', getAppLanguage())} · {translateText('Filtered net USD movement', getAppLanguage())}: {currencyAmount(knownInflows - knownOutflows, knownInflows >= knownOutflows ? '+' : '−')}</span>
        </div>

        {filteredRows.length === 0 ? (
          <p class="mt-3 rounded border border-slate-800 px-3 py-8 text-center text-xs text-slate-500">{translateText('No cash activity matches these filters.', getAppLanguage())}</p>
        ) : (
          <>
            <TableScrollRegion
              label={translateText('Cash activity records', getAppLanguage())}
              className="mt-3"
            >
              <table class="min-w-[56rem] w-full border-collapse text-left text-xs">
                <thead class="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Activity date', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Category', getAppLanguage())}</th>
                    <th scope="col" class="px-3 py-2.5 font-semibold">{translateText('Description', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Source / quality', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 font-semibold">{translateText('Currency', getAppLanguage())}</th>
                    <th scope="col" class="whitespace-nowrap px-3 py-2.5 text-right font-semibold">{translateText('Cash / debt impact', getAppLanguage())}</th>
                  </tr>
                </thead>
                <tbody id="cashActivityTable" class="divide-y divide-slate-800/80 bg-slate-950/40">
                  {visibleRows.map(row => {
                    const signedDisplay = row.debtOnly
                      ? (row.amount === null ? null : -row.amount)
                      : row.signedCash;
                    const isInflow = signedDisplay !== null && signedDisplay >= 0;
                    const amountTone = signedDisplay === null
                      ? 'text-amber-300'
                      : isInflow ? 'text-emerald-300' : 'text-rose-300';
                    const qualityLabel = row.legacyManual
                      ? 'Historical manual entry · unverified'
                      : row.quality === 'verified'
                        ? 'Provider ID / app record'
                        : row.quality === 'provisional'
                          ? 'Provisional source identity'
                          : 'Unclassified source row';
                    return (
                      <tr key={row.id} class="align-top transition-colors hover:bg-slate-900/40">
                        <td class="whitespace-nowrap px-3 py-3 text-slate-400">{formatDate(row.timestamp)}</td>
                        <td class="whitespace-nowrap px-3 py-3 font-semibold text-slate-200">{categoryLabel(row.category)}</td>
                        <td class="max-w-[28rem] whitespace-normal px-3 py-3 text-slate-300">
                          <p class="break-words">{row.description}</p>
                        </td>
                        <td class="whitespace-nowrap px-3 py-3">
                          <p class="text-slate-300">{row.source}</p>
                          <p class="mt-1 text-[10px] text-slate-500">{translateText(qualityLabel, getAppLanguage())}</p>
                        </td>
                        <td class="whitespace-nowrap px-3 py-3 text-slate-400">
                          {row.currency || '—'}
                          {row.debtOnly && <p class="mt-1 text-[10px] text-slate-500">{translateText('Debt only', getAppLanguage())}</p>}
                        </td>
                        <td class={'whitespace-nowrap px-3 py-3 text-right font-mono text-sm font-semibold tabular-nums ' + amountTone}>
                          {signedDisplay === null ? '—' : (isInflow ? '+' : '−') + formatMoney(signedDisplay, row.currency)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScrollRegion>
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
