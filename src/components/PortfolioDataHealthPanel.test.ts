import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { translateText } from '../services/i18n';

const source = readFileSync(new URL('./PortfolioDataHealthPanel.tsx', import.meta.url), 'utf8');
const style = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const englishCopy = [
  'Data health', 'Needs review', 'Data current', 'Checking data status',
  'Broker snapshot', 'Assigned snapshot', 'Quote freshness',
  'Cloud synchronization', 'Assigned data refresh', 'Review in Settings'
];

describe('Portfolio Data Health panel', () => {
  it('renders only the role-scoped data source selected by the pure selector', () => {
    expect(source).toContain('selectPortfolioDataHealthSource(state, isAdmin)');
    expect(source).toContain('source.role === \'admin\' ? source.brokerAccountInfo : undefined');
    expect(source).toContain('source.role === \'guest\' ? source.guestSnapshot : undefined');
    expect(source).toContain('summarizeGuestPortfolioQuoteFreshness(guestSnapshot');
  });

  it('provides an expandable, accessible status summary and existing sync/recovery actions', () => {
    expect(source).toContain('aria-expanded={expanded}');
    expect(source).toContain('aria-controls="portfolioDataHealthDetails"');
    expect(source).toContain('role="region"');
    expect(source).toContain("emitUiEvent('portfolio:sync-request'");
    expect(source).toContain("emitUiEvent('portfolio:set-active-view', { view: 'SETTINGS' })");
    expect(source).toContain('disabled={syncing}');
    expect(source).toContain('hasCloudConflict');
  });

  it('keeps the data-health panel compact and mobile-width bounded', () => {
    expect(style).toContain('.portfolio-data-health__trigger');
    expect(style).toContain('.portfolio-data-health__details');
    expect(style).toMatch(/\.portfolio-data-health__trigger\s*\{[^}]*min-height:\s*2\.75rem/s);
    expect(style).toMatch(/\.portfolio-data-health__action,\s*\.empty-state-panel__actions button\s*\{[^}]*min-height:\s*2\.75rem/s);
    expect(style).toMatch(/\.portfolio-data-health__details\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(style).toMatch(/@media\s*\(max-width:\s*639px\)[\s\S]*?\.portfolio-data-health__details\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*1rem\)/);
    expect(style).toMatch(/width:\s*min\(29rem,\s*calc\(100vw\s*-\s*2rem\)\)/);
    expect(style).toContain('@media (max-width: 639px)');
  });

  it('keeps all newly introduced health labels in the application translation flow', () => {
    for (const copy of englishCopy) expect(source).toContain(copy);
    expect(source).not.toContain('Cloud status details from Worker payload');
  });

  it('provides Russian translations for the complete health-panel vocabulary', () => {
    for (const copy of [
      ...englishCopy, 'Cloud', 'Current', 'Partial snapshot', 'Empty snapshot',
      'Stale snapshot', 'Status unknown', 'No tracked quotes', 'No assigned holdings'
    ]) {
      expect(translateText(copy, 'ru'), copy).not.toBe(copy);
    }
  });
});
