import { describe, expect, it } from 'vitest';
import { resolveMarketSessionChange, resolveMarketSessionPrice } from './quotes';

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

  it('uses an available pre-market price as a closed-session fallback before the regular price', () => {
    expect(resolveMarketSessionPrice({
      regularPrice: 100,
      preMarketPrice: 101.25,
      marketState: 'CLOSED'
    })).toBe(101.25);
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

  it('uses a valid session quote even when the regular-session price is absent', () => {
    expect(resolveMarketSessionPrice({
      regularPrice: undefined,
      preMarketPrice: 101.25,
      marketState: 'PRE'
    })).toBe(101.25);
    expect(resolveMarketSessionPrice({
      regularPrice: undefined,
      postMarketPrice: 98.5,
      marketState: 'CLOSED'
    })).toBe(98.5);
  });
});

describe('resolveMarketSessionChange', () => {
  it('calculates the daily move against previous close during pre-market and after-hours sessions', () => {
    expect(resolveMarketSessionChange({
      currentPrice: 102,
      previousClose: 95,
      suppliedChange: 7,
      marketState: 'PRE'
    })).toBe(7);

    expect(resolveMarketSessionChange({
      currentPrice: 99,
      previousClose: 100,
      suppliedChange: -1,
      marketState: 'POST'
    })).toBe(-1);
  });

  it('preserves the regular-session daily move after the market closes without an extended-hours quote', () => {
    expect(resolveMarketSessionChange({
      currentPrice: 100,
      previousClose: 95,
      suppliedChange: 5,
      marketState: 'CLOSED'
    })).toBe(5);
  });

  it('uses the provider daily change when the previous close is unavailable', () => {
    expect(resolveMarketSessionChange({
      currentPrice: 102,
      previousClose: null,
      suppliedChange: 2,
      marketState: 'CLOSED'
    })).toBe(2);
  });

  it('returns null instead of inventing a zero when change inputs are missing or malformed', () => {
    expect(resolveMarketSessionChange({
      currentPrice: 102,
      previousClose: undefined,
      suppliedChange: Number.NaN,
      marketState: 'CLOSED'
    })).toBeNull();

    expect(resolveMarketSessionChange({
      currentPrice: 102,
      previousClose: Number.NaN,
      suppliedChange: Number.POSITIVE_INFINITY,
      marketState: 'REGULAR'
    })).toBeNull();

    expect(resolveMarketSessionChange({
      currentPrice: Number.POSITIVE_INFINITY,
      previousClose: 100,
      suppliedChange: 2,
      marketState: 'REGULAR'
    })).toBeNull();
  });

  it('preserves a valid provider-supplied regular-session change', () => {
    expect(resolveMarketSessionChange({
      currentPrice: 102,
      previousClose: 95,
      suppliedChange: 3,
      marketState: 'REGULAR'
    })).toBe(3);
  });
});
