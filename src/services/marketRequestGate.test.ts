import { describe, expect, it } from 'vitest';
import { getUsEquityMarketSession } from './marketSession';
import { createMarketRequestGate } from './marketRequestGate';

describe('US equity market session', () => {
  it('distinguishes premarket, regular, postmarket and fully closed time in New York', () => {
    expect(getUsEquityMarketSession(new Date('2026-10-30T12:00:00.000Z'))).toBe('PRE');
    expect(getUsEquityMarketSession(new Date('2026-10-30T13:30:00.000Z'))).toBe('REGULAR');
    expect(getUsEquityMarketSession(new Date('2026-10-30T20:00:00.000Z'))).toBe('POST');
    expect(getUsEquityMarketSession(new Date('2026-10-31T02:00:00.000Z'))).toBe('CLOSED');
    expect(getUsEquityMarketSession(new Date('2026-10-30T00:00:00.000Z'))).toBe('CLOSED');
  });

  it('recognizes full market holidays and the postmarket after the Thanksgiving early close', () => {
    expect(getUsEquityMarketSession(new Date('2026-11-26T16:00:00.000Z'))).toBe('CLOSED');
    expect(getUsEquityMarketSession(new Date('2026-11-27T18:00:00.000Z'))).toBe('POST');
    expect(getUsEquityMarketSession(new Date('2026-11-27T22:30:00.000Z'))).toBe('CLOSED');
  });
});

describe('app-wide closed-market request budget', () => {
  it('allows one request per cooldown while fully closed and blocks concurrent/additional requests', async () => {
    let clock = 1_000_000;
    const gate = createMarketRequestGate({ now: () => clock, getSession: () => 'CLOSED', cooldownMs: 60_000 });
    let release!: () => void;
    const pending = gate(() => new Promise<void>(resolve => { release = resolve; }));
    await expect(gate(async () => 'second')).rejects.toThrow(/request limit/i);
    release();
    await pending;
    await expect(gate(async () => 'third')).rejects.toThrow(/request limit/i);
    clock += 60_000;
    await expect(gate(async () => 'fourth')).resolves.toBe('fourth');
  });

  it('does not throttle premarket, regular or postmarket requests', async () => {
    let session: 'CLOSED' | 'PRE' = 'CLOSED';
    const gate = createMarketRequestGate({ getSession: () => session, now: () => 100, cooldownMs: 60_000 });
    await gate(async () => undefined);
    session = 'PRE';
    await expect(gate(async () => 'pre')).resolves.toBe('pre');
    session = 'CLOSED';
    await expect(gate(async () => 'closed-blocked')).rejects.toThrow();
    session = 'PRE';
    await expect(gate(async () => 'pre-again')).resolves.toBe('pre-again');
  });
});
