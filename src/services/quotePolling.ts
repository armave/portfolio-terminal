import { fetchLivePriceFromProviders } from './quoteProvider';
import type { QuoteDetails } from '../types/portfolio';

export type RecordTrackedPrice = (
  ticker: string,
  price: number,
  sourceName: string,
  updatedAt?: number | null,
  quoteDetails?: QuoteDetails,
  requestStartedAt?: number
) => boolean;

const QUOTE_REFRESH_CONCURRENCY = 4;

// Automated quote refresh is a load-time snapshot, not a polling fallback.
// Keep the first provider outcome (success or failure) scoped to this page load.
const attemptedQuoteSnapshots = new Set<string>();

export interface TrackedQuoteRefreshResult {
  updatedCount: number;
  skipped: boolean;
}

/** Reset the load-time guards when the application explicitly starts a new data session. */
export function clearTrackedQuoteSnapshotCache(): void {
  attemptedQuoteSnapshots.clear();
}

/**
 * Fetch the same provider-comparison result used by individual ticker lookups.
 * A small worker pool keeps large portfolios from opening unbounded provider
 * requests while allowing Yahoo's own batch transport to combine same-turn calls.
 */
export async function refreshTrackedQuotes(
  tickers: string[],
  requestStartedAt: number,
  recordTrackedPrice: RecordTrackedPrice,
  force = false
): Promise<TrackedQuoteRefreshResult> {
  const requestedTickers = [...new Set(
    tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
  )];
  if (requestedTickers.length === 0) return { updatedCount: 0, skipped: true };

  const tickersToFetch = requestedTickers.filter((ticker) => !attemptedQuoteSnapshots.has(ticker));
  if (tickersToFetch.length === 0) return { updatedCount: 0, skipped: true };

  // Mark before dispatch so overlapping scheduler/visibility triggers cannot
  // start another REST provider-comparison batch while the first is in flight.
  tickersToFetch.forEach((ticker) => attemptedQuoteSnapshots.add(ticker));
  const results = new Array<Awaited<ReturnType<typeof fetchLivePriceFromProviders>> | null>(
    tickersToFetch.length
  );
  let nextIndex = 0;
  const workerCount = Math.min(QUOTE_REFRESH_CONCURRENCY, tickersToFetch.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tickersToFetch.length) {
      const index = nextIndex++;
      const ticker = tickersToFetch[index];
      results[index] = force
        ? await fetchLivePriceFromProviders(ticker, requestStartedAt, true)
        : await fetchLivePriceFromProviders(ticker, requestStartedAt);
    }
  }));

  let updatedCount = 0;
  for (let index = 0; index < tickersToFetch.length; index++) {
    const ticker = tickersToFetch[index];
    const result = results[index];
    if (!result || result.price === null || !Number.isFinite(result.price) || result.price <= 0) continue;

    if (recordTrackedPrice(
      ticker,
      result.price,
      result.sourceName,
      result.updatedAt,
      result.quoteDetails ?? undefined,
      result.requestStartedAt ?? requestStartedAt
    )) {
      updatedCount++;
    }
  }

  return { updatedCount, skipped: false };
}
