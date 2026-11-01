import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const marker = '/* Fluid workspace system: adapt to the space each desk actually receives. */';
const fluidStyles = stylesheet.slice(stylesheet.lastIndexOf(marker));

describe('fluid workspace styles', () => {
  it('uses fluid layout tokens instead of a single fixed page rhythm', () => {
    expect(fluidStyles).toMatch(/--layout-gutter:\s*clamp\(/);
    expect(fluidStyles).toMatch(/--layout-stack-gap:\s*clamp\(/);
    expect(fluidStyles).toMatch(/--surface-radius:\s*clamp\(/);
    expect(fluidStyles).toMatch(/#root\s*\{[^}]*padding:\s*clamp\(/s);
  });

  it('switches the trading workspace based on available container width', () => {
    expect(fluidStyles).toMatch(/container-name:\s*portfolio-workspace;/);
    expect(fluidStyles).toMatch(/container-type:\s*inline-size;/);
    expect(fluidStyles).toMatch(/@container\s+portfolio-workspace\s*\(min-width:\s*72rem\)/);
    expect(fluidStyles).toMatch(/#tradingWorkspaceGrid\.trading-workspace-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.72fr\)\s+minmax\(20rem,\s*0\.88fr\)/s);
  });

  it('adapts financial summary columns to their own available width', () => {
    expect(fluidStyles).toMatch(/container-name:\s*portfolio-metrics;/);
    expect(fluidStyles).toMatch(/@container\s+portfolio-metrics\s*\(max-width:\s*52rem\)/);
    expect(fluidStyles).toMatch(/@container\s+portfolio-metrics\s*\(max-width:\s*36rem\)/);
    expect(fluidStyles).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(fluidStyles).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums;/);
  });

  it('keeps detailed tables scrollable and terminal height responsive', () => {
    expect(fluidStyles).toMatch(/\.table-scroll-wrapper,\s*#projectionTableContainer\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(fluidStyles).toMatch(/#projectionTableContainer table\s*\{[^}]*min-width:\s*max\(100%,\s*34rem\)/s);
    expect(fluidStyles).toMatch(/#terminalLog\s*\{[^}]*height:\s*clamp\(/s);
  });

  it('respects reduced-motion preferences', () => {
    expect(fluidStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(fluidStyles).toMatch(/transition:\s*none\s*!important;/);
  });
});
