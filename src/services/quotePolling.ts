import { fetchFallbackPrice } from './quoteProvider';
import { fetchYahooStockData, normalizeYahooBatchResults } from './api';
import { resolveMarketSessionChange, resolveMarketSessionPrice } from '../domain/quotes';

export type RecordTrackedPrice = (
  ticker: string,
  price: number,
  sourceName: string,
  updatedAt?: number | null,
  quoteDetails?: any,
  requestStartedAt?: number
) => boolean;

/** Fetch batch quotes and apply them through the caller's current-state mutation callback. */
export async function refreshTrackedQuotes(
  tickers: string[],
  requestStartedAt: number,
  recordTrackedPrice: RecordTrackedPrice
): Promise<number> {
  if (tickers.length === 0) return 0;

  const responseData = await fetchYahooStockData(tickers.join(', '));
  const results = normalizeYahooBatchResults(responseData, tickers);
  let updatedCount = 0;

  for (const data of results) {
    if (!data?.symbol) {
      console.warn('[Quote Warning]: Missing symbol in batch quote response.', data?.error);
      continue;
    }

    const ticker = data.symbol.toUpperCase();
    if (data.error || !data.price) {
      console.warn(`[Quote Warning]: Missing or failed data for ${ticker}`, data.error);
      const fallback = await fetchFallbackPrice(ticker);
      if (fallback && recordTrackedPrice(ticker, fallback.price, fallback.sourceName, Date.now(), fallback.quoteDetails, requestStartedAt)) updatedCount++;
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
      const fallback = await fetchFallbackPrice(ticker);
      if (fallback && recordTrackedPrice(ticker, fallback.price, fallback.sourceName, Date.now(), fallback.quoteDetails, requestStartedAt)) updatedCount++;
      continue;
    }

    const change = resolveMarketSessionChange({
      currentPrice: current,
      regularPrice,
      previousClose: previous,
      suppliedChange: data.price.change ?? data.regularMarketChange,
      marketState
    });
    const quoteDetails = {
      marketState,
      price: current,
      change,
      changePercent: previous ? (change / previous) * 100 : 0
    };

    if (recordTrackedPrice(ticker, Number(current), 'Yahoo Proxy', Date.now(), quoteDetails, requestStartedAt)) updatedCount++;
  }

  return updatedCount;
}
