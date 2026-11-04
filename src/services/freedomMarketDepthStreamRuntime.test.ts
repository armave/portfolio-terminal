import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFreedomMarketDepthStreamRuntime,
  type FreedomMarketDepthSocketLike
} from './freedomMarketDepthStreamRuntime';

class FakeSocket implements FreedomMarketDepthSocketLike {
  readyState = 0;
  sent: string[] = [];
  closeCalls: Array<[number | undefined, string | undefined]> = [];
  private listeners = new Map<string, Array<(event: any) => void>>();

  addEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push([code, reason]);
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(message: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  remoteClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

describe('modal-scoped TradeNet Market Depth stream runtime', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('opens a ticketed socket, forwards live book updates, and closes on stop', async () => {
    const socket = new FakeSocket();
    const onDepth = vi.fn();
    const onStatus = vi.fn();
    const createTicket = vi.fn(async (ticker: string) => ({
      ticket: 'a'.repeat(64),
      symbol: `${ticker}.US`
    }));
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket,
      buildSocketUrl: ticket => `wss://worker.test/?ticket=${ticket}`,
      createSocket: vi.fn(() => socket),
      onDepth,
      onStatus
    });

    const connecting = runtime.start('GOOGL', 'admin:account-1');
    await Promise.resolve();
    expect(createTicket).toHaveBeenCalledWith('GOOGL');
    socket.open();
    socket.receive({ type: 'ready', symbol: 'GOOGL.US' });
    await expect(connecting).resolves.toBe(true);
    expect(runtime.isConnected()).toBe(true);

    const data = {
      symbol: 'GOOGL.US',
      bids: [{ position: 0, price: 287.72, quantity: 10 }],
      asks: [{ position: 0, price: 287.79, quantity: 20 }]
    };
    socket.receive({ type: 'depth', symbol: 'GOOGL.US', data, updatedAt: 123 });
    expect(onDepth).toHaveBeenCalledWith('GOOGL.US', data, 123, 'admin:account-1');

    runtime.stop();
    expect(socket.closeCalls).toContainEqual([1000, 'Market Depth modal closed']);
    expect(runtime.isConnected()).toBe(false);
  });

  it('rejects depth updates without a valid timestamp rather than substituting the browser clock', async () => {
    const socket = new FakeSocket();
    const onDepth = vi.fn();
    const onStatus = vi.fn();
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket: async () => ({ ticket: 'd'.repeat(64), symbol: 'AAPL.US' }),
      buildSocketUrl: ticket => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => socket,
      onDepth,
      onStatus
    });

    const connecting = runtime.start('AAPL', 'admin:account-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready', symbol: 'AAPL.US' });
    await expect(connecting).resolves.toBe(true);
    socket.receive({ type: 'depth', symbol: 'AAPL.US', data: { bids: [], asks: [] } });

    expect(onDepth).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('error', expect.stringContaining('valid update timestamp'));
    expect(socket.closeCalls).toContainEqual([1008, 'Invalid Market Depth timestamp']);
  });

  it('preserves the Worker error frame when the following socket close event has no reason', async () => {
    const socket = new FakeSocket();
    const onStatus = vi.fn();
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket: async () => ({ ticket: 'e'.repeat(64), symbol: 'GOOGL.US' }),
      buildSocketUrl: ticket => \`wss://worker.test/?ticket=\${ticket}\`,
      createSocket: () => socket,
      onDepth: vi.fn(),
      onStatus
    });

    const connecting = runtime.start('GOOGL', 'admin:account-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready', symbol: 'GOOGL.US' });
    await expect(connecting).resolves.toBe(true);

    const message = 'TradeNet Market Depth deletion referenced a missing book position.';
    socket.receive({ type: 'error', message });

    expect(onStatus).toHaveBeenLastCalledWith('error', message);
    expect(onStatus.mock.calls.some(([status]) => status === 'disconnected')).toBe(false);
    expect(socket.closeCalls).toContainEqual([1011, 'Market Depth stream error']);
    expect(runtime.isConnected()).toBe(false);
  });

  it('includes the remote WebSocket close code and reason in unexplained disconnects', async () => {
    const socket = new FakeSocket();
    const onStatus = vi.fn();
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket: async () => ({ ticket: 'f'.repeat(64), symbol: 'GOOGL.US' }),
      buildSocketUrl: ticket => \`wss://worker.test/?ticket=\${ticket}\`,
      createSocket: () => socket,
      onDepth: vi.fn(),
      onStatus
    });

    const connecting = runtime.start('GOOGL', 'admin:account-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready', symbol: 'GOOGL.US' });
    await expect(connecting).resolves.toBe(true);

    socket.readyState = 3;
    socket['emitForTest']?.('close', { code: 1006, reason: 'upstream closed' });
  });

  it('includes the remote WebSocket close code and reason in unexplained disconnects', async () => {
    const socket = new FakeSocket();
    const onStatus = vi.fn();
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket: async () => ({ ticket: 'f'.repeat(64), symbol: 'GOOGL.US' }),
      buildSocketUrl: ticket => \`wss://worker.test/?ticket=\${ticket}\`,
      createSocket: () => socket,
      onDepth: vi.fn(),
      onStatus
    });

    const connecting = runtime.start('GOOGL', 'admin:account-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready', symbol: 'GOOGL.US' });
    await expect(connecting).resolves.toBe(true);

    socket.remoteClose(1006, 'upstream closed');
    expect(onStatus).toHaveBeenLastCalledWith(
      'disconnected',
      'TradeNet Market Depth stream closed (code 1006): upstream closed'
    );
  });

  it('does not open a stale socket after the modal closes while requesting a ticket', async () => {
    let resolveTicket: ((value: { ticket: string; symbol: string }) => void) | undefined;
    const createTicket = vi.fn(() => new Promise<{ ticket: string; symbol: string }>((resolve) => {
      resolveTicket = resolve;
    }));
    const createSocket = vi.fn(() => new FakeSocket());
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket,
      buildSocketUrl: ticket => `wss://worker.test/?ticket=${ticket}`,
      createSocket,
      onDepth: vi.fn()
    });

    const connecting = runtime.start('AAPL', 'admin:account-1');
    runtime.stop();
    resolveTicket?.({ ticket: 'b'.repeat(64), symbol: 'AAPL.US' });

    await expect(connecting).resolves.toBe(false);
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('rejects an unexpected ticker from the Worker before reporting a connection', async () => {
    const socket = new FakeSocket();
    const onStatus = vi.fn();
    const runtime = createFreedomMarketDepthStreamRuntime({
      createTicket: async () => ({ ticket: 'c'.repeat(64), symbol: 'AAPL.US' }),
      buildSocketUrl: ticket => `wss://worker.test/?ticket=${ticket}`,
      createSocket: () => socket,
      onDepth: vi.fn(),
      onStatus
    });

    const connecting = runtime.start('AAPL', 'admin:account-1');
    await Promise.resolve();
    socket.open();
    socket.receive({ type: 'ready', symbol: 'MSFT.US' });

    await expect(connecting).resolves.toBe(false);
    expect(onStatus).toHaveBeenCalledWith('error', expect.stringContaining('unexpected ticker'));
    runtime.stop();
  });
});
