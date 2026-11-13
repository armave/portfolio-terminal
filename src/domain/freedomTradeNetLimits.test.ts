import { describe, expect, it } from 'vitest';
import { resolveTradeNetProbeInstrument } from './freedomTradeNetLimits';

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
