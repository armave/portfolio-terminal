import { describe, expect, it, vi } from 'vitest';
import {
  createFreedomQuoteStreamAppRuntime,
  type FreedomQuoteSocketLike
} from './freedomQuoteStreamAppRuntime';

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
  it('applies every accepted q update to the current portfolio session and persists the new price', async () => {
    const recordQuote = vi.fn().mockReturnValue(true);
    const persistAndRender = vi.fn();
    const socket = new FakeSocket();
    let currentSessionKey = 'admin:account-1';
    const runtime = createFreedomQuoteStreamAppRuntime({
      createTicket: vi.fn(async () => ({ ticket: 'a'.repeat(64) })),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => socket,
      getCurrentSessionKey: () => currentSessionKey,
      nextRequestSequence: () => 123,
      recordQuote,
      persistAndRender
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
    expect(persistAndRender).toHaveBeenCalledTimes(1);

    currentSessionKey = 'guest:guest-2';
    socket.receive({
      type: 'quote',
      symbol: 'GOOGL.US',
      data: { c: 'GOOGL.US', ltp: 281 },
      receivedAt: 1_800_000_001_000
    });
    expect(recordQuote).toHaveBeenCalledTimes(1);
    expect(persistAndRender).toHaveBeenCalledTimes(1);

    runtime.stop();
  });

  it('does not persist a quote rejected by the canonical portfolio store', async () => {
    const recordQuote = vi.fn().mockReturnValue(false);
    const persistAndRender = vi.fn();
    const socket = new FakeSocket();
    const runtime = createFreedomQuoteStreamAppRuntime({
      createTicket: vi.fn(async () => ({ ticket: 'b'.repeat(64) })),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => socket,
      getCurrentSessionKey: () => 'guest:guest-1',
      nextRequestSequence: () => 456,
      recordQuote,
      persistAndRender
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
    expect(persistAndRender).not.toHaveBeenCalled();
    runtime.stop();
  });
});
