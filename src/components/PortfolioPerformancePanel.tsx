import { useMemo } from 'preact/hooks';
import { usePortfolioSelector } from '../store/portfolioStore';
import { getAppLanguage, translateText } from '../services/i18n';
import { buildPortfolioPerformanceReport } from '../domain/portfolioPerformanceIntegration';

const PERFORMANCE_RU_COPY: Record<string, string> = {
  "Portfolio performance": "Доходность портфеля",
  "Cash-flow-adjusted returns from verified daily valuation history.": "Доходность с поправкой на денежные потоки по подтверждённой ежедневной истории оценки.",
  "Current": "Актуальные данные",
  "Provisional": "Предварительно",
  "History collecting": "Сбор истории",
  "Time-weighted return": "Доходность, взвешенная по времени",
  "Money-weighted return": "Доходность, взвешенная по капиталу",
  "Investment profit": "Инвестиционная прибыль",
  "Linked Modified Dietz": "Связанный метод Modified Dietz",
  "Annualized XIRR · ACT/365": "Годовая XIRR · ACT/365",
  "Since first verified valuation": "С первой подтверждённой оценки",
  "Performance is not available yet": "Доходность пока недоступна",
  "More complete source data is required.": "Требуются более полные исходные данные.",
  "Valuation observations": "Наблюдения оценки",
  "Period": "Период",
  "Observations": "Наблюдения",
  "Monthly performance": "Доходность по месяцам",
  "Month": "Месяц",
  "Period return": "Доходность за период",
  "Cumulative return": "Накопленная доходность",
  "Income and costs": "Доходы и расходы",
  "Dividends": "Дивиденды",
  "Fees": "Сборы",
  "Commissions": "Комиссии",
  "Interest": "Проценты",
  "Net income / costs": "Чистый доход / расходы",
  "Income and cost totals are explanatory and are not added again to return calculations.": "Суммы доходов и расходов приведены для справки и повторно не включаются в расчёт доходности.",
  "Latest period contribution": "Вклад за последний период",
  "Other holdings": "Прочие активы",
  "Margin debt": "Маржинальный долг",
  "Cash": "Денежные средства",
  "Cash holding": "Актив за денежные средства",
  "TWR uses linked Modified Dietz, a flow-weighted approximation. MWR uses XIRR with ACT/365. Historical FX and benchmark comparison are not enabled. See Performance methodology in Settings.": "TWR использует связанный метод Modified Dietz — приближённый метод с весами денежных потоков. MWR использует XIRR с базой ACT/365. Историческая конвертация валют и сравнение с бенчмарком не включены. См. методологию доходности в настройках."
};

export function translatePortfolioPerformanceText(value: string, language = getAppLanguage()): string {
  if (language === 'ru') return PERFORMANCE_RU_COPY[value] || translateText(value, language);
  return value;
}

