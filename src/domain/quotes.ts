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
  if (input.marketState === 'POST') {
    return usablePrice(input.postMarketPrice) ?? regularPrice;
  }
  if (input.marketState === 'CLOSED') {
    return usablePrice(input.postMarketPrice) ??
      usablePrice(input.preMarketPrice) ??
      regularPrice;
  }
  return regularPrice;
}


export interface MarketSessionChangeInput {
  currentPrice: number;
  previousClose?: unknown;
  suppliedChange?: unknown;
  marketState?: MarketState;
}

/**
 * Returns the daily move for the selected session price. Extended and closed
 * sessions must compare against the previous close, not the regular price:
 * when no extended-hours price exists those prices are identical and would
 * incorrectly report a zero daily move.
 */
export function resolveMarketSessionChange(input: MarketSessionChangeInput): number | null {
  const usableNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const current = usableNumber(input.currentPrice);
  if (current === null) return null;

  const previous = usableNumber(input.previousClose);
  const hasPrevious = previous !== null && previous > 0;
  const supplied = usableNumber(input.suppliedChange);
  const isExtendedOrClosed = input.marketState === 'PRE' ||
    input.marketState === 'POST' ||
    input.marketState === 'CLOSED';

  if (isExtendedOrClosed && hasPrevious) return current - previous;
  if (supplied !== null) return supplied;
  return hasPrevious ? current - previous : null;
}
