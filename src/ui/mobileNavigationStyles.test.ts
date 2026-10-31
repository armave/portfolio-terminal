import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const navigationComponent = readFileSync(new URL('../components/TickerTab.tsx', import.meta.url), 'utf8');
const marker = '/* Mobile workspace navigation wraps without hiding destinations. */';
const markerIndex = stylesheet.lastIndexOf(marker);
const mobileNavigationStyles = markerIndex >= 0 ? stylesheet.slice(markerIndex) : '';

describe('mobile workspace navigation styles', () => {
  it('wraps every destination into visible rows on narrow screens', () => {
    expect(mobileNavigationStyles).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*overflow-x:\s*visible;/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*overflow-y:\s*visible;/);
    expect(mobileNavigationStyles).toMatch(/#tickerTabs\s*\{[^}]*scroll-snap-type:\s*none;/);
  });

  it('uses compact Combined and ticker captions only on phone-sized screens', () => {
    expect(mobileNavigationStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(mobileNavigationStyles).toMatch(/\.workspace-nav-label--desktop\s*\{\s*display:\s*none;/);
    expect(mobileNavigationStyles).toMatch(/\.workspace-nav-label--mobile\s*\{\s*display:\s*inline;/);
    expect(navigationComponent).toContain('<span class="workspace-nav-label--mobile">COMBINED</span>');
    expect(navigationComponent).toContain('<span class="workspace-nav-label--mobile">{tickers[0]}</span>');
    expect(navigationComponent).toContain('<span class="workspace-nav-label--desktop">COMBINED PORTFOLIO</span>');
    expect(navigationComponent).toContain('aria-label="Combined portfolio"');
    expect(navigationComponent).toContain('aria-label={\`Margin: \${tickers[0]}\`}');
  });
});
