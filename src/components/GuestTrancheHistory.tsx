import { useMemo, useState } from 'preact/hooks';
import type { ActiveBrokerTranche, GuestTrancheLedgerRecord, GuestTrancheLedgerStatus } from '../types/portfolio';
import { filterGuestTrancheLedger, groupGuestTrancheLedgerOperations, summarizeGuestTrancheLedger } from '../domain/guestPortfolio';
import { formatUSD } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';
import { TableScrollRegion } from './TableScrollRegion';
import { TablePagination } from './TablePagination';
import { DeskPageHeader } from './DeskPageHeader';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import { getHistoryDateRangeForPreset, type HistoryDatePreset } from '../ui/historyDateRange';

interface GuestTrancheHistoryProps {
  records: GuestTrancheLedgerRecord[];
  activeTranches: ActiveBrokerTranche[];
}

function formatAssignmentDate(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
  return new Date(Number(value)).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit'
  });
}

const STATUS_LABELS: Record<GuestTrancheLedgerStatus, string> = {
  active: 'Active',
  closed: 'Closed',
  unassigned: 'Removed'
};

const DATE_RANGE_PRESETS: { value: HistoryDatePreset; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'month', label: 'This month' }
];

export function GuestTrancheHistory({ records, activeTranches }: GuestTrancheHistoryProps) {
  const [tickerFilter, setTickerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GuestTrancheLedgerStatus>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [datePreset, setDatePreset] = useState<HistoryDatePreset | 'custom'>('all');

  const applyDatePreset = (preset: HistoryDatePreset) => {
    const range = getHistoryDateRangeForPreset(preset);
    setFromDate(range.fromDate);
    setToDate(range.toDate);
    setDatePreset(preset);
  };
  const updateCustomDateRange = (nextFromDate: string, nextToDate: string) => {
    setFromDate(nextFromDate);
    setToDate(nextToDate);
    setDatePreset(nextFromDate || nextToDate ? 'custom' : 'all');
  };

  const filteredRecords = useMemo(() => filterGuestTrancheLedger(records, {
    ticker: tickerFilter,
    status: statusFilter,
    operationDateFrom: fromDate ? new Date(fromDate + 'T00:00:00').getTime() : undefined,
    operationDateTo: toDate ? new Date(toDate + 'T23:59:59.999').getTime() : undefined
  }), [records, tickerFilter, statusFilter, fromDate, toDate]);
  const groupedRecords = useMemo(() => groupGuestTrancheLedgerOperations(filteredRecords), [filteredRecords]);
  const pagination = useTablePagination('guest-tranche-history', groupedRecords.length, 10);
  const visibleGroupedRecords = sliceTablePage(groupedRecords, pagination.currentPage, pagination.pageSize);
  const summary = useMemo(
    () => summarizeGuestTrancheLedger(filteredRecords, activeTranches),
    [filteredRecords, activeTranches]
  );
  const marketValueLabel = summary.unpricedOpenTranches > 0
    ? summary.pricedOpenTranches > 0 ? '≥ ' + formatUSD(summary.currentMarketValue) : '—'
    : formatUSD(summary.currentMarketValue);

  return (
    <section id="guestTrancheHistory" class="desk-page-content min-w-0 space-y-4"
      aria-labelledby="guestTrancheHistoryHeading">
      <DeskPageHeader
        title={translateText('History', getAppLanguage())}
        description={translateText('Your stocks, purchases, and completed trades in one place.', getAppLanguage())}
        titleId="guestTrancheHistoryHeading"
        trailing={
          <span class="text-xs tabular-nums text-slate-400">
            {translateText(`${filteredRecords.length} records`, getAppLanguage())} / {translateText(`${records.length} records`, getAppLanguage())}
          </span>
        }
      />

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
          <p class="text-[9px] uppercase tracking-wide text-slate-500">Active</p>
          <p class="mt-1 font-mono text-lg font-bold text-emerald-300">{summary.activeAssignments}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
          <p class="text-[9px] uppercase tracking-wide text-slate-500">Closed</p>
          <p class="mt-1 font-mono text-lg font-bold text-slate-200">{summary.closedAssignments}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
          <p class="text-[9px] uppercase tracking-wide text-slate-500">Open cost basis</p>
          <p class="mt-1 font-mono text-lg font-bold text-slate-100">{summary.openCostBasis > 0 ? formatUSD(summary.openCostBasis) : '—'}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
          <p class="text-[9px] uppercase tracking-wide text-slate-500">Open market value</p>
          <p class="mt-1 font-mono text-lg font-bold text-cyan-300">{summary.pricedOpenTranches + summary.unpricedOpenTranches > 0 ? marketValueLabel : '—'}</p>
        </div>
      </div>
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <label class="flex min-w-0 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:min-w-[8rem] sm:flex-1">
            Ticker
            <input type="search" value={tickerFilter} onInput={(event) => setTickerFilter((event.currentTarget as HTMLInputElement).value)}
              placeholder="All tickers" class="min-h-11 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200 placeholder:text-slate-600" />
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:min-w-[8rem] sm:flex-1">
            Status
            <select value={statusFilter} onChange={(event) => setStatusFilter((event.currentTarget as HTMLSelectElement).value as typeof statusFilter)}
              class="min-h-11 rounded border border-slate-700 text-center bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200">
              <option value="all" class="text-center">All statuses</option>
              <option value="active" class="text-center">Active</option>
              <option value="closed" class="text-center">Closed</option>
              <option value="unassigned" class="text-center">Removed</option>
            </select>
          </label>
        </div>

        <div class="space-y-2">
          <span class="block text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Date range', getAppLanguage())}</span>
          <div class="guest-history-date-presets" role="group" aria-label={translateText('Date range', getAppLanguage())}>
            {DATE_RANGE_PRESETS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={datePreset === value}
                class={'guest-history-date-preset' + (datePreset === value ? ' guest-history-date-preset--active' : '')}
                onClick={() => applyDatePreset(value)}
              >
                {translateText(label, getAppLanguage())}
              </button>
            ))}
          </div>
          <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <label class="flex min-w-0 flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:min-w-[8rem]">
              {translateText('Date from', getAppLanguage())}
              <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => updateCustomDateRange((event.currentTarget as HTMLInputElement).value, toDate)}
                class="min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200" />
            </label>
            <label class="flex min-w-0 flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:min-w-[8rem]">
              {translateText('Date to', getAppLanguage())}
              <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => updateCustomDateRange(fromDate, (event.currentTarget as HTMLInputElement).value)}
                class="min-h-11 w-full rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200" />
            </label>
          </div>
        </div>
      </div>

      {records.length === 0 ? (
        <div class="rounded-lg border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">
          <p class="font-semibold text-slate-300">{translateText('No stock history yet.', getAppLanguage())}</p>
          <p class="mt-2 leading-relaxed">{translateText('Your stock purchases and completed trades will appear here after the next portfolio update.', getAppLanguage())}</p>
        </div>
      ) : filteredRecords.length === 0 ? (
        <p class="rounded-lg border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">{translateText('No stocks match these filters.', getAppLanguage())}</p>
      ) : (
        <>
        <TableScrollRegion label={translateText('Stock history table', getAppLanguage())} className="table-scroll-wrapper guest-assignment-history-scroll" focusClassName="focus-visible:outline-indigo-400">
          <table class="guest-assignment-history-table w-full border-collapse text-left text-xs">
            <caption class="sr-only">Stock history table</caption>
            <thead>
              <tr class="border-b border-slate-800 text-[9px] uppercase tracking-wide text-slate-500">
                <th scope="col" class="px-2 py-2">Date</th>
                <th scope="col" class="px-2 py-2">Source</th>
                <th scope="col" class="px-2 py-2">Ticker</th>
                <th scope="col" class="px-2 py-2 text-right">Shares</th>
                <th scope="col" class="px-2 py-2 text-right">Remaining shares</th>
                <th scope="col" class="px-2 py-2 text-right">Average cost</th>
                <th scope="col" class="px-2 py-2 text-right">Value</th>
                <th scope="col" class="px-2 py-2 text-right">Net P&amp;L</th>
                <th scope="col" class="px-2 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody id="guestTrancheHistoryTableBody" class="divide-y divide-slate-800/70 font-mono">
              {visibleGroupedRecords.map((group) => {
                const grouped = group.records;
                const record = grouped[0];
                const isClosedTrade = record.trancheId.startsWith('closed-trade:');
                const assignedQuantity = grouped.reduce((total, item) => total + Math.max(0, Number(item.assignedQuantity) || 0), 0);
                const openQuantity = grouped.reduce((total, item) => total + Math.max(0, Number(item.openQuantity) || 0), 0);
                const hasAllAveragePrices = grouped.every((item) =>
                  item.averagePrice !== null && item.averagePrice !== undefined && Number.isFinite(Number(item.averagePrice))
                );
                const averagePrice = hasAllAveragePrices && assignedQuantity > 0
                  ? grouped.reduce((total, item) => total + Number(item.averagePrice) * Math.max(0, Number(item.assignedQuantity) || 0), 0) / assignedQuantity
                  : null;
                const statuses = new Set(grouped.map((item) => item.status));
                const status = statuses.size === 1 ? record.status : null;
                const statusLabel = status === null ? 'Mixed' : STATUS_LABELS[status];
                const statusClass = status === 'active'
                  ? 'text-emerald-300'
                  : status === 'closed'
                    ? 'text-slate-300'
                    : status === 'unassigned'
                      ? 'text-amber-300'
                      : 'text-slate-400';
                const values = grouped.map((item) => item.status === 'active'
                  ? activeTranches.find((tranche) => tranche.id === item.trancheId)?.marketValue ?? null
                  : item.value ?? null);
                // Do not combine market value, sale proceeds, or P/L across mixed lifecycle states.
                const hasComparableValues = status !== null && values.every((item) =>
                  item !== null && item !== undefined && Number.isFinite(Number(item))
                );
                const value = hasComparableValues
                  ? values.reduce<number>((total, item) => total + Number(item), 0)
                  : null;
                const hasAllNetProfits = grouped.every((item) =>
                  item.netProfit !== null && item.netProfit !== undefined && Number.isFinite(Number(item.netProfit))
                );
                const netProfit = hasAllNetProfits
                  ? grouped.reduce((total, item) => total + Number(item.netProfit), 0)
                  : null;
                return (
                  <tr key={grouped.map((item) => item.assignmentId).join('|')} class="hover:bg-slate-900/60">
                    <td data-label={translateText('Date', getAppLanguage())} class="whitespace-nowrap px-2 py-2 text-slate-400">{formatAssignmentDate(group.operationAt)}</td>
                    <td data-label={translateText('Source', getAppLanguage())} class="px-2 py-2 text-slate-400">{isClosedTrade ? translateText('Trade', getAppLanguage()) : translateText('Tranche', getAppLanguage())}</td>
                    <td data-label={translateText('Ticker', getAppLanguage())} class="px-2 py-2 font-bold text-cyan-300">{record.ticker}</td>
                    <td data-label={translateText('Shares', getAppLanguage())} class="px-2 py-2 text-right tabular-nums text-slate-200">{assignedQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td data-label={translateText('Remaining shares', getAppLanguage())} class="px-2 py-2 text-right tabular-nums text-slate-200">{openQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td data-label={translateText('Average cost', getAppLanguage())} class="px-2 py-2 text-right tabular-nums text-slate-300">{averagePrice !== null ? formatUSD(averagePrice) : '—'}</td>
                    <td data-label={translateText('Value', getAppLanguage())} class="px-2 py-2 text-right tabular-nums text-slate-300">{value !== null ? formatUSD(value) : '—'}</td>
                    <td data-label={translateText('Net P&L', getAppLanguage())} class={`px-2 py-2 text-right tabular-nums ${netProfit === null ? 'text-slate-500' : netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {netProfit !== null ? formatUSD(netProfit) : '—'}
                    </td>
                    <td data-label={translateText('Status', getAppLanguage())} class="px-2 py-2 text-right">
                      <span class={statusClass}>{translateText(statusLabel, getAppLanguage())}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr class="border-t border-slate-700 text-[10px] text-slate-400">
                <td colSpan={9} class="px-2 py-2">
                  Cost basis across filtered records: {summary.totalAssignedCostBasis > 0 ? formatUSD(summary.totalAssignedCostBasis) : '—'}
                  {summary.unassignedAssignments > 0 ? ` · ${summary.unassignedAssignments} removed` : ''}
                  {summary.unpricedOpenTranches > 0 ? ' · Some open holdings have no current quote' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </TableScrollRegion>
        <TablePagination
          tableLabel={translateText('Stock history table', getAppLanguage())}
          page={pagination.currentPage}
          pageCount={pagination.pageCount}
          pageSize={pagination.pageSize}
          start={pagination.start}
          end={pagination.end}
          total={groupedRecords.length}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
          controlsId="guestTrancheHistoryTableBody"
        />
        </>
      )}
      <p class="text-[9px] text-slate-600">Value shows current market value for open tranches and sale proceeds for closed trades. Net P&amp;L appears only when the closed trade's net result is available.</p>
    </section>
  );
}