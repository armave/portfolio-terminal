import { useEffect, useMemo, useState } from 'preact/hooks';
import type { GuestCashHolding } from '../domain/guestPortfolio';
import { summarizeGuestCashHoldings } from '../domain/guestPortfolio';
import { formatQuoteFreshnessSummary, formatUSD, summarizeQuoteFreshness } from '../utils/formatters';
import type { CloudStatus } from '../ui/uiStateStore';
import { getAppLanguage, translateText } from '../services/i18n';

interface GuestSnapshotTimestamps {
  updatedAt: number;
  ledgerUpdatedAt?: number;
  fetchedAt?: number;
}

interface GuestPortfolioOverviewProps {
  holdings: readonly GuestCashHolding[];
  snapshot: GuestSnapshotTimestamps | null;
  syncStatus: CloudStatus;
  refreshIntervalMs: number;
}

function formatSnapshotTimestamp(timestamp: number | null | undefined, language: 'en' | 'ru'): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) {
    return translateText('Not available', language);
  }
  try {
    return new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  } catch {
    return translateText('Not available', language);
  }
}

/** A permission-scoped overview of only the cash-funded holdings assigned to this guest. */
export function GuestPortfolioOverview({
  holdings,
  snapshot,
  syncStatus,
  refreshIntervalMs
}: GuestPortfolioOverviewProps) {
  const language = getAppLanguage();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const summary = useMemo(() => summarizeGuestCashHoldings(holdings), [holdings]);
  const quoteFreshness = useMemo(() => summarizeQuoteFreshness(
    holdings.map((holding) => ({
      quoteUpdatedAt: holding.quoteUpdatedAt,
      quoteSource: holding.quoteSource,
      sourceTimestamp: holding.quoteDetails?.sourceTimestamp,
      marketState: holding.quoteDetails?.marketState,
      quoteDetails: holding.quoteDetails
    })),
    now,
    refreshIntervalMs
  ), [holdings, now, refreshIntervalMs]);

  const hasSnapshot = snapshot !== null;
  const isRefreshing = syncStatus.status === 'syncing' || syncStatus.status === 'pending';
  const isError = syncStatus.status === 'error';
  const syncMessage = isRefreshing
    ? 'Refreshing assigned holdings and assignment history…'
    : isError
      ? hasSnapshot
        ? 'Refresh failed. Showing your last successfully loaded snapshot.'
        : 'Unable to load assigned holdings. Refresh to try again.'
      : syncStatus.status === 'synced'
        ? 'Assigned holdings and history refreshed successfully.'
        : hasSnapshot
          ? 'Showing your last successfully loaded snapshot.'
          : 'Waiting for your first assigned portfolio snapshot.';
  const quoteFreshnessText = quoteFreshness.total > 0
    ? formatQuoteFreshnessSummary(quoteFreshness)
    : translateText('No assigned holdings yet.', language);

  return (
    <section class="guest-portfolio-overview space-y-3" aria-label={translateText('Guest portfolio overview', language)} data-testid="guest-portfolio-overview">
      <div class="rounded-lg border border-cyan-900/60 bg-cyan-950/20 px-3 py-3" role="note">
        <div class="flex items-center gap-2">
          <span aria-hidden="true" class="text-cyan-300">◉</span>
          <h2 class="text-xs font-bold uppercase tracking-wide text-cyan-200">{translateText('Shared portfolio · Read only', language)}</h2>
        </div>
        <p class="mt-1 text-[11px] leading-relaxed text-slate-300">
          {translateText('You can view the holdings and allocations assigned to your account. Portfolio changes are managed by your administrator.', language)}
        </p>
      </div>

      <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-3 sm:p-4" aria-labelledby="guestPortfolioOverviewHeading">
        <div class="mb-3">
          <h2 id="guestPortfolioOverviewHeading" class="text-sm font-bold text-slate-100">{translateText('Portfolio overview', language)}</h2>
          <p class="mt-1 text-[10px] leading-relaxed text-slate-500">{translateText('Only cash-funded holdings explicitly assigned to your account are included.', language)}</p>
        </div>
        <dl class="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Assigned market value', language)}</dt>
            <dd class="mt-1 break-words text-lg font-black tabular-nums text-slate-100">
              {summary.marketValue !== null ? formatUSD(summary.marketValue) : '—'}
            </dd>
            {summary.unpricedHoldingCount > 0 && (
              <p class="mt-1 text-[9px] leading-relaxed text-amber-300">{translateText('Complete market value is unavailable until every assigned holding has a valid quote.', language)}</p>
            )}
          </div>
          <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Assigned cost basis', language)}</dt>
            <dd class="mt-1 break-words text-lg font-black tabular-nums text-slate-100">
              {summary.costBasis !== null ? formatUSD(summary.costBasis) : '—'}
            </dd>
            {summary.costBasis === null && summary.holdingCount > 0 && (
              <p class="mt-1 text-[9px] leading-relaxed text-slate-500">{translateText('Complete cost basis is unavailable until every assigned holding has a valid average entry price.', language)}</p>
            )}
          </div>
          <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Unrealized P/L', language)}</dt>
            <dd class={'mt-1 break-words text-lg font-black tabular-nums ' + (summary.unrealizedPnl === null ? 'text-slate-500' : summary.unrealizedPnl >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
              {summary.unrealizedPnl === null ? '—' : (summary.unrealizedPnl >= 0 ? '+' : '−') + formatUSD(Math.abs(summary.unrealizedPnl))}
            </dd>
            {summary.unrealizedPnl === null && summary.holdingCount > 0 && (
              <p class="mt-1 text-[9px] leading-relaxed text-slate-500">{translateText('Complete quotes and cost basis are required to calculate unrealized P/L.', language)}</p>
            )}
          </div>
          <div class="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <dt class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">{translateText('Assigned holdings', language)}</dt>
            <dd class="mt-1 break-words text-lg font-black tabular-nums text-slate-100">{summary.holdingCount}</dd>
            <p class="mt-1 text-[9px] leading-relaxed text-slate-500">
              {summary.holdingCount > 0 ? summary.pricedHoldingCount + ' / ' + summary.holdingCount + ' ' + translateText('priced holdings', language) : translateText('No assigned holdings yet.', language)}
            </p>
          </div>
        </dl>

        {summary.unpricedHoldingCount > 0 && (
          <p class="mt-3 rounded-md border border-amber-900/50 bg-amber-950/20 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200" role="status">
            {translateText('Unpriced holdings', language)}: {summary.unpricedHoldingCount}. {translateText('Market value and unrealized P/L remain incomplete until valid quotes are available.', language)}
          </p>
        )}
      </section>

      <section
        class={'rounded-lg border px-3 py-3 ' + (isError ? 'border-amber-800/60 bg-amber-950/20' : isRefreshing ? 'border-cyan-900/60 bg-cyan-950/20' : 'border-slate-800 bg-slate-900/40')}
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        aria-atomic="true"
        data-testid="guest-assigned-data-health"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <strong class="text-[11px] font-semibold text-slate-200">{translateText('Assigned data health', language)}</strong>
          <span class={'text-[10px] font-semibold ' + (isError ? 'text-amber-200' : isRefreshing ? 'text-cyan-200' : syncStatus.status === 'synced' ? 'text-emerald-300' : 'text-slate-400')}>
            {translateText(syncMessage, language)}
          </span>
        </div>
        <div class="mt-2 grid grid-cols-1 gap-2 text-[10px] sm:grid-cols-2">
          <div>
            <span class="text-slate-500">{translateText('Last successful refresh', language)}: </span>
            <span class="tabular-nums text-slate-300">{formatSnapshotTimestamp(snapshot?.fetchedAt, language)}</span>
          </div>
          <div>
            <span class="text-slate-500">{translateText('Holdings published by administrator', language)}: </span>
            <span class="tabular-nums text-slate-300">{formatSnapshotTimestamp(snapshot?.updatedAt, language)}</span>
          </div>
          <div>
            <span class="text-slate-500">{translateText('Assignment history last updated', language)}: </span>
            <span class="tabular-nums text-slate-300">{formatSnapshotTimestamp(snapshot?.ledgerUpdatedAt, language)}</span>
          </div>
          <div>
            <span class="text-slate-500">{translateText('Quote freshness', language)}: </span>
            <span class="text-slate-300">{quoteFreshnessText}</span>
          </div>
        </div>
      </section>
    </section>
  );
}
