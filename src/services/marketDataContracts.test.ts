import { describe, expect, it } from 'vitest';
import {
  isFxRateUsableForConversion,
  normalizeFxRate,
  normalizeInstrumentIdentity,
  normalizeMarketHistoryPoints,
  normalizeMarketHistoryResponse,
  normalizeMarketQuoteObservation,
  shouldAcceptMarketObservation
} from './marketDataContracts';

describe('normalizeInstrumentIdentity', () => {
  it('normalizes exchange-qualified symbols without confusing share classes with exchanges', () => {
    expect(normalizeInstrumentIdentity({ symbol: 'aapl.us', assetType: 'equity', quoteCurrency: 'usd' }))
      .toMatchObject({
        instrument: {
          id: 'EQUITY:US:AAPL',
          symbol: 'AAPL',
          exchange: 'US',
          assetType: 'EQUITY',
          quoteCurrency: 'USD'
        },
        issues: []
      });
    expect(normalizeInstrumentIdentity({ symbol: 'brk.b', assetType: 'EQUITY' }).instrument)
      .toMatchObject({ id: 'EQUITY:UNSPECIFIED:BRK.B', symbol: 'BRK.B', exchange: null });
  });

  it('uses an explicit exchange and preserves provider aliases', () => {
    expect(normalizeInstrumentIdentity({
      symbol: 'AAPL',
      exchange: 'nasdaq',
      aliases: ['aapl.us', 'AAPL', ''],
      providerSymbols: { yahoo: 'aapl', freedom: 'AAPL.US' }
    }).instrument).toMatchObject({
      id: 'UNKNOWN:NASDAQ:AAPL',
      exchange: 'NASDAQ',
      aliases: ['AAPL.US'],
      providerSymbols: { YAHOO: 'AAPL', FREEDOM: 'AAPL.US' }
    });
  });

  it('rejects blank or unsafe symbols and does not infer currency from a ticker', () => {
    expect(normalizeInstrumentIdentity({ symbol: '   ' }).instrument).toBeNull();
    expect(normalizeInstrumentIdentity({ symbol: 'AAPL;DROP' }).instrument).toBeNull();
    const result = normalizeInstrumentIdentity({ symbol: 'AAPL', quoteCurrency: 'US' });
    expect(result.instrument?.quoteCurrency).toBeNull();
    expect(result.issues).toContain('Quote currency is invalid; currency remains unknown.');
  });
});

describe('normalizeMarketQuoteObservation', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z');
  const base = {
    symbol: 'AAPL.US',
    price: '210.25',
    provider: 'yahoo',
    receivedAt: now,
    observedAt: now - 30_000,
    currency: 'USD',
    session: 'REGULAR',
    delayClass: 'LIVE'
  };

  it('keeps observation time independent from receipt time and marks a verified recent quote fresh', () => {
    expect(normalizeMarketQuoteObservation(base, { now }).observation).toMatchObject({
      instrument: { id: 'UNKNOWN:US:AAPL', quoteCurrency: 'USD' },
      price: 210.25,
      provider: 'YAHOO',
      observedAt: now - 30_000,
      receivedAt: now,
      session: 'REGULAR',
      delayClass: 'live',
      freshness: 'fresh',
      quality: 'complete'
    });
  });

  it('never infers fresh/live data from receipt time alone', () => {
    const result = normalizeMarketQuoteObservation({
      ...base, observedAt: null, delayClass: 'unknown'
    }, { now });
    expect(result.observation).toMatchObject({ observedAt: null, freshness: 'unknown', quality: 'partial' });
    expect(result.issues).toContain('Quote observation time is unknown; live freshness cannot be verified.');
  });

  it('marks old quotes stale and delayed quotes as delayed', () => {
    expect(normalizeMarketQuoteObservation({
      ...base, observedAt: now - 10 * 60_000
    }, { now }).observation?.freshness).toBe('stale');
    expect(normalizeMarketQuoteObservation({
      ...base, delayClass: 'DELAYED'
    }, { now }).observation?.freshness).toBe('delayed');
    expect(normalizeMarketQuoteObservation({
      ...base, observedAt: now - 10 * 60_000, delayClass: 'unknown'
    }, { now }).observation?.freshness).toBe('stale');
  });

  it('rejects impossible future observations and invalid prices/receipt times', () => {
    expect(normalizeMarketQuoteObservation({
      ...base, observedAt: now + 5 * 60_000
    }, { now }).observation).toMatchObject({ observedAt: null, freshness: 'unknown' });
    expect(normalizeMarketQuoteObservation({ ...base, price: 0 }, { now }).observation).toBeNull();
    expect(normalizeMarketQuoteObservation({ ...base, receivedAt: null }, { now }).observation).toBeNull();
  });
});

