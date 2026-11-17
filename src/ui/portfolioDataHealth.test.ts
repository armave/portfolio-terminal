import { describe, expect, it } from 'vitest';
import type { PortfolioState } from '../types/portfolio';
import {
  arePortfolioDataHealthSourcesEqual,
  getBrokerSnapshotHealth,
  getQuoteFreshnessHealth,
  selectPortfolioDataHealthSource,
  summarizeAdminPortfolioQuoteFreshness,
  summarizeGuestPortfolioQuoteFreshness,
  resolvePortfolioDataHealthTone
} from './portfolioDataHealth';

function brokerSnapshot(overrides: Partial<NonNullable<PortfolioState['brokerAccountInfo']>> = {}): NonNullable<PortfolioState['brokerAccountInfo']> {
  return {
    loaded: true,
    balances: [],
    positions: [],
    status: 'current',
    quality: 'complete',
    snapshotQuality: 'complete',
    observedAt: 1_800_000_000_000,
    receivedAt: 1_800_000_000_100,
    ...overrides
  };
}

describe('broker snapshot health', () => {
  it('requires current status, complete quality, and a verified observation timestamp', () => {
    expect(getBrokerSnapshotHealth(undefined)).toBe('unknown');
    expect(getBrokerSnapshotHealth(brokerSnapshot())).toBe('current');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ status: 'stale' }))).toBe('stale');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ status: 'unavailable' }))).toBe('unavailable');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ quality: 'partial' }))).toBe('partial');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ snapshotQuality: 'partial' }))).toBe('partial');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ quality: 'empty' }))).toBe('empty');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ observedAt: undefined }))).toBe('received');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ observedAt: undefined, receivedAt: undefined }))).toBe('unknown');
    expect(getBrokerSnapshotHealth(brokerSnapshot({ loaded: false }))).toBe('unknown');
  });

  it('does not call a snapshot current while position integrity issues remain', () => {
    expect(getBrokerSnapshotHealth(brokerSnapshot({
      positionIntegrityIssues: [{ ticker: 'AAPL', code: 'invalid_broker_position', source: 'account_snapshot' }]
    }))).toBe('partial');
  });
});

describe('role-scoped data health selection', () => {
  it('selects only the guest projection for guests', () => {
    const ownerBroker = brokerSnapshot();
    const state = {
      positions: { AAPL: { ticker: 'AAPL' } },
      brokerAccountInfo: ownerBroker,
      cashCushion: { freeCash: 0, holdings: [] },
      guestPortfolioSnapshot: { updatedAt: 1_800_000_000_000, tranches: [] }
    } as unknown as PortfolioState;

    const guest = selectPortfolioDataHealthSource(state, false);
    expect(guest).toEqual({ role: 'guest', guestSnapshot: state.guestPortfolioSnapshot });
    expect(guest).not.toHaveProperty('brokerAccountInfo');
    expect(guest).not.toHaveProperty('positions');
  });

  it('selects the administrator owner snapshot only for administrators', () => {
    const state = {
      positions: { AAPL: { ticker: 'AAPL' } },
      brokerAccountInfo: brokerSnapshot(),
      cashCushion: { freeCash: 0, holdings: [] }
    } as unknown as PortfolioState;

    const admin = selectPortfolioDataHealthSource(state, true);
    expect(admin).toEqual({
      role: 'admin',
      brokerAccountInfo: state.brokerAccountInfo,
      positions: state.positions,
      cashHoldings: state.cashCushion.holdings
    });
  });

  it('compares role-scoped source references without treating a role switch as equal', () => {
    const state = {
      positions: {},
      brokerAccountInfo: brokerSnapshot(),
      cashCushion: { freeCash: 0, holdings: [] },
      guestPortfolioSnapshot: { updatedAt: 1_800_000_000_000, tranches: [] }
    } as unknown as PortfolioState;
    const admin = selectPortfolioDataHealthSource(state, true);
    const guest = selectPortfolioDataHealthSource(state, false);
    expect(arePortfolioDataHealthSourcesEqual(admin, guest)).toBe(false);
    expect(arePortfolioDataHealthSourcesEqual(guest, selectPortfolioDataHealthSource(state, false))).toBe(true);
  });
});

