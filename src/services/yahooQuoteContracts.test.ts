import { describe, expect, it } from 'vitest';
import { normalizeYahooBatchResults } from './yahooQuoteContracts';

describe('Yahoo quote response contracts', () => {
  it('normalizes provider symbols while preserving untrusted quote leaves for domain validation', () => {
    const results = normalizeYahooBatchResults([
      {
        symbol: ' aapl ',
        price: {
          current: '210.5',
          previousClose: 205,
          regularMarketTime: 1793450000,
          marketState: 'REGULAR'
        }
      },
      { symbol: 'MSFT', error: 'temporarily unavailable' }
    ], ['AAPL', 'MSFT']);

    expect(results).toEqual([
      {
        symbol: 'AAPL',
        price: {
          current: '210.5',
          previousClose: 205,
          regularMarketTime: 1793450000,
          marketState: 'REGULAR'
        }
      },
      { symbol: 'MSFT', error: 'temporarily unavailable' }
    ]);
  });

  it('wraps a single symbol response and normalizes its symbol', () => {
    expect(normalizeYahooBatchResults({
      symbol: 'aapl',
      price: { current: 100 }
    }, ['AAPL'])).toEqual([
      { symbol: 'AAPL', price: { current: 100 } }
    ]);
  });

  it('creates per-symbol fallback entries when the batch request fails', () => {
    expect(normalizeYahooBatchResults(null, ['AAPL', 'MSFT'])).toEqual([
      { symbol: 'AAPL', error: 'Yahoo batch request failed' },
      { symbol: 'MSFT', error: 'Yahoo batch request failed' }
    ]);
  });

  it('adds a fallback entry for each requested symbol omitted by a partial response', () => {
    expect(normalizeYahooBatchResults([
      { symbol: 'AAPL', price: { current: 100 } }
    ], ['AAPL', 'MSFT', 'NVDA'])).toEqual([
      { symbol: 'AAPL', price: { current: 100 } },
      { symbol: 'MSFT', error: 'Yahoo batch response omitted this symbol.' },
      { symbol: 'NVDA', error: 'Yahoo batch response omitted this symbol.' }
    ]);
  });

  it('rejects malformed records safely and requests fallback for their missing symbols', () => {
    expect(normalizeYahooBatchResults([
      null,
      'not-a-record',
      { symbol: 42, price: { current: 100 } },
      { price: { current: 200 } },
      { symbol: 'AAPL', price: 'invalid' }
    ], ['AAPL', 'MSFT'])).toEqual([
      { symbol: 'AAPL', error: 'Yahoo returned a malformed quote payload.' },
      { symbol: 'MSFT', error: 'Yahoo batch response omitted this symbol.' }
    ]);
  });

  it('deduplicates duplicate provider symbols rather than applying them twice', () => {
    expect(normalizeYahooBatchResults([
      { symbol: 'AAPL', price: { current: 100 } },
      { symbol: 'aapl', price: { current: 101 } }
    ], ['AAPL'])).toEqual([
      { symbol: 'AAPL', price: { current: 100 } }
    ]);
  });

  it('retains unexpected provider symbols for diagnostics without attributing them to requested symbols', () => {
    expect(normalizeYahooBatchResults([
      { symbol: 'OTHER', price: { current: 999 } }
    ], ['AAPL'])).toEqual([
      { symbol: 'OTHER', price: { current: 999 } },
      { symbol: 'AAPL', error: 'Yahoo batch response omitted this symbol.' }
    ]);
  });

  it('uses a sanitized generic message for non-string provider error values', () => {
    expect(normalizeYahooBatchResults([
      { symbol: 'AAPL', error: { detail: 'provider failure' } }
    ], ['AAPL'])).toEqual([
      { symbol: 'AAPL', error: 'Yahoo returned no usable quote payload.' }
    ]);
  });
});