describe('normalizeMarketHistoryPoints', () => {
  it('normalizes timestamps, sorts points, and keeps the final observation for duplicate timestamps', () => {
    expect(normalizeMarketHistoryPoints([
      { timestamp: '2026-11-06T12:02:00.000Z', close: '102', volume: '4' },
      { timestamp: 1793966400, close: 101 },
      { timestamp: '2026-11-06T12:02:00.000Z', close: 103 }
    ])).toEqual({
      points: [
        { timestamp: 1793966400000, price: 101 },
        { timestamp: Date.parse('2026-11-06T12:02:00.000Z'), price: 103 }
      ],
      quality: 'complete',
      issues: []
    });
  });

  it('returns partial quality for malformed rows and bounds the output', () => {
    const result = normalizeMarketHistoryPoints([
      null,
      { time: 'invalid', close: 10 },
      { time: 1793966400, close: 100 },
      { time: 1793966460, close: 101 }
    ], { maxPoints: 1 });
    expect(result.points).toEqual([{ timestamp: 1793966460000, price: 101 }]);
    expect(result.quality).toBe('partial');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('attaches provider, instrument, currency, interval, and receipt provenance to history', () => {
    expect(normalizeMarketHistoryResponse({
      symbol: 'aapl.us',
      provider: 'yahoo',
      receivedAt: '2026-11-06T12:03:00.000Z',
      interval: '1d',
      currency: 'USD',
      assetType: 'EQUITY',
      points: [{ time: '2026-11-06T12:00:00.000Z', close: 210 }]
    })).toMatchObject({
      quality: 'complete',
      provider: 'YAHOO',
      receivedAt: Date.parse('2026-11-06T12:03:00.000Z'),
      interval: '1D',
      instrument: {
        id: 'EQUITY:US:AAPL',
        symbol: 'AAPL',
        quoteCurrency: 'USD'
      },
      points: [{ timestamp: Date.parse('2026-11-06T12:00:00.000Z'), price: 210 }]
    });
  });

  it('downgrades historical responses with missing source metadata', () => {
    const result = normalizeMarketHistoryResponse({
      symbol: 'AAPL',
      provider: '',
      receivedAt: null,
      interval: '',
      points: [{ time: 1793966400, close: 210 }]
    });
    expect(result.quality).toBe('partial');
    expect(result.provider).toBeUndefined();
    expect(result.receivedAt).toBeUndefined();
    expect(result.issues).toContain('Historical data provider is missing.');
  });

  it('reports an unavailable history when no usable points are present', () => {
    expect(normalizeMarketHistoryPoints([{ time: 1, close: 0 }])).toMatchObject({
      points: [], quality: 'unavailable'
    });
  });
});

describe('FX rate contract', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z');

  it('requires an explicit ordered currency pair and records quote units per base unit', () => {
    const result = normalizeFxRate({
      baseCurrency: 'usd',
      quoteCurrency: 'eur',
      rate: '0.92',
      provider: 'ecb',
      observedAt: now - 60_000,
      receivedAt: now
    });
    expect(result.rate).toMatchObject({
      baseCurrency: 'USD',
      quoteCurrency: 'EUR',
      direction: 'BASE_TO_QUOTE',
      rate: 0.92,
      session: null,
      quality: 'complete'
    });
    expect(isFxRateUsableForConversion(result.rate!, now)).toBe(true);
  });

  it('never auto-inverts a pair and rejects invalid or identical currencies', () => {
    expect(normalizeFxRate({
      baseCurrency: 'USD', quoteCurrency: 'USD', rate: 1, provider: 'test',
      observedAt: now, receivedAt: now
    }).rate).toBeNull();
    expect(normalizeFxRate({
      baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0, provider: 'test',
      observedAt: now, receivedAt: now
    }).rate).toBeNull();
  });

  it('preserves a provider-specific FX session without inventing one when omitted', () => {
    const withSession = normalizeFxRate({
      baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0.92,
      provider: 'test', observedAt: now, receivedAt: now, session: 'OPEN'
    }, { now }).rate;
    expect(withSession?.session).toBe('OPEN');
    const withoutSession = normalizeFxRate({
      baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0.92,
      provider: 'test', observedAt: now, receivedAt: now
    }, { now }).rate;
    expect(withoutSession?.session).toBeNull();
  });

  it('keeps timestamp-less rates visible as partial but never usable for conversion', () => {
    const result = normalizeFxRate({
      baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0.92,
      provider: 'test', receivedAt: now
    });
    expect(result.rate).toMatchObject({ quality: 'partial', observedAt: null });
    expect(isFxRateUsableForConversion(result.rate!, now)).toBe(false);
  });

  it('does not apply stale or future FX observations', () => {
    const stale = normalizeFxRate({
      baseCurrency: 'USD', quoteCurrency: 'EUR', rate: 0.92,
      provider: 'test', observedAt: now - 3 * 24 * 60 * 60_000, receivedAt: now
    }).rate!;
    expect(isFxRateUsableForConversion(stale, now)).toBe(false);
    expect(isFxRateUsableForConversion({
      ...stale, quality: 'complete', observedAt: now + 60_000
    }, now)).toBe(false);
    expect(isFxRateUsableForConversion({
      ...stale, quoteCurrency: 'USD', baseCurrency: 'USD'
    } as never, now)).toBe(false);
    expect(isFxRateUsableForConversion({
      ...stale, rate: Number.NaN
    }, now)).toBe(false);
  });
});

describe('out-of-order market observations', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z');
  const create = (observedAt: number, requestSequence: number) =>
    normalizeMarketQuoteObservation({
      symbol: 'AAPL', price: 100 + requestSequence, provider: 'test',
      observedAt, receivedAt: now, currency: 'USD', delayClass: 'LIVE', requestSequence
    }).observation!;

  it('rejects an older observation even when it arrives later', () => {
    expect(shouldAcceptMarketObservation(create(now - 30_000, 2), create(now - 60_000, 3))).toBe(false);
  });

  it('prefers a newer source observation and uses request sequence only as a tie-breaker', () => {
    expect(shouldAcceptMarketObservation(create(now - 60_000, 2), create(now - 30_000, 1))).toBe(true);
    expect(shouldAcceptMarketObservation(create(now - 30_000, 2), create(now - 30_000, 3))).toBe(true);
    expect(shouldAcceptMarketObservation(create(now - 30_000, 3), create(now - 30_000, 2))).toBe(false);
  });

  it('does not let an unknown-timestamp response overwrite a known observation', () => {
    const current = create(now - 30_000, 2);
    const candidate = normalizeMarketQuoteObservation({
      symbol: 'AAPL', price: 101, provider: 'test',
      receivedAt: now, currency: 'USD', delayClass: 'unknown', requestSequence: 3
    }).observation!;
    expect(shouldAcceptMarketObservation(current, candidate)).toBe(false);
  });
});
