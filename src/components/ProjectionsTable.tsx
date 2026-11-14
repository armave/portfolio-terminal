import { memo } from 'preact/compat';
import { useEffect } from 'preact/hooks';
import { TablePagination } from './TablePagination';
import { sliceTablePage, useTablePagination } from '../ui/useTablePagination';
import {
  calculateAccruedFees,
  calculateProjectedAccountBalanceAfterSale,
  calculateProjectedDebt,
  findProjectionBreakevenDay
} from '../domain/portfolio';
import { getUsEquityProjectionDates } from '../domain/tradingCalendar';
import { formatUSD } from '../utils/formatters';
import { useActiveView, usePortfolio } from '../store/portfolioStore';
import { getPortfolioProjectionInputs } from '../domain/portfolioSelectors';
import { calculateSaleCommission } from '../domain/portfolioTransactions';
import { getAppLanguage, translateText } from '../services/i18n';

const MAX_BREAKEVEN_SEARCH_DAYS = 3650;

function ProjectionsTableView() {
  const state = usePortfolio();
  const activeView = useActiveView();
  const projectionState = state.activeView === activeView ? state : { ...state, activeView };
  const { gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate } =
    getPortfolioProjectionInputs(projectionState, state.brokerAssumptions);
  const tickers = Object.keys(projectionState.positions || {});
  const isCombined = projectionState.activeView === 'COMBINED' ||
    (tickers.length !== 1 && !projectionState.positions?.[projectionState.activeView || '']);
  const liquidatedTickers = isCombined
    ? tickers
    : [projectionState.positions?.[projectionState.activeView || ''] ? projectionState.activeView : tickers[0]]
      .filter((ticker): ticker is string => Boolean(ticker));
  const netSaleProceeds = liquidatedTickers.reduce((total, ticker) => {
    const position = projectionState.positions?.[ticker];
    if (!position) return total;
    const shares = Number(position.shares);
    const exitPrice = Number(position.pt);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) return total;
    const grossProceeds = shares * exitPrice;
    return total + grossProceeds - calculateSaleCommission(shares, grossProceeds, state.brokerAssumptions);
  }, 0);
  const freeCash = Number(state.cashCushion?.freeCash ?? state.cashBalance ?? 0);

  const hasProjection = debtToUse > 0 || gross > 0;
  // Find the first day projected net reaches or crosses zero. That day is the
  // breakeven milestone; display its net as $0.00 and stop before any negative day.
  const breakevenDays = hasProjection
    ? findProjectionBreakevenDay(
      gross,
      totalComms,
      marginChargedToUse,
      debtToUse,
      dailyRate,
      MAX_BREAKEVEN_SEARCH_DAYS
    )
    : 0;
  const projectionItems = hasProjection
    ? getUsEquityProjectionDates(new Date(), entryDate, breakevenDays)
    : [];
  const pagination = useTablePagination('portfolio-projection', projectionItems.length, 10);
  const visibleItems = sliceTablePage(projectionItems, pagination.currentPage, pagination.pageSize);

  useEffect(() => {
    pagination.setPage(1);
  }, [gross, totalComms, debtToUse, marginChargedToUse, entryDate, dailyRate]);

  if (!hasProjection) {
    return (
      <tr>
        <td colSpan={4} class="py-4 text-center text-slate-500 italic">
          {translateText('No active position to project.', getAppLanguage())}
        </td>
      </tr>
    );
  }

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
              <td colSpan={3} class="py-1 px-2 text-[10px] italic text-center">
                {translateText('Position opened · projection values start today', getAppLanguage())}
              </td>
            </tr>
          );
        }

        const projectedDebt = calculateProjectedDebt(debtToUse, dailyRate, daysFromToday);
        const additionalAccrual = projectedDebt - Math.abs(debtToUse);
        const feesAndCommissions = calculateAccruedFees(totalComms, marginChargedToUse, additionalAccrual);
        const projectedNet = Number((gross - feesAndCommissions).toFixed(2));
        const net = kind === 'breakeven' ? 0 : projectedNet;
        const dailyFee = projectedDebt * dailyRate;
        const projectedAccountBalance = calculateProjectedAccountBalanceAfterSale(
          Number(state.balance ?? 0), freeCash, netSaleProceeds, dailyRate, daysFromToday
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
            <td class="py-1 px-2 text-slate-200">{formatUSD(feesAndCommissions)} ({formatUSD(dailyFee)})</td>
            <td class={`py-1 px-2 ${projectedAccountBalance < 0 ? 'text-rose-400' : 'text-cyan-200'}`}>
              {formatUSD(projectedAccountBalance)}
            </td>
          </tr>
        );
      })}
      <tr class="border-t border-slate-800">
        <td colSpan={4} class="px-2 py-1.5">
          <TablePagination
            tableLabel={translateText('Portfolio projection by date', getAppLanguage())}
            page={pagination.currentPage}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            start={pagination.start}
            end={pagination.end}
            total={projectionItems.length}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            className="border-0 px-0 py-1"
            controlsId="projectionTableBody"
          />
        </td>
      </tr>
    </>
  );
}

export const ProjectionsTable = memo(ProjectionsTableView);
