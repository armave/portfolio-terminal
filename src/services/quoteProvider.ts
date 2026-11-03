import { fetchYahooQuoteData, fetchFallbackQuote } from './api';
import { fetchFreedomQuote, fetchFreedomQuoteWebSocket } from './freedomMarketData';
import { resolveMarketSessionChange, resolveMarketSessionPrice } from '../domain/quotes';
import type { QuoteDetails } from '../types/portfolio';

function describeProviderError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function usableQuoteNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Time-anchored and monotonic, including requests started in the same millisecond.
// Anchoring to epoch time keeps persisted ordering comparable after ordinary reloads.
let lastQuoteRequestSequence = 0;
function nextQuoteRequestSequence(): number {
  lastQuoteRequestSequence = Math.max(Date.now() * 1000, lastQuoteRequestSequence + 1);
  return lastQuoteRequestSequence;
}

async function fetchFallbackPrice(symbol: string, force = false) {
  for (const provider of ['finnhub', 'twelvedata'] as const) {
    try {
      const fallback = force
        ? await fetchFallbackQuote(symbol, provider, true)
        : await fetchFallbackQuote(symbol, provider);
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
          ...(typeof fallback.change === 'number' && Number.isFinite(fallback.change)
            ? { change: fallback.change }
            : {}),
          ...(typeof fallback.changePercent === 'number' && Number.isFinite(fallback.changePercent)
            ? { changePercent: fallback.changePercent }
            : {})
        }
      };
    } catch (error: unknown) {
      console.warn(`[${provider} Quote Error for ${symbol}]:`, describeProviderError(error));
    }
  }
  return null;
}

export interface QuoteProvenance {
  freshness: 'fresh' | 'stale' | 'delayed' | 'unknown';
  sourceTimestamp?: number;
}

/**
 * Classifies a provider observation timestamp independently from the time the
 * browser received it. Yahoo market-data timestamps are Unix seconds.
 */
function resolveQuoteProvenance(
  marketState: string | undefined,
  sourceTimeSeconds: unknown,
  now = Date.now()
): QuoteProvenance {
  const seconds = Number(sourceTimeSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return { freshness: 'unknown' as const, sourceTimestamp: undefined };
  }

  const sourceTimestamp = seconds * 1000;
  const ageMs = now - sourceTimestamp;
  if (ageMs < 0) return { freshness: 'stale' as const, sourceTimestamp };
  if (ageMs > 5 * 60 * 1000) {
    // A closed-market quote can still be the valid last published close, but
    // must not be described as a live quote.
    return { freshness: marketState === 'CLOSED' ? 'delayed' as const : 'stale' as const, sourceTimestamp };
  }
  return { freshness: 'fresh' as const, sourceTimestamp };
}

