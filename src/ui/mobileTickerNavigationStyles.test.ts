import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const tickerSource = readFileSync(new URL('../components/TickerTab.tsx', import.meta.url), 'utf8');
const mobileRules = stylesheet.slice(stylesheet.lastIndexOf(
  '/* Keep mobile workspace destinations visible while ticker navigation scales horizontally. */'
));

describe('scalable mobile ticker navigation', () => {
  it('keeps the ticker rail horizontally scrollable instead of expanding into rows', () => {
    expect(mobileRules).toMatch(/#tickerTabs>\.workspace-nav-ticker-list\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1\s+1\s+100%;[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
    expect(mobileRules).toContain('scroll-snap-type: x proximity;');
  });

  it('keeps fixed workspace destinations visible and touch-sized', () => {
    expect(mobileRules).toMatch(/#tickerTabs>button\[data-nav-tab="true"\]\s*\{[^}]*min-height:\s*44px/s);
  });

  it('retains keyboard navigation and scrolls the focused ticker into view', () => {
    expect(tickerSource).toContain('onKeyDown={handleTabKeyDown}');
    expect(tickerSource).toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })");
  });
});
