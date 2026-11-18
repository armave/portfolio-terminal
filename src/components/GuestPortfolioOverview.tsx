import type { GuestCashHolding } from '../domain/guestPortfolio';
import { summarizeGuestCashHoldings } from '../domain/guestPortfolio';
import { formatUSD } from '../utils/formatters';
import { getAppLanguage, translateText } from '../services/i18n';

interface GuestPortfolioOverviewProps {
  holdings: readonly GuestCashHolding[];
}

/** A compact summary of the stocks visible in the current guest account. */
export function GuestPortfolioOverview({ holdings }: GuestPortfolioOverviewProps) {
  const language = getAppLanguage();
  const summary = summarizeGuestCashHoldings(holdings);

  return (
    <section class="guest-portfolio-overview space-y-3" aria-labelledby="myStocksOverviewHeading" data-testid="guest-portfolio-overview">
      <div class="mb-3">
        <h2 id="myStocksOverviewHeading" class="text-sm font-bold text-slate-100">{translateText('My stocks overview', language)}</h2>
      </div>
      <dl class="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Market value', language)}</dt>
          <dd class="mt-1 break-words text-lg font-black tabular-nums text-slate-100">
            {summary.marketValue !== null ? formatUSD(summary.marketValue) : '—'}
          </dd>
          {summary.unpricedHoldingCount > 0 && (
            <p class="mt-1 text-[9px] leading-relaxed text-amber-300">{translateText('Complete market value is unavailable until every stock has a valid quote.', language)}</p>
          )}
        </div>
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Cost basis', language)}</dt>
          <dd class="mt-1 break-words text-lg font-black tabular-nums text-slate-100">
            {summary.costBasis !== null ? formatUSD(summary.costBasis) : '—'}
          </dd>
          {summary.costBasis === null && summary.holdingCount > 0 && (
            <p class="mt-1 text-[9px] leading-relaxed text-slate-500">{translateText('Complete cost basis is unavailable until every stock has a valid average entry price.', language)}</p>
          )}
        </div>
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Unrealized P/L', language)}</dt>
          <dd class={'mt-1 break-words text-lg font-black tabular-nums ' + (summary.unrealizedPnl === null ? 'text-slate-500' : summary.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
            {summary.unrealizedPnl === null ? '—' : (summary.unrealizedPnl >= 0 ? '+' : '−') + formatUSD(Math.abs(summary.unrealizedPnl))}
          </dd>
          {summary.unrealizedPnl === null && summary.holdingCount > 0 && (
            <p class="mt-1 text-[9px] leading-relaxed text-slate-500">{translateText('Complete quotes and cost basis are required to calculate unrealized P/L.', language)}</p>
          )}
        </div>
        <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Stocks', language)}</dt>
          <dd class="mt-1 break-words text-lg font-black tabular-nums text-slate-100">{summary.holdingCount}</dd>
          <p class="mt-1 text-[9px] leading-relaxed text-slate-500">
            {summary.pricedHoldingCount} / {summary.holdingCount} {translateText('priced stocks', language)}
          </p>
        </div>
      </dl>

      {summary.unpricedHoldingCount > 0 && (
        <p class="rounded-md border border-amber-900/50 bg-amber-950/20 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200" role="status">
          {translateText('Unpriced stocks', language)}: {summary.unpricedHoldingCount}. {translateText('Market value and unrealized P/L remain incomplete until valid quotes are available.', language)}
        </p>
      )}
    </section>
  );
}
