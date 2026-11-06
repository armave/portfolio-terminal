import { describe, expect, it } from 'vitest';
import {
  appendPortfolioTransactionEvent,
  createPortfolioTransactionEvent,
  hasPortfolioTransactionIdempotencyKey,
  isPortfolioTransactionEvent,
  isPortfolioTransactionEventList,
  normalizePortfolioTransactionIdempotencyKey
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
    expect(original).toEqual([first]);
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
