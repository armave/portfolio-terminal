import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const overviewSource = readFileSync(new URL('./GuestPortfolioOverview.tsx', import.meta.url), 'utf8');

describe('My Stocks overview', () => {
  it('uses the My Stocks language without a shared-workspace information panel', () => {
    expect(overviewSource).toContain('My stocks overview');
    expect(overviewSource).toContain('data-testid="guest-portfolio-overview"');
    expect(overviewSource).not.toContain('Shared portfolio');
    expect(overviewSource).not.toContain('administrator');
  });

  it('uses complete stock totals and leaves incomplete values unavailable', () => {
    expect(overviewSource).toContain('summarizeGuestCashHoldings(holdings)');
    expect(overviewSource).toContain("summary.marketValue !== null ? formatUSD(summary.marketValue) : '—'");
    expect(overviewSource).toContain("summary.costBasis !== null ? formatUSD(summary.costBasis) : '—'");
    expect(overviewSource).toContain("summary.unrealizedPnl === null ? '—'");
    expect(overviewSource).not.toContain('calculateGuestPersonalEquity');
  });

  it('does not render a separate data-health, refresh or timestamp panel', () => {
    expect(overviewSource).not.toContain('Assigned data health');
    expect(overviewSource).not.toContain('Last successful refresh');
    expect(overviewSource).not.toContain('refreshIntervalMs');
    expect(overviewSource).not.toContain('PortfolioSyncButton');
    expect(overviewSource).not.toContain('summarizeQuoteFreshness');
  });

  it('explains missing quotes or cost basis without manufacturing zero values', () => {
    expect(overviewSource).toContain('Complete market value is unavailable until every stock has a valid quote.');
    expect(overviewSource).toContain('Complete cost basis is unavailable until every stock has a valid average entry price.');
    expect(overviewSource).toContain('Unpriced stocks');
  });
});
