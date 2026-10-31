import { describe, expect, it } from 'vitest';
import { getMatchingMarginIntelligenceState } from './marginIntelligenceState';

describe('getMatchingMarginIntelligenceState', () => {
  const positionState = {
    scope: 'position' as const,
    ticker: 'AAPL',
    analysis: 'Cached AAPL analysis',
    articles: [{ headline: 'AAPL news' }]
  };

  it('retains cached content for the same ticker and scope', () => {
    expect(getMatchingMarginIntelligenceState(positionState, {
      scope: 'position',
      ticker: 'AAPL'
    })).toBe(positionState);
  });

  it('does not carry another ticker analysis into a new request', () => {
    expect(getMatchingMarginIntelligenceState(positionState, {
      scope: 'position',
      ticker: 'MSFT'
    })).toBeNull();
  });

  it('does not carry position analysis into a portfolio request', () => {
    expect(getMatchingMarginIntelligenceState(positionState, {
      scope: 'portfolio'
    })).toBeNull();
  });

  it('matches portfolio state without a ticker', () => {
    const portfolioState = {
      scope: 'portfolio' as const,
      analysis: 'Cached portfolio analysis'
    };
    expect(getMatchingMarginIntelligenceState(portfolioState, {
      scope: 'portfolio'
    })).toBe(portfolioState);
  });
});
