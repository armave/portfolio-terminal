import { describe, expect, it } from 'vitest';
import { getTradeNetProbeFailureMessage, resolveTradeNetProbeInstrument } from './freedomTradeNetLimits';

describe('TradeNet probe instrument selection', () => {
  it('uses the position instr_id and never substitutes the quote serial n', () => {
    expect(resolveTradeNetProbeInstrument({
      OPQ: {
        ps: { pos: [{ i: 'GOOGL.US', curr: 'USD', q: 106, instr_id: 40000019798 }] },
        quotes: { q: [{ c: 'GOOGL.US', n: 6161 }] }
      }
    })).toEqual({ ticker: 'GOOGL.US', instrumentId: 40000019798 });
  });

  it('skips non-USD, non-US, and malformed instrument rows', () => {
    expect(resolveTradeNetProbeInstrument({
      OPQ: {
        ps: { pos: [
          { i: 'AAPL.US', curr: 'EUR', instr_id: 2388 },
          { i: 'DAX.IDX', curr: 'USD', instr_id: 123 },
          { i: 'MSFT.US', curr: 'USD', instr_id: 'not-an-id' }
        ] }
      }
    })).toBeNull();
  });

  it('does not invent an instrument ID from ticker or quote metadata', () => {
    expect(resolveTradeNetProbeInstrument({
      OPQ: { ps: { pos: [{ i: 'AAPL.US', curr: 'USD', q: 1 }] }, quotes: { q: [{ c: 'AAPL.US', n: 2388 }] } }
    })).toBeNull();
  });
});

 
describe('TradeNet probe failure classification', () => {
  it('reports HTTP 400 as a rejected candidate request without guessing which parameter part is wrong', () => {
    expect(getTradeNetProbeFailureMessage({
      ok: false,
      source: 'getTradingLimits',
      requestParameters: { instrument_id: 12345 },
      providerHttpStatus: 400,
      providerError: 'TradeNet returned HTTP 400: Incorrect request parameters.'
    }, 'TEST.US')).toBe(
      'TradeNet rejected the candidate getTradingLimits request with HTTP 400. The response does not identify whether the parameter name or value is invalid; broker limits remain unverified.'
    );
  });

  it('preserves a safe provider diagnostic for other failures', () => {
    expect(getTradeNetProbeFailureMessage({
      ok: false,
      source: 'getTradingLimits',
      providerError: 'Rate limited.'
    }, 'TEST.US')).toBe('TradeNet getTradingLimits for TEST.US: Rate limited.');
  });

  it('does not classify a successful response as a probe failure', () => {
    expect(getTradeNetProbeFailureMessage({
      ok: true,
      source: 'getTradingLimits',
      data: { opaque: true }
    }, 'TEST.US')).toBeNull();
  });

  it('does not present an unrelated response as a getTradingLimits result', () => {
    expect(getTradeNetProbeFailureMessage({ ok: false, source: 'getOPQ' }, 'TEST.US'))
      .toBe('TradeNet trading-limits probe returned an invalid response.');
  });
});
