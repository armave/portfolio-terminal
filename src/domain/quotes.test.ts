import { describe, expect, it } from 'vitest';
import { resolveMarketSessionPrice } from './quotes';

describe('resolveMarketSessionPrice', () => {
  it('uses pre-market and after-hours prices when available', () => {
    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      preMarketPrice: 101.5,
      postMarketPrice: 99.5,
      marketState: 'PRE'
    })).toBe(101.5);

    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      postMarketPrice: 98.75,
      marketState: 'POST'
    })).toBe(98.75);

    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      postMarketPrice: 98.75,
      marketState: 'CLOSED'
    })).toBe(98.75);
  });

  it('falls back to the regular price when session-specific prices are missing or invalid', () => {
    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      marketState: 'PRE'
    })).toBe(100);
    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      preMarketPrice: Number.NaN,
      postMarketPrice: 0,
      marketState: 'PRE'
    })).toBe(100);
    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      postMarketPrice: Number.POSITIVE_INFINITY,
      marketState: 'POST'
    })).toBe(100);
  });

  it('returns null when no usable regular or session price exists', () => {
    expect(resolveMarketSessionPrice({
      regularPrice: 0,
      postMarketPrice: -1,
      marketState: 'POST'
    })).toBeNull();
  });

  it('uses the regular price during regular or unknown market states', () => {
    expect(resolveMarketSessionPrice({ regularPrice: 100, marketState: 'REGULAR' })).toBe(100);
    expect(resolveMarketSessionPrice({ regularPrice: 100 })).toBe(100);
  });
});
