import { useMemo, useState } from 'preact/hooks';
import type { ActiveBrokerTranche, GuestTrancheLedgerRecord, GuestTrancheLedgerStatus } from '../types/portfolio';
import { filterGuestTrancheLedger, summarizeGuestTrancheLedger } from '../domain/guestPortfolio';
import { formatUSD } from '../utils/formatters';

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
    assignedFrom: fromDate ? new Date(fromDate + 'T00:00:00').getTime() : undefined,
    assignedTo: toDate ? new Date(toDate + 'T23:59:59.999').getTime() : undefined
  }), [records, tickerFilter, statusFilter, fromDate, toDate]);
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
          Assigned from
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate((event.currentTarget as HTMLInputElement).value)}
            class="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs font-normal normal-case text-slate-200" />
        </label>
        <label class="flex min-w-[8rem] flex-1 flex-col gap-1 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          Assigned to
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
        <div class="table-scroll-wrapper overflow-x-auto">
          <table class="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead>
              <tr class="border-b border-slate-800 text-[9px] uppercase tracking-wide text-slate-500">
                <th class="px-2 py-2">Assigned</th>
                <th class="px-2 py-2">Ticker</th>
                <th class="px-2 py-2 text-right">Shares</th>
                <th class="px-2 py-2 text-right">Open shares</th>
                <th class="px-2 py-2 text-right">Avg. cost</th>
                <th class="px-2 py-2 text-right">Open value</th>
                <th class="px-2 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-800/70 font-mono">
              {filteredRecords.map((record) => {
                const active = activeTranches.find((tranche) => tranche.id === record.trancheId);
                const marketValue = record.status === 'active' ? active?.marketValue : null;
                return (
                  <tr key={record.assignmentId} class="hover:bg-slate-900/60">
                    <td class="whitespace-nowrap px-2 py-2 text-slate-400">{formatAssignmentDate(record.assignedAt)}</td>
                    <td class="px-2 py-2 font-bold text-cyan-300">{record.ticker}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-200">{record.assignedQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-200">{record.openQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-300">{record.averagePrice !== null ? formatUSD(record.averagePrice) : '—'}</td>
                    <td class="px-2 py-2 text-right tabular-nums text-slate-300">{marketValue !== null && marketValue !== undefined ? formatUSD(marketValue) : '—'}</td>
                    <td class="px-2 py-2 text-right">
                      <span class={record.status === 'active' ? 'text-emerald-300' : record.status === 'closed' ? 'text-slate-300' : 'text-amber-300'}>
                        {STATUS_LABELS[record.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr class="border-t border-slate-700 text-[10px] text-slate-400">
                <td colSpan={7} class="px-2 py-2">
                  Assigned cost basis across filtered records: {summary.totalAssignedCostBasis > 0 ? formatUSD(summary.totalAssignedCostBasis) : '—'}
                  {summary.unassignedAssignments > 0 ? ` · ${summary.unassignedAssignments} unassigned` : ''}
                  {summary.unpricedOpenTranches > 0 ? ' · Some open holdings have no current quote' : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p class="text-[9px] text-slate-600">Market value is shown only for open assigned holdings. Realized profit/loss is not inferred from assignment history. Pre-feature open assignments are dated when first recorded.</p>
    </section>
  );
}