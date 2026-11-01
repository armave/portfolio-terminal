export interface FreedomMarketDepthLevel {
  price: number;
  quantity: number;
  position: number | null;
}

export interface FreedomMarketDepthSnapshot {
  symbol: string;
  bids: FreedomMarketDepthLevel[];
  asks: FreedomMarketDepthLevel[];
  depth: number;
  minPriceStep: number | null;
  updatedAt: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLevels(value: unknown): FreedomMarketDepthLevel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const row = asRecord(candidate);
    if (!row) return [];
    const price = finiteNumber(row.price);
    const quantity = finiteNumber(row.quantity);
    if (price === null || price <= 0 || quantity === null || quantity <= 0) return [];
    return [{
      price,
      quantity,
      position: finiteNumber(row.position)
    }];
  });
}

/**
 * Parse the Worker envelope and validate all levels before exposing them to
 * the rendering component. Unknown or partial provider payloads fail closed.
 */
export function normalizeFreedomMarketDepth(
  payload: unknown,
  expectedSymbol: string
): FreedomMarketDepthSnapshot {
  const envelope = asRecord(payload);
  const data = asRecord(envelope?.data);
  const nestedData = asRecord(data?.data);
  const book = nestedData ?? data ?? envelope;
  const symbol = typeof book?.symbol === 'string' ? book.symbol.trim().toUpperCase() : '';
  const expected = expectedSymbol.trim().toUpperCase();

  if (!book || !expected || symbol !== expected ||
      !Array.isArray(book.bids) || !Array.isArray(book.asks)) {
    throw new Error('TradeNet returned an unrecognized market-depth response.');
  }

  const bids = normalizeLevels(book.bids);
  const asks = normalizeLevels(book.asks);
  const depthValue = finiteNumber(book.depth);
  const step = finiteNumber(book.minPriceStep);
  const updatedAt = finiteNumber(book.updatedAt);

  return {
    symbol,
    bids,
    asks,
    depth: depthValue !== null && depthValue >= 0 ? depthValue : bids.length + asks.length,
    minPriceStep: step !== null && step > 0 ? step : null,
    updatedAt: updatedAt !== null && updatedAt > 0 ? updatedAt : Date.now()
  };
}
