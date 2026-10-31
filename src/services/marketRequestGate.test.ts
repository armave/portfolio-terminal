import { describe, expect, it, vi } from 'vitest';
import { getUsEquityMarketSession, getUsEquityMarketSessionKey } from './marketSession';
import { createMarketRequestGate } from './marketRequestGate';

describe('US equity market session', () => {
  it('distinguishes premarket, regular, postmarket and fully closed time in New York', () => {
    expect(getUsEquityMarketSession(new Date('2026-10-30T12:00:00.000Z'))).toBe('PRE');
    expect(getUsEquityMarketSession(new Date('2026-10-30T13:30:00.000Z'))).toBe('REGULAR');
    expect(getUsEquityMarketSession(new Date('2026-10-30T20:00:00.000Z'))).toBe('POST');
    expect(getUsEquityMarketSession(new Date('2026-10-31T02:00:00.000Z'))).toBe('CLOSED');
    expect(getUsEquityMarketSession(new Date('2026-10-30T00:00:00.000Z'))).toBe('CLOSED');
  });

  it('recognizes full holidays and recognized early closes', () => {
    expect(getUsEquityMarketSession(new Date('2026-11-26T16:00:00.000Z'))).toBe('CLOSED');
    expect(getUsEquityMarketSession(new Date('2026-11-27T18:00:00.000Z'))).toBe('POST');
    expect(getUsEquityMarketSession(new Date('2026-11-27T22:30:00.000Z'))).toBe('CLOSED');
    expect(getUsEquityMarketSession(new Date('2027-07-02T18:00:00.000Z'))).toBe('POST');
  });

  it('uses one closed-session identity from Friday night through the next premarket', () => {
    expect(getUsEquityMarketSessionKey(new Date('2026-10-31T02:00:00.000Z'))).toBe('2026-11-02:CLOSED');
    expect(getUsEquityMarketSessionKey(new Date('2026-10-31T15:00:00.000Z'))).toBe('2026-11-02:CLOSED');
    expect(getUsEquityMarketSessionKey(new Date('2026-11-02T07:00:00.000Z'))).toBe('2026-11-02:CLOSED');
    expect(getUsEquityMarketSessionKey(new Date('2026-11-02T09:00:00.000Z'))).toBe('2026-11-02:PRE');
  });
});

describe('successful market request deduplication while closed', () => {
  const closed = { getSession: () => 'CLOSED' as const, getSessionKey: () => '2026-10-31:CLOSED' };

  it('reuses only exact successful requests and allows different symbols/endpoints', async () => {
    const gate = createMarketRequestGate(closed);
    const aapl = vi.fn(async () => ({ analystTarget: 200 }));
    const msft = vi.fn(async () => ({ price: 450 }));
    await expect(gate('deep-data:AAPL', aapl)).resolves.toEqual({ analystTarget: 200 });
    await expect(gate('deep-data:AAPL', aapl)).resolves.toEqual({ analystTarget: 200 });
    await expect(gate('quote:MSFT', msft)).resolves.toEqual({ price: 450 });
    expect(aapl).toHaveBeenCalledTimes(1);
    expect(msft).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical requests and retains their successful result', async () => {
    const gate = createMarketRequestGate(closed);
    let release!: (value: { analystTarget: number }) => void;
    const request = vi.fn(() => new Promise<{ analystTarget: number }>(resolve => { release = resolve; }));
    const first = gate('deep-data:AAPL', request);
    const second = gate('deep-data:AAPL', request);
    release({ analystTarget: 205 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { analystTarget: 205 }, { analystTarget: 205 }
    ]);
    await expect(gate('deep-data:AAPL', request)).resolves.toEqual({ analystTarget: 205 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not cache request failures or provider error payloads', async () => {
    const gate = createMarketRequestGate(closed);
    const rejected = vi.fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ analystTarget: 210 });
    await expect(gate('deep-data:AAPL', rejected)).rejects.toThrow('temporary network failure');
    await expect(gate('deep-data:AAPL', rejected)).resolves.toEqual({ analystTarget: 210 });
    await expect(gate('deep-data:AAPL', rejected)).resolves.toEqual({ analystTarget: 210 });
    expect(rejected).toHaveBeenCalledTimes(2);

    const providerError = vi.fn(async () => ({ symbol: 'BAD', error: 'Yahoo unavailable' }));
    await gate('deep-data:BAD', providerError);
    await gate('deep-data:BAD', providerError);
    expect(providerError).toHaveBeenCalledTimes(2);
  });

  it('expires successful results when the closed session changes', async () => {
    let sessionKey = '2026-10-31:CLOSED';
    const gate = createMarketRequestGate({
      getSession: () => 'CLOSED',
      getSessionKey: () => sessionKey
    });
    const request = vi.fn(async () => ({ analystTarget: 220 }));
    await gate('deep-data:AAPL', request);
    await gate('deep-data:AAPL', request);
    sessionKey = '2026-11-02:CLOSED';
    await gate('deep-data:AAPL', request);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never restricts premarket, regular or postmarket requests', async () => {
    let session: 'PRE' | 'REGULAR' | 'POST' = 'PRE';
    const gate = createMarketRequestGate({ getSession: () => session });
    const request = vi.fn(async () => ({ price: 100 }));
    await gate('quote:AAPL', request);
    await gate('quote:AAPL', request);
    session = 'REGULAR';
    await gate('quote:AAPL', request);
    session = 'POST';
    await gate('quote:AAPL', request);
    expect(request).toHaveBeenCalledTimes(4);
  });
});
