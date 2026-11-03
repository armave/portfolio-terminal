import { fetchFreedomTradeNetQuoteStreamOnce, proxyFetch } from "./api";

export interface FreedomQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sourceTimestamp: number | null;
  bid?: number | null;
  ask?: number | null;
  volume?: number | null;
  lastTradeTime?: string | null;
  utcOffset?: number | null;
  serverTime?: string | null;
  marketState?: string;
  raw: unknown;
}

function firstObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstObject(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["q", "quotes", "quote", "data", "result", "items", "securities"]) {
    if (record[key] && typeof record[key] === "object") {
      const nested = firstObject(record[key]);
      if (nested) return nested;
    }
  }
  return record;
}

function numeric(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizeFreedomQuote(payload: unknown, symbol: string): FreedomQuote | null {
  const record = firstObject(payload);
  if (!record) return null;
  const price = numeric(record, ["last", "lastPrice", "last_price", "price", "close", "c", "ltp", "last_trade_price"]);
  if (price === null || price <= 0) return null;
  const previousClose = numeric(record, ["prevClose", "previousClose", "previous_close", "closePrev", "pc", "prev_close", "pp"]);
  const suppliedChange = numeric(record, ["change", "changeAbs", "change_abs", "chg", "d"]);
  const suppliedPercent = numeric(record, ["changePercent", "change_percent", "changePct", "change_pct", "dp", "pcp"]);
  const change = suppliedChange ?? (previousClose !== null ? price - previousClose : null);
  const changePercent = suppliedPercent ?? (previousClose !== null && change !== null && previousClose !== 0 ? change / previousClose * 100 : null);
  const timestampRaw = numeric(record, ["time", "timestamp", "lastTradeTime", "last_trade_time", "trade_time", "ltt"]);
  const sourceTimestamp = timestampRaw === null ? null : timestampRaw < 1e12 ? timestampRaw * 1000 : timestampRaw;
  const rawMarketState = typeof record.marketStatus === "string"
    ? record.marketStatus.trim().toUpperCase()
    : typeof record.marketState === "string" ? record.marketState.trim().toUpperCase() : "";
  const marketState = rawMarketState === "CLOSE" ? "CLOSED" : rawMarketState || undefined;
  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    sourceTimestamp,
    bid: numeric(record, ["bbp", "bid"]),
    ask: numeric(record, ["bap", "ask"]),
    volume: numeric(record, ["vol", "volume"]),
    lastTradeTime: typeof record.ltt === "string" ? record.ltt : null,
    utcOffset: numeric(record, ["UTCOffset"]),
    serverTime: typeof record.acc_srv_tm === "string" ? record.acc_srv_tm : null,
    marketState,
    raw: payload
  };
}

function freedomSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  return normalized.includes(".") ? normalized : `${normalized}.US`;
}

export async function fetchFreedomQuoteWebSocket(symbol: string): Promise<FreedomQuote> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) throw new Error("A ticker symbol is required.");
  const ticker = freedomSymbol(normalized);
  if (!/^[A-Z0-9.^=-]{1,32}$/.test(ticker)) {
    throw new Error("Enter one valid TradeNet ticker symbol.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);
  let payload: any;
  try {
    payload = await fetchFreedomTradeNetQuoteStreamOnce(ticker, { signal: controller.signal });
    if (payload === null) {
      throw new Error("TradeNet WebSocket quote snapshot was already requested for this ticker during this app session.");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("TradeNet WebSocket quote request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (
    payload?.ok !== true ||
    payload?.source !== "authenticated_websocket" ||
    String(payload?.symbol || "").trim().toUpperCase() !== ticker
  ) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "TradeNet WebSocket did not confirm the requested production quote."
    );
  }

  const record = firstObject(payload.data);
  const returnedSymbol = record?.c ?? record?.symbol ?? record?.ticker ?? record?.code;
  if (
    typeof returnedSymbol === "string" &&
    returnedSymbol.trim().toUpperCase() !== ticker
  ) {
    throw new Error("TradeNet WebSocket returned a quote for a different ticker.");
  }

  const quote = normalizeFreedomQuote(payload.data, normalized);
  if (!quote) throw new Error("TradeNet WebSocket returned an unsupported quote payload.");
  return quote;
}

export async function fetchFreedomQuote(symbol: string, force = false): Promise<FreedomQuote> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) throw new Error("A ticker symbol is required.");
  const payload = await proxyFetch(
    "freedom-quote",
    { symbol: freedomSymbol(normalized) },
    force ? { cache: "no-store" } : {}
  );
  const quote = normalizeFreedomQuote(payload?.data, normalized);
  if (!quote) throw new Error("Freedom TradeNet returned an unsupported quote payload.");
  return quote;
}
