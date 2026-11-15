import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const tickerSource = readFileSync(new URL('../components/TickerTab.tsx', import.meta.url), 'utf8');
const mobileRules = stylesheet.slice(stylesheet.lastIndexOf(
  '/* Keep mobile workspace destinations visible while ticker navigation scales horizontally. */'
));

describe('shared workspace navigation visual system', () => {
  it('uses one standardized button surface and keeps status in a separate header region', () => {
    expect(stylesheet).toContain('.workspace-header-controls {');
    expect(stylesheet).toContain('.workspace-header-destinations {');
    expect(stylesheet).toContain('.workspace-header-status {');
    expect(stylesheet).toContain('.workspace-nav-button {');
    expect(stylesheet).toContain('min-height: 2.75rem;');
    expect(stylesheet).toContain('.workspace-nav-button--active {');
    expect(stylesheet).toContain('.workspace-nav-button__icon {');
    expect(stylesheet).toContain('.workspace-header-status-pill {');
  });

  it('uses icon-first mobile controls while retaining ticker names and touch targets', () => {
    expect(stylesheet).toContain('.workspace-nav-button:not(.workspace-nav-button--ticker) .workspace-nav-button__label');
    expect(stylesheet).toContain('.workspace-nav-button:not(.workspace-nav-button--ticker) .workspace-nav-button__label');
    expect(stylesheet).toContain('.workspace-nav-label--desktop');
    expect(stylesheet).toContain('.workspace-nav-label--mobile');
    expect(stylesheet).toContain('.workspace-nav-button__context { display: none; }');
    expect(stylesheet).toContain('.workspace-nav-button {\n    min-width: 2.75rem;');
  });
});

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
