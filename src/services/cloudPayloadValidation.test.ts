import { describe, expect, it } from 'vitest';
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

  it.each([
    [{ positions: null }, 'positions'],
    [{ positions: { AAPL: null } }, 'position AAPL'],
    [{ cashCushion: [] }, 'cash cushion'],
    [{ cashCushion: { holdings: {} } }, 'cash cushion holdings'],
    [{ closedTrades: {} }, 'closed trades'],
    [{ apiKeys: [] }, 'API keys']
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