export async function fetchLivePriceFromProviders(
  symbol: string,
  requestStartedAt = Date.now(),
  force = false
) {
  const requestSequence = nextQuoteRequestSequence();
  symbol = symbol.toUpperCase();
  let price: number | null = null;
  let sourceName = "";
  let quoteDetails: QuoteDetails | null = null;
  let freedomQuote: Awaited<ReturnType<typeof fetchFreedomQuote>> | null = null;
  let freedomTransport: 'websocket' | 'rest' | null = null;

  // TradeNet q is authoritative when it returns a valid quote. Do not launch
  // Yahoo in parallel: that was creating a redundant REST quote on every load.
  // The Freedom REST quote is requested only when the q snapshot fails.
  try {
    freedomQuote = await fetchFreedomQuoteWebSocket(symbol);
    freedomTransport = 'websocket';
  } catch (websocketError) {
    console.warn(
      `[Freedom WebSocket Quote Error for ${symbol}]:`,
      describeProviderError(websocketError)
    );
    try {
      freedomQuote = await fetchFreedomQuote(symbol, true);
      freedomTransport = 'rest';
    } catch (restError) {
      console.warn(`[Freedom REST Quote Error for ${symbol}]:`, describeProviderError(restError));
    }
  }

  if (freedomQuote && Number.isFinite(freedomQuote.price) && freedomQuote.price > 0) {
    const freedomAge = freedomQuote.sourceTimestamp === null
      ? null
      : Date.now() - freedomQuote.sourceTimestamp;
    const freedomFreshness = freedomAge === null ? 'unknown' as const
      : freedomAge < 0 ? 'stale' as const
        : freedomAge > 5 * 60 * 1000 ? 'stale' as const : 'fresh' as const;

    price = freedomQuote.price;
    sourceName = 'Freedom TradeNet';
    quoteDetails = {
      marketState: freedomQuote.marketState || 'UNKNOWN',
      freshness: freedomFreshness,
      sourceTimestamp: freedomQuote.sourceTimestamp ?? undefined,
      transport: freedomTransport,
      receivedAt: Date.now(),
      requestSequence,
      requestStartedAt,
      price: freedomQuote.price,
      ...(freedomQuote.bid !== null && freedomQuote.bid !== undefined ? { bid: freedomQuote.bid } : {}),
      ...(freedomQuote.ask !== null && freedomQuote.ask !== undefined ? { ask: freedomQuote.ask } : {}),
      ...(freedomQuote.volume !== null && freedomQuote.volume !== undefined ? { volume: freedomQuote.volume } : {}),
      ...(freedomQuote.lastTradeTime ? { lastTradeTime: freedomQuote.lastTradeTime } : {}),
      ...(freedomQuote.utcOffset !== null && freedomQuote.utcOffset !== undefined ? { utcOffset: freedomQuote.utcOffset } : {}),
      ...(freedomQuote.serverTime ? { serverTime: freedomQuote.serverTime } : {}),
      ...(typeof freedomQuote.change === 'number' && Number.isFinite(freedomQuote.change)
        ? { change: freedomQuote.change }
        : {}),
      ...(typeof freedomQuote.changePercent === 'number' && Number.isFinite(freedomQuote.changePercent)
        ? { changePercent: freedomQuote.changePercent }
        : {})
    };
  }

  // Only if both authenticated TradeNet paths failed do we try the external
  // Yahoo quote endpoint, followed by Finnhub/Twelve Data. These are true
  // fallbacks now, not parallel requests competing with a successful q event.
  if (price === null) {
    try {
      const data = force
        ? await fetchYahooQuoteData(symbol, true)
        : await fetchYahooQuoteData(symbol);
      if (data?.price && typeof data.price === 'object') {
        const regularPrice = data.price.current ?? data.price.regularMarketPrice ?? data.regularMarketPrice;
        const prevClose = data.price.previousClose ??
          data.price.regularMarketPreviousClose ??
          data.regularMarketPreviousClose;
        const marketState = data.price.marketState;
        const current = resolveMarketSessionPrice({
          regularPrice,
          preMarketPrice: data.price.preMarketPrice,
          postMarketPrice: data.price.postMarketPrice,
          marketState
        });

        if (current !== null) {
          price = current;
          sourceName = 'Yahoo';
          const change = resolveMarketSessionChange({
            currentPrice: current,
            previousClose: prevClose,
            suppliedChange: data.price.change ?? data.price.regularMarketChange ?? data.regularMarketChange,
            marketState
          });
          const previousClose = usableQuoteNumber(prevClose);
          const hasPreviousClose = previousClose !== null && previousClose > 0;
          const suppliedChangePercent = usableQuoteNumber(
            data.price.changePercent ??
            data.price.regularMarketChangePercent ??
            data.regularMarketChangePercent
          );
          const changePercent = hasPreviousClose && change !== null
            ? (change / previousClose) * 100
            : suppliedChangePercent;
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
            ...(change !== null ? { change } : {}),
            ...(changePercent !== null ? { changePercent } : {})
          };
        }
      }
    } catch (error: unknown) {
      console.warn(`[Proxy Quote Error for ${symbol}]:`, describeProviderError(error));
    }
  }

  if (price === null) {
    const fallback = force
      ? await fetchFallbackPrice(symbol, true)
      : await fetchFallbackPrice(symbol);
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
