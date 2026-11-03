import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const navigationComponent = readFileSync(new URL('../components/TickerTab.tsx', import.meta.url), 'utf8');
const marker = '/* Keep the ticker strip independent on desktop and merge it into the centered';
const markerIndex = stylesheet.lastIndexOf(marker);
const mobileNavigationStyles = markerIndex >= 0 ? stylesheet.slice(markerIndex) : '';

describe('mobile workspace navigation styles', () => {
  it('centers all destinations together in one wrapping group on small screens', () => {
    expect(mobileNavigationStyles).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*justify-content:\s*center;/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*overflow-x:\s*visible;/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs>\.workspace-nav-ticker-list\s*\{\s*display:\s*contents;/);
  });

  it('keeps the ticker strip independently scrollable on larger screens', () => {
    expect(mobileNavigationStyles).toMatch(/#tickerTabs>\.workspace-nav-ticker-list\s*\{[^}]*flex:\s*0\s+1\s+min\(52vw,\s*52rem\)/s);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs>\.workspace-nav-ticker-list\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs>\.workspace-nav-ticker-list\s*\{[^}]*min-width:\s*0;/s);
    expect(mobileNavigationStyles).toMatch(/\.workspace-nav-ticker-list>\*\s*\{[^}]*flex:\s*0\s+0\s+auto;/s);
    expect(stylesheet.match(/#tickerTabs\s*\{/g) || []).toHaveLength(2);
  });

  it('allows the mobile header flex row and workspace container to shrink around the ticker scroll region', () => {
    expect(stylesheet).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?\.board-header-banner\s*>\s*\.flex\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
    expect(stylesheet).toMatch(/@media\s*\(max-width:\s*768px\)[\s\S]*?#tickerTabs\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  });

  it('keeps compact phone captions and groups ticker choices separately from fixed destinations', () => {
    expect(mobileNavigationStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(mobileNavigationStyles).toMatch(/\.workspace-nav-label--desktop\s*\{\s*display:\s*none;/);
    expect(mobileNavigationStyles).toMatch(/\.workspace-nav-label--mobile\s*\{\s*display:\s*inline;/);
    expect(navigationComponent).toContain('class="workspace-nav-ticker-list"');
    expect(navigationComponent).toContain("aria-label={translateText('MARGIN DESK', getAppLanguage())}");
    expect(navigationComponent).toContain("translateText('COMBINED PORTFOLIO', getAppLanguage())");
    expect(navigationComponent).toContain("translateText('BALANCE', getAppLanguage())");
    expect(navigationComponent).toContain("translateText('LOTS', getAppLanguage())");
    expect(navigationComponent).toContain("translateText('TRADES', getAppLanguage())");
    expect(navigationComponent).toContain("translateText('Settings', getAppLanguage())");
  });

  it('retains the Balance equity badge and its partial-valuation accessible name', () => {
    expect(navigationComponent).toContain("isAdmin ? 'workspace-nav-equity-badge--admin' : ''");
    expect(navigationComponent).toContain("aria-label={`" + "$" + "{translateText('Balance', getAppLanguage())}: " + "$" + "{equityBadgeText}. " + "$" + "{equityBadgeTitle}`}");
    expect(mobileNavigationStyles).toMatch(/\.workspace-nav-equity-badge--admin\s*\{\s*display:\s*none;/);
  });
});
