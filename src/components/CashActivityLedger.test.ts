import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(new URL('./CashActivityLedger.tsx', import.meta.url), 'utf8').replace(/\\r\\n/g, '\\n');
}

describe('Cash Activity shared table', () => {
  it('renders normalized cash records in the shared responsive and paginated table pattern', () => {
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

  it('resets to the first page when search, category, or period filters change', () => {
    const source = readSource();
    expect(source.match(/pagination\\.setPage\\(1\\)/g) || []).toHaveLength(3);
  });

  it('retains the distinction between cash movement and debt-only margin interest', () => {
    const source = readSource();
    expect(source).toContain('const signedDisplay = row.debtOnly');
    expect(source).toContain(': row.signedCash;');
    expect(source).toContain("translateText('Debt only', getAppLanguage())");
    expect(source).toContain("translateText('Cash / debt impact', getAppLanguage())");
    expect(source).toContain("row.quality !== 'verified'");
  });
});
