import { useMemo, useState } from 'preact/hooks';
import type { ActiveBrokerTranche, GuestTrancheLedgerRecord, GuestTrancheLedgerStatus } from '../types/portfolio';
import { filterGuestTrancheLedger, groupGuestTrancheLedgerOperations, summarizeGuestTrancheLedger } from '../domain/guestPortfolio';
import { formatUSD } from '../utils/formatters';
import { TableScrollRegion } from './TableScrollRegion';

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
  unassigned: 'Unassigned'
};

export function GuestTrancheHistory({ records, activeTranches }: GuestTrancheHistoryProps) {
  const [tickerFilter, setTickerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GuestTrancheLedgerStatus>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const filteredRecords = useMemo(() => filterGuestTrancheLedger(records, {
    ticker: tickerFilter,
    status: statusFilter,
    operationDateFrom: fromDate ? new Date(fromDate + 'T00:00:00').getTime() : undefined,
    operationDateTo: toDate ? new Date(toDate + 'T23:59:59.999').getTime() : undefined
  }), [records, tickerFilter, statusFilter, fromDate, toDate]);
  const groupedRecords = useMemo(() => groupGuestTrancheLedgerOperations(filteredRecords), [filteredRecords]);
  const summary = useMemo(
    () => summarizeGuestTrancheLedger(filteredRecords, activeTranches),
    [filteredRecords, activeTranches]
  );
  const marketValueLabel = summary.unpricedOpenTranches > 0
    ? summary.pricedOpenTranches > 0 ? '≥ ' + formatUSD(summary.currentMarketValue) : '—'
    : formatUSD(summary.currentMarketValue);

  return (
    <section id="guestTrancheHistory" class="space-y-3 rounded-xl border border-indigo-900/50 bg-slate-950/50 p-3 sm:p-4"
      aria-labelledby="guestTrancheHistoryHeading">
      <div class="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 id="guestTrancheHistoryHeading" class="text-sm font-black uppercase tracking-wide text-indigo-300">LOTS</h2>
          <p class="mt-1 text-[10px] text-slate-500">Your cash-funded purchase allocations, including completed and removed assignments</p>
        </div>
        <span class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] tabular-nums text-slate-400">
          {filteredRecords.length} / {records.length} records
        </span>
      </div>

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
          <p class="mt-1 font-mono text-sm font-bold text-slate-100">{summary.openCostBasis > 0 ? formatUSD(summary.openCostBasis) : '—'}</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
          <p class="text-[9px] uppercase tracking-wide text-slate-500">Open market value</p>
          <p class="mt-1 font-mono text-sm font-bold text-cyan-300">{summary.pricedOpenTranches + summary.unpricedOpenTranches > 0 ? marketValueLabel : '—'}</p>
        </div>
      </div>
      <div class="flex flex-wrap items-end gap-2">
        <label class="flex min-w-[8rem] flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          Ticker
          <input type="search" value={tickerFilter} onInput={(event) => setTickerFilter((event.currentTarget as HTMLInputElement).value)}
            placeholder="All tickers" class="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200 placeholder:text-slate-600" />
        </label>
        <label class="flex min-w-[8rem] flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter((event.currentTarget as HTMLSelectElement).value as typeof statusFilter)}
            class="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </label>
        <label class="flex min-w-[8rem] flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          Date from
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate((event.currentTarget as HTMLInputElement).value)}
            class="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200" />
        </label>
        <label class="flex min-w-[8rem] flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          Date to
          <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate((event.currentTarget as HTMLInputElement).value)}
            class="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200" />
        </label>
      </div>

      {records.length === 0 ? (
        <p class="rounded-lg border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">
          Assignment history will appear here after the administrator's next successful portfolio sync. Only assignments created before this history feature and still open can be backfilled.
        </p>
      ) : filteredRecords.length === 0 ? (
        <p class="rounded-lg border border-dashed border-slate-800 px-3 py-5 text-center text-xs text-slate-500">No assignments match these filters.</p>
      ) : (
        <TableScrollRegion label="Guest assignment history table" className="table-scroll-wrapper" focusClassName="focus-visible:outline-indigo-400">
          <table class="w-full min-w-[960px] border-collapse text-left text-xs">
            <caption class="sr-only">Guest assignment history table</caption>
            <thead>
              <tr class="border-b border-slate-800 text-[9px] uppercase tracking-wide text-slate-500">
                <th scope="col" class="px-2 py-2">Date</th>
                <th scope="col" class="px-2 py-2">Source</th>
                <th scope="col" class="px-2 py-2">Ticker</th>
                <th scope="col" class="px-2 py-2 text-right">Shares</th>
                <th scope="col" class="px-2 py-2 text-right">Open shares</th>
                <th scope="col" class="px-2 py-2 text-right">Avg. cost</th>
                <th scope="col" class="px-2 py-2 text-right">Value</th>
                <th scope="col" class="px-2 py-2 text-right">Net P&amp;L</th>
                <th scope="col" class="px-2 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/70 font-mono">
              {groupedRecords.map((group) => {
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
                    <td class="whitespace-nowrap px-2 py-2 text-slate-400">{formatAssignmentDate(group.operationAt)}</td>
                    <td class="px-2 py-2 text-slate-400">{isClosedTrade ? 'Trade' : 'Tranche'}</td>
                    <td class="px-2 py-2 font-bold text-cyan-300">{record.ticker}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-200">{assignedQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-200">{openQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-300">{averagePrice !== null ? formatUSD(averagePrice) : '—'}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-300">{value !== null ? formatUSD(value) : '—'}</td>
                    <td class={`px-2 py-2 text-right tabular-nums ${netProfit === null ? 'text-slate-500' : netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {netProfit !== null ? formatUSD(netProfit) : '—'}
                    </td>
                    <td class="px-2 py-2 text-right">
                      <span class={statusClass}>{statusLabel}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr class="border-t border-slate-700 text-[10px] text-slate-400">
                <td colSpan={9} class="px-2 py-2">
                  Assigned cost basis across filtered records: {summary.totalAssignedCostBasis > 0 ? formatUSD(summary.totalAssignedCostBasis) : '—'}
                  {summary.unassignedAssignments > 0 ? ` · ${summary.unassignedAssignments} unassigned` : ''}
                  {summary.unpricedOpenTranches > 0 ? ' · Some open holdings have no current quote' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </TableScrollRegion>
      )}
      <p class="text-[9px] text-slate-600">Value shows current market value for open tranches and sale proceeds for closed trades. Net P&amp;L appears only when the closed trade's net result is available.</p>
    </section>
  );
}