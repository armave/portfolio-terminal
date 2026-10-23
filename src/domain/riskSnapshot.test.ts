import { describe, expect, it } from 'vitest';
import { createRiskSnapshot } from './riskSnapshot';
import type { BoardState } from '../types/portfolio';

const position = (overrides: Record<string, unknown> = {}) => ({
  ticker: 'ABC',
  shares: 10,
  currentPrice: 12,
  pt: 0,
  commBuy: 0,
  quoteDetails: { freshness: 'fresh', sourceTimestamp: 1_700_000_000_000 },
  ...overrides
});

describe('createRiskSnapshot', () => {
  it('calculates gross exposure only from usable position quantities and prices', () => {
    const snapshot = createRiskSnapshot({
      positions: { ABC: position(), XYZ: position({ ticker: 'XYZ', shares: 2, currentPrice: 5 }) },
      cashCushion: { freeCash: 250, holdings: [] }
    } as unknown as BoardState, 123);

    expect(snapshot.calculatedAt).toBe(123);
    expect(snapshot.grossExposure.value).toBe(130);
    expect(snapshot.grossExposure.validity).toBe('valid');
    expect(snapshot.cash).toMatchObject({ value: 250, validity: 'valid' });
    expect(snapshot.quoteCoverage).toMatchObject({ totalPositions: 2, fresh: 2, unknown: 0 });
  });

  it('keeps exposure indicative when any quote freshness is unknown or stale', () => {
    const snapshot = createRiskSnapshot({
      positions: {
        ABC: position({ quoteDetails: { freshness: 'unknown' } }),
        XYZ: position({ ticker: 'XYZ', quoteDetails: { freshness: 'stale' } })
      },
      cashCushion: { freeCash: 0, holdings: [] }
    } as unknown as BoardState);

    expect(snapshot.grossExposure.value).toBe(240);
    expect(snapshot.grossExposure.validity).toBe('stale');
    expect(snapshot.quoteCoverage).toMatchObject({ unknown: 1, staleOrDelayed: 1 });
    expect(snapshot.level).toBe('unknown');
  });

  it('withholds aggregate exposure when any position has an unusable price', () => {
    const snapshot = createRiskSnapshot({
      positions: {
        ABC: position(),
        XYZ: position({ ticker: 'XYZ', currentPrice: Number.NaN })
      },
      cashCushion: { freeCash: 0, holdings: [] }
    } as unknown as BoardState);

    expect(snapshot.grossExposure.value).toBeNull();
    expect(snapshot.grossExposure.validity).toBe('missing');
    expect(snapshot.quoteCoverage.missingOrInvalid).toBe(1);
  });

  it('does not infer equity, debt, or liquidation safety from balance', () => {
    const snapshot = createRiskSnapshot({
      balance: -1000,
      positions: { ABC: position() },
      cashCushion: { freeCash: 100, holdings: [] }
    } as unknown as BoardState);

    expect(snapshot.equity.value).toBeNull();
    expect(snapshot.marginDebt.value).toBeNull();
    expect(snapshot.marginBuffer.value).toBeNull();
    expect(snapshot.level).toBe('unknown');
  });

  it('marks absent state safely and handles invalid cash', () => {
    const empty = createRiskSnapshot(undefined, 10);
    expect(empty.grossExposure).toMatchObject({ value: 0, validity: 'valid' });
    expect(empty.cash.validity).toBe('missing');

    const invalidCash = createRiskSnapshot({
      positions: {},
      cashCushion: { freeCash: -1, holdings: [] }
    } as unknown as BoardState);
    expect(invalidCash.cash).toMatchObject({ value: null, validity: 'invalid' });
  });
});
