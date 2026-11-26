import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(new URL('./CashActivityLedger.tsx', import.meta.url), 'utf8');
}

describe('Cash Activity read-only ledger', () => {
  it('renders normalized source records in the shared responsive and paginated table pattern', () => {
    const source = readSource();

    expect(source).toContain("useTablePagination('cash-activity', filteredRows.length, 10)");
    expect(source).toContain('sliceTablePage(filteredRows, pagination.currentPage, pagination.pageSize)');
    expect(source).toContain('<TableScrollRegion');
    expect(source).toContain('<table class="min-w-[56rem] w-full border-collapse text-left text-xs">');
    expect(source).toContain('<thead');
    expect(source).toContain('<tbody id="cashActivityTable"');
    expect(source).toContain('visibleRows.map(row => {');
    expect(source).toContain('<tr key={row.id}');
    expect(source).toContain('<TablePagination');
    expect(source).not.toContain('<article key={row.id}');
  });

  it('does not expose a manual cash posting form or store mutation', () => {
    const source = readSource();
    expect(source).not.toContain('<form');
    expect(source).not.toContain('postCashActivity');
    expect(source).not.toContain('ManualCashActivity');
    expect(source).not.toContain('Record manual cash activity');
    expect(source).not.toContain('portfolioStore.');
    expect(source).not.toContain('setFreeCash');
    expect(source).not.toContain('setCashBalance');
    expect(source).not.toContain('setMarginDebt');
  });

  it('filters by search, category, period, source and data quality, and can clear filters', () => {
    const source = readSource();
    expect(source).toContain('row.id, row.description');
    expect(source).toContain('sourceFilter');
    expect(source).toContain('qualityFilter');
    expect(source).toContain("translateText('All sources'");
    expect(source).toContain("translateText('All qualities'");
    expect(source.match(/pagination\.setPage\(1\)/g)).toHaveLength(6);
    expect(source).toContain("translateText('Clear filters'");
  });

  it('keeps account balances separate from filtered, verified USD cashflow summaries', () => {
    const source = readSource();
    expect(source).toContain("translateText('Current available USD cash'");
    expect(source).toContain("translateText('Current margin debt'");
    expect(source).toContain("translateText('Filtered verified inflows · USD'");
    expect(source).toContain("translateText('Filtered verified outflows · USD'");
    expect(source).toContain("translateText('Filtered verified net USD movement'");
    expect(source).toContain('Math.max(0, -snapshot.balance)');
    expect(source).toContain("row.quality === 'verified' && row.currency === 'USD' && !row.debtOnly");
  });

  it('uses the shared broker date parser and preserves date-only display precision', () => {
    const source = readSource();
    expect(source).toContain('parseFreedomCashflowDate(row.date)');
    expect(source).toContain('dateOnly: parsedDate?.dateOnly ?? false');
    expect(source).toContain('formatDate(row.timestamp, row.dateOnly)');
    expect(source).toContain("timeZone: 'UTC'");
  });

  it('uses eligible verified USD rows only and shows coverage before interpreting totals', () => {
    const source = readSource();
    expect(source).toContain('const netUsdMovement = knownInflows - knownOutflows');
    expect(source).toContain('hasVerifiedUsdCashActivity ? currencyAmount(value, sign) :');
    expect(source).toContain('row.amount !== null && row.timestamp !== null && row.signedCash !== null');
    expect(source).toContain("translateText('verified USD cash movements included in totals.'");
    expect(source).toContain("translateText('records are excluded from verified USD totals");
    expect(source).toContain("translateText('Margin interest recorded separately'");
  });

  it('retains historical manual rows as provisional and excludes them from verified summaries', () => {
    const source = readSource();
    expect(source).toContain("event.source === 'manual-cash-activity'");
    expect(source).toContain("quality: event.source === 'manual-cash-activity'");
    expect(source).toContain("'Historical manual entry · unverified'");
    expect(source).toContain("row.quality !== 'verified'");
    expect(source).toContain("'margin.adjustment'");
    expect(source).toContain('signedDebt');
  });

  it('retains the distinction between cash movement and debt-only margin interest', () => {
    const source = readSource();
    expect(source).toContain('const signedDisplay = row.debtOnly');
    expect(source).toContain(': row.signedCash;');
    expect(source).toContain("translateText('Debt only'");
    expect(source).toContain("translateText('Cash / debt impact'");
  });
});
