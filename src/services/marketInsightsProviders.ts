/**
 * Typed market-news and Stocktwits provider boundary.
 *
 * Each feed owns a bounded TTL cache and shares identical in-flight reads.
 * Abort signals are subscriber-scoped: cancelling one consumer does not cancel
 * the shared transport while another consumer still needs the result.
 */

export interface MarketNewsItem {
  id?: number | string;
  url?: string;
  link?: string;
  headline?: string;
  title?: string;
  datetime?: number | string;
  publishedAt?: number | string;
  source?: string;
  publisher?: string;
  summary?: string;
  description?: string;
  content?: string;
}

export interface StocktwitsMessage {
  id: number | string;
  body: string;
  created_at?: string;
  user?: { username?: string; name?: string };
  sentiment?: { basic?: 'Bullish' | 'Bearish' | null } | null;
  likes?: { total?: number };
  entities?: { sentiment?: { basic?: string | null } | null };
  conversation?: { parent_message_id?: number | string | null } | null;
  in_reply_to?: unknown;
  reply_to?: unknown;
}

export interface StocktwitsStream {
  symbol: string;
  messages: StocktwitsMessage[];
  streamUrl: string;
}

export interface MarketInsightsProviderOptions {
  fetchNews: (symbol: string, signal: AbortSignal, force: boolean) => Promise<unknown>;
  fetchStocktwits: (symbol: string, signal: AbortSignal, force: boolean) => Promise<unknown>;
  onNewsError?: (symbol: string, error: unknown) => void;
  now?: () => number;
  maxEntries?: number;
}

interface CachedValue<T> {
  expiresAt: number;
  data: T;
}

interface RequestEntry<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
  settled: boolean;
}

interface SymbolResourceOptions<T> {
  ttlMs: number;
  now: () => number;
  maxEntries: number;
  fetchData: (symbol: string, signal: AbortSignal, force: boolean) => Promise<T>;
}

interface SymbolResource<T> {
  fetch: (symbol: string, force?: boolean, signal?: AbortSignal) => Promise<T>;
  clear: () => void;
}

const DEFAULT_MAX_ENTRIES = 500;
const MARKET_NEWS_TTL_MS = 5 * 60 * 1000;
const STOCKTWITS_TTL_MS = 2 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase();
}

function createAbortError(): Error {
  const error = new Error('The request was aborted.');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError';
}

