import { useMemo } from 'preact/hooks';
import { usePortfolio } from '../store/portfolioStore';
import { formatUSD, formatTrancheDate, formatQuoteVolume, getQuoteFreshness } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { buildAdminDashboardSummary } from '../domain/adminDashboard';
import { calculateCommission, calculateMarginInterest, resolveCommissionConfig } from '../domain/portfolio';
import { QuoteProvenanceList, type QuoteProvenanceHolding } from './QuoteProvenance';
import { MarginMarketTools } from './MarginMarketTools';

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
  const marginTranches = positions.flatMap(position => position.tranches || []);
  const marginTrancheCount = positions.reduce(
    (sum, position) => sum + (position.tranches || []).filter(t => Number(t.qty) > 0 && Number(t.price) > 0).length,
    0
  );
  const marginInvested = positions.reduce((sum, position) => sum + (position.tranches || []).reduce((sub, tranche) => {
    const qty = Number(tranche.qty);
    const price = Number(tranche.price);
    return sub + (Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0 ? qty * price : 0);
  }, 0), 0);
  const marginAverageEntry = summary.investedCostBasis !== null && marginShares > 0 ? marginInvested / marginShares : null;
  const commissionRules = resolveCommissionConfig(state.brokerAssumptions);
  const buyCommissions = positions.reduce((sum, position) => sum + (Number(position.commBuy) || 0), 0);
  // Match the legacy projection: sell commission is estimated at each position's target price.
  const estimatedSellCommissions = positions.reduce((sum, position) => {
    const shares = Number(position.shares);
    const targetPrice = Number(position.pt);
    return Number.isFinite(shares) && shares > 0 && Number.isFinite(targetPrice) && targetPrice > 0
      ? sum + calculateCommission(shares, shares * targetPrice, commissionRules)
      : sum;
  }, 0);
  const dailyRate = state.brokerAssumptions.annualBorrowRate / state.brokerAssumptions.dayCountBasis;
  const debt = summary.marginDebt;
  const interestTranches = state.tranches?.length ? state.tranches : marginTranches;
  const accruedMarginInterest = (Number(state.realizedMarginCharged) || 0) + calculateMarginInterest(interestTranches, {
    dailyRate, marginDebt: debt, totalDebt: debt
  });

  const marginRows = positions.map(position => {
    const shares = Number(position.shares);
    const price = Number(position.currentPrice);
    const hasPrice = Number.isFinite(price) && price > 0;
    const marketValue = hasPrice ? shares * price : null;
    const validTranches = (position.tranches || []).filter(tranche =>
      Number.isFinite(Number(tranche.qty)) && Number(tranche.qty) > 0 &&
      Number.isFinite(Number(tranche.price)) && Number(tranche.price) > 0
    );
    const basisShares = validTranches.reduce((sum, tranche) => sum + Number(tranche.qty), 0);
    const basis = validTranches.reduce((sum, tranche) => sum + Number(tranche.qty) * Number(tranche.price), 0);
    const basisComplete = Math.abs(basisShares - shares) <= Math.max(0.000001, shares * 0.000001);
    const pnl = hasPrice && basisComplete && basis > 0 ? marketValue! - basis : null;
    const details = position.quoteDetails;
    const hasDayMove = Number.isFinite(Number(details?.change)) && Number.isFinite(Number(details?.changePercent));
    const dayMove = hasDayMove
      ? `${Number(details!.change) >= 0 ? '+' : '−'}${formatUSD(Math.abs(Number(details!.change)))} (${Number(details!.changePercent) >= 0 ? '+' : '−'}${Math.abs(Number(details!.changePercent)).toFixed(2)}%)`
      : null;
    return {
      ticker: position.ticker, shares, price: hasPrice ? price : null, marketValue, pnl,
      pnlPercent: pnl !== null && basis > 0 ? pnl / basis * 100 : null,
      targetPrice: Number(position.pt) > 0 ? Number(position.pt) : null,
      dayMove, volume: formatQuoteVolume(details?.volume), quote: getQuoteFreshness(position)
    };
  });

  const rows = [
    ...marginRows.map(row => ({
      ticker: row.ticker, kind: 'Margin', shares: row.shares,
      marketValue: row.marketValue, pnl: row.pnl,
      weight: row.marketValue !== null && totalValue > 0 ? row.marketValue / totalValue * 100 : null,
      quote: row.quote
    })),
    ...cashHoldings.map(holding => {
      const price = Number(holding.currentPrice ?? holding.price);
      const validPrice = Number.isFinite(price) && price > 0;
      const marketValue = validPrice ? Number(holding.shares) * price : null;
      return {
        ticker: holding.ticker, kind: 'Cash', shares: Number(holding.shares),
        marketValue, pnl: null,
        weight: marketValue !== null && totalValue > 0 ? marketValue / totalValue * 100 : null,
        quote: getQuoteFreshness(holding)
      };
    })
  ].sort((a, b) => (b.marketValue ?? -1) - (a.marketValue ?? -1));

  const quoteHoldings: QuoteProvenanceHolding[] = [
    ...positions.map(position => ({ ...position, kind: 'Margin position' as const })),
    ...cashHoldings.map(holding => ({ ...holding, kind: 'Cash holding' as const }))
  ];

  const dataStatus = summary.status;
  const riskStatus = summary.marginRiskStatus;
  const riskLabel = riskStatus === 'stop-out' ? 'Stop-out estimate'
    : riskStatus === 'margin-call' ? 'Maintenance threshold reached'
      : riskStatus === 'elevated' ? 'Elevated risk' : riskStatus === 'healthy'
        ? 'Within configured thresholds' : 'Risk estimate unavailable';
  const quoteCounts = summary.quoteSummary;

  return (
    <section class="mt-2 space-y-2 rounded-xl border border-cyan-900/50 bg-slate-950/70 p-2 sm:p-3"
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

      <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
        <section class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
          <h3 id="adminPositionBasisTitle" class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label('Position basis')}</h3>
          <p class="mt-2 text-sm font-bold text-slate-100">
            {marginShares.toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })} {label('shares')} · {marginTrancheCount} {label('tranches')}
          </p>
          <p class="mt-1 text-xs text-slate-300">{summary.investedCostBasis === null ? label('Cost basis or quote data incomplete') : formatUSD(summary.investedCostBasis) + ' ' + label('invested')}</p>
          <p class="mt-1 text-[10px] text-slate-500">{label('Average entry')}: {marginAverageEntry === null ? '—' : formatUSD(marginAverageEntry)}</p>
          <div class="mt-2 space-y-1 border-t border-slate-800/70 pt-2">
            {positions.length === 0
              ? <p class="text-[10px] text-slate-500">{label('No margin positions')}</p>
              : positions.map(position => (
                <div key={position.ticker} class="space-y-1">
                  <p class="text-[10px] text-slate-400">
                    <span class="font-semibold text-slate-200">{position.ticker}</span>
                    {' · '}{Number(position.shares).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })} sh
                    {' @ PT '}{Number(position.pt) > 0 ? formatUSD(Number(position.pt)) : '—'}
                  </p>
                  {(position.tranches || []).length > 0 && (
                    <details class="pl-2 text-[10px] text-slate-500">
                      <summary class="min-h-6 cursor-pointer underline decoration-dotted underline-offset-2">{label('Show tranches')} ({(position.tranches || []).length})</summary>
                      <ul class="space-y-1 py-1">
                        {(position.tranches || []).map((tranche, index) => (
                          <li key={index}>
                            {Number(tranche.qty).toLocaleString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: 3 })} @ {formatUSD(Number(tranche.price))}
                            {' · '}{tranche.date ? formatTrancheDate(tranche.date) : label('Date unavailable')}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              ))}
          </div>
        </section>

        <section class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <h3 id="adminMarketValuationTitle" class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label('Market valuation')}</h3>
          <p class="mt-2 text-sm font-bold text-slate-100">{summary.marginUnpricedPositions > 0 ? '≥' : ''}{formatUSD(summary.marginMarketValue)}</p>
          <p class="mt-1 text-xs text-slate-300">{label('Margin market value')}</p>
          {summary.marginUnpricedPositions > 0 && <p class="mt-1 text-[10px] text-amber-300">{summary.marginUnpricedPositions} {label('unpriced')}</p>}
          <p class="mt-1 text-[10px] text-slate-500">
            {positions.length} {label('margin positions')} · {summary.marginUnpricedPositions} {label('unpriced')}
          </p>
          <QuoteProvenanceList holdings={quoteHoldings} />
        </section>

        <section class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <h3 id="adminDebtCarryingCostsTitle" class="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label('Debt & carrying costs')}</h3>
          <p class="mt-2 text-sm font-bold text-rose-300">{formatUSD(debt)} {label('margin debt')}</p>
          <p class="mt-1 text-[10px] text-slate-400">
            {label('Daily margin cost')}: {formatUSD(summary.dailyMarginCost)} · {label('Annual margin rate')} {(state.brokerAssumptions.annualBorrowRate * 100).toFixed(2)}%
          </p>
          <div class="mt-2 space-y-1 border-t border-slate-800/70 pt-2 text-[10px]">
            <p class="text-slate-300">{label('Buy commissions')}: {formatUSD(buyCommissions)}</p>
            <p class="text-slate-300">{label('Estimated sell commissions')}: {formatUSD(estimatedSellCommissions)}</p>
            <p class="font-semibold text-slate-200">{label('Total commissions')}: {formatUSD(buyCommissions + estimatedSellCommissions)}</p>
            <p class="pt-1 text-slate-400">{label('Accrued margin interest')}: {formatUSD(accruedMarginInterest)}</p>
          </div>
        </section>

        <section class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <MarginMarketTools ticker={positions.length === 1 ? positions[0].ticker : undefined} isAdmin={true} />
        </section>
      </div>

      <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <Metric title="Total equity" value={summary.equity === null ? '—' : formatUSD(summary.equity)}
          detail={label('Holdings plus cash less margin debt')} />
        <Metric title="Free cash" value={formatUSD(summary.freeCash)} detail={label('Unallocated cash balance')} />
      </div>

      <div class="grid grid-cols-1 gap-1.5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)]">
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
          <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div class="min-w-0">
              <p class="text-[10px] text-slate-500">{label('Broker snapshot')}</p>
              <p class="mt-0.5 text-xs font-semibold text-slate-200">{label(state.brokerAccountInfo?.status === 'current' ? 'Current' : state.brokerAccountInfo?.status === 'stale' ? 'Stale' : state.brokerAccountInfo?.loaded ? 'Unverified' : 'Unavailable')}</p>
              <p class="mt-0.5 break-words text-[10px] text-slate-400">
                {[state.brokerAccountInfo?.provider, state.brokerAccountInfo?.source, state.brokerAccountInfo?.quality].filter(Boolean).join(' · ') || label('Broker source metadata unavailable')}
              </p>
              <p class="mt-0.5 text-[10px] text-slate-500">
                {state.brokerAccountInfo?.observedAt
                  ? `${label('Observed')}: ${new Date(state.brokerAccountInfo.observedAt).toLocaleString()}`
                  : state.brokerAccountInfo?.receivedAt
                    ? `${label('Received')}: ${new Date(state.brokerAccountInfo.receivedAt).toLocaleString()}`
                    : label('Snapshot timestamp unavailable')}
              </p>
              {(state.brokerAccountInfo?.warnings?.length || state.brokerAccountInfo?.lastRefreshIssue) && (
                <p class="mt-1 break-words text-[10px] text-amber-300">
                  {state.brokerAccountInfo.warnings?.join(' · ') || state.brokerAccountInfo.lastRefreshIssue?.message || label('Broker refresh issue')}
                </p>
              )}
            </div>
            <div class="min-w-0">
              <p class="text-[10px] text-slate-500">{label('Market quotes')}</p>
              <p class="mt-0.5 text-xs font-semibold text-slate-200">
                {quoteCounts.fresh} {label('fresh')} · {quoteCounts.stale} {label('stale')} · {quoteCounts.delayed} {label('delayed')} · {quoteCounts.unknown + quoteCounts.unavailable} {label('unknown / unavailable')}
              </p>
              <div class="mt-1 space-y-1">
                {quoteHoldings.length === 0
                  ? <p class="text-[10px] text-slate-500">{label('No open holdings to check')}</p>
                  : quoteHoldings.map(holding => (
                    <div key={holding.ticker + '-' + holding.kind} class="flex min-w-0 flex-wrap items-center justify-between gap-x-2 text-[10px]">
                      <span class="font-semibold text-slate-300">{holding.ticker} · {label(holding.kind)}</span>
                      <span class="min-w-0 break-words text-right text-slate-400">
                        {label(getQuoteFreshness(holding))}{holding.quoteSource ? ` · ${holding.quoteSource}` : ''}
                      </span>
                    </div>
                  ))}
              </div>
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
            <table class="w-full min-w-[560px] text-xs">
              <thead class="bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th class="px-3 py-2 text-left">{label('Ticker')}</th>
                  <th class="px-3 py-2 text-left">{label('Funding')}</th>
                  <th class="px-3 py-2 text-right">{label('Shares')}</th>
                  <th class="px-3 py-2 text-right">{label('Market value')}</th>
                  <th class="px-3 py-2 text-right">{label('Unrealized P/L (margin only)')}</th>
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
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
        <div>
          <p class="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label('Cash unrealized P/L')}</p>
          <p class={`mt-0.5 text-sm font-bold tabular-nums ${summary.cashUnrealizedPnl === null ? 'text-slate-400' : summary.cashUnrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {summary.cashUnrealizedPnl === null ? '—' : `${summary.cashUnrealizedPnl >= 0 ? '+' : '−'}${formatUSD(Math.abs(summary.cashUnrealizedPnl))}`}
            {summary.cashUnrealizedPnlPercent === null ? '' : ` (${summary.cashUnrealizedPnlPercent >= 0 ? '+' : ''}${summary.cashUnrealizedPnlPercent.toFixed(2)}%)`}
          </p>
        </div>
        <p class="text-right text-[10px] text-slate-500">
          {summary.cashInvestedCostBasis === null
            ? `${summary.cashUnpricedHoldings} ${label('unpriced')} · ${summary.cashMissingCostBasisHoldings} ${label('missing cost basis')}`
            : `${label('Cash cost basis')}: ${formatUSD(summary.cashInvestedCostBasis)}`}
        </p>
      </div>
    </section>
  );
}
