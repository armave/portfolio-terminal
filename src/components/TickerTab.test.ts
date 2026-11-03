import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tickerTabSource = readFileSync(new URL('./TickerTab.tsx', import.meta.url), 'utf8');
const tickerTabsStart = tickerTabSource.indexOf('export const TickerTabs');
const syncButtonStart = tickerTabSource.indexOf('export function PortfolioSyncButton');
const syncButtonSource = tickerTabSource.slice(syncButtonStart);

describe('navigation portfolio sync control', () => {
  it('uses a dedicated full-sync action instead of a quote-only nav refresh', () => {
    expect(syncButtonStart).toBeGreaterThan(tickerTabsStart);
    expect(syncButtonSource).toContain("translateText('Sync portfolio', getAppLanguage())");
    expect(syncButtonSource).toContain("emitUiEvent('portfolio:sync-request'");
    expect(syncButtonSource).toContain('onClick={handleSyncPortfolio}');
    expect(tickerTabSource).not.toContain('id="refreshQuotesButton"');
  });

  it('keeps automatic navigation quote refresh separate from full sync', () => {
    expect(tickerTabSource).toContain("emitUiEvent('portfolio:refresh-live-prices'");
    expect(tickerTabSource).toContain('if (refreshQuotes) void handleRefreshQuotes();');
    expect(tickerTabSource.slice(tickerTabsStart, syncButtonStart)).not.toContain('portfolio:sync-request');
  });

  it('shows sync only to administrators and authenticated guests, even with no current holdings', () => {
    expect(syncButtonSource).toContain('isAdmin = false');
    expect(syncButtonSource).toContain('userId?: string');
    expect(syncButtonSource).toContain('if (!isAdmin && !userId) return null;');
  });
});
