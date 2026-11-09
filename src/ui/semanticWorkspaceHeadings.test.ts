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

  it('provides a primary heading for each standalone workspace destination', () => {
    expect(readSource('../components/CashCushionDesk.tsx')).toContain('<h1 class="text-lg font-black text-cyan-400');
    expect(readSource('../components/ClosedHistoryDesk.tsx')).toContain('<h1 class="flex items-center gap-2');
    expect(readSource('../components/SettingsDesk.tsx')).toContain('<h1 class="text-lg font-black text-slate-200');
    expect(readSource('../components/GuestTrancheHistory.tsx')).toContain('<h1 id="guestTrancheHistoryHeading"');
  });

  it('uses a subordinate heading for the Trading Console section', () => {
    expect(readSource('../components/TradingConsole.tsx')).toContain('<h2 class="text-xs font-bold text-slate-200');
  });
});
