import { describe, expect, it } from 'vitest';
import { getMarginTranchePreview } from './SummaryMetricsGrid';

describe('margin tranche preview', () => {
  it('shows only the first three tranches by default', () => {
    const tranches = ['oldest', 'second', 'third', 'fourth', 'newest'];
    expect(getMarginTranchePreview(tranches)).toEqual(['oldest', 'second', 'third']);
  });

  it('keeps all tranches visible when there are three or fewer', () => {
    expect(getMarginTranchePreview(['one', 'two', 'three'])).toEqual(['one', 'two', 'three']);
    expect(getMarginTranchePreview(['one', 'two'])).toEqual(['one', 'two']);
    expect(getMarginTranchePreview([])).toEqual([]);
  });

  it('does not mutate the stored tranche array', () => {
    const tranches = [1, 2, 3, 4];
    getMarginTranchePreview(tranches);
    expect(tranches).toEqual([1, 2, 3, 4]);
  });
});
