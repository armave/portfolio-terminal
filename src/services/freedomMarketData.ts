import { proxyFetch } from "./api";

export interface FreedomQuote {
  symbol: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  sourceTimestamp: number | null;
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
  for (const key of ["quotes", "quote", "data", "result", "items", "securities"]) {
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
  const previousClose = numeric(record, ["prevClose", "previousClose", "previous_close", "closePrev", "pc", "prev_close"]);
  const suppliedChange = numeric(record, ["change", "changeAbs", "change_abs", "chg", "d"]);
  const suppliedPercent = numeric(record, ["changePercent", "change_percent", "changePct", "change_pct", "dp"]);
  const change = suppliedChange ?? (previousClose !== null ? price - previousClose : null);
  const changePercent = suppliedPercent ?? (previousClose !== null && change !== null && previousClose !== 0 ? change / previousClose * 100 : null);
  const timestampRaw = numeric(record, ["time", "timestamp", "lastTradeTime", "last_trade_time", "trade_time"]);
  const sourceTimestamp = timestampRaw === null ? null : timestampRaw < 1e12 ? timestampRaw * 1000 : timestampRaw;
  return { symbol, price, previousClose, change, changePercent, sourceTimestamp, raw: payload };
}

function freedomSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  return normalized.includes(".") ? normalized : `${normalized}.US`;
}

export async function fetchFreedomQuote(symbol: string): Promise<FreedomQuote> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) throw new Error("A ticker symbol is required.");
  const payload = await proxyFetch("freedom-quote", { symbol: freedomSymbol(normalized) });
  const quote = normalizeFreedomQuote(payload?.data, normalized);
  if (!quote) throw new Error("Freedom TradeNet returned an unsupported quote payload.");
  return quote;
}

export async function fetchFreedomNews(symbol: string): Promise<unknown[]> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];
  const payload = await proxyFetch("freedom-news", { symbol: freedomSymbol(normalized) });
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["news", "items", "stories", "result"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

export async function fetchFreedomHistory(symbol: string): Promise<unknown[]> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return [];
  const payload = await proxyFetch("freedom-history", { symbol: freedomSymbol(normalized) });
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["candles", "hloc", "history", "items", "result"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}
