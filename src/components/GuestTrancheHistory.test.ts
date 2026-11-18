import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const historySource = readFileSync(new URL('./GuestTrancheHistory.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

describe('guest History presentation', () => {
  it('uses History terminology and keeps the history table semantically labelled', () => {
    expect(historySource).toContain("translateText('History', getAppLanguage())");
    expect(historySource).toContain("translateText('Closed assignments', getAppLanguage())");
    expect(historySource).toContain("translateText('Closed assignment', getAppLanguage())");
    expect(historySource).toContain("translateText('Open cost basis', getAppLanguage())");
    expect(historySource).toContain("translateText('Open market value', getAppLanguage())");
    expect(historySource).toContain("translateText('Date', getAppLanguage())");
    expect(historySource).toContain("translateText('Source', getAppLanguage())");
    expect(historySource).toContain("translateText('Value', getAppLanguage())");
    expect(historySource).toContain("translateText('Net P&L', getAppLanguage())");
    expect(historySource).toContain('Stock history table');
    expect(historySource).toContain('Shares</th>');
    expect(historySource).toContain("data-label={translateText('Shares', getAppLanguage())}");
    expect(historySource).toContain("data-label={translateText('Remaining shares', getAppLanguage())}");
    expect(historySource).not.toContain('My stocks history table');
    expect(historySource).not.toContain('Assignment History');
    expect(historySource).not.toContain('Assigned shares');
  });

  it('offers one-tap date ranges and editable bounded custom dates', () => {
    expect(historySource).toContain('getHistoryDateRangeForPreset');
    expect(historySource).toContain("label: 'All time'");
    expect(historySource).toContain("label: '7 days'");
    expect(historySource).toContain("label: '30 days'");
    expect(historySource).toContain("label: '90 days'");
    expect(historySource).toContain("label: 'This month'");
    expect(historySource).toContain('aria-pressed={datePreset === value}');
    expect(historySource).toContain('max={toDate || undefined}');
    expect(historySource).toContain('min={fromDate || undefined}');
    expect(historySource).toContain('updateCustomDateRange');
    expect(stylesheet).toContain('.guest-history-date-preset--active');
  });

  it('renders compact labelled cards on mobile while retaining the desktop table', () => {
    expect(historySource).toContain('guest-assignment-history-table');
    expect(stylesheet).toContain('@media (max-width: 767px)');
    expect(stylesheet).toContain('.guest-assignment-history-table tbody tr');
    expect(stylesheet).toContain('content: attr(data-label)');
    expect(stylesheet).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(stylesheet).toContain('.guest-assignment-history-scroll .guest-assignment-history-table');
    expect(stylesheet).toContain('max-width: 100%;');
    expect(stylesheet).toContain('min-width: 0;');
    expect(stylesheet).toContain('overflow-x: clip;');
  });

  it('uses stock-focused empty and removed states', () => {
    expect(historySource).toContain('No stock history yet.');
    expect(historySource).toContain('No stocks match these filters.');
    expect(historySource).toContain("unassigned: 'Removed'");
    expect(historySource).not.toContain('No assignment history');
    expect(historySource).not.toContain('unassigned</span>');
  });
});
