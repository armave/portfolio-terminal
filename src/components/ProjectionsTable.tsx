import { memo } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import {
  calculateAccruedFees,
  calculateProjectedAccountBalance,
  calculateProjectedDebt,
  findProjectionBreakevenDay
} from '../domain/portfolio';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { formatUSD } from '../utils/formatters';
import { useActiveView, usePortfolio } from '../store/portfolioStore';
import { getPortfolioProjectionInputs } from '../domain/portfolioSelectors';
import { getAppLanguage, translateText } from '../services/i18n';

const ROWS_PER_PAGE = 10;
const MAX_BREAKEVEN_SEARCH_DAYS = 3650;

function ProjectionsTableView() {
  const state = usePortfolio();
  const activeView = useActiveView();
  const projectionState = state.activeView === activeView ? state : { ...state, activeView };
  const { gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate } =
    getPortfolioProjectionInputs(projectionState, state.brokerAssumptions);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate]);

  if (debtToUse <= 0 && gross <= 0) {
    return (
      <tr>
        <td colSpan={5} class="py-4 text-center text-slate-500 italic">
          {translateText('No active position to project.', getAppLanguage())}
        </td>
      </tr>
    );
  }

  // Find the first day projected net reaches or crosses zero. That day is the
  // breakeven milestone; display its net as $0.00 and stop before any negative day.
  const breakevenDays = findProjectionBreakevenDay(
    gross,
    totalComms,
    marginChargedToUse,
    debtToUse,
    dailyRate,
    MAX_BREAKEVEN_SEARCH_DAYS
  );

  const projectionItems = getUsEquityProjectionDates(new Date(), entryDate, breakevenDays);
  const pageCount = Math.max(1, Math.ceil(projectionItems.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleItems = projectionItems.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE);

  return (
    <>
      {visibleItems.map((item, idx) => {
        const { date, daysFromToday, kind } = item;
        const dateFormatted = date.toLocaleDateString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });

        if (kind === 'entry') {
          return (
            <tr key={`entry-${daysFromToday}-${idx}`} class="projection-page-row border-b border-slate-800/50 text-slate-500">
              <td class="sticky left-0 z-10 backdrop-blur-sm py-1 px-2 text-left projection-date-cell">
                <span class="text-[10px] font-medium text-slate-400">{translateText('Entry', getAppLanguage())}</span>
                <span class="text-[10px] text-slate-500 font-mono">{dateFormatted}</span>
              </td>
              <td colSpan={4} class="py-1 px-2 text-[10px] italic text-center">
                {translateText('Position opened · projection values start today', getAppLanguage())}
              </td>
            </tr>
          );
        }

        const projectedDebt = calculateProjectedDebt(debtToUse, dailyRate, daysFromToday);
        const additionalAccrual = projectedDebt - Math.abs(debtToUse);
        const marginFee = marginChargedToUse + additionalAccrual;
        const feesAndCommissions = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
        const projectedNet = Number((gross - feesAndCommissions).toFixed(2));
        const net = kind === 'breakeven' ? 0 : projectedNet;
        const dailyFee = projectedDebt * dailyRate;
        const projectedAccountBalance = calculateProjectedAccountBalance(
          Number(state.balance ?? 0), dailyRate, daysFromToday
        );

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
          badgeText = translateText('TODAY', getAppLanguage());
        } else if (kind === 'next-trading-day' || kind === 'week-end') {
          badgeClass = 'text-xs text-slate-400 font-mono';
          const defaultTag = kind === 'week-end'
            ? translateText('EOW · +{days}d', getAppLanguage())
            : translateText('NTD · +{days}d', getAppLanguage());
          badgeText = defaultTag.replace('{days}', String(daysFromToday));
        } else if (kind === 'breakeven') {
          badgeClass = 'text-xs text-amber-300 font-mono';
          badgeText = translateText('BREAKEVEN', getAppLanguage());
        }

        return (
          <tr key={`${kind}-${daysFromToday}-${idx}`} class={`${rowClass} projection-page-row`}>
            <td class="sticky left-0 z-10 backdrop-blur-sm py-1 px-2 text-slate-300 font-semibold projection-date-cell">
              <span>{dateFormatted}</span>
              <span class={badgeClass}>{badgeText}</span>
            </td>
            <td class={`py-1 px-2 ${netClass} font-semibold`}>
              {netSign}{formatUSD(net)}
            </td>
            <td class="py-1 px-2 text-slate-200">{formatUSD(feesAndCommissions)}</td>
            <td class="py-1 px-2 text-slate-400">
              {formatUSD(marginFee)} ({formatUSD(dailyFee)})
            </td>
            <td class={`py-1 px-2 ${projectedAccountBalance < 0 ? 'text-rose-400' : 'text-cyan-200'}`}>
              {formatUSD(projectedAccountBalance)}
            </td>
          </tr>
        );
      })}
      {pageCount > 1 && (
        <tr class="border-t border-slate-800">
          <td colSpan={5} class="px-2 py-3">
            <div class="projection-pagination flex items-center justify-between gap-3 text-xs text-slate-400" aria-label={translateText('Projection table pagination', getAppLanguage())} aria-live="polite">
              <span>
                {translateText('Rows {start}–{end} of {total}', getAppLanguage()).replace('{start}', String(currentPage * ROWS_PER_PAGE + 1)).replace('{end}', String(Math.min((currentPage + 1) * ROWS_PER_PAGE, projectionItems.length))).replace('{total}', String(projectionItems.length))}
              </span>
              <div class="projection-pagination-controls flex items-center gap-2">
                <button
                  type="button"
                  class="projection-pagination-button rounded border border-slate-700 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  aria-label={translateText('Previous projection page', getAppLanguage())}
                  disabled={currentPage === 0}
                  onClick={() => setPage(Math.max(0, currentPage - 1))}
                >
                  {translateText('Previous', getAppLanguage())}
                </button>
                <span class="whitespace-nowrap">{translateText('Page {current} of {total}', getAppLanguage()).replace('{current}', String(currentPage + 1)).replace('{total}', String(pageCount))}</span>
                <button
                  type="button"
                  class="rounded border border-slate-700 px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-800"
                  aria-label={translateText('Next projection page', getAppLanguage())}
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))}
                >
                  {translateText('Next', getAppLanguage())}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export const ProjectionsTable = memo(ProjectionsTableView);
