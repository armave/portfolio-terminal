import { describe, expect, it, vi } from 'vitest';
import { createFreedomTradeNetBrokerAdapter } from './freedomTradeNetAdapter';
import { createBrokerAdapterRegistry } from './registry';
import type { BrokerAdapterTransport } from '../../types/broker';

function createTransport(overrides: Partial<BrokerAdapterTransport> = {}): BrokerAdapterTransport {
  return {
    fetchPortfolio: vi.fn(async () => ({})),
    fetchActiveOrders: vi.fn(async () => ({})),
    fetchExecutions: vi.fn(async () => ({})),
    fetchCashflows: vi.fn(async () => ({})),
    ...overrides
  };
}

describe('Freedom TradeNet broker adapter', () => {
  it('exposes read-only capabilities and provider-independent portfolio metadata', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizePortfolio({
      data: { result: { ps: {
        loaded: true,
        acc: [{ curr: 'USD', s: '-125.50' }, { curr: 'EUR', s: 100 }],
        pos: [{ curr: 'USD', i: 'AAPL.US', name: 'Apple', q: 2, mkt_price: 190 }]
      } } }
    }, { receivedAt: 123, source: 'websocket' });

    expect(adapter.provider).toBe('freedom-tradenet');
    expect(adapter.readOnly).toBe(true);
    expect(adapter.capabilities.orderPlacement).toBe(false);
    expect(snapshot).toMatchObject({
      provider: 'freedom-tradenet',
      source: 'websocket',
      quality: 'complete',
      receivedAt: 123,
      data: {
        loaded: true,
        balances: [{ currency: 'USD', amount: -125.5 }],
        positions: [{ ticker: 'AAPL.US', quantity: 2 }]
      }
    });
    expect(snapshot.observedAt).toBeUndefined();
    expect(snapshot.warnings).toContain('The provider did not supply a verifiable observation timestamp.');
  });

  it('marks a confirmed empty USD portfolio as empty without inventing a balance', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizePortfolio({
      data: { result: { ps: { loaded: true, acc: [], pos: [] } } }
    }, { receivedAt: 456, observedAt: 450 });

    expect(snapshot.quality).toBe('empty');
    expect(snapshot.observedAt).toBe(450);
    expect(snapshot.data.balances).toEqual([]);
    expect(snapshot.data.positions).toEqual([]);
  });

  it('marks missing USD collections as partial without penalizing excluded non-USD rows', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizePortfolio({
      data: { result: { ps: { loaded: true, acc: [{ curr: 'USD', s: '10' }] } } }
    });

    expect(snapshot.quality).toBe('partial');
    expect(snapshot.warnings).toContain('Some USD provider rows or required collections were unavailable.');
  });

  it('marks malformed required USD values partial and excludes those rows without inventing zero values', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizePortfolio({
      data: { result: { ps: {
        loaded: true,
        acc: [
          { curr: 'USD', s: '125.50' },
          { curr: 'USD', s: true, currval: false }
        ],
        pos: [
          { curr: 'USD', i: 'AAPL.US', q: 2, mkt_price: 190 },
          { curr: 'USD', i: 'MSFT.US', q: true, mkt_price: 400 }
        ]
      } } }
    }, { receivedAt: 789, source: 'rest' });

    expect(snapshot.quality).toBe('partial');
    expect(snapshot.receivedAt).toBe(789);
    expect(snapshot.data.balances).toEqual([{ currency: 'USD', amount: 125.5, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 }]);
    expect(snapshot.data.positions).toMatchObject([{ ticker: 'AAPL.US', quantity: 2 }]);
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      'TradeNet USD balance row without a valid amount was excluded.',
      'TradeNet USD position row without a valid quantity was excluded.'
    ]));
  });

  it('treats rows with unknown currency as partial rather than silently excluding them as non-USD', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizePortfolio({
      data: { result: { ps: {
        loaded: true,
        acc: [{ s: '100' }],
        pos: []
      } } }
    });

    expect(snapshot.quality).toBe('partial');
    expect(snapshot.data.balances).toEqual([]);
    expect(snapshot.warnings).toContain('TradeNet balance row without a currency was excluded.');
  });

  it('keeps genuine zero USD balances and quantities complete', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizePortfolio({
      data: { result: { ps: {
        loaded: true,
        acc: [{ curr: 'USD', s: 0 }],
        pos: [{ curr: 'USD', i: 'AAPL.US', q: 0 }]
      } } }
    }, { observedAt: 100 });

    expect(snapshot.quality).toBe('complete');
    expect(snapshot.data.balances[0].amount).toBe(0);
    expect(snapshot.data.positions[0].quantity).toBe(0);
  });

  it('rejects unloaded or malformed portfolio data through a typed provider error', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    expect(() => adapter.normalizePortfolio({ data: { result: { ps: { loaded: false } } } }))
      .toThrow('not loaded yet');
    try {
      adapter.normalizePortfolio({ data: { result: { ps: { loaded: false } } } });
    } catch (error) {
      expect(adapter.classifyError(error)).toMatchObject({
        name: 'BrokerAdapterError',
        provider: 'freedom-tradenet',
        code: 'malformed_response',
        retryable: false,
        requiresReauthentication: false
      });
    }
  });

  it('normalizes orders and explicitly reports a partial response containing malformed rows', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizeActiveOrders({
      data: { orders: { order: [
        { order_id: 'order-1', instr: 'aapl.us', oper: 3, p: '190.5', leaves_qty: '2', stat: '10' },
        null
      ] } }
    });

    expect(snapshot.quality).toBe('partial');
    expect(snapshot.data).toMatchObject([
      { id: 'order-1', ticker: 'AAPL.US', operation: 3, limitPrice: 190.5, remainingQuantity: 2 }
    ]);
  });

  it('rejects unknown order and execution envelopes instead of presenting them as valid empty results', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    expect(() => adapter.normalizeActiveOrders({ data: { account: [] } })).toThrow(/unrecognized active-orders/i);
    expect(() => adapter.normalizeExecutions({ data: { account: [] } })).toThrow(/unrecognized execution-history/i);
  });

  it('normalizes executions and preserves broker facts without merging app-owned accounting', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizeExecutions({
      data: { trades: { trade: [{
        trade_id: 701, instr_nm: 'AAPL.US', operation: '1',
        q: 0, quantity: '5', p: '12.50', date: '2026-10-31T10:20:00Z',
        v: '62.50', curr_c: 'USD', commiss: '0.25'
      }] } }
    });

    expect(snapshot.data).toHaveLength(1);
    expect(snapshot.data[0]).toMatchObject({
      id: '701', ticker: 'AAPL.US', side: 'BUY', quantity: 5, price: 12.5,
      tradeValue: 62.5, commission: 0.25
    });
    expect(snapshot.data[0].marginFeeAllocations).toBeUndefined();
  });

  it('normalizes cashflows through the provider adapter and fails closed on unknown envelopes', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const snapshot = adapter.normalizeCashflows({
      data: { result: { cash_flows: [{
        operation_id: 4812, operation_date: '2026-10-30T10:20:00Z',
        operation_type: 'Margin Fee', amount: '-12,45', curr: 'USD'
      }] } }
    });
    expect(snapshot.data).toMatchObject([{ id: 'freedom-4812', amount: -12.45, currency: 'USD' }]);
    expect(() => adapter.normalizeCashflows({ data: { account: [] } })).toThrow(/unrecognized cashflow/i);
  });

  it('classifies authentication, throttling, timeout, and network errors', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    expect(adapter.classifyError({ status: 401, message: 'Unauthorized' })).toMatchObject({
      code: 'authentication_required', requiresReauthentication: true, retryable: false
    });
    expect(adapter.classifyError({ status: 429, message: 'Too many requests' })).toMatchObject({
      code: 'rate_limited', retryable: true
    });
    expect(adapter.classifyError(new Error('Request timed out'))).toMatchObject({
      code: 'timeout', retryable: true
    });
    expect(adapter.classifyError(new Error('fetch failed'))).toMatchObject({
      code: 'network', retryable: true
    });
  });

  it('exposes authentication state without holding credentials or session secrets', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    expect(adapter.getAuthenticationState({ authenticated: true, checkedAt: 100 }))
      .toEqual({ status: 'authenticated', checkedAt: 100, authenticatedAt: 100 });
    expect(adapter.getAuthenticationState({ error: { status: 401 }, checkedAt: 101 }))
      .toEqual({ status: 'expired', checkedAt: 101 });
    expect(adapter.getAuthenticationState({ checkedAt: 102 }))
      .toEqual({ status: 'unknown', checkedAt: 102 });
  });

  it('keeps the registry extensible and rejects ambiguous duplicate provider registrations', () => {
    const adapter = createFreedomTradeNetBrokerAdapter(createTransport());
    const registry = createBrokerAdapterRegistry([adapter]);
    expect(registry.get('freedom-tradenet')).toBe(adapter);
    expect(registry.list()).toEqual([adapter]);
    expect(() => registry.register(adapter)).toThrow(/already registered/i);
  });
});
