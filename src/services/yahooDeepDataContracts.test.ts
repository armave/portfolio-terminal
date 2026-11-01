import { describe, expect, it } from 'vitest';
import { normalizeYahooDeepStockData } from './yahooDeepDataContracts';

describe('normalizeYahooDeepStockData', () => {
  it('normalizes the Worker response shape and preserves supported values', () => {
    expect(normalizeYahooDeepStockData({
      symbol: 'AAPL',
      price: {
        current: 190,
        previousClose: 188,
        marketState: 'REGULAR',
        regularMarketTime: 1790000000,
        change: 2
      },
      valuation: {
        peTrailing: 28,
        peForward: 25,
        pegRatio: 1.4,
        shortPercentOfFloat: '1.25%',
        priceToBook: 42
      },
      financialHealth: {
        profitMargin: '26.31%',
        returnOnEquity: '152.34%',
        totalDebt: 109000000000
      },
      analystTargets: {
        mean: 205,
        high: 250,
        low: 180,
        median: 207,
        consensusRecommendation: 'buy'
      },
      calendar: { earningsDate: 'Nov 6, 2026' },
      upgradesDowngrades: [
        { firm: 'Broker A', toGrade: 'Buy', fromGrade: 'Hold', action: 'up' },
        null,
        { firm: 'Broker B', toGrade: 'Neutral', action: 'main' }
      ]
    })).toMatchObject({
      symbol: 'AAPL',
      price: { current: 190, previousClose: 188, marketState: 'REGULAR', regularMarketTime: 1790000000 },
      valuation: { peTrailing: 28, peForward: 25, shortPercentOfFloat: '1.25%' },
      financialHealth: { profitMargin: '26.31%', totalDebt: 109000000000 },
      analystTargets: { mean: 205, median: 207, consensusRecommendation: 'buy' },
      calendar: { earningsDate: 'Nov 6, 2026' },
      upgradesDowngrades: [
        { firm: 'Broker A', toGrade: 'Buy', fromGrade: 'Hold', action: 'up' },
        { firm: 'Broker B', toGrade: 'Neutral', fromGrade: null, action: 'main' }
      ]
    });
  });

  it('fails closed for malformed payloads and numeric strings where Yahoo emits raw numbers', () => {
    const result = normalizeYahooDeepStockData({
      symbol: 123,
      valuation: { peTrailing: 'not-a-number', peForward: true },
      analystTargets: { mean: '210', high: Number.POSITIVE_INFINITY },
      upgradesDowngrades: ['invalid', null],
      calendar: 'invalid'
    });

    expect(result.symbol).toBeUndefined();
    expect(result.valuation).toMatchObject({ peTrailing: 'not-a-number', peForward: null });
    expect(result.analystTargets).toMatchObject({ mean: null, high: null });
    expect(result.upgradesDowngrades).toEqual([]);
    expect(result.calendar).toEqual({ earningsDate: null });
  });

  it('returns a safe empty contract for null and primitive values', () => {
    expect(normalizeYahooDeepStockData(null)).toMatchObject({
      price: { current: null, marketState: null },
      valuation: { peTrailing: null },
      analystTargets: { mean: null },
      upgradesDowngrades: [],
      earningsHistory: [],
      profile: {}
    });
    expect(normalizeYahooDeepStockData('unexpected').symbol).toBeUndefined();
  });

  it('normalizes optional earnings and profile records without leaking objects', () => {
    const result = normalizeYahooDeepStockData({
      earningsHistory: [
        { quarter: 'Q3 2026', epsEstimate: 1.2, epsActual: 1.4, epsDifference: 0.2, surprisePercent: '16.7%' },
        { quarter: {}, epsActual: false },
        null
      ],
      profile: { sector: 'Technology', industry: null, invalid: { nested: true } }
    });
    expect(result.earningsHistory).toEqual([
      { quarter: 'Q3 2026', epsEstimate: 1.2, epsActual: 1.4, epsDifference: 0.2, surprisePercent: '16.7%' },
      { quarter: null, epsEstimate: null, epsActual: null, epsDifference: null, surprisePercent: null }
    ]);
    expect(result.profile).toEqual({ sector: 'Technology' });
  });
});
