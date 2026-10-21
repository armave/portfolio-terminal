import { describe, expect, it } from 'vitest';
import { getStocktwitsCashtags } from './MarketInsightsPanel';

describe('getStocktwitsCashtags', () => {
  it('returns unique ticker cashtags in uppercase', () => {
    expect(getStocktwitsCashtags('Watching $aapl and $MSFT; $AAPL again')).toEqual(['AAPL', 'MSFT']);
  });

  it('returns no tickers when a message has no cashtags', () => {
    expect(getStocktwitsCashtags('Market is choppy today')).toEqual([]);
  });

  it('does not treat ordinary dollar amounts as ticker symbols', () => {
    expect(getStocktwitsCashtags('Bought shares for $125 and waiting')).toEqual([]);
  });
});
