import {
  calculateAccruedFees,
  calculateProjectedDebt
} from '../domain/portfolio';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { formatUSD } from '../ui/renderBoard';

export interface ProjectionsTableProps {
  gross: number;
  totalComms: number;
  debtToUse: number;
  marginChargedToUse: number;
  entryDate?: string;
  dailyRate?: number;
}

export function ProjectionsTable({
  gross,
  totalComms,
  debtToUse,
  marginChargedToUse,
  entryDate,
  dailyRate = 0
}: ProjectionsTableProps) {
  if (debtToUse <= 0 && gross <= 0) {
    return (
      <tr>
        <td colSpan={5} class="py-4 text-center text-slate-500 italic">
          No active position to project.
        </td>
      </tr>
    );
  }

  const projectionItems = getUsEquityProjectionDates(new Date(), entryDate);

  return (
    <>
      {projectionItems.map((item, idx) => {
        const { date, daysFromToday, kind } = item;
        const dateFormatted = date.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });

        if (kind === 'entry') {
          return (
            <tr key={`entry-${idx}`} class="border-b border-slate-800/50 text-slate-500">
              <td class="py-1.5 px-3 text-left projection-date-cell">
                <span class="text-[10px] font-medium text-slate-400">Entry</span>
                <span class="text-[10px] text-slate-500 font-mono">{dateFormatted}</span>
              </td>
              <td colSpan={4} class="py-1.5 px-3 text-[10px] italic text-left">
                Position opened · projection values start today
              </td>
            </tr>
          );
        }

        // Calculate exact projected debt and derive the interest to prevent rounding mismatches
        const b_t = calculateProjectedDebt(debtToUse, dailyRate, daysFromToday);
        const additionalAccrual = b_t - Math.abs(debtToUse);
        
        const m_d = marginChargedToUse + additionalAccrual;
        const fee_c = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
        const net_p = gross - fee_c;
        const dr = b_t * dailyRate;

        const rowClass = kind === 'today' ? 'bg-slate-900/80 font-bold' : 'hover:bg-slate-900/40';
        const netClass = net_p >= 0 ? 'text-emerald-400' : 'text-rose-400';
        const netSign = net_p >= 0 ? '+' : '';

        let badgeClass = 'text-xs text-slate-500 font-mono';
        let badgeText = (item.label || `+${daysFromToday}d`).replace(/^\(|\)$/g, '');

        if (kind === 'today') {
          badgeClass = 'text-xs text-sky-400 font-mono';
          badgeText = 'TODAY';
        } else if (kind === 'next-trading-day' || kind === 'week-end') {
          badgeClass = 'text-xs text-slate-400 font-mono';
          const defaultTag =
            kind === 'week-end' ? `EOW · +${daysFromToday}d` : `NTD · +${daysFromToday}d`;
          badgeText = (item.label || defaultTag).replace(/^\(|\)$/g, '');
        }

        return (
          <tr key={`${kind}-${daysFromToday}-${idx}`} class={rowClass}>
            <td class="py-2 px-3 text-left text-slate-300 font-semibold projection-date-cell">
              <span>{dateFormatted}</span>
              <span class={badgeClass}>{badgeText}</span>
            </td>
            <td class={`py-2 px-3 text-right ${netClass} font-semibold`}>
              {netSign}{formatUSD(net_p)}
            </td>
            <td class="py-2 px-3 text-right text-slate-200">{formatUSD(fee_c)}</td>
            <td class="py-2 px-3 text-right text-slate-400">
              {formatUSD(m_d)} ({formatUSD(dr)})
            </td>
            <td class="py-2 px-3 text-right text-rose-400">-{formatUSD(b_t)}</td>
          </tr>
        );
      })}
    </>
  );
}
