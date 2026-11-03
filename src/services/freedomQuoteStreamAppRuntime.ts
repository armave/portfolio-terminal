import { normalizeFreedomQuote } from './freedomMarketData';
import {
  createFreedomQuoteStreamRuntime,
  type FreedomQuoteStreamRuntime
} from './freedomQuoteStreamRuntime';

export interface FreedomQuoteStreamAppRuntimeDependencies {
  createTicket: (tickers: string[]) => Promise<{ ticket: string }>;
  buildSocketUrl: (ticket: string) => string;
  getCurrentSessionKey: () => string;
  nextRequestSequence: () => number;
  recordQuote: (
    ticker: string,
    price: number,
    source: string,
    updatedAt: number,
    details: Record<string, unknown>,
    requestStartedAt: number
  ) => boolean;
  persistAndRender: () => void;
  onStatus?: (status: string, message?: string) => void;
}

/**
 * Adapts the persistent public q event to the existing portfolio quote store.
 * Kept in a lazy chunk so it does not increase the application entry bundle.
 */
export function createFreedomQuoteStreamAppRuntime(
  dependencies: FreedomQuoteStreamAppRuntimeDependencies
): FreedomQuoteStreamRuntime {
  return createFreedomQuoteStreamRuntime({
    createTicket: dependencies.createTicket,
    buildSocketUrl: dependencies.buildSocketUrl,
    onQuote: (message, sessionKey) => {
      const currentSessionKey = dependencies.getCurrentSessionKey();
      if (!currentSessionKey || sessionKey !== currentSessionKey) return;

      const wireSymbol = message.symbol.trim().toUpperCase();
      const ticker = wireSymbol.endsWith('.US') ? wireSymbol.slice(0, -3) : wireSymbol;
      const quote = normalizeFreedomQuote({ q: [message.data] }, ticker);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return;

      const receivedAt = Number(message.receivedAt) || Date.now();
      const sourceTimestamp = quote.sourceTimestamp ?? undefined;
      const ageMs = sourceTimestamp === undefined ? null : receivedAt - sourceTimestamp;
      const freshness = ageMs === null ? 'unknown'
        : ageMs < 0 ? 'stale'
          : ageMs > 5 * 60 * 1000
            ? quote.marketState === 'CLOSED' ? 'delayed' : 'stale'
            : 'fresh';
      const requestSequence = dependencies.nextRequestSequence();
      const quoteDetails = {
        marketState: quote.marketState || 'UNKNOWN',
        freshness,
        receivedAt,
        requestSequence,
        requestStartedAt: receivedAt,
        sourceTimestamp,
        transport: 'websocket',
        price: quote.price,
        ...(quote.change !== null ? { change: quote.change } : {}),
        ...(quote.changePercent !== null ? { changePercent: quote.changePercent } : {}),
        ...(quote.bid !== null && quote.bid !== undefined ? { bid: quote.bid } : {}),
        ...(quote.ask !== null && quote.ask !== undefined ? { ask: quote.ask } : {}),
        ...(quote.volume !== null && quote.volume !== undefined ? { volume: quote.volume } : {}),
        ...(quote.lastTradeTime ? { lastTradeTime: quote.lastTradeTime } : {}),
        ...(quote.utcOffset !== null && quote.utcOffset !== undefined ? { utcOffset: quote.utcOffset } : {}),
        ...(quote.serverTime ? { serverTime: quote.serverTime } : {})
      };
      if (dependencies.recordQuote(ticker, quote.price, 'Freedom TradeNet', receivedAt, quoteDetails, receivedAt)) {
        dependencies.persistAndRender();
      }
    },
    onStatus: dependencies.onStatus
  });
}
