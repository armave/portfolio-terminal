export type MarketState = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED' | string | undefined;

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
