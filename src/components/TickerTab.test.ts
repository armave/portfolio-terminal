import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tickerTabSource = readFileSync(new URL('./TickerTab.tsx', import.meta.url), 'utf8');

describe('navigation portfolio sync control', () => {
  it('uses a dedicated full-sync action instead of a quote-only nav refresh', () => {
    expect(tickerTabSource).toContain('id="syncPortfolioButton"');
    expect(tickerTabSource).toContain("translateText('Sync portfolio', getAppLanguage())");
    expect(tickerTabSource).toContain("emitUiEvent('portfolio:sync-request'");
    expect(tickerTabSource).toContain('onClick={handleSyncPortfolio}');
    expect(tickerTabSource).not.toContain('id="refreshQuotesButton"');
  });

  it('keeps automatic navigation quote refresh separate from full sync', () => {
    expect(tickerTabSource).toContain("emitUiEvent('portfolio:refresh-live-prices'");
    expect(tickerTabSource).toContain('if (refreshQuotes) void handleRefreshQuotes();');
  });

  it('shows sync for signed-in admins and guests even with no current holdings', () => {
    expect(tickerTabSource).toContain('{(isAdmin || Boolean(userId)) && (');
  });
});
