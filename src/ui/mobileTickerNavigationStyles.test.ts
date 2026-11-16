import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const tickerSource = readFileSync(new URL('../components/TickerTab.tsx', import.meta.url), 'utf8');
const mobileRules = stylesheet.slice(stylesheet.lastIndexOf('/* Mobile navigation dock:'));

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
});

describe('mobile footer workspace navigation', () => {
  it('docks the shared navigation at the viewport footer and respects device safe areas', () => {
    expect(mobileRules).toMatch(/\.workspace-header-destinations\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;/s);
    expect(mobileRules).toContain('env(safe-area-inset-left)');
    expect(mobileRules).toContain('env(safe-area-inset-right)');
    expect(mobileRules).toContain('env(safe-area-inset-bottom)');
    expect(mobileRules).toContain('padding-bottom: calc(5.5rem + env(safe-area-inset-bottom));');
  });

  it('keeps descriptive labels visible and all footer destinations touch-sized', () => {
    expect(mobileRules).toMatch(/\.workspace-nav-button:not\(\.workspace-nav-button--ticker\) \.workspace-nav-button__label,[^}]*\{[^}]*display:\s*inline-flex;/s);
    expect(mobileRules).toContain('min-height: 52px;');
    expect(mobileRules).toContain('flex-direction: column;');
    expect(mobileRules).toContain('.workspace-nav-equity-badge--admin');
  });

  it('keeps a long administrator ticker list independently horizontally scrollable', () => {
    expect(mobileRules).toMatch(/#tickerTabs\s*>\s*\.workspace-nav-ticker-list\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 0;[^}]*overflow-x:\s*auto;/s);
    expect(mobileRules).toContain('scroll-snap-type: x proximity;');
  });

  it('retains keyboard navigation and scrolls the focused ticker into view', () => {
    expect(tickerSource).toContain('onKeyDown={handleTabKeyDown}');
    expect(tickerSource).toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })");
  });
});
