import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('semantic workspace headings', () => {
  it('provides a primary heading for the Margin desk and empty state', () => {
    expect(readSource('../App.tsx')).toContain('<h1 class="board-title-text');
    expect(readSource('../components/EmptyStatePanel.tsx')).toContain('<h1 class="text-lg font-black');
  });

  it('provides a primary heading for each standalone workspace destination through the shared header', () => {
    const sharedHeader = readSource('../components/DeskPageHeader.tsx');
    for (const path of [
      '../components/CashCushionDesk.tsx',
      '../components/ClosedHistoryDesk.tsx',
      '../components/SettingsDesk.tsx',
      '../components/GuestTrancheHistory.tsx'
    ]) {
      const source = readSource(path);
      expect(source).toContain("import { DeskPageHeader } from './DeskPageHeader';");
      expect(source).toContain('<DeskPageHeader');
    }
    expect(sharedHeader).toContain('<h1 id={titleId} class="desk-page-header__title md:justify-start justify-center">');
  });

});
