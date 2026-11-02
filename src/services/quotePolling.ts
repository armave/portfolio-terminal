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
): Promise<number> {
  const requestedTickers = [...new Set(
    tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
  )];
  if (requestedTickers.length === 0) return 0;

  const results = new Array<Awaited<ReturnType<typeof fetchLivePriceFromProviders>> | null>(
    requestedTickers.length
  );
  let nextIndex = 0;
  const workerCount = Math.min(QUOTE_REFRESH_CONCURRENCY, requestedTickers.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < requestedTickers.length) {
      const index = nextIndex++;
      const ticker = requestedTickers[index];
      results[index] = force
        ? await fetchLivePriceFromProviders(ticker, requestStartedAt, true)
        : await fetchLivePriceFromProviders(ticker, requestStartedAt);
    }
  }));

  let updatedCount = 0;
  for (let index = 0; index < requestedTickers.length; index++) {
    const ticker = requestedTickers[index];
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

  return updatedCount;
}