function setBoundedCache<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number
): void {
  cache.set(key, value);
  if (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

function subscribeToRequest<T>(
  entry: RequestEntry<T>,
  signal: AbortSignal | undefined,
  onLastSubscriberAbort: () => void
): Promise<T> {
  if (signal?.aborted) return Promise.reject(createAbortError());

  entry.subscribers += 1;
  return new Promise<T>((resolve, reject) => {
    let active = true;

    const release = (): boolean => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener('abort', onAbort);
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      return true;
    };

    const onAbort = (): void => {
      if (!release()) return;
      if (!entry.settled && entry.subscribers === 0) {
        onLastSubscriberAbort();
        entry.controller.abort();
      }
      reject(createAbortError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    entry.promise.then(
      value => {
        if (release()) resolve(value);
      },
      error => {
        if (release()) reject(error);
      }
    );
  });
}

function createSymbolResource<T>(options: SymbolResourceOptions<T>): SymbolResource<T> {
  const cache = new Map<string, CachedValue<T>>();
  const requests = new Map<string, RequestEntry<T>>();
  const inFlight = new Set<RequestEntry<T>>();

  function startRequest(symbol: string, force: boolean): RequestEntry<T> {
    const controller = new AbortController();
    let entry!: RequestEntry<T>;

    const promise = Promise.resolve()
      .then(() => options.fetchData(symbol, controller.signal, force))
      .then(data => {
        if (requests.get(symbol) === entry && !controller.signal.aborted) {
          setBoundedCache(cache, symbol, {
            expiresAt: options.now() + options.ttlMs,
            data
          }, options.maxEntries);
        }
        return data;
      })
      .finally(() => {
        entry.settled = true;
        inFlight.delete(entry);
        if (requests.get(symbol) === entry) requests.delete(symbol);
      });

    entry = { controller, promise, subscribers: 0, settled: false };
    requests.set(symbol, entry);
    inFlight.add(entry);
    return entry;
  }

  function fetch(symbolValue: string, force = false, signal?: AbortSignal): Promise<T> {
    const symbol = normalizeSymbol(symbolValue);
    if (!symbol) return Promise.reject(new Error('A ticker symbol is required.'));
    if (signal?.aborted) return Promise.reject(createAbortError());

    if (!force) {
      const cached = cache.get(symbol);
      if (cached && cached.expiresAt > options.now()) return Promise.resolve(cached.data);
      if (cached) cache.delete(symbol);
    }

    const existing = force ? undefined : requests.get(symbol);
    const entry = existing ?? startRequest(symbol, force);
    return subscribeToRequest(entry, signal, () => {
      if (requests.get(symbol) === entry) requests.delete(symbol);
    });
  }

  function clear(): void {
    for (const entry of inFlight) entry.controller.abort();
    inFlight.clear();
    requests.clear();
    cache.clear();
  }

  return { fetch, clear };
}

function normalizeNews(value: unknown): MarketNewsItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map(record => {
    const item: MarketNewsItem = {};
    if (typeof record.id === 'string' || (typeof record.id === 'number' && Number.isFinite(record.id))) {
      item.id = record.id;
    }
    for (const key of ['url', 'link', 'headline', 'title', 'source', 'publisher', 'summary', 'description', 'content'] as const) {
      if (typeof record[key] === 'string') item[key] = record[key];
    }
    for (const key of ['datetime', 'publishedAt'] as const) {
      if (typeof record[key] === 'string' || (typeof record[key] === 'number' && Number.isFinite(record[key]))) {
        item[key] = record[key];
      }
    }
    return item;
  });
}

function normalizeStocktwitsSentiment(value: unknown): StocktwitsMessage['sentiment'] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const basic = value.basic;
  if (basic === 'Bullish' || basic === 'Bearish' || basic === null) return { basic };
  return undefined;
}

function normalizeStocktwitsMessage(value: unknown): StocktwitsMessage | null {
  if (!isRecord(value) || typeof value.body !== 'string') return null;

  const id = typeof value.id === 'number' && Number.isFinite(value.id)
    ? value.id
    : typeof value.id === 'string' && value.id.trim()
      ? value.id
      : null;
  if (id === null) return null;

  const message: StocktwitsMessage = { id, body: value.body };
  if (typeof value.created_at === 'string') message.created_at = value.created_at;

  if (isRecord(value.user)) {
    const user: NonNullable<StocktwitsMessage['user']> = {};
    if (typeof value.user.username === 'string') user.username = value.user.username;
    if (typeof value.user.name === 'string') user.name = value.user.name;
    if (Object.keys(user).length > 0) message.user = user;
  }

  if (value.sentiment === null) {
    message.sentiment = null;
  } else {
    const sentiment = normalizeStocktwitsSentiment(value.sentiment);
    if (sentiment !== undefined) message.sentiment = sentiment;
  }

  if (isRecord(value.likes) && typeof value.likes.total === 'number' && Number.isFinite(value.likes.total)) {
    message.likes = { total: value.likes.total };
  }

  if (isRecord(value.entities) && isRecord(value.entities.sentiment)) {
    const basic = value.entities.sentiment.basic;
    if (typeof basic === 'string' || basic === null) {
      message.entities = { sentiment: { basic } };
    }
  }

  if (value.conversation === null) {
    message.conversation = null;
  } else if (isRecord(value.conversation)) {
    const parent = value.conversation.parent_message_id;
    if (typeof parent === 'number' || typeof parent === 'string' || parent === null) {
      message.conversation = { parent_message_id: parent };
    }
  }

  if ('in_reply_to' in value) message.in_reply_to = value.in_reply_to;
  if ('reply_to' in value) message.reply_to = value.reply_to;
  return message;
}

function normalizeStocktwits(symbol: string, value: unknown): StocktwitsStream {
  const record = isRecord(value) ? value : {};
  const messages = Array.isArray(record.messages)
    ? record.messages.map(normalizeStocktwitsMessage).filter((message): message is StocktwitsMessage => message !== null)
    : [];
  const streamUrl = typeof record.streamUrl === 'string' && record.streamUrl
    ? record.streamUrl
    : 'https://stocktwits.com/symbol/' + encodeURIComponent(symbol);
  return { symbol, messages, streamUrl };
}

export function createMarketInsightsProviderClient(options: MarketInsightsProviderOptions) {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;

  const news = createSymbolResource<MarketNewsItem[]>({
    ttlMs: MARKET_NEWS_TTL_MS,
    now,
    maxEntries,
    fetchData: async (symbol, signal, force) => normalizeNews(await options.fetchNews(symbol, signal, force))
  });

  const stocktwits = createSymbolResource<StocktwitsStream>({
    ttlMs: STOCKTWITS_TTL_MS,
    now,
    maxEntries,
    fetchData: async (symbol, signal, force) => normalizeStocktwits(
      symbol,
      await options.fetchStocktwits(symbol, signal, force)
    )
  });

  async function fetchMarketNews(
    ticker: string,
    force = false,
    signal?: AbortSignal
  ): Promise<MarketNewsItem[]> {
    const symbol = normalizeSymbol(ticker);
    if (!symbol) return [];
    try {
      return await news.fetch(symbol, force, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      options.onNewsError?.(symbol, error);
      return [];
    }
  }

  function fetchStocktwitsStream(
    ticker: string,
    force = false,
    signal?: AbortSignal
  ): Promise<StocktwitsStream> {
    const symbol = normalizeSymbol(ticker);
    if (!symbol) return Promise.resolve({ symbol: '', messages: [], streamUrl: '' });
    return stocktwits.fetch(symbol, force, signal);
  }

  function clear(): void {
    news.clear();
    stocktwits.clear();
  }

  return { fetchMarketNews, fetchStocktwitsStream, clear };
}
