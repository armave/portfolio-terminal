import { describe, expect, it } from 'vitest';
import {
  adjustPositionForSplit,
  mergePortfolioCorporateActionEvents,
  normalizeFinnhubDividendActions,
  normalizeFinnhubStockSplits,
  previewCorporateActionAdjustment,
  toPortfolioCorporateActionEvent
} from './corporateActions';
import type { PositionRecord } from '../types/portfolio';

const receivedAt = Date.parse('2026-11-08T10:00:00.000Z');

function splitEvent(overrides: Record<string, unknown> = {}) {
  const result = normalizeFinnhubStockSplits([{
    symbol: 'AAPL',
    date: '2020-08-31',
    fromFactor: 1,
    toFactor: 4,
    ...overrides
  }], { symbol: 'AAPL', provider: 'Finnhub', receivedAt });
  return result.events[0];
}

const preSplitPosition: PositionRecord = {
  ticker: 'AAPL',
  shares: 10,
  currentPrice: 500,
  pt: 600,
  commBuy: 12,
  startDate: '2019-01-02',
  tranches: [{ qty: 10, price: 100, date: '2019-01-02', buyCommission: 12 }],
  quoteDetails: {
    price: 500,
    currency: 'USD',
    provider: 'FINNHUB',
    sourceTimestamp: Date.parse('2020-08-28T20:00:00.000Z'),
    receivedAt,
    freshness: 'stale',
    dataQuality: 'complete'
  }
};

describe('Finnhub corporate-action split normalization', () => {
  it('normalizes forward and reverse split ratios with source provenance', () => {
    expect(normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 },
      { symbol: 'AAPL', date: '2000-06-21', fromFactor: 2, toFactor: 1 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt })).toMatchObject({
      quality: 'complete',
      events: [
        { kind: 'reverse_split', sharesAfterPerShareBefore: 0.5 },
        { kind: 'stock_split', sharesAfterPerShareBefore: 4, provider: 'FINNHUB' }
      ]
    });
  });

  it('collapses identical duplicate events and withholds conflicting same-date revisions', () => {
    const identical = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 },
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt });
    expect(identical.quality).toBe('complete');
    expect(identical.events).toHaveLength(1);

    const conflicting = normalizeFinnhubStockSplits([
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 4 },
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 1, toFactor: 7 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt });
    expect(conflicting.events).toEqual([]);
    expect(conflicting.quality).toBe('unavailable');
    expect(conflicting.issues[0]).toContain('Conflicting corporate-action revisions');
  });

  it('rejects invalid, mismatched-symbol and unverified source rows', () => {
    const result = normalizeFinnhubStockSplits([
      { symbol: 'MSFT', date: '2020-08-31', fromFactor: 1, toFactor: 4 },
      { symbol: 'AAPL', date: '2020-02-30', fromFactor: 1, toFactor: 4 },
      { symbol: 'AAPL', date: '2020-08-31', fromFactor: 0, toFactor: 4 }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt });
    expect(result.events).toEqual([]);
    expect(result.quality).toBe('unavailable');
    expect(result.issues.length).toBe(3);

    expect(normalizeFinnhubStockSplits([], {
      symbol: 'AAPL', provider: 'Finnhub', receivedAt, available: false
    })).toMatchObject({ quality: 'unavailable', events: [] });
  });
});

describe('corporate-action history', () => {
  it('normalizes cash dividend evidence without recording a cash settlement', () => {
    const result = normalizeFinnhubDividendActions([
      { symbol: 'AAPL', date: '2026-02-06', amount: 0.26, currency: 'USD', payDate: '2026-02-12' },
      { symbol: 'AAPL', date: '2026-05-08', amount: 0.27, currency: null }
    ], { symbol: 'AAPL', provider: 'Finnhub', receivedAt });
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      kind: 'cash_dividend', amountPerShare: 0.26, currency: 'USD', payDate: '2026-02-12'
    });
    expect(result.events[1]).toMatchObject({
      kind: 'cash_dividend', amountPerShare: 0.27, currency: null, effectiveDate: '2026-05-08'
    });
    expect(result.quality).toBe('partial');
    expect(result.issues.some(issue => issue.includes('currency is unknown'))).toBe(true);
  });

  it('merges repeated event imports idempotently and rejects conflicting source reuse', () => {
    const event = toPortfolioCorporateActionEvent(splitEvent(), 'review_required', receivedAt);
    expect(mergePortfolioCorporateActionEvents([event], [event])).toEqual([event]);
    expect(() => mergePortfolioCorporateActionEvents([event], [{
      ...event, sharesAfterPerShareBefore: 7, toFactor: 7
    }])).toThrow('reused for different evidence');
  });

  it('advances action status monotonically from review to applied', () => {
    const review = toPortfolioCorporateActionEvent(splitEvent(), 'review_required', receivedAt);
    const applied = { ...review, status: 'applied' as const, note: 'Reviewed and applied.' };
    expect(mergePortfolioCorporateActionEvents([review], [applied])[0].status).toBe('applied');
  });
});

