import { describe, expect, it } from 'vitest';
import { createPortfolioTransactionEvent } from '../domain/portfolioTransactionJournal';
import {
  assertValidCloudPortfolioPayload,
  normalizeCloudHistoryPayload
} from './cloudPayloadValidation';

describe('cloud portfolio payload validation', () => {
  it('accepts current and legacy partial snapshots', () => {
    expect(() => assertValidCloudPortfolioPayload({
      positions: {},
      cashCushion: { freeCash: '125.50', holdings: [] },
      closedTrades: [],
      brokerAssumptions: {},
      apiKeys: {}
    })).not.toThrow();

    expect(() => assertValidCloudPortfolioPayload({
      holdings: [{ ticker: 'AAPL', tranches: [] }],
      balance: 100
    })).not.toThrow();
  });

  it('accepts valid transaction journals and rejects malformed journal rows', () => {
    const event = createPortfolioTransactionEvent({
      type: 'trade.buy',
      effectiveAt: Date.parse('2026-11-06T12:00:00Z'),
      ticker: 'AAPL',
      quantity: 1,
      positionQuantityDelta: 1
    });
    expect(() => assertValidCloudPortfolioPayload({ positions: {}, transactionEvents: [event] })).not.toThrow();
    expect(() => assertValidCloudPortfolioPayload({ positions: {}, transactionEvents: [{ id: 'bad', schemaVersion: 99 }] }))
      .toThrow('transaction events');
  });

  it.each([
    { positions: null },
    { positions: { AAPL: null } },
    { cashCushion: [] },
    { cashCushion: { holdings: {} } },
    { closedTrades: {} },
    { apiKeys: [] }
  ])('rejects malformed snapshot containers: %j', (payload) => {
    expect(() => assertValidCloudPortfolioPayload(payload)).toThrow('Invalid cloud portfolio');
  });
});

describe('closed history payload validation', () => {
  it('normalizes a valid partial legacy history without losing its arrays', () => {
    expect(normalizeCloudHistoryPayload({ brokerExecutedTrades: [{ id: 't1' }] })).toEqual({
      brokerExecutedTrades: [{ id: 't1' }],
      cashflows: []
    });
  });

  it.each([
    null,
    [],
    { brokerExecutedTrades: {} },
    { cashflows: null }
  ])('rejects malformed history payloads: %j', (payload) => {
    expect(() => normalizeCloudHistoryPayload(payload)).toThrow('Invalid cloud history');
  });
});
