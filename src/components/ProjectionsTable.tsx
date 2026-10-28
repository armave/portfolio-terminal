import { useEffect, useState } from 'preact/hooks';
import {
  calculateAccruedFees,
  calculateProjectedDebt
} from '../domain/portfolio';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { formatUSD } from '../utils/formatters';

export interface ProjectionsTableProps {
  gross: number;
  totalComms: number;
  debtToUse: number;
  marginChargedToUse: number;
  entryDate?: string;
  dailyRate?: number;
}

const ROWS_PER_PAGE = 8;
const MAX_BREAKEVEN_SEARCH_DAYS = 3650;

export function ProjectionsTable({
  gross,
  totalComms,
  debtToUse,
  marginChargedToUse,
  entryDate,
  dailyRate = 0
}: ProjectionsTableProps) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate]);

  if (debtToUse <= 0 && gross <= 0) {
    return (
      <tr>
        <td colSpan={5} class="py-4 text-center text-slate-500 italic">
          No active position to project.
        </td>
      </tr>
    );
  }

  const netAfterDays = (days: number): number => {
    const projectedDebt = calculateProjectedDebt(debtToUse, dailyRate, days);
    const additionalAccrual = projectedDebt - Math.abs(debtToUse);
    const projectedFees = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
    return gross - projectedFees;
  };

  // Find the first cent-rounded calendar day on which projected net P&L reaches
  // zero. The cap prevents unbounded rendering for positions that never break even.
  let breakevenDays: number | undefined;
  if (netAfterDays(0) <= 0) {
    breakevenDays = 0;
  } else if (debtToUse > 0 && dailyRate > 0) {
    for (let day = 1; day <= MAX_BREAKEVEN_SEARCH_DAYS; day++) {
      if (netAfterDays(day) <= 0) {
        breakevenDays = day;
        break;
      }
    }
  }

  const projectionItems = getUsEquityProjectionDates(new Date(), entryDate, breakevenDays);
  const pageCount = Math.max(1, Math.ceil(projectionItems.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = projectionItems.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE);

  return (
    <>
      {visibleItems.map((item, idx) => {
        const { date, daysFromToday, kind } = item;
        const dateFormatted = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });

        if (kind === 'entry') {
          return (
            <tr key={`entry-${daysFromToday}-${idx}`} class="border-b border-slate-800/50 text-slate-500">
              <td class="sticky left-0 z-10 backdrop-blur-sm py-1 px-2 text-left projection-date-cell">
                <span class="text-[10px] font-medium text-slate-400">Entry</span>
                <span class="text-[10px] text-slate-500 font-mono">{dateFormatted}</span>
              </td>
              <td colSpan={4} class="py-1 px-2 text-[10px] italic text-center">
                Position opened · projection values start today
              </td>
            </tr>
          );
        }

        const projectedDebt = calculateProjectedDebt(debtToUse, dailyRate, daysFromToday);
        const additionalAccrual = projectedDebt - Math.abs(debtToUse);
        const marginFee = marginChargedToUse + additionalAccrual;
        const feesAndCommissions = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
        const net = gross - feesAndCommissions;
        const dailyFee = projectedDebt * dailyRate;

        const rowClass = kind === 'today'
          ? 'bg-slate-900/80 font-bold'
          : kind === 'breakeven'
            ? 'bg-amber-950/30 font-bold'
            : 'hover:bg-slate-900/40';
        const netClass = net >= 0 ? 'text-emerald-400' : 'text-rose-400';
        const netSign = net >= 0 ? '+' : '';

        let badgeClass = 'text-xs text-slate-500 font-mono';
        let badgeText = (item.label || `+${daysFromToday}d`).replace(/^\(|\)$/g, '');

        if (kind === 'today') {
          badgeClass = 'text-xs text-sky-400 font-mono';
          badgeText = 'TODAY';
        } else if (kind === 'next-trading-day' || kind === 'week-end') {
          badgeClass = 'text-xs text-slate-400 font-mono';
          const defaultTag = kind === 'week-end' ? `EOW · +${daysFromToday}d` : `NTD · +${daysFromToday}d`;
          badgeText = (item.label || defaultTag).replace(/^\(|\)$/g, '');
        } else if (kind === 'breakeven') {
          badgeClass = 'text-xs text-amber-300 font-mono';
          badgeText = 'BREAKEVEN';
        }

        return (
          <tr key={`${kind}-${daysFromToday}-${idx}`} class={rowClass}>
            <td class="sticky left-0 z-10 backdrop-blur-sm py-1 px-2 text-left text-slate-300 font-semibold projection-date-cell">
              <span>{dateFormatted}</span>
              <span class={badgeClass}>{badgeText}</span>
            </td>
            <td class={`py-1 px-2 text-right ${netClass} font-semibold`}>
              {netSign}{formatUSD(net)}
            </td>
            <td class="py-1 px-2 text-right text-slate-200">{formatUSD(feesAndCommissions)}</td>
            <td class="py-1 px-2 text-right text-slate-400">
              {formatUSD(marginFee)} ({formatUSD(dailyFee)})
            </td>
            <td class="py-1 px-2 text-right text-rose-400">-{formatUSD(projectedDebt)}</td>
          </tr>
        );
      })}
      {pageCount > 1 && (
        <tr class="border-t border-slate-800">
          <td colSpan={5} class="px-2 py-3">
            <div class="flex items-center justify-between gap-3 text-xs text-slate-400" aria-label="Projection table pagination">
              <span>
                Rows {currentPage * ROWS_PER_PAGE + 1}–{Math.min((currentPage + 1) * ROWS_PER_PAGE, projectionItems.length)} of {projectionItems.length}
              </span>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="rounded border border-slate-700 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  aria-label="Previous projection page"
                  disabled={currentPage === 0}
                  onClick={() => setPage(Math.max(0, currentPage - 1))}
                >
                  Previous
                </button>
                <span class="whitespace-nowrap">Page {currentPage + 1} of {pageCount}</span>
                <button
                  type="button"
                  class="rounded border border-slate-700 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  aria-label="Next projection page"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