describe('quote freshness health', () => {
  const now = 1_800_000_000_000;

  it('summarizes margin and positive cash-backed holdings without promoting missing prices to fresh', () => {
    const fresh = { sourceTimestamp: now - 30_000, freshness: 'fresh' as const };
    const summary = summarizeAdminPortfolioQuoteFreshness({
      positions: {
        AAPL: { ticker: 'AAPL', shares: 1, currentPrice: 10, pt: 12, commBuy: 0, quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: fresh },
        MSFT: { ticker: 'MSFT', shares: 2, currentPrice: 0, pt: 12, commBuy: 0, quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: fresh }
      },
      cashHoldings: [
        { ticker: 'NVDA', shares: 3, price: 20, currentPrice: 20, quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: fresh },
        { ticker: 'TSLA', shares: 0, price: 20, currentPrice: 20, quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: fresh }
      ]
    } as unknown as {
      positions: PortfolioState['positions'];
      cashHoldings: PortfolioState['cashCushion']['holdings'];
    }, now);

    expect(summary.total).toBe(3);
    expect(summary.fresh).toBe(2);
    expect(summary.unavailable).toBe(1);
  });

  it('honors provider-provided stale and delayed classifications for guest assignments', () => {
    const snapshot = {
      updatedAt: now,
      tranches: [
        { id: 'a', ticker: 'AAPL', name: 'Apple', quantity: 1, marketPrice: 10, averagePrice: 9, marketValue: 10, purchasedAt: now, quoteDetails: { sourceTimestamp: now - 900_000, freshness: 'stale' } },
        { id: 'b', ticker: 'MSFT', name: 'Microsoft', quantity: 2, marketPrice: 20, averagePrice: 18, marketValue: 40, purchasedAt: now, quoteDetails: { freshness: 'delayed' } }
      ]
    } as unknown as NonNullable<PortfolioState['guestPortfolioSnapshot']>;

    const summary = summarizeGuestPortfolioQuoteFreshness(snapshot, now);
    expect(summary.total).toBe(2);
    expect(summary.stale).toBe(1);
    expect(summary.delayed).toBe(1);
    expect(getQuoteFreshnessHealth(summary)).toBe('stale');
  });

  it('reports no quote observations separately from unavailable individual quotes', () => {
    const none = summarizeGuestPortfolioQuoteFreshness(undefined, now);
    expect(none.total).toBe(0);
    expect(getQuoteFreshnessHealth(none)).toBe('none');

    const unknownPrice = summarizeGuestPortfolioQuoteFreshness({
      updatedAt: now,
      tranches: [{
        id: 'a', ticker: 'AAPL', name: 'Apple', quantity: 1, marketPrice: null,
        averagePrice: 9, marketValue: null, purchasedAt: now
      }]
    } as unknown as NonNullable<PortfolioState['guestPortfolioSnapshot']>, now);
    expect(unknownPrice.unavailable).toBe(1);
  });
});

describe('overall portfolio data health tone', () => {
  it('warns for stale, partial, unavailable, or conflicted administrator inputs', () => {
    const base = {
      role: 'admin' as const,
      brokerHealth: 'current' as const,
      quoteHealth: 'fresh' as const,
      cloudTone: 'success' as const
    };
    expect(resolvePortfolioDataHealthTone({ ...base, brokerHealth: 'stale' })).toBe('warning');
    expect(resolvePortfolioDataHealthTone({ ...base, brokerHealth: 'partial' })).toBe('warning');
    expect(resolvePortfolioDataHealthTone({ ...base, brokerHealth: 'unavailable' })).toBe('warning');
    expect(resolvePortfolioDataHealthTone({ ...base, cloudTone: 'conflict' })).toBe('warning');
    expect(resolvePortfolioDataHealthTone({ ...base, quoteHealth: 'delayed' })).toBe('warning');
  });

  it('does not call unknown or offline administrator inputs current', () => {
    const base = {
      role: 'admin' as const,
      brokerHealth: 'current' as const,
      quoteHealth: 'fresh' as const,
      cloudTone: 'success' as const
    };
    expect(resolvePortfolioDataHealthTone({ ...base, brokerHealth: 'unknown' })).toBe('unknown');
    expect(resolvePortfolioDataHealthTone({ ...base, brokerHealth: 'received' })).toBe('healthy');
    expect(resolvePortfolioDataHealthTone({ ...base, quoteHealth: 'unavailable' })).toBe('unknown');
    expect(resolvePortfolioDataHealthTone({ ...base, cloudTone: 'neutral' })).toBe('unknown');
  });

  it('uses only the assigned snapshot and guest refresh status for guests', () => {
    const base = {
      role: 'guest' as const,
      quoteHealth: 'fresh' as const,
      assignedSnapshotAvailable: true,
      assignedRefreshStatus: 'synced'
    };
    expect(resolvePortfolioDataHealthTone(base)).toBe('healthy');
    expect(resolvePortfolioDataHealthTone({ ...base, assignedRefreshStatus: 'error' })).toBe('warning');
    expect(resolvePortfolioDataHealthTone({ ...base, assignedSnapshotAvailable: false })).toBe('unknown');
    expect(resolvePortfolioDataHealthTone({ ...base, quoteHealth: 'unknown' })).toBe('unknown');
  });
});
