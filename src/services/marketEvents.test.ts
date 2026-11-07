import { describe, expect, it } from 'vitest';
import { normalizeDividendEvents, normalizeEarningsEvents, normalizeMarketEventsResponse } from './marketEvents';

describe('market event normalization', () => {
  it('normalizes earnings events without inventing observation or publication times', () => {
    const result = normalizeMarketEventsResponse({
      ok: true, provider: 'Finnhub', symbol: 'GOOGL', receivedAt: 1794000000000,
      earningsAvailable: true, dividendsAvailable: false,
      earnings: [{ symbol: 'GOOGL', date: '2026-11-07', hour: 'amc', epsEstimate: 2.1, currency: 'USD' }],
      dividends: []
    });
    expect(result).toMatchObject({
      symbol: 'GOOGL', quality: 'partial', observedAt: null,
      earnings: [{
        eventDate: '2026-11-07', timing: 'after_market', epsActual: null, epsEstimate: 2.1,
        currency: 'USD', provenance: { provider: 'FINNHUB', receivedAt: 1794000000000, observedAt: null, publishedAt: null }
      }],
      dividends: []
    });
  });

  it('preserves zero amounts as real values and keeps absent currency unknown', () => {
    const result = normalizeDividendEvents([{ symbol: 'GOOGL', date: '2026-11-10', amount: 0, currency: null }], {
      symbol: 'GOOGL', provider: 'Finnhub', receivedAt: 1000
    });
    expect(result.events[0]).toMatchObject({ amount: 0, currency: null, exDate: '2026-11-10' });
  });

  it('rejects impossible event dates and marks malformed rows partial', () => {
    const result = normalizeEarningsEvents([
      { symbol: 'GOOGL', date: '2026-02-30' },
      { symbol: 'GOOGL', date: '2026-02-12' }
    ], { symbol: 'GOOGL', provider: 'Finnhub', receivedAt: Date.now() });
    expect(result.quality).toBe('partial');
    expect(result.events).toHaveLength(1);
  });
});
