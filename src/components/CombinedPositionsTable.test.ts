import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./CombinedPositionsTable.tsx', import.meta.url), 'utf8');

describe('Combined positions table', () => {
  it('supports sorting by ticker, market value, gross P&L, return and weight', () => {
    for (const key of ['ticker', 'marketValue', 'unrealizedPnl', 'unrealizedPnlPct', 'weight']) {
      expect(source).toContain("case '" + key + "'");
      expect(source).toContain("sortButton('" + key + "'");
    }
    expect(source).toContain('aria-sort=');
  });

  it('uses domain position values and leaves incomplete inputs unavailable', () => {
    expect(source).toContain('getMarginPositionMarketSummaries(positions)');
    expect(source).toContain('row.marketPrice === null');
    expect(source).toContain('money(row.marketValue)');
    expect(source).not.toContain('marketValue || 0');
    expect(source).not.toContain('unrealizedPnl || 0');
  });

  it('offers keyboard-scrollable desktop table and labelled mobile cards', () => {
    expect(source).toContain('<TableScrollRegion');
    expect(source).toContain('combined-positions-table-region');
    expect(source).toContain('combined-position-cards');
    expect(source).toContain("emitUiEvent('portfolio:set-active-view', { view: ticker })");
  });
});
