import { fetchYahooStockData, fetchFallbackQuote } from './api';
import { resolveMarketSessionChange, resolveMarketSessionPrice } from '../domain/quotes';

export async function fetchFallbackPrice(symbol: string) {
  for (const provider of ['finnhub', 'twelvedata'] as const) {
    try {
      const fallback = await fetchFallbackQuote(symbol, provider);
      return {
        price: fallback.price,
        sourceName: fallback.sourceName,
        quoteDetails: {
          // These providers do not reliably return a market-session label or
          // source observation timestamp. Do not present a fallback as live.
          marketState: 'UNKNOWN' as const,
          freshness: 'unknown' as const,
          receivedAt: Date.now(),
          price: fallback.price,
          change: fallback.change ?? 0,
          changePercent: fallback.changePercent ?? 0
        }
      };
    } catch (error: any) {
      console.warn(`[${provider} Quote Error for ${symbol}]:`, error?.message || error);
    }
  }
  return null;
}

function resolveQuoteProvenance(marketState: string | undefined, sourceTimeSeconds: unknown) {
  const seconds = Number(sourceTimeSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { freshness: 'unknown' as const, sourceTimestamp: undefined };
  }

  const sourceTimestamp = seconds * 1000;
  const ageMs = Date.now() - sourceTimestamp;
  if (ageMs < 0) return { freshness: 'stale' as const, sourceTimestamp };
  if (ageMs > 5 * 60 * 1000) {
    // A closed-market quote can still be the valid last published close, but
    // must not be described as a live quote.
    return { freshness: marketState === 'CLOSED' ? 'delayed' as const : 'stale' as const, sourceTimestamp };
  }
  return { freshness: 'fresh' as const, sourceTimestamp };
}

export async function fetchLivePriceFromProviders(symbol: string) {
  symbol = symbol.toUpperCase();
  let price: number | null = null;
  let sourceName = "";
  let quoteDetails: any = null;

  try {
    const data = await fetchYahooStockData(symbol);

    if (data?.price && typeof data.price === 'object') {
      const regularPrice = data.price.current ?? data.regularMarketPrice;
      const prevClose = data.price.previousClose ?? data.price.regularMarketPreviousClose;
      const marketState = data.price.marketState;
      const current = resolveMarketSessionPrice({
        regularPrice,
        preMarketPrice: data.price.preMarketPrice,
        postMarketPrice: data.price.postMarketPrice,
        marketState
      });

      if (current !== null) {
        price = current;
        sourceName = "Yahoo";
        const change = resolveMarketSessionChange({
          currentPrice: current,
          regularPrice,
          previousClose: prevClose,
          suppliedChange: data.price.change ?? data.price.regularMarketChange,
          marketState
        });

        const previousClose = Number(prevClose);
        const hasPreviousClose = Number.isFinite(previousClose) && previousClose > 0;
        const sourceTime = marketState === 'PRE'
          ? (data.price.preMarketTime ?? data.price.regularMarketTime)
          : marketState === 'POST'
            ? (data.price.postMarketTime ?? data.price.regularMarketTime)
            : data.price.regularMarketTime;
        const provenance = resolveQuoteProvenance(marketState, sourceTime);
        quoteDetails = {
          marketState,
          ...provenance,
          receivedAt: Date.now(),
          price: current,
          change,
          changePercent: hasPreviousClose ? (change / previousClose) * 100 : 0
        };
      }
    }
  } catch (e: any) {
    console.warn(`[Proxy Quote Error for ${symbol}]:`, e.message);
  }

  if (price === null) {
    const fallback = await fetchFallbackPrice(symbol);
    if (fallback) {
      price = fallback.price;
      sourceName = fallback.sourceName;
      quoteDetails = fallback.quoteDetails;
    }
  }

  const updatedAt = price ? Date.now() : null;

  return {
    price,
    sourceName,
    updatedAt,
    quoteDetails,
    error: price ? null : "Quote unavailable via Yahoo, Finnhub, and Twelve Data"
  };
}
