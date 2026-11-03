import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFreedomAccountStreamRuntime,
  type FreedomAccountSocketLike
} from './freedomAccountStreamRuntime';

class FakeSocket implements FreedomAccountSocketLike {
  readyState = 0;
  sent: string[] = [];
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

describe('Freedom persistent account stream runtime', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('opens one authenticated browser socket and forwards portfolio and orders updates', async () => {
    const sockets: FakeSocket[] = [];
    const onPortfolio = vi.fn();
    const onOrders = vi.fn();
    const createTicket = vi.fn(async () => ({ ticket: 'a'.repeat(64) }));
    const runtime = createFreedomAccountStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?action=freedom-account-socket&ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      getCurrentSessionKey: () => 'admin:account-1',
      onPortfolio,
      onOrders
    });

    const start = runtime.start('admin:account-1');
    await Promise.resolve();
    expect(createTicket).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    sockets[0].receive({ type: 'ready', events: ['portfolio', 'orders'] });
    await expect(start).resolves.toBe(true);
    expect(runtime.isConnected()).toBe(true);

    sockets[0].receive({
      type: 'portfolio',
      data: { data: { result: { ps: { loaded: true, acc: [], pos: [] } } } },
      receivedAt: 1_800_000_000_000
    });
    sockets[0].receive({
      type: 'orders',
      data: { data: { orders: { order: [] }, trades: { trade: [] } } },
      receivedAt: 1_800_000_001_000
    });
    expect(onPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.any(Object) }),
      'admin:account-1',
      1_800_000_000_000
    );
    expect(onOrders).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.any(Object) }),
      'admin:account-1',
      1_800_000_001_000
    );

    await vi.advanceTimersByTimeAsync(20_000);
    expect(sockets[0].sent).toContain('ping');
    expect(runtime.isConnected()).toBe(true);
  });

  it('does not forward data after the authenticated account identity changes', async () => {
    const sockets: FakeSocket[] = [];
    let currentSessionKey = 'admin:account-1';
    const onPortfolio = vi.fn();
    const runtime = createFreedomAccountStreamRuntime({
      createTicket: async () => ({ ticket: 'b'.repeat(64) }),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      getCurrentSessionKey: () => currentSessionKey,
      onPortfolio,
      onOrders: vi.fn()
    });
    const start = runtime.start('admin:account-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await start;

    currentSessionKey = 'admin:account-2';
    sockets[0].receive({ type: 'portfolio', data: { loaded: true, positions: [] } });
    expect(onPortfolio).not.toHaveBeenCalled();
  });

  it('reconnects with a fresh ticket after an upstream stream error', async () => {
    const sockets: FakeSocket[] = [];
    const createTicket = vi.fn()
      .mockResolvedValueOnce({ ticket: 'h'.repeat(64) })
      .mockResolvedValueOnce({ ticket: 'i'.repeat(64) });
    const runtime = createFreedomAccountStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      getCurrentSessionKey: () => 'admin:account-1',
      onPortfolio: vi.fn(),
      onOrders: vi.fn()
    });

    const start = runtime.start('admin:account-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await expect(start).resolves.toBe(true);

    sockets[0].receive({ type: 'error', message: 'Upstream session rejected' });
    expect(sockets[0].readyState).toBe(3);
    expect(runtime.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(createTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].receive({ type: 'ready' });
    expect(runtime.isConnected()).toBe(true);
    runtime.stop();
  });

  it('closes a half-open socket when the heartbeat pong stops arriving', async () => {
    const sockets: FakeSocket[] = [];
    const statuses: Array<[string, string?]> = [];
    const runtime = createFreedomAccountStreamRuntime({
      createTicket: async () => ({ ticket: 'g'.repeat(64) }),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      getCurrentSessionKey: () => 'admin:account-1',
      onPortfolio: vi.fn(),
      onOrders: vi.fn(),
      onStatus: (status, message) => statuses.push([status, message])
    });
    const start = runtime.start('admin:account-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await expect(start).resolves.toBe(true);

    await vi.advanceTimersByTimeAsync(45_000);

    expect(sockets[0].readyState).toBe(3);
    expect(runtime.isConnected()).toBe(false);
    expect(statuses).toContainEqual([
      'disconnected',
      'TradeNet account stream heartbeat timed out.'
    ]);
    runtime.stop();
  });

  it('reconnects with a new one-use ticket after the browser socket closes', async () => {
    const sockets: FakeSocket[] = [];
    const createTicket = vi.fn()
      .mockResolvedValueOnce({ ticket: 'c'.repeat(64) })
      .mockResolvedValueOnce({ ticket: 'd'.repeat(64) });
    const runtime = createFreedomAccountStreamRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      getCurrentSessionKey: () => 'admin:account-1',
      onPortfolio: vi.fn(),
      onOrders: vi.fn()
    });
    const start = runtime.start('admin:account-1');
    await Promise.resolve();
    sockets[0].open();
    sockets[0].receive({ type: 'ready' });
    await start;
    sockets[0].close(1006, 'network');
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.resolve();
    expect(createTicket).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    sockets[1].receive({ type: 'ready' });
    expect(runtime.isConnected()).toBe(true);
  });
});
