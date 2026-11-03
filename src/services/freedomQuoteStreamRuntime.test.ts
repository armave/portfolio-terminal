import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFreedomQuoteStreamRuntime,
  type FreedomQuoteSocketLike
} from './freedomQuoteStreamRuntime';

class FakeSocket implements FreedomQuoteSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  private listeners = new Map<string, Array<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void): void {
    const current = this.listeners.get(type) || [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.closed = true;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(data: unknown): void {
    this.emit('message', { data: JSON.stringify(data) });
  }

  private emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

describe('Freedom persistent quote stream runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('establishes one persistent socket and forwards subsequent quote changes with the account scope', async () => {
    const sockets: FakeSocket[] = [];
    const createTicket = vi.fn(async () => ({ ticket: 'a'.repeat(64) }));
    const onQuote = vi.fn();
    const onStatus = vi.fn();
    const runtime = createFreedomQuoteStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?action=freedom-quote-socket&ticket=${ticket}`,
      createSocket: vi.fn(() => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      }),
      onQuote,
      onStatus
    });

    const start = runtime.start(['aapl', 'MSFT', 'AAPL'], 'admin:account-1');
    await Promise.resolve();
    expect(createTicket).toHaveBeenCalledWith(['AAPL', 'MSFT']);
    expect(sockets).toHaveLength(1);

    sockets[0].open();
    sockets[0].receive({ type: 'ready', symbols: ['AAPL.US', 'MSFT.US'] });
    await expect(start).resolves.toBe(true);
    expect(runtime.isConnected()).toBe(true);
    expect(onStatus).toHaveBeenCalledWith('connected', undefined);

    sockets[0].receive({
      type: 'quote',
      symbol: 'AAPL.US',
      data: { c: 'AAPL.US', ltp: 212.5, pp: 210, chg: 2.5 },
      receivedAt: 1_800_000_000_000
    });
    sockets[0].receive({
      type: 'quote',
      symbol: 'AAPL.US',
      data: { c: 'AAPL.US', ltp: 213, pp: 210, chg: 3 },
      receivedAt: 1_800_000_001_000
    });

    expect(onQuote).toHaveBeenCalledTimes(2);
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'quote',
      symbol: 'AAPL.US',
      data: expect.objectContaining({ ltp: 213 })
    }), 'admin:account-1');

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets[0].sent).toContain('ping');
    expect(runtime.isConnected()).toBe(true);
  });

  it('reconnects with a fresh one-use ticket when the server closes the socket', async () => {
    const sockets: FakeSocket[] = [];
    const createTicket = vi.fn()
      .mockResolvedValueOnce({ ticket: 'a'.repeat(64) })
      .mockResolvedValueOnce({ ticket: 'b'.repeat(64) });
    const runtime = createFreedomQuoteStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onQuote: vi.fn()
    });

    const firstStart = runtime.start(['GOOGL'], 'guest:guest-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await expect(firstStart).resolves.toBe(true);

    sockets[0].close(1012, 'upstream rotated');
    expect(runtime.isConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(createTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    sockets[1].receive({ type: 'ready' });
    await Promise.resolve();
    expect(runtime.isConnected()).toBe(true);
  });

  it('replaces the subscription when the account or ticker set changes', async () => {
    const sockets: FakeSocket[] = [];
    const createTicket = vi.fn(async () => ({ ticket: String(createTicket.mock.calls.length).padStart(64, '0') }));
    const runtime = createFreedomQuoteStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onQuote: vi.fn()
    });

    const first = runtime.start(['AAPL'], 'admin:account-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await first;

    const second = runtime.start(['AAPL', 'MSFT'], 'guest:guest-2');
    await Promise.resolve();
    expect(sockets[0].closed).toBe(true);
    expect(createTicket).toHaveBeenCalledTimes(2);
    sockets[1].open();
    sockets[1].receive({ type: 'ready' });
    await expect(second).resolves.toBe(true);
    expect(runtime.isConnected()).toBe(true);
  });

  it('stops heartbeat and reconnect attempts when stopped', async () => {
    const sockets: FakeSocket[] = [];
    const createTicket = vi.fn(async () => ({ ticket: 'c'.repeat(64) }));
    const runtime = createFreedomQuoteStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      onQuote: vi.fn()
    });

    const start = runtime.start(['GOOGL'], 'admin:account-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await start;

    runtime.stop();
    expect(sockets[0].closed).toBe(true);
    expect(runtime.isConnected()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });
});
