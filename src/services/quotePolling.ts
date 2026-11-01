import { fetchFallbackPrice, nextQuoteRequestSequence, resolveQuoteProvenance } from './quoteProvider';
import { fetchYahooStockData } from './api';
import { normalizeYahooBatchResults } from './yahooQuoteContracts';
import { resolveMarketSessionChange, resolveMarketSessionPrice } from '../domain/quotes';
import type { QuoteDetails } from '../types/portfolio';

export type RecordTrackedPrice = (
  ticker: string,
  price: number,
  sourceName: string,
  updatedAt?: number | null,
  quoteDetails?: QuoteDetails,
  requestStartedAt?: number
) => boolean;

const FALLBACK_QUOTE_CONCURRENCY = 4;

type FallbackQuoteResult = Awaited<ReturnType<typeof fetchFallbackPrice>>;

/**
 * Resolve missing-symbol fallback quotes with a small worker pool. A bounded
 * pool keeps a degraded batch from opening one request per position at once.
 */
async function fetchFallbackQuotes(tickers: string[]): Promise<Map<string, FallbackQuoteResult>> {
  const results = new Map<string, FallbackQuoteResult>();
  let nextIndex = 0;
  const workerCount = Math.min(FALLBACK_QUOTE_CONCURRENCY, tickers.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < tickers.length) {
      const ticker = tickers[nextIndex++];
      results.set(ticker, await fetchFallbackPrice(ticker));
    }
  }));

  return results;
}

/** Fetch batch quotes and apply them through the caller's current-state mutation callback. */
export async function refreshTrackedQuotes(
  tickers: string[],
  requestStartedAt: number,
  recordTrackedPrice: RecordTrackedPrice
): Promise<number> {
  if (tickers.length === 0) return 0;

  const requestedTickers = new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean));
  if (requestedTickers.size === 0) return 0;
  const requestSequence = nextQuoteRequestSequence();

  const responseData = await fetchYahooStockData([...requestedTickers].join(', '));
  const results = normalizeYahooBatchResults(responseData, [...requestedTickers]);
  const fallbackTickers: string[] = [];
  const updates: Array<{
    ticker: string;
    price: number;
    sourceName: string;
    updatedAt: number;
    quoteDetails: QuoteDetails;
  } | {
    ticker: string;
    fallback: true;
  }> = [];

  for (const data of results) {
    if (!data?.symbol) {
      console.warn('[Quote Warning]: Missing symbol in batch quote response.', data?.error);
      continue;
    }

    const ticker = data.symbol.trim().toUpperCase();
    // Only process symbols requested by this refresh. A malformed or unexpected
    // provider response must not trigger fallback requests for unrelated tickers.
    if (!requestedTickers.has(ticker)) continue;
    if (data.error || !data.price) {
      console.warn(`[Quote Warning]: Missing or failed data for ${ticker}`, data.error);
      fallbackTickers.push(ticker);
      updates.push({ ticker, fallback: true });
      continue;
    }

    const regularPrice = data.price.current ?? data.regularMarketPrice;
    const previous = data.price.previousClose ?? data.regularMarketPreviousClose;
    const marketState = data.price?.marketState;
    const current = resolveMarketSessionPrice({
      regularPrice,
      preMarketPrice: data.price.preMarketPrice,
      postMarketPrice: data.price.postMarketPrice,
      marketState
    });

    if (current === null) {
      fallbackTickers.push(ticker);
      updates.push({ ticker, fallback: true });
      continue;
    }

    const change = resolveMarketSessionChange({
      currentPrice: current,
      regularPrice,
      previousClose: previous,
      suppliedChange: data.price.change ?? data.regularMarketChange,
      marketState
    });
    const previousClose = Number(previous);
    const hasPreviousClose = Number.isFinite(previousClose) && previousClose > 0;
    const sourceTime = marketState === 'PRE'
      ? (data.price.preMarketTime ?? data.price.regularMarketTime)
      : marketState === 'POST'
        ? (data.price.postMarketTime ?? data.price.regularMarketTime)
        : data.price.regularMarketTime;
    const provenance = resolveQuoteProvenance(marketState, sourceTime);
    const quoteDetails = {
      marketState,
      ...provenance,
      receivedAt: Date.now(),
      requestSequence,
      requestStartedAt,
      price: current,
      change,
      changePercent: hasPreviousClose ? (change / previousClose) * 100 : 0
    };

    updates.push({
      ticker,
      price: Number(current),
      sourceName: 'Yahoo',
      updatedAt: Date.now(),
      quoteDetails
    });
  }

  const fallbackQuotes = await fetchFallbackQuotes(fallbackTickers);
  let updatedCount = 0;

  // Apply values in the normalized provider response order, even though
  // fallback requests complete independently within the bounded worker pool.
  for (const update of updates) {
    if ('fallback' in update) {
      const fallback = fallbackQuotes.get(update.ticker);
      if (!fallback) continue;
      if (recordTrackedPrice(
        update.ticker,
        fallback.price,
        fallback.sourceName,
        Date.now(),
        { ...fallback.quoteDetails, requestSequence, requestStartedAt },
        requestStartedAt
      )) updatedCount++;
      continue;
    }

    if (recordTrackedPrice(
      update.ticker,
      update.price,
      update.sourceName,
      update.updatedAt,
      update.quoteDetails,
      requestStartedAt
    )) updatedCount++;
  }

  return updatedCount;
}
