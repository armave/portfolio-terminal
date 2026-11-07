import { describe, expect, it } from 'vitest';
import { assertEntryBundleBudget, ENTRY_BUNDLE_BUDGET } from '../../scripts/bundleBudget.js';

describe('production entry bundle budget', () => {
  it('sets a raw and gzip budget above the current entry baseline', () => {
    expect(ENTRY_BUNDLE_BUDGET.maxBytes).toBe(575_000);
    expect(ENTRY_BUNDLE_BUDGET.maxGzipBytes).toBe(165_000);
    expect(assertEntryBundleBudget({
      assetName: 'index.js',
      bytes: 575_000,
      gzipBytes: 155_920
    })).toBe(true);
  });

  it('fails when the minified application entry exceeds its budget', () => {
    expect(() => assertEntryBundleBudget({
      assetName: 'index.js',
      bytes: 575_001,
      gzipBytes: 150_000
    })).toThrow(/minified size 575001 B exceeds 575000 B/);
  });

  it('fails when the gzip application entry exceeds its budget', () => {
    expect(() => assertEntryBundleBudget({
      assetName: 'index.js',
      bytes: 499_000,
      gzipBytes: 165_001
    })).toThrow(/gzip size 165001 B exceeds 165000 B/);
  });

  it('rejects invalid size measurements rather than bypassing the budget', () => {
    expect(() => assertEntryBundleBudget({
      assetName: 'index.js',
      bytes: Number.NaN,
      gzipBytes: 1
    })).toThrow(/raw size must be a non-negative safe integer/);
  });
});
