import { describe, expect, it } from 'vitest';
import { getExitComparisonReference } from './exitComparisonReference';

describe('Compare Exits reference-price provenance', () => {
  it('prefers a usable latest quote even when the tracked lot ledger needs reconciliation', () => {
    expect(getExitComparisonReference({
      currentPrice: 120,
      shares: 5,
      commBuy: 0,
      tranches: [{ qty: 4, price: 100 }]
    }, 'GOOGL')).toEqual({ price: 120, source: 'quote' });
  });

  it('classifies manually entered and trade-entered prices separately from provider quotes', () => {
    expect(getExitComparisonReference({
      currentPrice: 120,
      quoteSource: 'Manual',
      shares: 5,
      commBuy: 0,
      tranches: [{ qty: 5, price: 100 }]
    }, 'GOOGL')).toEqual({ price: 120, source: 'manual' });
    expect(getExitComparisonReference({
      currentPrice: 121,
      quoteSource: 'Trade input',
      shares: 5,
      commBuy: 0,
      tranches: [{ qty: 5, price: 100 }]
    }, 'GOOGL')).toEqual({ price: 121, source: 'manual' });
  });

  it('uses average entry only when the tracked lots cover every open share', () => {
    expect(getExitComparisonReference({
      shares: 5,
      commBuy: 3,
      tranches: [
        { qty: 2, price: 100, buyCommission: 1 },
        { qty: 3, price: 120, buyCommission: 2 }
      ]
    }, 'GOOGL')).toEqual({ price: 112, source: 'average-entry' });
  });

  it('does not derive an average entry from partial or excess lot coverage', () => {
    expect(getExitComparisonReference({
      shares: 5,
      commBuy: 0,
      tranches: [{ qty: 4, price: 100 }]
    }, 'GOOGL')).toEqual({ price: null, source: null });
    expect(getExitComparisonReference({
      shares: 5,
      commBuy: 0,
      tranches: [{ qty: 6, price: 100 }]
    }, 'GOOGL')).toEqual({ price: null, source: null });
  });

  it('rejects malformed or incomplete cost-basis fields instead of treating them as zero', () => {
    expect(getExitComparisonReference({
      shares: 5,
      commBuy: 'not-a-number',
      tranches: [{ qty: 5, price: 100 }]
    })).toEqual({ price: null, source: null });
    expect(getExitComparisonReference({
      shares: 5,
      commBuy: 0,
      tranches: [{ qty: 5, price: Number.NaN }]
    })).toEqual({ price: null, source: null });
    expect(getExitComparisonReference(undefined)).toEqual({ price: null, source: null });
  });

  it('supports validated legacy quantity and entry-price aliases', () => {
    expect(getExitComparisonReference({
      shares: '2',
      tranches: [{ shares: 2, entryPrice: 105 }]
    })).toEqual({ price: 105, source: 'average-entry' });
  });
});
