import { describe, expect, it, vi } from 'vitest';
import { createFreedomQuoteStreamAppRuntime } from './freedomQuoteStreamAppRuntime';
import type { FreedomQuoteSocketLike } from './freedomQuoteStreamRuntime';

class FakeSocket implements FreedomQuoteSocketLike {
  readyState = 0;
  private listeners = new Map<string, Array<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) });
  }

  private emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

describe('Freedom quote stream app adapter', () => {
  it('applies every accepted q update to the current portfolio session without persistence', async () => {
    const recordQuote = vi.fn().mockReturnValue(true);
    const renderAfterUpdate = vi.fn();
    const socket = new FakeSocket();
    let currentSessionKey = 'admin:account-1';
    let requestSequence = 122;
    const runtime = createFreedomQuoteStreamAppRuntime({
      createTicket: vi.fn(async () => ({ ticket: 'a'.repeat(64) })),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => socket,
      getCurrentSessionKey: () => currentSessionKey,
      nextRequestSequence: () => ++requestSequence,
      recordQuote,
      renderAfterUpdate
    });

    const start = runtime.start(['GOOGL'], 'admin:account-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready' });
    await expect(start).resolves.toBe(true);
    expect(runtime.isConnected()).toBe(true);

    socket.receive({
      type: 'quote',
      symbol: 'GOOGL.US',
      data: {
        c: 'GOOGL.US',
        ltp: 280.55,
        pp: 279.84,
        chg: 0.71,
        pcp: 0.25,
        bbp: 280.51,
        bap: 280.6,
        vol: 123456,
        ltt: '2026-11-03T10:00:00',
        UTCOffset: -300,
        owner_login: 'must-not-forward'
      },
      receivedAt: 1_800_000_000_000
    });

    expect(recordQuote).toHaveBeenCalledTimes(1);
    expect(recordQuote).toHaveBeenCalledWith(
      'GOOGL',
      280.55,
      'Freedom TradeNet',
      1_800_000_000_000,
      expect.objectContaining({
        transport: 'websocket',
        price: 280.55,
        bid: 280.51,
        ask: 280.6,
        freshness: 'unknown',
        requestSequence: 123
      }),
      1_800_000_000_000
    );
    expect(renderAfterUpdate).toHaveBeenCalledTimes(1);

    // Every subsequent q message for the same ticker must be forwarded as a
    // new local overwrite, even if the provider's ltt timestamp moves backward.
    socket.receive({
      type: 'quote',
      symbol: 'GOOGL.US',
      data: {
        c: 'GOOGL.US',
        ltp: 281.25,
        pp: 279.84,
        chg: 1.41,
        pcp: 0.50,
        bbp: 281.2,
        bap: 281.3,
        vol: 123999,
        ltt: '2026-11-03T09:59:00',
        UTCOffset: -300
      },
      receivedAt: 1_800_000_001_000
    });

    expect(recordQuote).toHaveBeenCalledTimes(2);
    expect(recordQuote).toHaveBeenNthCalledWith(
      2,
      'GOOGL',
      281.25,
      'Freedom TradeNet',
      1_800_000_001_000,
      expect.objectContaining({
        transport: 'websocket',
        price: 281.25,
        bid: 281.2,
        ask: 281.3,
        requestSequence: 124
      }),
      1_800_000_001_000
    );
    expect(renderAfterUpdate).toHaveBeenCalledTimes(2);

    currentSessionKey = 'guest:guest-2';
    socket.receive({
      type: 'quote',
      symbol: 'GOOGL.US',
      data: { c: 'GOOGL.US', ltp: 281 },
      receivedAt: 1_800_000_001_000
    });
    expect(recordQuote).toHaveBeenCalledTimes(2);
    expect(renderAfterUpdate).toHaveBeenCalledTimes(2);

    runtime.stop();
  });

  it('does not persist a quote rejected by the canonical portfolio store', async () => {
    const recordQuote = vi.fn().mockReturnValue(false);
    const renderAfterUpdate = vi.fn();
    const socket = new FakeSocket();
    const runtime = createFreedomQuoteStreamAppRuntime({
      createTicket: vi.fn(async () => ({ ticket: 'b'.repeat(64) })),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => socket,
      getCurrentSessionKey: () => 'guest:guest-1',
      nextRequestSequence: () => 456,
      recordQuote,
      renderAfterUpdate
    });

    const start = runtime.start(['AAPL'], 'guest:guest-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready' });
    await start;
    socket.receive({
      type: 'quote',
      symbol: 'AAPL.US',
      data: { c: 'AAPL.US', ltp: 210 },
      receivedAt: 1_800_000_000_000
    });

    expect(recordQuote).toHaveBeenCalledTimes(1);
    expect(renderAfterUpdate).not.toHaveBeenCalled();
    runtime.stop();
  });
});
