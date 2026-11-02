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


describe('Margin projection and insights layout', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const projectionSource = readFileSync(new URL('../components/ProjectionsTable.tsx', import.meta.url), 'utf8');

  it('places the projection table and market insights in the same responsive workspace row', () => {
    const workspaceStart = appSource.indexOf('id="marginDataWorkspace"');
    const projection = appSource.indexOf('<ProjectionsTable />', workspaceStart);
    const insights = appSource.indexOf('<MarketInsightsPanel />', workspaceStart);
    const workspaceEnd = appSource.indexOf('</div>', insights);
    expect(workspaceStart).toBeGreaterThan(-1);
    expect(projection).toBeGreaterThan(workspaceStart);
    expect(insights).toBeGreaterThan(projection);
    expect(workspaceEnd).toBeGreaterThan(insights);
    expect(appSource).toContain('margin-workspace-layout');
  });

  it('animates Margin projection page rows and keeps its pagination controls fluid', () => {
    expect(projectionSource).toContain('projection-page-row');
    expect(projectionSource).toContain('projection-pagination-controls');
    expect(projectionSource).toContain('aria-live="polite"');
    expect(fluidStyles).toContain('#projectionTableContainer .projection-page-row');
    expect(fluidStyles).toContain('animation: projection-page-swap 160ms');
    expect(fluidStyles).toContain('@keyframes projection-page-swap');
    expect(fluidStyles).toContain('#projectionTableContainer .projection-pagination-controls');
    expect(fluidStyles).toContain('flex-wrap: wrap;');
  });

  it('uses two columns only when the Margin desk has enough room and stacks on smaller screens', () => {
    expect(fluidStyles).toMatch(/#tradingWorkspaceGrid\.margin-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(fluidStyles).toMatch(/container-name:\s*margin-desk;/);
    expect(fluidStyles).toMatch(/@container\s+margin-desk\s*\(min-width:\s*56rem\)/);
    expect(fluidStyles).toMatch(/\.margin-data-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s+minmax\(18rem,\s*0\.85fr\)/s);
    expect(fluidStyles).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{\s*\.margin-data-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  });
});


describe('table pagination, Settings, and Auth fluid interactions', () => {
  const closedHistorySource = readFileSync(new URL('../components/ClosedHistoryDesk.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../components/SettingsDesk.tsx', import.meta.url), 'utf8');
  const authSource = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');

  it('animates the keyed Trades page body and keeps pagination controls connected accessibly', () => {
    expect(closedHistorySource).toContain('<div key={tradesPage} class="closed-history-page-transition">');
    expect(closedHistorySource).not.toContain('<tbody key={tradesPage}');
    expect(closedHistorySource).toContain('closed-history-page-transition');
    expect(closedHistorySource).toContain('closed-history-pagination');
    expect(closedHistorySource).toContain('aria-controls="closedTradesTableBody"');
    expect(fluidStyles).toMatch(/\.closed-history-page-transition\s*\{[^}]*display:\s*flow-root/s);
    expect(fluidStyles).toMatch(/\.closed-history-pagination-controls\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(fluidStyles).toMatch(/\.table-pagination-button:not\(:disabled\):hover/);
  });

  it('gives Settings a fluid container, responsive toolbar, panels, and scrollable user table', () => {
    expect(settingsSource).toContain('id="settingsDesk"');
    expect(settingsSource).toContain('settings-user-form');
    expect(settingsSource).toContain('settings-user-panel');
    expect(settingsSource).toContain('settings-broker-rules');
    expect(fluidStyles).toMatch(/container-name:\s*settings-workspace;/);
    expect(fluidStyles).toMatch(/@container\s+settings-workspace\s*\(min-width:\s*54rem\)/);
    expect(fluidStyles).toMatch(/#settingsDesk \.settings-table-scroll table\s*\{[^}]*min-width:\s*49rem/s);
  });

  it('keeps Auth transitions responsive and gives fields and status messages smooth feedback', () => {
    expect(authSource).toContain('auth-dialog-surface');
    expect(authSource).toContain('auth-form');
    expect(authSource).toContain('auth-input');
    expect(authSource).toContain('auth-feedback');
    expect(fluidStyles).toMatch(/#auth-container \.auth-dialog-surface\s*\{[^}]*max-height:/s);
    expect(fluidStyles).toMatch(/#auth-container \.auth-input:focus-visible/);
    expect(fluidStyles).toMatch(/@keyframes auth-feedback-enter/);
    expect(fluidStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
  });

  it('respects reduced-motion settings for the new page, Settings, and Auth interactions', () => {
    expect(fluidStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.closed-history-page-transition/);
    expect(fluidStyles).toMatch(/#settingsDesk \.settings-panel/);
    expect(fluidStyles).toMatch(/#auth-container \.auth-submit-button/);
  });
});


describe('table page swaps and shared desk loading reveals', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const cashSource = readFileSync(new URL('../components/CashCushionDesk.tsx', import.meta.url), 'utf8');
  const closedSource = readFileSync(new URL('../components/ClosedHistoryDesk.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../components/SettingsDesk.tsx', import.meta.url), 'utf8');

  it('animates pagination on a keyed block wrapper outside table-internal elements', () => {
    expect(closedSource).toContain('<div key={tradesPage} class="closed-history-page-transition">');
    expect(closedSource).toContain('<tbody id="closedTradesTableBody"');
    expect(closedSource).not.toContain('<tbody key={tradesPage}');
    expect(fluidStyles).toMatch(/\.closed-history-page-transition\s*\{[^}]*display:\s*flow-root/s);
    expect(fluidStyles).toMatch(/@keyframes trades-page-swap/);
    expect(fluidStyles).toMatch(/animation:\s*trades-page-swap\s+180ms/);
  });

  it('reveals ready content after the shell-level loading screens for each desk', () => {
    expect(appSource).toContain('desk-content-reveal');
    expect(cashSource).not.toContain('desk-content-reveal');
    expect(closedSource).not.toContain('desk-content-reveal rounded-xl');
    expect(settingsSource).not.toContain('settings-desk desk-content-reveal');
    expect(appSource).toContain('<div class="desk-content-reveal">');
    expect(fluidStyles).toMatch(/@keyframes desk-content-reveal/);
    expect(fluidStyles).toMatch(/animation:\s*desk-content-reveal\s+180ms/);
  });

  it('uses one reduced-motion rule for page swaps and all desk reveals', () => {
    expect(fluidStyles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.desk-content-reveal,[\s\S]*\.closed-history-page-transition/);
  });
});


describe('cross-platform navigation and motion performance', () => {
  it('keeps global scrolling immediate and reserves hover transforms for fine pointers', () => {
    expect(stylesheet).toMatch(/html\s*\{\s*scroll-behavior:\s*auto;/);
    expect(stylesheet).toMatch(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
    expect(stylesheet).not.toMatch(/button:hover:not\(:disabled\)\s*\{[^}]*transform/);
  });

  it('uses blur-free, short desk and pagination animations', () => {
    const motionStart = stylesheet.indexOf('/* Page changes animate a normal block wrapper');
    const motionStyles = stylesheet.slice(motionStart);
    expect(motionStyles).toContain('animation: desk-content-reveal 180ms');
    expect(motionStyles).toContain('animation: trades-page-swap 180ms');
    expect(motionStyles).toContain('animation: projection-page-swap 160ms');
    expect(motionStyles).not.toMatch(/filter:\s*blur/);
  });
});
