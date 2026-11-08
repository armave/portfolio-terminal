import { describe, expect, it } from 'vitest';
import {
  appendPortfolioTransactionEvent,
  appendBrokerHistoryAuditEvents,
  createPortfolioTransactionEvent,
  hasPortfolioTransactionIdempotencyKey,
  isPortfolioTransactionEvent,
  isPortfolioTransactionEventList,
  mergePortfolioTransactionEvents,
  normalizePortfolioTransactionIdempotencyKey,
  replayPortfolioTransactionJournal,
  resolveLatestBrokerHistoryAuditEvents,
  verifyPortfolioTransactionParity
} from './portfolioTransactionJournal';

const draft = {
  type: 'trade.buy' as const,
  effectiveAt: Date.parse('2026-11-06T09:00:00.000Z'),
  ticker: 'aapl',
  quantity: 2,
  unitPrice: 100,
  grossAmount: 200,
  fees: 1.25,
  cashDelta: -201.25,
  marginDebtDelta: 0
};

describe('portfolio transaction journal', () => {
  it('creates a versioned event with actor, source, effective time, and recorded time', () => {
    const event = createPortfolioTransactionEvent(draft, {
      eventId: 'event-1',
      idempotencyKey: 'buy-command-1',
      actor: { type: 'user', id: 'user-7' },
      source: 'terminal',
      recordedAt: Date.parse('2026-11-06T09:00:02.000Z')
    });

    expect(event).toMatchObject({
      id: 'event-1',
      schemaVersion: 1,
      type: 'trade.buy',
      actor: { type: 'user', id: 'user-7' },
      source: 'terminal',
      effectiveAt: draft.effectiveAt,
      recordedAt: Date.parse('2026-11-06T09:00:02.000Z'),
      idempotencyKey: 'buy-command-1',
      ticker: 'AAPL',
      quantity: 2,
      unitPrice: 100,
      grossAmount: 200,
      fees: 1.25,
      cashDelta: -201.25,
      marginDebtDelta: 0
    });
    expect(isPortfolioTransactionEvent(event)).toBe(true);
  });

  it('appends without mutating the existing journal or event', () => {
    const first = createPortfolioTransactionEvent(draft, { eventId: 'event-1' });
    const original = [first];
    const next = createPortfolioTransactionEvent({ ...draft, type: 'trade.sell' }, { eventId: 'event-2' });
    const result = appendPortfolioTransactionEvent(original, next);

    expect(result.appended).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(result.events).toHaveLength(2);
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(original).toEqual([first]);
    expect(() => result.events.push(first)).toThrow(TypeError);
    expect(Object.isFrozen(result.events[1])).toBe(true);
    expect(Object.isFrozen(result.events[1].actor)).toBe(true);
  });

  it('treats a repeated idempotency key as a successful no-op', () => {
    const first = createPortfolioTransactionEvent(draft, {
      eventId: 'event-1',
      idempotencyKey: 'request-123'
    });
    const retry = createPortfolioTransactionEvent(draft, {
      eventId: 'event-2',
      idempotencyKey: 'request-123'
    });
    const journal = [first];
    const result = appendPortfolioTransactionEvent(journal, retry);

    expect(hasPortfolioTransactionIdempotencyKey(journal, 'request-123')).toBe(true);
    expect(result).toEqual({ events: journal, appended: false, duplicate: true });
  });

  it('rejects conflicting reuse of an idempotency key when no request fingerprint is supplied', () => {
    const first = createPortfolioTransactionEvent(draft, {
      eventId: 'event-idempotency-first',
      idempotencyKey: 'same-key',
      actor: { type: 'user', id: 'user-7' },
      source: 'terminal'
    });
    const retry = createPortfolioTransactionEvent(draft, {
      eventId: 'event-idempotency-retry',
      idempotencyKey: 'same-key',
      actor: { type: 'user', id: 'user-7' },
      source: 'terminal',
      recordedAt: first.recordedAt + 5_000
    });
    const conflict = createPortfolioTransactionEvent({
      ...draft,
      quantity: 3,
      grossAmount: 300,
      cashDelta: -301.25
    }, {
      eventId: 'event-idempotency-conflict',
      idempotencyKey: 'same-key',
      actor: { type: 'user', id: 'user-7' },
      source: 'terminal'
    });

    expect(appendPortfolioTransactionEvent([first], retry)).toMatchObject({
      appended: false,
      duplicate: true
    });
    expect(() => appendPortfolioTransactionEvent([first], conflict))
      .toThrow(/conflicts with a different command/i);
  });

  it('rejects invalid idempotency keys rather than silently disabling deduplication', () => {
    expect(normalizePortfolioTransactionIdempotencyKey(undefined)).toBeUndefined();
    expect(normalizePortfolioTransactionIdempotencyKey(' request-123 ')).toBe('request-123');
    expect(() => normalizePortfolioTransactionIdempotencyKey('   ')).toThrow(RangeError);
    expect(() => normalizePortfolioTransactionIdempotencyKey('x'.repeat(201))).toThrow(RangeError);
    expect(() => normalizePortfolioTransactionIdempotencyKey(123)).toThrow(TypeError);
  });

  it('rejects malformed financial events and event arrays', () => {
    const event = createPortfolioTransactionEvent(draft, { eventId: 'event-1' });
    expect(isPortfolioTransactionEvent(event)).toBe(true);
    expect(isPortfolioTransactionEvent({ ...event, recordedAt: Number.NaN })).toBe(false);
    expect(isPortfolioTransactionEvent({ ...event, quantity: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isPortfolioTransactionEvent({ ...event, currency: 'US' })).toBe(false);
    expect(isPortfolioTransactionEventList([event])).toBe(true);
    expect(isPortfolioTransactionEventList([event, { ...event, id: '' }])).toBe(false);
  });

  it('rejects duplicate event IDs even when idempotency keys differ', () => {
    const first = createPortfolioTransactionEvent(draft, { eventId: 'event-1', idempotencyKey: 'first' });
    const second = createPortfolioTransactionEvent(draft, { eventId: 'event-1', idempotencyKey: 'second' });
    expect(() => appendPortfolioTransactionEvent([first], second)).toThrow('already exists');
  });
});


describe('portfolio transaction journal imports', () => {
  it('merges unique imported events without replacing existing history', () => {
    const first = createPortfolioTransactionEvent(draft, {
      eventId: 'event-1',
      idempotencyKey: 'key-1',
      requestFingerprint: 'buy:AAPL:2:100'
    });
    const second = createPortfolioTransactionEvent({
      ...draft,
      type: 'cash.adjustment',
      ticker: undefined,
      quantity: undefined,
      unitPrice: undefined,
      grossAmount: 50,
      fees: undefined,
      cashDelta: 50
    }, {
      eventId: 'event-2',
      requestFingerprint: 'cash:+50'
    });

    const merged = mergePortfolioTransactionEvents([first], [first, second]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(first);
    expect(merged[1]).toEqual(second);
  });

  it('reorders older backup events by recorded time while preserving append-only history', () => {
    const newer = createPortfolioTransactionEvent({
      type: 'portfolio.reset',
      effectiveAt: 2_000,
      note: 'Local reset'
    }, { eventId: 'newer-reset', recordedAt: 2_100 });
    const older = createPortfolioTransactionEvent({
      type: 'trade.buy',
      effectiveAt: 1_000,
      ticker: 'AAPL',
      quantity: 1,
      positionQuantityDelta: 1
    }, { eventId: 'older-buy', recordedAt: 1_100 });

    const merged = mergePortfolioTransactionEvents([newer], [older]);
    expect(merged.map((event) => event.id)).toEqual(['older-buy', 'newer-reset']);
    expect(replayPortfolioTransactionJournal(merged).positions).toEqual({});
    expect(Object.isFrozen(merged)).toBe(true);
  });

  it('rejects imports that conflict by event ID or idempotency key', () => {
    const original = createPortfolioTransactionEvent(draft, {
      eventId: 'event-1',
      idempotencyKey: 'key-1',
      requestFingerprint: 'buy:AAPL:2:100'
    });
    expect(() => mergePortfolioTransactionEvents(
      [original],
      [{ ...original, quantity: 3 }]
    )).toThrow('conflicts with existing history');

    const reusedKey = createPortfolioTransactionEvent(draft, {
      eventId: 'event-2',
      idempotencyKey: 'key-1',
      requestFingerprint: 'buy:AAPL:3:100'
    });
    expect(() => mergePortfolioTransactionEvents([original], [reusedKey]))
      .toThrow('idempotency key');
  });
});


describe('broker history audit events', () => {
  it('imports read-only broker executions exactly once and links source revisions', () => {
    const firstRows = [{
      id: 'exec-100',
      orderId: 'order-100',
      ticker: 'aapl',
      side: 'BUY',
      quantity: 2,
      price: 100,
      currency: 'USD',
      executedAt: '2026-11-01T10:00:00.000Z',
      commission: 1.25,
      commissionCurrency: 'USD'
    }];
    const first = appendBrokerHistoryAuditEvents([], firstRows, [], Date.parse('2026-11-06T09:00:00Z'));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: 'broker.execution',
      actor: { type: 'broker' },
      source: 'freedom-tradenet',
      externalReferenceId: 'exec-100',
      externalOrderReferenceId: 'order-100',
      ticker: 'AAPL',
      quantity: 2,
      unitPrice: 100,
      grossAmount: 200,
      fees: 1.25
    });
    expect(first[0].positionQuantityDelta).toBeUndefined();

    const replayed = appendBrokerHistoryAuditEvents(first, firstRows, [], Date.parse('2026-11-06T09:01:00Z'));
    expect(replayed).toHaveLength(1);
    expect(replayed[0].id).toBe(first[0].id);

    const revised = appendBrokerHistoryAuditEvents(first, [{
      ...firstRows[0],
      commission: 1.5
    }], [], Date.parse('2026-11-06T09:02:00Z'));
    expect(revised).toHaveLength(2);
    expect(revised[1]).toMatchObject({
      type: 'broker.execution',
      externalReferenceId: 'exec-100',
      fees: 1.5,
      relatedEventId: first[0].id
    });
  });

  it('deduplicates overlapping broker history pages by stable execution and cashflow IDs', () => {
    const firstPage = appendBrokerHistoryAuditEvents([], [
      {
        id: 'exec-page-1',
        orderId: 'order-page-a',
        ticker: 'AAPL',
        side: 'BUY',
        quantity: 1,
        price: 100,
        currency: 'USD',
        executedAt: '2026-11-01T10:00:00.000Z'
      },
      {
        id: 'exec-page-2',
        orderId: 'order-page-a',
        ticker: 'AAPL',
        side: 'BUY',
        quantity: 1,
        price: 101,
        currency: 'USD',
        executedAt: '2026-11-01T10:01:00.000Z'
      }
    ], [{
      id: 'cash-page-1',
      date: '2026-11-01',
      type: 'Dividend',
      amount: 5,
      currency: 'USD'
    }], 1_000);

    const overlappingPage = appendBrokerHistoryAuditEvents(firstPage, [
      {
        id: 'exec-page-2',
        orderId: 'order-page-a',
        ticker: 'AAPL',
        side: 'BUY',
        quantity: 1,
        price: 101,
        currency: 'USD',
        executedAt: '2026-11-01T10:01:00.000Z'
      },
      {
        id: 'exec-page-3',
        orderId: 'order-page-b',
        ticker: 'MSFT',
        side: 'BUY',
        quantity: 2,
        price: 50,
        currency: 'USD',
        executedAt: '2026-11-01T10:02:00.000Z'
      }
    ], [{
      id: 'cash-page-1',
      date: '2026-11-01',
      type: 'Dividend',
      amount: 5,
      currency: 'USD'
    }, {
      id: 'cash-page-2',
      date: '2026-11-01',
      type: 'Fee',
      amount: -1,
      currency: 'USD'
    }], 2_000);

    expect(overlappingPage).toHaveLength(5);
    expect(overlappingPage.filter(event => event.type === 'broker.execution')).toHaveLength(3);
    expect(overlappingPage.filter(event => event.idempotencyKey?.startsWith('broker-cashflow:'))).toHaveLength(2);
  });

  it('records a broker correction that reverts to older facts as a new revision', () => {
    const original = [{
      id: 'exec-revert-1',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 2,
      price: 100,
      currency: 'USD',
      executedAt: '2026-11-01T10:00:00.000Z',
      commission: 1.25,
      commissionCurrency: 'USD'
    }];
    const first = appendBrokerHistoryAuditEvents([], original, [], 1_000);
    const revised = appendBrokerHistoryAuditEvents(first, [{
      ...original[0],
      commission: 1.5
    }], [], 2_000);
    const reverted = appendBrokerHistoryAuditEvents(revised, original, [], 3_000);

    expect(reverted).toHaveLength(3);
    expect(reverted[2]).toMatchObject({
      externalReferenceId: 'exec-revert-1',
      fees: 1.25,
      relatedEventId: revised[1].id
    });
    expect(reverted[2].id).not.toBe(first[0].id);
    expect(appendBrokerHistoryAuditEvents(reverted, original, [], 4_000)).toHaveLength(3);
    expect(resolveLatestBrokerHistoryAuditEvents(reverted)).toHaveLength(1);
    expect(resolveLatestBrokerHistoryAuditEvents(reverted)[0].id).toBe(reverted[2].id);
  });

  it('resolves only the latest broker cashflow revision without deleting audit history', () => {
    const first = appendBrokerHistoryAuditEvents([], [], [{
      id: 'div-revision-1',
      date: '2026-11-01',
      type: 'Dividend',
      amount: 12,
      currency: 'USD'
    }], 1_000);
    const revised = appendBrokerHistoryAuditEvents(first, [], [{
      id: 'div-revision-1',
      date: '2026-11-01',
      type: 'Dividend',
      amount: 15,
      currency: 'USD'
    }], 2_000);

    expect(revised).toHaveLength(2);
    expect(revised[1]).toMatchObject({ externalReferenceId: 'div-revision-1', externalCashFlowAmount: 15 });
    expect(resolveLatestBrokerHistoryAuditEvents(revised)).toHaveLength(1);
    expect(resolveLatestBrokerHistoryAuditEvents(revised)[0].id).toBe(revised[1].id);
    expect(resolveLatestBrokerHistoryAuditEvents(revised)[0].relatedEventId).toBe(revised[0].id);
  });

  it('keeps identical provider execution references isolated by source', () => {
    const execution = {
      id: 'same-provider-id',
      ticker: 'AAPL',
      side: 'BUY',
      quantity: 1,
      price: 100,
      currency: 'USD',
      executedAt: '2026-11-01T10:00:00.000Z',
      commission: 1,
      commissionCurrency: 'USD'
    };
    const firstSource = appendBrokerHistoryAuditEvents([], [execution], [], 1_000, 'provider-one');
    const secondSource = appendBrokerHistoryAuditEvents(firstSource, [execution], [], 2_000, 'provider-two');

    expect(secondSource).toHaveLength(2);
    expect(secondSource.map(event => event.source)).toEqual(['provider-one', 'provider-two']);
    expect(secondSource.map(event => event.relatedEventId)).toEqual([undefined, undefined]);
    expect(resolveLatestBrokerHistoryAuditEvents(secondSource)).toHaveLength(2);
  });

  it('classifies external cashflows without posting their amounts to local cash or debt', () => {
    const cashflows = [
      { id: 'div-1', date: '2026-11-01', type: 'Dividend', amount: 12, currency: 'USD' },
      { id: 'fee-1', date: '2026-11-02', type: 'Commission fee', amount: -2, currency: 'USD' },
      { id: 'fee-positive-magnitude', date: '2026-11-02', type: 'Commission fee', amount: 2, currency: 'USD' },
      { id: 'margin-1', date: '2026-11-03', type: 'Margin Fee', amount: -3, currency: 'USD' },
      { id: 'margin-positive-magnitude', date: '2026-11-03', type: 'Margin Fee', amount: 3, currency: 'USD' },
      { id: 'deposit-1', date: '2026-11-04', type: 'Deposit', amount: 500, currency: 'USD' },
      { id: 'deposit-negative-magnitude', date: '2026-11-04', type: 'Deposit', amount: -500, currency: 'USD' },
      { id: 'withdraw-1', date: '2026-11-05', type: 'Withdrawal', amount: -20, currency: 'USD' },
      { id: 'withdraw-positive-magnitude', date: '2026-11-05', type: 'Withdrawal', amount: 20, currency: 'USD' },
      { id: 'transfer-1', date: '2026-11-05', type: 'Transfer', amount: -5, currency: 'USD' },
      { id: 'split-1', date: '2026-11-05', type: 'Stock Split', amount: 0, currency: 'USD' }
    ];
    const events = appendBrokerHistoryAuditEvents([], [], cashflows, Date.parse('2026-11-06T09:00:00Z'));
    expect(events.map((event) => event.type)).toEqual([
      'dividend', 'fee', 'margin.interest', 'cash.deposit', 'cash.withdrawal', 'cash.transfer', 'corporate-action'
    ]);
    expect(events.find(event => event.externalReferenceId === 'fee-positive-magnitude')?.externalCashFlowAmount).toBe(-2);
    expect(events.find(event => event.externalReferenceId === 'margin-positive-magnitude')?.externalCashFlowAmount).toBe(-3);
    expect(events.find(event => event.externalReferenceId === 'deposit-negative-magnitude')?.externalCashFlowAmount).toBe(500);
    expect(events.find(event => event.externalReferenceId === 'withdraw-positive-magnitude')?.externalCashFlowAmount).toBe(-20);
    expect(events.find(event => event.externalReferenceId === 'deposit-1')?.externalCashFlowAmount).toBe(500);
    expect(events[3].externalCashFlowAmount).toBe(500);
    expect(events[2].financingCost).toBe(3);
    expect(events.find(event => event.externalReferenceId === 'split-1')?.type).toBe('corporate-action');
    expect(events.every((event) => event.cashDelta === undefined && event.marginDebtDelta === undefined)).toBe(true);

    const replay = replayPortfolioTransactionJournal(events);
    expect(replay).toEqual({ positions: {}, cashHoldings: {}, freeCash: 0, marginDebt: 0 });
  });
});

describe('transaction journal replay and parity', () => {
  it('replays app-owned positions, cash holdings, cash and margin debt', () => {
    const events = [
      createPortfolioTransactionEvent({
        type: 'trade.buy', effectiveAt: draft.effectiveAt, ticker: 'AAPL',
        quantity: 2, positionQuantityDelta: 2, cashDelta: 0, marginDebtDelta: 201.25
      }, { eventId: 'buy' }),
      createPortfolioTransactionEvent({
        type: 'trade.sell', effectiveAt: draft.effectiveAt, ticker: 'AAPL',
        quantity: 1, positionQuantityDelta: -1, cashDelta: 0, marginDebtDelta: -119
      }, { eventId: 'sell' }),
      createPortfolioTransactionEvent({
        type: 'cash-holding.buy', effectiveAt: draft.effectiveAt, ticker: 'MSFT',
        quantity: 3, cashHoldingQuantityDelta: 3
      }, { eventId: 'cash-buy' }),
      createPortfolioTransactionEvent({
        type: 'cash.adjustment', effectiveAt: draft.effectiveAt,
        cashDelta: 50
      }, { eventId: 'cash' })
    ];
    const canonical = {
      positions: { AAPL: { shares: 1 } },
      cashCushion: {
        freeCash: 50,
        holdings: [{ ticker: 'MSFT', shares: 3 }]
      },
      balance: -82.25
    };
    const replay = replayPortfolioTransactionJournal(events);
    expect(replay).toEqual({
      positions: { AAPL: 1 },
      cashHoldings: { MSFT: 3 },
      freeCash: 50,
      marginDebt: 82.25
    });
    const parity = verifyPortfolioTransactionParity(events, canonical);
    expect(parity).toEqual({ matches: true, discrepancies: [] });
  });

  it('verifies a journal against a matching canonical snapshot', () => {
    const events = [
      createPortfolioTransactionEvent({
        type: 'trade.buy', effectiveAt: draft.effectiveAt, ticker: 'AAPL',
        quantity: 2, positionQuantityDelta: 2, cashDelta: 0, marginDebtDelta: 200
      }),
      createPortfolioTransactionEvent({
        type: 'cash.adjustment', effectiveAt: draft.effectiveAt, cashDelta: 25
      }),
      createPortfolioTransactionEvent({
        type: 'cash.deposit', effectiveAt: draft.effectiveAt, externalCashFlowAmount: 10, cashDelta: 10
      }),
      createPortfolioTransactionEvent({
        type: 'margin.adjustment', effectiveAt: draft.effectiveAt, marginDebtDelta: -190
      })
    ];
    expect(verifyPortfolioTransactionParity(events, {
      positions: { AAPL: { shares: 2 } },
      cashCushion: { freeCash: 35, holdings: [] },
      balance: -10
    })).toEqual({ matches: true, discrepancies: [] });
  });

  it('reconciles legacy state differences without classifying them as executions', () => {
    const events = [createPortfolioTransactionEvent({
      type: 'portfolio.reconciliation',
      effectiveAt: draft.effectiveAt,
      ticker: 'GOOGL',
      positionQuantityDelta: 50,
      note: 'Legacy baseline imported from the canonical state.'
    })];
    expect(verifyPortfolioTransactionParity(events, {
      positions: { GOOGL: { shares: 50 } },
      cashCushion: { freeCash: 0, holdings: [] },
      balance: 0
    }).matches).toBe(true);
  });
});