describe('split position adjustment', () => {
  it('adjusts all pre-action lots, conserves acquisition cost and marks an old quote stale', () => {
    const result = adjustPositionForSplit(preSplitPosition, splitEvent());
    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.position).toMatchObject({
      shares: 40,
      currentPrice: 125,
      pt: 150,
      tranches: [{ qty: 40, price: 25, buyCommission: 12 }],
      quoteDetails: { price: 125, freshness: 'stale', dataQuality: 'partial' }
    });
    expect(result.costBasisBefore).toBe(1000);
    expect(result.costBasisAfter).toBe(1000);
    expect(result.position.commBuy).toBe(12);
  });

  it('requires review for short or unknown-direction positions', () => {
    expect(adjustPositionForSplit({
      ...preSplitPosition,
      direction: 'short'
    } as PositionRecord, splitEvent())).toMatchObject({
      status: 'review_required',
      reason: 'Automatic split adjustment is limited to verified long positions; short or unknown direction requires reconciliation.'
    });
    expect(adjustPositionForSplit({
      ...preSplitPosition,
      direction: 'unknown'
    } as PositionRecord, splitEvent())).toMatchObject({ status: 'review_required' });
  });

  it('rejects a non-positive or future-dated market quote before split accounting', () => {
    expect(adjustPositionForSplit({
      ...preSplitPosition,
      currentPrice: 0
    }, splitEvent())).toMatchObject({ status: 'review_required' });
    expect(adjustPositionForSplit({
      ...preSplitPosition,
      quoteDetails: {
        ...preSplitPosition.quoteDetails,
        sourceTimestamp: Date.now() + 5 * 60_000
      }
    }, splitEvent())).toMatchObject({
      status: 'review_required',
      reason: 'The current quote observation timestamp is in the future; refresh and verify the market quote before applying the split.'
    });
  });

  it('requires review when the current quote cannot be ordered around the action date', () => {
    const unverifiedQuote = {
      ...preSplitPosition,
      quoteDetails: { ...preSplitPosition.quoteDetails, sourceTimestamp: undefined }
    };
    expect(adjustPositionForSplit(unverifiedQuote, splitEvent())).toMatchObject({
      status: 'review_required',
      reason: 'The open position has no verifiable quote observation timestamp. Refresh its market quote before applying the split.'
    });
  });

  it('retains a quote observed after the action and requires review for mixed or undated lots', () => {
    const afterQuote = {
      ...preSplitPosition,
      quoteDetails: { ...preSplitPosition.quoteDetails, sourceTimestamp: Date.parse('2020-09-01T14:00:00Z') }
    };
    const applied = adjustPositionForSplit(afterQuote, splitEvent());
    expect(applied.status).toBe('applied');
    if (applied.status === 'applied') expect(applied.position.currentPrice).toBe(500);

    const mixed = {
      ...preSplitPosition,
      tranches: [
        { qty: 5, price: 100, date: '2019-01-02' },
        { qty: 5, price: 100, date: '2020-09-01' }
      ]
    };
    expect(adjustPositionForSplit(mixed, splitEvent())).toMatchObject({ status: 'review_required' });
    expect(adjustPositionForSplit({
      ...preSplitPosition, tranches: [{ qty: 10, price: 100 }]
    }, splitEvent())).toMatchObject({ status: 'review_required' });
  });

  it('does not re-adjust positions acquired after the effective date', () => {
    const postAction = {
      ...preSplitPosition,
      startDate: '2021-01-01',
      tranches: [{ qty: 10, price: 100, date: '2021-01-01' }]
    };
    expect(adjustPositionForSplit(postAction, splitEvent())).toMatchObject({
      status: 'not_applicable'
    });
  });
});

describe('corporate-action preview', () => {
  it('shows dividend entitlement separately from broker cash settlement', () => {
    expect(previewCorporateActionAdjustment({
      kind: 'cash_dividend',
      quantity: 10,
      direction: 'long',
      totalCostBasis: 1000,
      amountPerShare: 0.25,
      currency: 'USD'
    })).toMatchObject({
      status: 'ready', cashEntitlement: 2.5, cashCurrency: 'USD',
      totalCostBasisAfter: 1000
    });
  });

  it.each(['merger', 'spin_off'] as const)('requires review for unsupported %s basis allocation', kind => {
    expect(previewCorporateActionAdjustment({
      kind, quantity: 10, direction: 'long', totalCostBasis: 1000
    })).toMatchObject({ status: 'review_required' });
  });
});
