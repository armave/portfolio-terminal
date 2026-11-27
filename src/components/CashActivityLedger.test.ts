import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(new URL('./CashActivityLedger.tsx', import.meta.url), 'utf8');
}

describe('Cash Activity read-only ledger', () => {
  it('uses stacked mobile cards and retains the desktop semantic table and pagination', () => {
    const source = readSource();

    expect(source).toContain("useTablePagination('cash-activity', filteredRows.length, 10)");
    expect(source).toContain('sliceTablePage(filteredRows, pagination.currentPage, pagination.pageSize)');
    expect(source).toContain('<div class="mt-3 space-y-2 sm:hidden">');
    expect(source).toContain('<article key={row.id}');
    expect(source).toContain('<details class="mt-1 text-[11px] text-slate-500">');
    expect(source).toContain('<div class="hidden sm:block">');
    expect(source).toContain('<TableScrollRegion');
    expect(source).toContain('<table class="min-w-[68rem] w-full border-collapse text-left text-xs">');
    expect(source).toContain('<thead');
    expect(source).toContain('<tbody id="cashActivityTable"');
    expect(source).toContain('visibleRows.map(row => {');
    expect(source).toContain('<tr key={row.id}');
    expect(source).toContain('<TablePagination');
  });

  it('renders trade settlements as signed cash legs and order holds as non-settled reservations', () => {
    const source = readSource();
    expect(source).toContain("trade: 'Trade settlement'");
    expect(source).toContain("order_reservation: 'Order reservation'");
    expect(source).toContain("row.category === 'order_reservation'");
    expect(source).toContain("translateText('Reservation only · no settled cash impact'");
    expect(source).toContain("translateText('order reservations / releases'");
    expect(source).toContain('typeCode: raw.type_code');
    expect(source).toContain('category: classification.category');
    expect(source).toContain('hasKnownCashflowDirection(classification.category)');
    expect(source).toContain("or because they are not settled cash movements.");
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
    expect(source).toContain('const periodStartDate = startAt === null ? null : new Date(startAt)');
    expect(source).toContain('row.dateOnly && periodStartDate');
  });

  it('shows signed broker-reported amounts without inventing classified cash impact', () => {
    const source = readSource();
    expect(source).toContain('reportedAmount: amount');
    expect(source).toContain('hasProviderSignedSum\n        ? amount');
    expect(source).toContain("translateText('Broker-reported amount'");
    expect(source).toContain("row.quality === 'unclassified'");
    expect(source).toContain("row.identityQuality === 'provider'");
    expect(source).toContain("translateText('Data quality details:'");
    expect(source).toContain("translateText('unclassified operations'");
    expect(source).toContain("translateText('provisional identities'");
  });

  it('uses eligible verified USD rows only and shows coverage before interpreting totals', () => {
    const source = readSource();
    expect(source).toContain('const netUsdMovement = knownInflows - knownOutflows');
    expect(source).toContain('hasVerifiedUsdCashActivity ? currencyAmount(value, sign) :');
    expect(source).toContain('row.amount !== null && row.timestamp !== null && row.signedCash !== null');
    expect(source).toContain("translateText('verified USD cash movements included in totals.'");
    expect(source).toContain("translateText('records are excluded from verified USD totals");
    expect(source).toContain("translateText('order reservations / releases'");
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
    expect(source).toContain('function cashImpact(row: CashActivityRow): number | null');
    expect(source).toContain('return row.debtOnly');
    expect(source).toContain(': row.signedCash;');
    expect(source).toContain("translateText('Debt only'");
    expect(source).toContain("translateText('Cash / debt impact'");
  });
});
