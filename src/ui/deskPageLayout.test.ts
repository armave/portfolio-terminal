import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const cashSource = readFileSync(new URL('../components/CashCushionDesk.tsx', import.meta.url), 'utf8');
const tradesSource = readFileSync(new URL('../components/ClosedHistoryDesk.tsx', import.meta.url), 'utf8');
const lotsSource = readFileSync(new URL('../components/GuestTrancheHistory.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../components/SettingsDesk.tsx', import.meta.url), 'utf8');
const headerSource = readFileSync(new URL('../components/DeskPageHeader.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const compactStyles = (source: string) => source.replace(/\s*([>+~{}:;,])\s*/g, '$1').replace(/\s+/g, ' ').trim();
const russian = readFileSync(new URL('../services/i18n-ru.ts', import.meta.url), 'utf8');

describe('standard non-Margin page layout', () => {
  it('keeps Balance, Lots, Trades and Settings inside the shared workspace shell', () => {
    const workspaceStart = appSource.indexOf('id="mainTerminalView"');
    const tradesStart = appSource.indexOf('id="closedHistoryContainer"');
    const settingsStart = appSource.indexOf('id="settings"');
    const workspaceEnd = appSource.indexOf('</main>', settingsStart);

    expect(workspaceStart).toBeGreaterThan(-1);
    expect(tradesStart).toBeGreaterThan(workspaceStart);
    expect(settingsStart).toBeGreaterThan(tradesStart);
    expect(workspaceEnd).toBeGreaterThan(settingsStart);
    expect(appSource).toContain('id="cashCushionContainer" class={"standard-desk-container');
    expect(appSource).toContain('id="guestHistoryContainer"');
    expect(appSource).toContain('standard-desk-container desk-view-transition');
    expect(appSource).toMatch(/id="guestHistoryContainer"\s+class={`standard-desk-container desk-view-transition text-center md:text-left min-w-0/);
    expect(appSource).toMatch(/id="closedHistoryContainer"\s+class={"standard-desk-container desk-view-transition min-w-0/);
    expect(appSource).toMatch(/id="settings"\s+class={"standard-desk-container min-w-0/);
    expect(appSource).not.toMatch(/id="settings"\s+class={"standard-desk-container desk-view-transition/);
  });

  it('does not apply the non-Margin page shell to the Margin board', () => {
    const marginStart = appSource.indexOf('id="mainDeskContainer"');
    const insightsStart = appSource.indexOf('id="marketInsightsPanel"', marginStart);
    expect(marginStart).toBeGreaterThan(-1);
    expect(appSource.slice(marginStart, insightsStart)).not.toContain('standard-desk-container');
  });

  it('uses one shared heading component for all non-Margin desks', () => {
    for (const source of [cashSource, tradesSource, lotsSource, settingsSource]) {
      expect(source).toContain("import { DeskPageHeader } from './DeskPageHeader';");
      expect(source).toContain('<DeskPageHeader');
    }
    expect(headerSource).toContain('<header class="desk-page-header md:text-left text-center">');
    expect(headerSource).toContain('desk-page-header__title');
    expect(headerSource).toContain('desk-page-header__description');
    expect(headerSource).toContain('desk-page-header__trailing');
  });

  it('uses a single outer page surface rather than nested cards', () => {
    expect(tradesSource).toContain('class="desk-page-content min-w-0 space-y-4"');
    expect(tradesSource).not.toContain('rounded-xl border-card p-4 space-y-4');
    expect(lotsSource).toContain('class="desk-page-content min-w-0 space-y-4"');
    expect(lotsSource).not.toContain('rounded-xl border border-indigo-900/50');
    expect(appSource).not.toContain('border-card p-4 sm:p-6 rounded-xl space-y-4 max-w-6xl md:text-left text-center mx-auto');
  });

  it('keeps page headings fluid with trailing metadata on its own mobile row', () => {
    expect(styles).toMatch(/\.standard-desk-container,\s*\.desk-page-content\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
    expect(styles).toMatch(/\.desk-page-header\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
    expect(styles).toMatch(/\.desk-page-header__title\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(styles).toMatch(/@media\s*\(max-width:\s*639px\)\s*\{\s*\.desk-page-header__trailing\s*\{[^}]*width:\s*100%;/s);
  });

  it('hides page title and subtitle visually on mobile while retaining the semantic heading', () => {
    expect(headerSource).toContain('<h1 id={titleId} class="desk-page-header__title');
    expect(styles).toContain('@media (max-width: 767px)');
    expect(styles).toContain('.desk-page-header__copy');
    expect(styles).toContain('clip: rect(0, 0, 0, 0)');
    expect(styles).toContain('clip-path: inset(50%)');
    expect(styles).toContain('width: auto;');
  });

  it('keeps mobile Settings compact without a flow-reserving hidden header', () => {
    expect(settingsSource).toContain('class="settings-desk min-w-0"');
    expect(settingsSource).not.toContain('settings-desk min-w-0 space-y-4');
    expect(styles).toContain('@media (max-width: 767px)');
    expect(compactStyles(styles)).toContain('#settingsDesk>.desk-page-header{');
    expect(styles).toContain('position: absolute;');
    expect(styles).toContain('gap: 0.7rem;');
  });

  it('increases key Settings and volume-badge text and control sizing on mobile', () => {
    expect(styles).toContain('#settingsDesk .settings-section-nav a {');
    expect(styles).toContain('font-size: 0.8rem;');
    expect(styles).toContain('.quote-volume-badge {');
    expect(styles).toContain('font-size: 0.75rem;');
    expect(compactStyles(styles)).toContain('.guest-stock-metrics-grid>div>p:first-child{');
    expect(compactStyles(styles)).toContain('.guest-stock-metrics-grid>div>p:nth-child(2){');
  });

  it('localizes new desk page headings and descriptions in Russian', () => {
    for (const label of [
      'MY STOCKS', 'CASH & NON-MARGIN HOLDINGS', 'LOTS',
      'Manage account, data, and application preferences.',
      'Your cash-funded purchase allocations, including completed and removed assignments',
      'Closed trades and sell executions, including partial sales. Buy executions are used for duration matching, not shown as closed trades.'
    ]) {
      expect(
        russian.includes(`'${label}':`) || russian.includes(`"${label}":`)
      ).toBe(true);
    }
  });
});
