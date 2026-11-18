import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getWorkspaceNavigationViews } from '../ui/tabNavigation';

const tickerTabSource = readFileSync(new URL('./TickerTab.tsx', import.meta.url), 'utf8');
const tickerTabsStart = tickerTabSource.indexOf('export const TickerTabs');
const syncButtonStart = tickerTabSource.indexOf('export function PortfolioSyncButton');
const syncButtonSource = tickerTabSource.slice(syncButtonStart);

describe('standardized workspace navigation controls', () => {
  it('uses one shared icon, label, touch target and active-state contract for every destination', () => {
    expect(tickerTabSource).toContain('function WorkspaceNavigationIcon');
    expect(tickerTabSource).toContain('workspace-nav-button__icon');
    expect(tickerTabSource).toContain('workspace-nav-button__label');
    expect(tickerTabSource).toContain('workspaceNavigationButtonClass');
    expect(tickerTabSource).toContain('data-nav-kind="balance"');
    expect(tickerTabSource).toContain('data-nav-kind="trades"');
    expect(tickerTabSource).toContain('data-nav-kind="lots"');
    expect(tickerTabSource).toContain('data-nav-kind="settings"');
    expect(tickerTabSource).toContain('data-nav-kind="margin-ticker"');
    expect(tickerTabSource).toContain('aria-pressed={isCushionActive}');
  });

  it('keeps Margin destinations exclusive to admins while guests retain Balance, assigned Lots and Settings', () => {
    expect(getWorkspaceNavigationViews(['AAPL'], false, true))
      .toEqual(['BALANCE', 'GUEST_HISTORY', 'SETTINGS']);
    expect(getWorkspaceNavigationViews(['AAPL'], false, false))
      .toEqual(['BALANCE', 'SETTINGS']);
    expect(tickerTabSource).toContain('{isAdmin && tickers.length === 1 &&');
    expect(tickerTabSource).toContain('{isAdmin && tickers.length > 1 &&');
    expect(tickerTabSource).toContain('{canViewGuestHistory && (');
  });
});

describe('navigation portfolio sync control', () => {
  it('uses a dedicated full-sync action instead of a quote-only nav refresh', () => {
    expect(syncButtonStart).toBeGreaterThan(tickerTabsStart);
    expect(syncButtonSource).toContain("translateText('Sync portfolio', getAppLanguage())");
    expect(syncButtonSource).toContain("emitUiEvent('portfolio:sync-request'");
    expect(syncButtonSource).toContain('onClick={handleSyncPortfolio}');
    expect(tickerTabSource).not.toContain('id="refreshQuotesButton"');
  });

  it('keeps the icon-only full-sync action at a 44px touch target', () => {
    expect(syncButtonSource).toContain('min-h-11 min-w-11');
    expect(syncButtonSource).not.toContain('class="h-8');
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


describe('guest navigation terminology', () => {
  it('labels the guest history destination as Assignments rather than Lots', () => {
    expect(tickerTabSource).toContain("translateText('Assignments', getAppLanguage())");
  });

  it('uses an explicit refresh label for a guest portfolio refresh button', () => {
    expect(syncButtonSource).toContain("translateText('Refresh assigned holdings and history', getAppLanguage())");
    expect(syncButtonSource).toContain('aria-label={syncLabel}');
  });
});
