import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const historySource = readFileSync(new URL('./GuestTrancheHistory.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

describe('guest assignment history presentation', () => {
  it('uses assignment terminology and keeps the history table semantically labelled', () => {
    expect(historySource).toContain("translateText('Assignment History', getAppLanguage())");
    expect(historySource).toContain('Guest assignment history table');
    expect(historySource).toContain('<caption class="sr-only">Guest assignment history table</caption>');
    expect(historySource).toContain("data-label={translateText('Assigned shares', getAppLanguage())}");
    expect(historySource).toContain("data-label={translateText('Remaining shares', getAppLanguage())}");
  });

  it('renders compact labelled cards on mobile while retaining the desktop table', () => {
    expect(historySource).toContain('guest-assignment-history-table');
    expect(stylesheet).toContain('@media (max-width: 767px)');
    expect(stylesheet).toContain('.guest-assignment-history-table tbody tr');
    expect(stylesheet).toContain('content: attr(data-label)');
    expect(stylesheet).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
  });

  it('distinguishes missing assignment history from a filtered no-results state', () => {
    expect(historySource).toContain('No assignment history is available yet.');
    expect(historySource).toContain('No assignments match these filters.');
  });
});
