import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const rootTokens = stylesheet.match(/^:root\s*\{([\s\S]*?)^\}/m)?.[1] ?? '';
const reducedMotionRules = stylesheet.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g) ?? [];
const contrastRules = stylesheet.match(/@media\s*\(prefers-contrast:\s*more\)\s*\{/g) ?? [];

describe('stylesheet architecture and shared policies', () => {
  it('keeps base design tokens in one root block while high-contrast values remain conditional', () => {
    expect(stylesheet.match(/^:root\s*\{/gm) ?? []).toHaveLength(1);
    expect(rootTokens).toContain('--control-height: 2.75rem;');
    expect(rootTokens).toContain('--surface-hover: rgba(148, 163, 184, 0.08);');
    expect(rootTokens).toMatch(/--layout-gutter:\s*clamp\(/);
    expect(rootTokens).toMatch(/--layout-stack-gap:\s*clamp\(/);
    expect(rootTokens).toMatch(/--surface-radius:\s*clamp\(/);
    expect(rootTokens).toContain('--surface-shadow:');
    expect(rootTokens).toContain('--surface-shadow-hover:');
    expect(rootTokens).toContain('--motion-fluid:');
    expect(contrastRules).toHaveLength(1);
    expect(stylesheet).toContain('@media (forced-colors: active)');
  });

  it('uses one global reduced-motion policy for animations, transitions, and smooth scrolling', () => {
    expect(reducedMotionRules).toHaveLength(1);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none\s*!important;[\s\S]*?transition:\s*none\s*!important;/);
    expect(stylesheet).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?scroll-behavior:\s*auto\s*!important;/);
  });

  it('defines the mounted auth overlay transition in one canonical rule set', () => {
    const start = stylesheet.indexOf('/* Keep the auth overlay mounted so its exit transition can finish cleanly. */');
    const end = stylesheet.indexOf('/* Scenario comparison modal:', start);
    const transitionRules = stylesheet.slice(start, end);

    expect(transitionRules.match(/#auth-container\.auth-overlay\s*\{/g) ?? []).toHaveLength(1);
    expect(transitionRules.match(/#auth-container\.auth-overlay \.auth-card\s*\{/g) ?? []).toHaveLength(1);
    expect(transitionRules.match(/#auth-container\.auth-overlay\.auth-overlay-open\s*\{/g) ?? []).toHaveLength(1);
    expect(transitionRules.match(/#auth-container\.auth-overlay\.auth-overlay-open \.auth-card\s*\{/g) ?? []).toHaveLength(1);
    expect(transitionRules).toContain('display: flex;');
  });

  it('retains explicit transform resets for animated workspace, modal, and pagination elements', () => {
    const policyStart = stylesheet.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    const policy = stylesheet.slice(policyStart);
    for (const selector of [
      '.desk-content-reveal',
      '.closed-history-page-transition',
      '.desk-section-loading',
      '.news-dialog-enter',
      '.expandable-motion',
      '#auth-container .auth-feedback'
    ]) {
      expect(policy).toContain(selector);
    }
    expect(policy).toContain('transform: none !important;');
  });

  it('keeps mobile header shrink rules beside the existing workspace navigation breakpoint', () => {
    const navStart = stylesheet.indexOf('/* Keep the ticker strip independent on desktop');
    const mobileBreakpoint = stylesheet.indexOf('@media (max-width: 768px)', navStart);
    const navSectionEnd = stylesheet.indexOf('/* Compact destination captions for phone-sized navigation. */', mobileBreakpoint);
    const navStyles = stylesheet.slice(mobileBreakpoint, navSectionEnd);
    expect(navStyles).toContain('.board-header-banner > .flex');
    expect(navStyles).toContain('#tickerTabs');
    expect(navStyles).toContain('min-width: 0;');
    expect(stylesheet.slice(navSectionEnd)).not.toMatch(/@media\s*\(max-width:\s*768px\)\s*\{[^}]*#tickerTabs/);
  });
});
