import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBrokerEventListener } from './brokerEventBus';
import { createFreedomAccountStreamAppRuntime } from './freedomAccountStreamAppRuntime';
import {
  isFreedomAccountStreamHealthy,
  resetFreedomAccountStreamHealth
} from './freedomAccountStreamHealth';

class FakeWebSocket {
  static latest: FakeWebSocket | null = null;
  readyState = 0;
  private listeners = new Map<string, Array<(event: any) => void>>();

  constructor(_url: string) {
    FakeWebSocket.latest = this;
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const handlers = this.listeners.get(type) || [];
    handlers.push(listener);
    this.listeners.set(type, handlers);
  }

  send(_data: string): void {}

  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }

  open(): void {
    this.readyState = 1;
    this.emit('open', {});
  }

  receive(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }
}

describe('Freedom account stream app adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWebSocket.latest = null;
    resetFreedomAccountStreamHealth();
  });

  it('routes normalized portfolio, orders and deduplicated fills into broker events', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const portfolioEvents: unknown[] = [];
    const orderEvents: unknown[] = [];
    let brokerExecutions: any[] = [];
    const offPortfolio = addBrokerEventListener('broker:account-info', (value) => portfolioEvents.push(value));
    const offOrders = addBrokerEventListener('broker:active-orders', (value) => orderEvents.push(value));
    const offTrades = addBrokerEventListener('broker:executed-trades', (value) => { brokerExecutions = value; });
    const runtime = createFreedomAccountStreamAppRuntime({
      createTicket: async () => ({ ticket: 'e'.repeat(64) }),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      getCurrentSessionKey: () => 'admin:account-1',
      isAdmin: () => true,
      loadSavedBrokerExecutions: () => [],
      getCurrentBrokerExecutions: () => brokerExecutions
    });

    try {
      const start = runtime.start('admin:account-1');
      await Promise.resolve();
      const socket = FakeWebSocket.latest;
      expect(socket).not.toBeNull();
      socket!.open();
      socket!.receive({ type: 'ready' });
      await expect(start).resolves.toBe(true);

      socket!.receive({
        type: 'portfolio',
        receivedAt: 1_800_000_000_000,
        data: {
          data: { result: { ps: {
            loaded: true,
            acc: [{ curr: 'USD', s: 9000, currval: 9000 }],
            pos: [{ curr: 'USD', i: 'GOOGL.US', name: 'Alphabet', q: 50, mkt_price: 294, market_value: 14700, bal_price_a: 337.7 }]
          } } }
        }
      });
      expect(portfolioEvents).toHaveLength(1);
      expect(portfolioEvents[0]).toMatchObject({
        loaded: true,
        balances: [{ currency: 'USD', amount: 9000 }],
        positions: [{ ticker: 'GOOGL.US', quantity: 50, marketPrice: 294 }]
      });

      const orders = {
        data: {
          orders: { order: [{
            order_id: 'order-1', instr: 'GOOGL.US', oper: 2, type: 2,
            p: 353, q: 10, leaves_qty: 10, stat: 10
          }] },
          trades: { trade: [{
            id: 'fill-1', order_id: 'order-1', instr: 'GOOGL.US',
            side: 'BUY', curr: 'USD', date: '2026-11-03T10:00:00',
            p: 352.5, q: 2, v: 705, profit: 0, acd: 0, fv: 1, go_sum: 100
          }] }
        }
      };
      socket!.receive({ type: 'orders', data: orders, receivedAt: 1_800_000_001_000 });
      expect(orderEvents).toHaveLength(1);
      expect(orderEvents[0]).toMatchObject([{
        id: 'order-1', ticker: 'GOOGL.US', operation: 2, limitPrice: 353
      }]);
      expect(brokerExecutions).toHaveLength(1);
      expect(brokerExecutions[0]).toMatchObject({
        id: 'fill-1', ticker: 'GOOGL.US', side: 'BUY', quantity: 2, price: 352.5
      });
      expect(isFreedomAccountStreamHealthy('admin:account-1')).toBe(true);

      socket!.receive({ type: 'orders', data: orders, receivedAt: 1_800_000_002_000 });
      expect(brokerExecutions).toHaveLength(1);
    } finally {
      runtime.stop();
      offPortfolio();
      offOrders();
      offTrades();
    }
  });

  it('rejects a partial live portfolio snapshot without marking the stream snapshot current', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const portfolioEvents: unknown[] = [];
    const accountErrors: unknown[] = [];
    const offPortfolio = addBrokerEventListener('broker:account-info', (value) => portfolioEvents.push(value));
    const offError = addBrokerEventListener('broker:account-info-error', (value) => accountErrors.push(value));
    const runtime = createFreedomAccountStreamAppRuntime({
      createTicket: async () => ({ ticket: 'g'.repeat(64) }),
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      getCurrentSessionKey: () => 'admin:account-1',
      isAdmin: () => true,
      loadSavedBrokerExecutions: () => [],
      getCurrentBrokerExecutions: () => []
    });

    try {
      const start = runtime.start('admin:account-1');
      await Promise.resolve();
      const socket = FakeWebSocket.latest;
      expect(socket).not.toBeNull();
      socket!.open();
      socket!.receive({ type: 'ready' });
      await expect(start).resolves.toBe(true);

      socket!.receive({
        type: 'portfolio',
        receivedAt: 1_800_000_003_000,
        data: {
          data: { result: { ps: {
            loaded: true,
            acc: [{ curr: 'USD', s: true, currval: false }],
            pos: [{ curr: 'USD', i: 'AAPL.US', q: 2, mkt_price: 190 }]
          } } }
        }
      });

      expect(portfolioEvents).toEqual([]);
      expect(accountErrors).toHaveLength(1);
      expect(accountErrors[0]).toMatchObject({
        provider: 'freedom-tradenet',
        quality: 'partial',
        source: 'websocket',
        receivedAt: 1_800_000_003_000,
        warnings: expect.arrayContaining([
          'TradeNet USD balance row without a valid amount was excluded.'
        ])
      });
      expect(isFreedomAccountStreamHealthy('admin:account-1')).toBe(false);
    } finally {
      runtime.stop();
      offPortfolio();
      offError();
    }
  });

  it('does not request a ticket or open a socket for a guest session', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const createTicket = vi.fn(async () => ({ ticket: 'f'.repeat(64) }));
    const runtime = createFreedomAccountStreamAppRuntime({
      createTicket,
      buildSocketUrl: (ticket) => `wss://worker.test/?ticket=${ticket}`,
      getCurrentSessionKey: () => 'guest:account-1',
      isAdmin: () => false,
      loadSavedBrokerExecutions: () => [],
      getCurrentBrokerExecutions: () => []
    });
    try {
      await expect(runtime.start('guest:account-1')).resolves.toBe(false);
      expect(createTicket).not.toHaveBeenCalled();
      expect(FakeWebSocket.latest).toBeNull();
      expect(runtime.isConnected()).toBe(false);
    } finally {
      runtime.stop();
    }
  });
});