function label(value: string): string {
  return translatePortfolioPerformanceText(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(value: number | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.DateTimeFormat(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value as number));
}

function statusTone(status: 'available' | 'provisional' | 'unavailable'): string {
  if (status === 'available') return 'border-emerald-800/70 bg-emerald-950/25 text-emerald-300';
  if (status === 'provisional') return 'border-amber-800/70 bg-amber-950/20 text-amber-200';
  return 'border-slate-700 bg-slate-900 text-slate-300';
}

function displayItemKey(key: string): string {
  if (key.startsWith('position:')) return key.slice('position:'.length);
  if (key.startsWith('cash-holding:')) return key.slice('cash-holding:'.length) + ' · ' + label('Cash holding');
  if (key === 'other-holdings') return label('Other holdings');
  if (key === 'margin-debt') return label('Margin debt');
  if (key === 'cash') return label('Cash');
  return key;
}

export function PortfolioPerformancePanel() {
  const history = usePortfolioSelector(
    (state) => ({
      performanceValuations: state.performanceValuations || [],
      transactionEvents: state.transactionEvents || [],
      cashflows: state.cashflows || []
    }),
    (previous, next) =>
      previous.performanceValuations === next.performanceValuations &&
      previous.transactionEvents === next.transactionEvents &&
      previous.cashflows === next.cashflows
  );

  const report = useMemo(() => buildPortfolioPerformanceReport(history), [history]);
  const statusLabel = report.status === 'available'
    ? 'Current'
    : report.status === 'provisional'
      ? 'Provisional'
      : 'History collecting';
  const currency = report.currency || 'USD';
  const monthlyPoints = report.monthlySeries?.status === 'unavailable'
    ? []
    : report.monthlySeries?.value.points.slice(-6) || [];
  const attributionItems = report.latestAttribution?.status === 'unavailable'
    ? []
    : [...(report.latestAttribution?.value.items || [])]
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, 8);

  return (
    <section
      class="mt-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3 sm:p-4"
      aria-labelledby="portfolioPerformanceTitle"
    >
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="portfolioPerformanceTitle" class="text-sm font-bold text-slate-100">
            {label('Portfolio performance')}
          </h3>
          <p class="mt-0.5 text-[11px] leading-4 text-slate-400">
            {label('Cash-flow-adjusted returns from verified daily valuation history.')}
          </p>
        </div>
        <span class={'rounded-full border px-2.5 py-1 text-[10px] font-semibold ' + statusTone(report.status)}>
          {label(statusLabel)}
        </span>
      </div>

      {report.status === 'unavailable' ? (
        <div class="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <p class="text-xs font-semibold text-slate-200">{label('Performance is not available yet')}</p>
          <p class="mt-1 text-xs leading-5 text-slate-400">{label(report.reason || 'More complete source data is required.')}</p>
          <p class="mt-2 text-[10px] text-slate-500">
            {label('Valuation observations')}: {report.observationCount}
          </p>
        </div>
      ) : (
        <>
          <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <div class="text-[10px] text-slate-500">{label('Time-weighted return')}</div>
              <div class="mt-1 text-xl font-bold tabular-nums text-slate-100">
                {report.timeWeighted && report.timeWeighted.status !== 'unavailable'
                  ? formatPercent(report.timeWeighted.value.totalReturn)
                  : '—'}
              </div>
              <div class="mt-1 text-[10px] text-slate-500">{label('Linked Modified Dietz')}</div>
            </div>
            <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <div class="text-[10px] text-slate-500">{label('Money-weighted return')}</div>
              <div class="mt-1 text-xl font-bold tabular-nums text-slate-100">
                {report.moneyWeighted && report.moneyWeighted.status !== 'unavailable'
                  ? formatPercent(report.moneyWeighted.value.annualizedReturn)
                  : '—'}
              </div>
              <div class="mt-1 text-[10px] text-slate-500">{label('Annualized XIRR · ACT/365')}</div>
            </div>
            <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
              <div class="text-[10px] text-slate-500">{label('Investment profit')}</div>
              <div class="mt-1 text-xl font-bold tabular-nums text-slate-100">
                {report.profit === undefined ? '—' : formatMoney(report.profit, currency)}
              </div>
              <div class="mt-1 text-[10px] text-slate-500">{label('Since first verified valuation')}</div>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap justify-between gap-2 text-[10px] text-slate-500">
            <span>{label('Period')}: {formatDate(report.startAt)} — {formatDate(report.endAt)}</span>
            <span>{label('Observations')}: {report.observationCount}</span>
          </div>

          {monthlyPoints.length > 0 && (
            <div class="mt-4">
              <h4 class="text-xs font-semibold text-slate-200">{label('Monthly performance')}</h4>
              <div class="mt-2 overflow-x-auto">
                <table class="w-full min-w-[340px] text-xs">
                  <thead class="text-[10px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" class="py-2 pr-3 text-left">{label('Month')}</th>
                      <th scope="col" class="py-2 px-3 text-right">{label('Period return')}</th>
                      <th scope="col" class="py-2 pl-3 text-right">{label('Cumulative return')}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-800">
                    {monthlyPoints.map(point => (
                      <tr key={point.period}>
                        <td class="py-2 pr-3 text-slate-300">{point.period}</td>
                        <td class="py-2 px-3 text-right font-mono tabular-nums text-slate-200">{formatPercent(point.periodReturn)}</td>
                        <td class="py-2 pl-3 text-right font-mono tabular-nums text-slate-200">{formatPercent(point.cumulativeReturn)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {report.incomeCosts?.status !== 'unavailable' && report.incomeCosts && (
            <div class="mt-4">
              <h4 class="text-xs font-semibold text-slate-200">{label('Income and costs')}</h4>
              <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
                {([
                  ['Dividends', report.incomeCosts.value.dividends],
                  ['Fees', -report.incomeCosts.value.fees],
                  ['Commissions', -report.incomeCosts.value.commissions],
                  ['Interest', -report.incomeCosts.value.interest],
                  ['Net income / costs', report.incomeCosts.value.netIncomeAndCosts]
                ] as Array<[string, number]>).map(([name, value]) => (
                  <div key={name} class="rounded-lg bg-slate-900/70 p-2">
                    <div class="text-[10px] text-slate-500">{label(name)}</div>
                    <div class="mt-1 font-mono tabular-nums text-slate-200">{formatMoney(value, currency)}</div>
                  </div>
                ))}
              </div>
              <p class="mt-1 text-[10px] text-slate-500">
                {label('Income and cost totals are explanatory and are not added again to return calculations.')}
              </p>
            </div>
          )}

          {attributionItems.length > 0 && report.latestAttribution?.status !== 'unavailable' && (
            <div class="mt-4">
              <h4 class="text-xs font-semibold text-slate-200">{label('Latest period contribution')}</h4>
              <div class="mt-2 space-y-2">
                {attributionItems.map(item => (
                  <div key={item.key} class="flex items-center justify-between gap-3 text-[11px]">
                    <span class="min-w-0 truncate text-slate-400">{displayItemKey(item.key)}</span>
                    <span class="shrink-0 font-mono tabular-nums text-slate-200">
                      {formatMoney(item.profit, currency)} · {formatPercent(item.contribution)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {report.warnings.length > 0 && (
        <ul class="mt-3 space-y-1 border-t border-slate-800 pt-3 text-[10px] leading-4 text-amber-200">
          {report.warnings.slice(0, 5).map((warning, index) => <li key={index}>• {label(warning)}</li>)}
        </ul>
      )}

      <p class="mt-3 border-t border-slate-800 pt-2 text-[10px] leading-4 text-slate-500">
        {label('TWR uses linked Modified Dietz, a flow-weighted approximation. MWR uses XIRR with ACT/365. Historical FX and benchmark comparison are not enabled. See Performance methodology in Settings.')}
      </p>
    </section>
  );
}
