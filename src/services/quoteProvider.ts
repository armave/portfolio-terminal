import { fetchYahooQuoteData, fetchFallbackQuote } from './api';
import { fetchFreedomQuote } from './freedomMarketData';
import { resolveMarketSessionChange, resolveMarketSessionPrice } from '../domain/quotes';

// Time-anchored and monotonic, including requests started in the same millisecond.
// Anchoring to epoch time keeps persisted ordering comparable after ordinary reloads.
let lastQuoteRequestSequence = 0;
export function nextQuoteRequestSequence(): number {
  lastQuoteRequestSequence = Math.max(Date.now() * 1000, lastQuoteRequestSequence + 1);
  return lastQuoteRequestSequence;
}

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
  const requestStartedAt = Date.now();
  const requestSequence = nextQuoteRequestSequence();
  symbol = symbol.toUpperCase();
  let price: number | null = null;
  let sourceName = "";
  let quoteDetails: any = null;

  // Start both providers together; selection below is based on source timestamps,
  // not request completion order or a hard-coded vendor preference.
  const [freedomResult, yahooResult] = await Promise.allSettled([
    fetchFreedomQuote(symbol),
    fetchYahooQuoteData(symbol)
  ]);
  let freedomQuote: Awaited<ReturnType<typeof fetchFreedomQuote>> | null = null;
  if (freedomResult.status === 'fulfilled') {
    freedomQuote = freedomResult.value;
  } else {
    console.warn(`[Freedom Quote Error for ${symbol}]:`, freedomResult.reason?.message || freedomResult.reason);
  }

  try {
    if (yahooResult.status === 'rejected') throw yahooResult.reason;
    const data = yahooResult.value;

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
          requestSequence,
          requestStartedAt,
          price: current,
          change,
          changePercent: hasPreviousClose ? (change / previousClose) * 100 : 0
        };
      }
    }
  } catch (e: any) {
    console.warn(`[Proxy Quote Error for ${symbol}]:`, e?.message || e);
  }

  if (freedomQuote && Number.isFinite(freedomQuote.price) && freedomQuote.price > 0) {
    const freedomAge = freedomQuote.sourceTimestamp === null ? null : Date.now() - freedomQuote.sourceTimestamp;
    const freedomFreshness = freedomAge === null ? 'unknown' as const
      : freedomAge < 0 ? 'stale' as const
        : freedomAge > 5 * 60 * 1000 ? 'stale' as const : 'fresh' as const;
    const yahooFreshness = quoteDetails?.freshness;
    const yahooTimestamp = quoteDetails?.sourceTimestamp;
    const yahooIsFresh = yahooFreshness === 'fresh';
    const freedomIsFresh = freedomFreshness === 'fresh';
    const freedomTimestamp = freedomQuote.sourceTimestamp;
    const hasFreedomTimestamp = typeof freedomTimestamp === 'number' && Number.isFinite(freedomTimestamp);
    const hasYahooTimestamp = typeof yahooTimestamp === 'number' && Number.isFinite(yahooTimestamp);
    const bothHaveSourceTimestamps = hasFreedomTimestamp && hasYahooTimestamp;
    const yahooIsNewer = hasYahooTimestamp && (!hasFreedomTimestamp || yahooTimestamp > freedomTimestamp!);

    // When both providers give observation timestamps, compare those timestamps
    // directly. Freshness labels are useful metadata, but must not override the
    // relative age of two otherwise valid quotes.
    const chooseFreedom = price === null || (bothHaveSourceTimestamps
      ? freedomTimestamp! >= yahooTimestamp!
      : freedomIsFresh && (!yahooIsFresh || !yahooIsNewer));
    if (chooseFreedom) {
      price = freedomQuote.price;
      sourceName = 'Freedom TradeNet';
      quoteDetails = {
        marketState: 'UNKNOWN',
        freshness: freedomFreshness,
        sourceTimestamp: freedomQuote.sourceTimestamp ?? undefined,
        receivedAt: Date.now(),
        requestSequence,
        requestStartedAt,
        price: freedomQuote.price,
        change: freedomQuote.change ?? 0,
        changePercent: freedomQuote.changePercent ?? 0
      };
    }
  }

  if (price === null) {
    const fallback = await fetchFallbackPrice(symbol);
    if (fallback) {
      price = fallback.price;
      sourceName = fallback.sourceName;
      quoteDetails = { ...fallback.quoteDetails, requestSequence, requestStartedAt };
    }
  }

  const updatedAt = price ? Date.now() : null;

  return {
    price,
    sourceName,
    updatedAt,
    requestStartedAt,
    requestSequence,
    quoteDetails,
    error: price ? null : "Quote unavailable via Freedom TradeNet, Yahoo, Finnhub, and Twelve Data"
  };
}
