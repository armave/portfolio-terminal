import { normalizeFreedomQuote } from './freedomMarketData';
import { createCoalescedFrameCallback, type FrameSchedule } from '../utils/coalescedFrameCallback';
import {
  createFreedomQuoteStreamRuntime,
  type FreedomQuoteStreamRuntime,
  type FreedomQuoteSocketLike
} from './freedomQuoteStreamRuntime';

export interface FreedomQuoteStreamAppRuntimeDependencies {
  createTicket: (tickers: string[]) => Promise<{ ticket: string }>;
  buildSocketUrl: (ticket: string) => string;
  createSocket?: (url: string) => FreedomQuoteSocketLike;
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
  renderAfterUpdate: () => void;
  scheduleRenderFrame?: FrameSchedule;
  onStatus?: (status: string, message?: string) => void;
}

/**
 * Adapts persistent public q events to the in-memory portfolio quote projection.
 * Quote ticks are volatile and must not trigger local or cloud persistence.
 */
export function createFreedomQuoteStreamAppRuntime(
  dependencies: FreedomQuoteStreamAppRuntimeDependencies
): FreedomQuoteStreamRuntime {
  const renderScheduler = createCoalescedFrameCallback(
    dependencies.renderAfterUpdate,
    dependencies.scheduleRenderFrame
  );
  const MAX_SYMBOLS_PER_STREAM = 10;
  let streams: FreedomQuoteStreamRuntime[] = [];
  let activeTickers: string[] = [];
  let activeSessionKey = '';

  const createStream = (): FreedomQuoteStreamRuntime => createFreedomQuoteStreamRuntime({
    createTicket: dependencies.createTicket,
    buildSocketUrl: dependencies.buildSocketUrl,
    createSocket: dependencies.createSocket,
    onQuote: (message, sessionKey) => {
      const currentSessionKey = dependencies.getCurrentSessionKey();
      if (!currentSessionKey || sessionKey !== currentSessionKey) return;

      const wireSymbol = message.symbol.trim().toUpperCase();
      const ticker = wireSymbol.endsWith('.US') ? wireSymbol.slice(0, -3) : wireSymbol;
      const quote = normalizeFreedomQuote({ q: [message.data] }, ticker);
      if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return;

      // Use this browser's arrival time as the ordering clock for live ticks.
      // The server-provided receive time may be behind the browser clock; taking
      // the maximum keeps a newly arrived q event newer than local trade writes.
      const receivedAt = Math.max(Date.now(), Number(message.receivedAt) || 0);
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
        renderScheduler.schedule();
      }
    },
    onStatus: dependencies.onStatus
  });

  const stop = (): void => {
    const previousStreams = streams;
    streams = [];
    activeTickers = [];
    activeSessionKey = '';
    previousStreams.forEach((stream) => stream.stop());
    renderScheduler.cancel();
  };

  const start = async (tickers: string[], sessionKey: string): Promise<boolean> => {
    const normalized = [...new Set(
      tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)
    )].sort();
    if (normalized.length === 0 || !sessionKey) {
      stop();
      return false;
    }

    const unchanged = activeSessionKey === sessionKey &&
      activeTickers.length === normalized.length &&
      activeTickers.every((ticker, index) => ticker === normalized[index]) &&
      streams.length === Math.ceil(normalized.length / MAX_SYMBOLS_PER_STREAM);

    if (!unchanged) {
      stop();
      activeSessionKey = sessionKey;
      activeTickers = normalized;
      const groups: string[][] = [];
      for (let index = 0; index < normalized.length; index += MAX_SYMBOLS_PER_STREAM) {
        groups.push(normalized.slice(index, index + MAX_SYMBOLS_PER_STREAM));
      }
      streams = groups.map(() => createStream());
    }

    const results = await Promise.all(streams.map((stream, index) => {
      const group = activeTickers.slice(
        index * MAX_SYMBOLS_PER_STREAM,
        (index + 1) * MAX_SYMBOLS_PER_STREAM
      );
      return stream.start(group, sessionKey).catch(() => false);
    }));
    return results.every(Boolean);
  };

  return {
    start,
    stop,
    isConnected: () => streams.length > 0 && streams.every((stream) => stream.isConnected()),
    isSocketOpen: () => streams.length > 0 && streams.every((stream) => stream.isSocketOpen()),
    isSubscribed: (ticker) => streams.some((stream) => stream.isSubscribed(ticker)),
    isForSession: (sessionKey) => Boolean(
      streams.length > 0 &&
      activeSessionKey === sessionKey &&
      streams.every((stream) => stream.isForSession(sessionKey))
    )
  };
}
