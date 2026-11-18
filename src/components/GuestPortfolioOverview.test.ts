import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overviewSource = readFileSync(new URL('./GuestPortfolioOverview.tsx', import.meta.url), 'utf8');

describe('guest portfolio overview', () => {
  it('identifies the guest view as shared and read-only', () => {
    expect(overviewSource).toContain('Shared portfolio · Read only');
    expect(overviewSource).toContain('Portfolio changes are managed by your administrator.');
    expect(overviewSource).toContain('data-testid="guest-portfolio-overview"');
  });

  it('uses complete guest-domain totals and leaves incomplete totals unavailable', () => {
    expect(overviewSource).toContain('summarizeGuestCashHoldings(holdings)');
    expect(overviewSource).toContain("summary.marketValue !== null ? formatUSD(summary.marketValue) : '—'");
    expect(overviewSource).toContain("summary.costBasis !== null ? formatUSD(summary.costBasis) : '—'");
    expect(overviewSource).toContain("summary.unrealizedPnl === null ? '—'");
    expect(overviewSource).not.toContain('calculateGuestPersonalEquity');
  });

  it('distinguishes guest receipt time, administrator publication time and quote observation freshness', () => {
    expect(overviewSource).toContain('snapshot?.fetchedAt');
    expect(overviewSource).toContain('snapshot?.updatedAt');
    expect(overviewSource).toContain('snapshot?.ledgerUpdatedAt');
    expect(overviewSource).toContain('summarizeQuoteFreshness');
    expect(overviewSource).toContain('refreshIntervalMs');
  });

  it('announces refresh failures without discarding the previously loaded snapshot', () => {
    expect(overviewSource).toContain('Showing your last successfully loaded snapshot.');
    expect(overviewSource).toContain("role={isError ? 'alert' : 'status'}");
    expect(overviewSource).toContain('aria-live="polite"');
  });
});
