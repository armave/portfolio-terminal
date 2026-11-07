import { useMemo } from 'preact/hooks';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, getQuoteFreshness } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { buildAdminDashboardSummary } from '../domain/adminDashboard';
import { calculateCommission, calculateMarginInterest, resolveCommissionConfig } from '../domain/portfolio';

function label(value: string): string {
  return translateText(value, getAppLanguage());
}

function Metric({ title, value, detail, tone = 'text-slate-100' }: {
  title: string; value: string; detail?: string; tone?: string;
}) {
  return (
    <article class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/75 p-3">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label(title)}</p>
      <p class={`mt-1 break-words text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      {detail && <p class="mt-1 text-[10px] leading-4 text-slate-500">{detail}</p>}
    </article>
  );
}

function statusTone(status: string): string {
  if (status === 'current' || status === 'healthy') return 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300';
  if (status === 'provisional' || status === 'elevated') return 'border-amber-800/70 bg-amber-950/30 text-amber-200';
  return 'border-rose-800/70 bg-rose-950/30 text-rose-200';
}

export function AdminExecutiveDashboard() {
  const state = usePortfolio();
  const refreshIntervalMs = useQuoteRefreshInterval();
  const summary = useMemo(
    () => buildAdminDashboardSummary(state, Date.now(), refreshIntervalMs),
    [state, refreshIntervalMs]
  );
  const positions = Object.values(state.positions || {}).filter(position => Number(position.shares) > 0);
  const cashHoldings = (state.cashCushion?.holdings || []).filter(holding => Number(holding.shares) > 0);
  const totalValue = summary.marketValue;
  const marginShares = positions.reduce((sum, position) => sum + Number(position.shares), 0);
  const marginTranches = positions.reduce((sum, position) => sum + (position.tranches || []).filter(t => Number(t.qty) > 0).length, 0);
  const marginInvested = positions.reduce((sum, position) => sum + (position.tranches || []).reduce((sub, tranche) => sub + Number(tranche.qty) * Number(tranche.price), 0), 0);
  const marginAverageEntry = marginShares > 0 ? marginInvested / marginShares : null;
  const currentMarginValue = positions.reduce((sum, position) => {
    const price = Number(position.currentPrice);
    return sum + (Number.isFinite(price) && price > 0 ? Number(position.shares) * price : 0);
  }, 0);
  const commissionRules = resolveCommissionConfig(state.brokerAssumptions);
  const estimatedCommissions = positions.reduce((sum, position) => {
    const price = Number(position.currentPrice);
    const sellFee = Number.isFinite(price) && price > 0
      ? calculateCommission(Number(position.shares), Number(position.shares) * price, commissionRules) : 0;
    return sum + (Number(position.commBuy) || 0) + sellFee;
  }, 0);
  const accruedMarginInterest = positions.reduce((sum, position) => {
    const invested = (position.tranches || []).reduce((sub, tranche) => sub + Number(tranche.qty) * Number(tranche.price), 0);
    const allocatedDebt = marginInvested > 0 ? summary.marginDebt * invested / marginInvested : 0;
    const dailyRate = state.brokerAssumptions.annualBorrowRate / state.brokerAssumptions.dayCountBasis;
    return sum + calculateMarginInterest(position.tranches || [], { dailyRate, marginDebt: allocatedDebt, totalDebt: summary.marginDebt });
  }, 0);

  const rows = [
    ...positions.map(position => {
      const price = Number(position.currentPrice);
      const validPrice = Number.isFinite(price) && price > 0;
      const marketValue = validPrice ? Number(position.shares) * price : null;
      const tranches = (position.tranches || []).filter(tranche => Number(tranche.qty) > 0 && Number(tranche.price) > 0);
      const basisShares = tranches.reduce((sum, tranche) => sum + Number(tranche.qty), 0);
      const basis = tranches.reduce((sum, tranche) => sum + Number(tranche.qty) * Number(tranche.price), 0);
      const basisComplete = Math.abs(basisShares - Number(position.shares)) <= Math.max(0.000001, Number(position.shares) * 0.000001);
      const pnl = validPrice && basisComplete && basis > 0 ? marketValue! - basis : null;
      return {
        ticker: position.ticker, kind: 'Margin', shares: Number(position.shares),
        marketValue, pnl, weight: marketValue !== null && totalValue > 0 ? marketValue / totalValue * 100 : null,
        quote: getQuoteFreshness(position)
      };
    }),
    ...cashHoldings.map(holding => {
      const price = Number(holding.currentPrice ?? holding.price);
      const validPrice = Number.isFinite(price) && price > 0;
      const marketValue = validPrice ? Number(holding.shares) * price : null;
      const basisPrice = Number(holding.averagePrice);
      const pnl = validPrice && Number.isFinite(basisPrice) && basisPrice > 0
        ? marketValue! - Number(holding.shares) * basisPrice : null;
      return {
        ticker: holding.ticker, kind: 'Cash', shares: Number(holding.shares),
        marketValue, pnl, weight: marketValue !== null && totalValue > 0 ? marketValue / totalValue * 100 : null,
        quote: getQuoteFreshness(holding)
      };
    })
  ].sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));

  const dataStatus = summary.status;
  const riskStatus = summary.marginRiskStatus;
  const riskLabel = riskStatus === 'stop-out' ? 'Stop-out estimate'
    : riskStatus === 'margin-call' ? 'Maintenance threshold reached'
      : riskStatus === 'elevated' ? 'Elevated risk' : riskStatus === 'healthy'
        ? 'Within configured thresholds' : 'Risk estimate unavailable';
  const quoteCounts = summary.quoteSummary;
  const pnlTone = summary.unrealizedPnl === null ? 'text-slate-400'
    : summary.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300';

  return (
    <section class="mt-3 space-y-3 rounded-xl border border-cyan-900/50 bg-slate-950/70 p-3 sm:p-4"
      aria-labelledby="adminExecutiveDashboardTitle">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="adminExecutiveDashboardTitle" class="text-sm font-black uppercase tracking-wide text-cyan-300">
            {label('Admin executive overview')}
          </h2>
          <p class="mt-1 text-[11px] text-slate-500">{label('Portfolio-wide financial position and risk snapshot')}</p>
        </div>
        <span class={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone(dataStatus)}`}>
          {label(dataStatus === 'current' ? 'Valuation current' : dataStatus === 'provisional' ? 'Valuation provisional' : 'Valuation incomplete')}
        </span>
      </div>

      <div class="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <section class="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <h3 class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label('Position basis')}</h3>
          <p class="mt-2 text-sm font-bold text-slate-100">{marginShares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })} {label('shares')} · {marginTranches} {label('tranches')}</p>
          <p class="mt-1 text-xs text-slate-300">{formatUSD(marginInvested)} {label('invested')}</p>
          <p class="mt-1 text-[10px] text-slate-500">{label('Average entry')}: {marginAverageEntry === null ? '—' : formatUSD(marginAverageEntry)}</p>
        </section>
        <section class="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <h3 class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label('Market valuation')}</h3>
          <p class="mt-2 text-sm font-bold text-slate-100">{summary.unpricedHoldings > 0 ? `≥${formatUSD(summary.pricedMarketValue)}` : formatUSD(summary.marketValue)}</p>
          <p class="mt-1 text-xs text-slate-300">{label('Margin positions')}: {formatUSD(currentMarginValue)}</p>
          <p class="mt-1 text-[10px] text-slate-500">{label('Unrealized P/L')}: {summary.unrealizedPnl === null ? '—' : `${summary.unrealizedPnl >= 0 ? '+' : '−'}${formatUSD(Math.abs(summary.unrealizedPnl))}`}</p>
        </section>
        <section class="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <h3 class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label('Debt & carrying costs')}</h3>
          <p class="mt-2 text-sm font-bold text-rose-300">{formatUSD(summary.marginDebt)} {label('margin debt')}</p>
          <p class="mt-1 text-xs text-slate-300">{label('Estimated total commissions')}: {formatUSD(estimatedCommissions)}</p>
          <p class="mt-1 text-[10px] text-slate-500">{label('Accrued margin interest')}: {formatUSD(accruedMarginInterest)}</p>
        </section>
      </div>

      <div class="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Metric title="Total equity" value={summary.equity === null ? '—' : formatUSD(summary.equity)}
          detail={label('Holdings plus cash less margin debt')} />
        <Metric title="Total market value" value={summary.unpricedHoldings > 0 ? `≥${formatUSD(summary.pricedMarketValue)}` : formatUSD(summary.marketValue)}
          detail={`${summary.pricedHoldings} ${label('priced holdings')} · ${summary.unpricedHoldings} ${label('unpriced')}`} />
        <Metric title="Margin debt" value={formatUSD(summary.marginDebt)} tone={summary.marginDebt > 0 ? 'text-rose-300' : 'text-slate-100'} />
        <Metric title="Free cash" value={formatUSD(summary.freeCash)} detail={label('Unallocated cash balance')} />
        <Metric title="Unrealized P/L" value={summary.unrealizedPnl === null ? '—' : `${summary.unrealizedPnl >= 0 ? '+' : '−'}${formatUSD(Math.abs(summary.unrealizedPnl))}`}
          detail={summary.unrealizedPnlPercent === null ? label('Cost basis or quote data incomplete') : `${summary.unrealizedPnlPercent >= 0 ? '+' : ''}${summary.unrealizedPnlPercent.toFixed(2)}%`}
          tone={pnlTone} />
        <Metric title="Daily margin cost" value={formatUSD(summary.dailyMarginCost)} detail={label('Estimated from configured annual rate')} />
      </div>

      <div class="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        <section class="rounded-lg border border-slate-800 bg-slate-900/60 p-3" aria-labelledby="adminRiskTitle">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 id="adminRiskTitle" class="text-xs font-bold uppercase tracking-wide text-slate-200">{label('Margin risk monitor')}</h3>
            <span class={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(riskStatus)}`}>{label(riskLabel)}</span>
          </div>
          {summary.marginRisk ? (
            <>
              <div class="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p class="text-[10px] text-slate-500">{label('Estimated equity ratio')}</p>
                  <p class="mt-1 text-2xl font-bold tabular-nums text-slate-100">
                    {Number.isFinite(summary.marginRisk.equityRatio) ? `${(summary.marginRisk.equityRatio * 100).toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div class="text-right">
                  <p class="text-[10px] text-slate-500">{label('Maintenance buffer')}</p>
                  <p class={`mt-1 text-lg font-bold tabular-nums ${(summary.marginBufferPct ?? 100) < 30 ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {summary.marginBufferPct === null ? '—' : `${summary.marginBufferPct.toFixed(1)}%`}
                  </p>
                </div>
              </div>
              <div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-800" role="progressbar"
                aria-label={label('Estimated maintenance buffer')} aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.max(0, Math.min(100, summary.marginBufferPct ?? 0))}>
                <span class={`block h-full rounded-full ${(summary.marginBufferPct ?? 0) < 0 ? 'bg-rose-500' : (summary.marginBufferPct ?? 0) < 30 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.max(0, Math.min(100, summary.marginBufferPct ?? 0))}%` }} />
              </div>
              <p class="mt-2 text-[10px] leading-4 text-slate-500">
                {label('Uses configured broker assumptions; this is not a live broker liquidation indicator.')}
              </p>
            </>
          ) : (
            <p class="mt-3 text-xs leading-5 text-amber-200">{label('Risk estimate unavailable until account balance and all holdings can be valued.')}</p>
          )}
        </section>

        <section class="rounded-lg border border-slate-800 bg-slate-900/60 p-3" aria-labelledby="adminDataHealthTitle">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 id="adminDataHealthTitle" class="text-xs font-bold uppercase tracking-wide text-slate-200">{label('Data health')}</h3>
            <span class={`rounded-full border px-2 py-1 text-[10px] font-semibold ${statusTone(dataStatus)}`}>{label(summary.statusReason)}</span>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p class="text-[10px] text-slate-500">{label('Broker snapshot')}</p>
              <p class="mt-1 text-xs font-semibold text-slate-200">{label(state.brokerAccountInfo?.status === 'current' ? 'Current' : state.brokerAccountInfo?.status === 'stale' ? 'Stale' : state.brokerAccountInfo?.loaded ? 'Unverified' : 'Unavailable')}</p>
            </div>
            <div>
              <p class="text-[10px] text-slate-500">{label('Market quotes')}</p>
              <p class="mt-1 text-xs font-semibold text-slate-200">{quoteCounts.fresh} {label('fresh')} · {quoteCounts.stale} {label('stale')} · {quoteCounts.delayed} {label('delayed')} · {quoteCounts.unknown + quoteCounts.unavailable} {label('unknown / unavailable')}</p>
            </div>
          </div>
        </section>
      </div>

      <section class="overflow-hidden rounded-lg border border-slate-800" aria-labelledby="adminExposureTitle">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
          <h3 id="adminExposureTitle" class="text-xs font-bold uppercase tracking-wide text-slate-200">{label('Position exposure')}</h3>
          <span class="text-[10px] text-slate-500">{summary.positionCount} {label('margin positions')} · {summary.cashHoldingCount} {label('cash holdings')}</span>
        </div>
        {rows.length === 0 ? (
          <p class="p-4 text-center text-xs text-slate-500">{label('No open positions or cash holdings')}</p>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full min-w-[640px] text-xs">
              <thead class="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-3 py-2 text-left">{label('Ticker')}</th>
                  <th class="px-3 py-2 text-left">{label('Funding')}</th>
                  <th class="px-3 py-2 text-right">{label('Shares')}</th>
                  <th class="px-3 py-2 text-right">{label('Market value')}</th>
                  <th class="px-3 py-2 text-right">{label('Unrealized P/L')}</th>
                  <th class="px-3 py-2 text-right">{label('Weight')}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/70">
                {rows.map(row => (
                  <tr key={row.kind + '-' + row.ticker}>
                    <td class="px-3 py-2 font-semibold text-slate-100">{row.ticker}</td>
                    <td class="px-3 py-2 text-slate-400">{label(row.kind)}</td>
                    <td class="px-3 py-2 text-right font-mono tabular-nums">{row.shares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })}</td>
                    <td class="px-3 py-2 text-right font-mono tabular-nums">{row.marketValue === null ? '—' : formatUSD(row.marketValue)}</td>
                    <td class={`px-3 py-2 text-right font-mono tabular-nums ${row.pnl === null ? 'text-slate-500' : row.pnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{row.pnl === null ? '—' : `${row.pnl >= 0 ? '+' : '−'}${formatUSD(Math.abs(row.pnl))}`}</td>
                    <td class="px-3 py-2 text-right font-mono tabular-nums">{row.weight === null ? '—' : `${row.weight.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
