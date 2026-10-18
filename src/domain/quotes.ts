type MarketState = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | string | undefined;

export interface MarketSessionPriceInput {
  regularPrice: unknown;
  preMarketPrice?: unknown;
  postMarketPrice?: unknown;
  marketState?: MarketState;
}

/**
 * Selects a usable market-session price without discarding the regular quote
 * when the provider omits a pre-market or after-hours value.
 */
export function resolveMarketSessionPrice(input: MarketSessionPriceInput): number | null {
  const usablePrice = (value: unknown): number | null => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? price : null;
  };

  const regularPrice = usablePrice(input.regularPrice);
  if (input.marketState === 'PRE') {
    return usablePrice(input.preMarketPrice) ??
      usablePrice(input.postMarketPrice) ??
      regularPrice;
  }
  if (input.marketState === 'POST' || input.marketState === 'CLOSED') {
    return usablePrice(input.postMarketPrice) ?? regularPrice;
  }
  return regularPrice;
}


export interface MarketSessionChangeInput {
  currentPrice: number;
  regularPrice?: unknown;
  previousClose?: unknown;
  suppliedChange?: unknown;
  marketState?: MarketState;
}

/** Returns a finite session change, falling back to a known baseline when needed. */
export function resolveMarketSessionChange(input: MarketSessionChangeInput): number {
  const usableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const current = usableNumber(input.currentPrice);
  if (current === null) return 0;

  const regular = usableNumber(input.regularPrice);
  const previous = usableNumber(input.previousClose);
  const hasRegular = regular !== null && regular > 0;
  const hasPrevious = previous !== null && previous > 0;

  if (input.marketState === 'PRE' || input.marketState === 'POST' || input.marketState === 'CLOSED') {
    if (hasRegular) return current - regular;
    if (hasPrevious) return current - previous;
    return 0;
  }

  const supplied = usableNumber(input.suppliedChange);
  if (supplied !== null) return supplied;
  return hasPrevious ? current - previous : 0;
}
