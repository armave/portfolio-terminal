import { describe, expect, it } from 'vitest';
import { formatPortfolioEquityBadge } from './portfolioEquityBadge';

describe('formatPortfolioEquityBadge', () => {
  it('shows exact equity when all holdings are priced', () => {
    expect(formatPortfolioEquityBadge({
      equity: 1234,
      locale: 'en-US',
      hasPricedHoldings: true,
      hasUnpricedHoldings: false
    })).toBe('+$1,234');
    expect(formatPortfolioEquityBadge({
      equity: -1234,
      locale: 'en-US',
      hasPricedHoldings: true,
      hasUnpricedHoldings: false
    })).toBe('−$1,234');
  });

  it('marks partial equity as a lower bound when any holding is unpriced', () => {
    expect(formatPortfolioEquityBadge({
      equity: 1234,
      locale: 'en-US',
      hasPricedHoldings: true,
      hasUnpricedHoldings: true
    })).toBe('≥+$1,234');
    expect(formatPortfolioEquityBadge({
      equity: -1234,
      locale: 'en-US',
      hasPricedHoldings: true,
      hasUnpricedHoldings: true
    })).toBe('≥−$1,234');
  });

  it('does not report equity when every holding is unpriced', () => {
    expect(formatPortfolioEquityBadge({
      equity: 1234,
      locale: 'en-US',
      hasPricedHoldings: false,
      hasUnpricedHoldings: true
    })).toBe('—');
  });

  it('retains the empty guest balance and rejects non-finite equity', () => {
    expect(formatPortfolioEquityBadge({
      equity: 0,
      locale: 'en-US',
      hasPricedHoldings: false,
      hasUnpricedHoldings: false,
      empty: true
    })).toBe('$0');
    expect(formatPortfolioEquityBadge({
      equity: Number.NaN,
      locale: 'en-US',
      hasPricedHoldings: false,
      hasUnpricedHoldings: false
    })).toBe('—');
  });
});
