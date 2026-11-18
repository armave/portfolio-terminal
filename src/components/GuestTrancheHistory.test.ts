import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const historySource = readFileSync(new URL('./GuestTrancheHistory.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

describe('My Stocks history presentation', () => {
  it('uses My Stocks terminology and keeps the history table semantically labelled', () => {
    expect(historySource).toContain("translateText('My Stocks', getAppLanguage())");
    expect(historySource).toContain('My stocks history table');
    expect(historySource).toContain('Shares</th>');
    expect(historySource).toContain("data-label={translateText('Shares', getAppLanguage())}");
    expect(historySource).toContain("data-label={translateText('Remaining shares', getAppLanguage())}");
    expect(historySource).not.toContain('Assignment History');
    expect(historySource).not.toContain('Assigned shares');
  });

  it('renders compact labelled cards on mobile while retaining the desktop table', () => {
    expect(historySource).toContain('guest-assignment-history-table');
    expect(stylesheet).toContain('@media (max-width: 767px)');
    expect(stylesheet).toContain('.guest-assignment-history-table tbody tr');
    expect(stylesheet).toContain('content: attr(data-label)');
    expect(stylesheet).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('uses stock-focused empty and removed states', () => {
    expect(historySource).toContain('No stock history yet.');
    expect(historySource).toContain('No stocks match these filters.');
    expect(historySource).toContain("unassigned: 'Removed'");
    expect(historySource).not.toContain('No assignment history');
    expect(historySource).not.toContain('unassigned</span>');
  });
});
