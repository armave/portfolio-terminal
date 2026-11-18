import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getWorkspaceNavigationViews } from '../ui/tabNavigation';

const tickerTabSource = readFileSync(new URL('./TickerTab.tsx', import.meta.url), 'utf8');
const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

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

  it('keeps Margin destinations exclusive to admins while guests retain Balance, History and Settings', () => {
    expect(getWorkspaceNavigationViews(['AAPL'], false, true))
      .toEqual(['BALANCE', 'GUEST_HISTORY', 'SETTINGS']);
    expect(getWorkspaceNavigationViews(['AAPL'], false, false))
      .toEqual(['BALANCE', 'SETTINGS']);
    expect(tickerTabSource).toContain('{isAdmin && tickers.length === 1 &&');
    expect(tickerTabSource).toContain('{isAdmin && tickers.length > 1 &&');
    expect(tickerTabSource).toContain('{canViewGuestHistory && (');
    expect(tickerTabSource).toContain("translateText('History', getAppLanguage())");
  });

  it('preserves selected, pressed, focus and touch feedback in the mobile navigation dock', () => {
    expect(stylesheet).toContain('.workspace-nav-button[aria-pressed="true"]');
    expect(stylesheet).toContain('.workspace-nav-button:active');
    expect(stylesheet).toContain('.workspace-nav-button:focus-visible');
    expect(stylesheet).toContain('@media (hover: hover) and (pointer: fine)');
    expect(stylesheet).not.toContain('#tickerTabs button,');
  });

  it('does not expose a dedicated guest refresh-assigned-data control', () => {
    expect(tickerTabSource).not.toContain('PortfolioSyncButton');
    expect(tickerTabSource).not.toContain('Refresh assigned holdings and history');
    expect(tickerTabSource).not.toContain('portfolio:sync-request');
  });
});
