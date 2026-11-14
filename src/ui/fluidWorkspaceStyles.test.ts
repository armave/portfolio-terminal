import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const marker = '/* Fluid workspace layout: adapt to the space each desk actually receives. */';
const fluidStyles = stylesheet.slice(stylesheet.lastIndexOf(marker));

describe('fluid workspace styles', () => {
  it('keeps the main portfolio workspace single-column without a command console', () => {
    expect(fluidStyles).toMatch(/container-name:\s*portfolio-workspace;/);
    expect(fluidStyles).toMatch(/#tradingWorkspaceGrid\.trading-workspace-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(fluidStyles).not.toMatch(/grid-template-columns:\s*minmax\(0,\s*1\.72fr\)\s+minmax\(20rem,\s*0\.88fr\)/s);
  });

  it('adapts financial summary columns to their own available width', () => {
    expect(fluidStyles).toMatch(/\.board-title-row\s*\{[^}]*flex-direction:\s*row;[^}]*flex-wrap:\s*wrap;/s);
    expect(fluidStyles).toMatch(/#boardTitle\s*\{[^}]*flex:\s*1\s+1\s+0;[^}]*width:\s*auto;/s);
    expect(fluidStyles).toMatch(/#boardAnalystConsensus\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(fluidStyles).toMatch(/container-name:\s*portfolio-metrics;/);
    expect(fluidStyles).toMatch(/\.portfolio-micro-summary\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
    expect(fluidStyles).toMatch(/\.portfolio-micro-costs,\s*\.portfolio-micro-actions\s*\{[^}]*grid-column:\s*auto;/s);
    expect(fluidStyles).toMatch(/@container\s+portfolio-metrics\s*\(max-width:\s*52rem\)/);
    expect(fluidStyles).toMatch(/@container\s+portfolio-metrics\s*\(max-width:\s*36rem\)/);
    expect(fluidStyles).toMatch(/overflow-wrap:\s*anywhere;/);
    expect(fluidStyles).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums;/);
  });

  it('keeps detailed portfolio tables scrollable', () => {
    expect(fluidStyles).toMatch(/\.table-scroll-wrapper,\s*#projectionTableContainer\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(fluidStyles).toMatch(/#projectionTableContainer table\s*\{[^}]*min-width:\s*max\(100%,\s*30rem\)/s);
    expect(fluidStyles).toMatch(/#marketInsightsPanel\s*\{[^}]*min-width:\s*0;/s);
  });
});

describe('Margin projection and insights layout', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const projectionSource = readFileSync(new URL('../components/ProjectionsTable.tsx', import.meta.url), 'utf8');
  const paginationSource = readFileSync(new URL('../components/TablePagination.tsx', import.meta.url), 'utf8');

  it('places the projection table and market insights in the same responsive workspace row', () => {
    const workspaceStart = appSource.indexOf('id="marginDataWorkspace"');
    const projection = appSource.indexOf('<MemoProjectionsTable />', workspaceStart);
    const insights = appSource.indexOf('<MarketInsightsPanel />', workspaceStart);
    const workspaceEnd = appSource.indexOf('</div>', insights);
    expect(workspaceStart).toBeGreaterThan(-1);
    expect(projection).toBeGreaterThan(workspaceStart);
    expect(insights).toBeGreaterThan(projection);
    expect(workspaceEnd).toBeGreaterThan(insights);
    expect(appSource).toContain('id="tradingWorkspaceGrid" class="trading-workspace-grid"');
  });

  it('combines the accrued fee total and daily margin interest in the Fee & Comm. column', () => {
    expect(appSource).toContain("translateText('Fee & Comm.', getAppLanguage())");
    expect(appSource).not.toContain("translateText('Margin fee', getAppLanguage())");
    expect(projectionSource).toContain('{formatUSD(feesAndCommissions)} ({formatUSD(dailyFee)})');
    expect(projectionSource).not.toContain('marginFee');
    expect(projectionSource).toContain('colSpan={3}');
    expect(projectionSource).not.toContain('colSpan={5}');
  });

  it('animates Margin projection page rows and keeps pagination controls accessible and fluid', () => {
    expect(projectionSource).toContain('projection-page-row');
    expect(projectionSource).toContain('controlsClassName="projection-pagination-controls"');
    expect(projectionSource).toContain('<TablePagination');
    expect(paginationSource).toContain('aria-live="polite"');
    expect(paginationSource).toContain('TABLE_PAGE_SIZE_OPTIONS');
    expect(fluidStyles).toContain('#projectionTableContainer .projection-page-row');
    expect(fluidStyles).toContain('animation: projection-page-swap 160ms');
    expect(fluidStyles).toContain('@keyframes projection-page-swap');
    expect(fluidStyles).toContain('#projectionTableContainer .projection-pagination-controls');
    expect(fluidStyles).toContain('flex-wrap: wrap;');
  });

  it('keeps the Margin data workspace responsive within the desk width', () => {
    expect(fluidStyles).toMatch(/\.margin-data-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(fluidStyles).toMatch(/container-name:\s*margin-desk;/);
    expect(fluidStyles).toMatch(/@container\s+margin-desk\s*\(min-width:\s*56rem\)/);
    expect(fluidStyles).toMatch(/\.margin-data-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(18rem,\s*1fr\)/s);
    expect(fluidStyles).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{\s*\.margin-data-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  });
});

describe('desk transitions and supporting layouts', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const cashSource = readFileSync(new URL('../components/CashCushionDesk.tsx', import.meta.url), 'utf8');
  const closedSource = readFileSync(new URL('../components/ClosedHistoryDesk.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../components/SettingsDesk.tsx', import.meta.url), 'utf8');
  const authSource = readFileSync(new URL('../components/AuthModal.tsx', import.meta.url), 'utf8');

  it('animates Trades pagination on a keyed block wrapper outside table internals', () => {
    expect(closedSource).toContain('<div key={pagination.currentPage} class="closed-history-page-transition">');
    expect(closedSource).toContain('<tbody id="closedTradesTableBody"');
    expect(closedSource).toContain('className="closed-history-pagination pt-2"');
    expect(closedSource).toContain('controlsClassName="closed-history-pagination-controls"');
    expect(closedSource).toContain('controlsId="closedTradesTableBody"');
    expect(closedSource).not.toContain('<tbody key={pagination.currentPage}');
    expect(fluidStyles).toMatch(/\.closed-history-page-transition\s*\{[^}]*display:\s*flow-root/s);
    expect(fluidStyles).toMatch(/@keyframes trades-page-swap/);
    expect(fluidStyles).toMatch(/animation:\s*trades-page-swap\s+180ms/);
    expect(fluidStyles).toMatch(/\.closed-history-pagination-controls\s*\{[^}]*flex-wrap:\s*wrap;/s);
  });

  it('gives Settings the same centered bordered workspace shell as the main page', () => {
    expect(appSource).toContain('class={"border-card p-4 sm:p-6 rounded-xl space-y-4 max-w-6xl mx-auto " + (activeDeskView === "SETTINGS" ? "" : "hidden")} id="settings"');
  });

  it('gives Settings a fluid container, responsive panels, and a scrollable user table', () => {
    expect(settingsSource).toContain('id="settingsDesk"');
    expect(settingsSource).toContain('settings-user-form');
    expect(settingsSource).toContain('settings-user-panel');
    expect(settingsSource).toContain('settings-broker-rules');
    expect(fluidStyles).toMatch(/container-name:\s*settings-workspace;/);
    expect(fluidStyles).toMatch(/@container\s+settings-workspace\s*\(min-width:\s*54rem\)/);
    expect(fluidStyles).toMatch(/#settingsDesk \.settings-table-scroll table\s*\{[^}]*min-width:\s*49rem/s);
  });

  it('keeps Auth transitions responsive and provides visible focus feedback', () => {
    expect(authSource).toContain('auth-dialog-surface');
    expect(authSource).toContain('auth-form');
    expect(authSource).toContain('auth-input');
    expect(authSource).toContain('auth-feedback');
    expect(fluidStyles).toMatch(/#auth-container \.auth-dialog-surface\s*\{[^}]*max-height:/s);
    expect(fluidStyles).toMatch(/#auth-container \.auth-input:focus-visible/);
    expect(fluidStyles).toMatch(/@keyframes auth-feedback-enter/);
    expect(fluidStyles).toMatch(/@media\s*\(max-width:\s*480px\)/);
  });

  it('reveals ready desk content after the shared loading shell', () => {
    expect(appSource).toContain('desk-content-reveal');
    expect(cashSource).not.toContain('desk-content-reveal');
    expect(closedSource).not.toContain('desk-content-reveal rounded-xl');
    expect(settingsSource).not.toContain('settings-desk desk-content-reveal');
    expect(appSource).toContain('<div class="desk-content-reveal">');
    expect(fluidStyles).toMatch(/@keyframes desk-content-reveal/);
    expect(fluidStyles).toMatch(/animation:\s*desk-content-reveal\s+180ms/);
  });
});


describe('Margin desk localization', () => {
  const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
  const summarySource = readFileSync(new URL('../components/SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
  const projectionSource = readFileSync(new URL('../components/ProjectionsTable.tsx', import.meta.url), 'utf8');
  const russianSource = readFileSync(new URL('../services/i18n-ru.ts', import.meta.url), 'utf8');

  it('routes projection table labels and its accessible description through i18n', () => {
    for (const label of [
      'Portfolio workspace',
      'Portfolio summary metrics',
      'Market insights',
      'Preparing portfolio metrics',
      'Loading portfolio metrics…',
      'Portfolio projection by date',
      'Projected portfolio net value, fees and commissions (including accrued margin interest), daily margin interest, and balance by date.',
      'Date',
      'Net',
      'Fee & Comm.',
      'Balance'
    ]) {
      expect(appSource).toContain(`translateText('${label}', getAppLanguage())`);
    }
    expect(appSource).not.toContain('<th scope="col" class="py-2 px-3">F&amp;C</th>');
    expect(appSource).not.toContain('<th scope="col" class="py-2 px-3">M Fee</th>');
  });

  it('localizes all static Margin summary metric labels', () => {
    for (const label of ['Shares / Tranches', 'Invested / Avg. Entry', 'Share Price / Market Value']) {
      expect(summarySource).toContain(`translateText('${label}', getAppLanguage())`);
    }
  });

  it('localizes projection entry, status, and pagination copy', () => {
    for (const label of [
      'No active position to project.',
      'Entry',
      'Position opened · projection values start today',
      'TODAY',
      'BREAKEVEN',
      'EOW · +{days}d',
      'NTD · +{days}d'
    ]) {
      expect(projectionSource).toContain(`translateText('${label}', getAppLanguage())`);
    }
    expect(projectionSource).toContain("useTablePagination('portfolio-projection'");
    expect(projectionSource).toContain('<TablePagination');
    for (const label of [
      'Rows', 'Rows per page for {table}', 'Pagination for {table}',
      'Previous page', 'Next page', 'Rows {start}–{end} of {total}', 'Page {current} of {total}'
    ]) {
      expect(paginationSource).toContain(`translateText('${label}', language)`);
      expect(russianSource).toContain(`'${label}':`);
    }
  });

  it('provides Russian translations for the combined fee header and projection description', () => {
    expect(russianSource).toContain("'Fee & Comm.': 'Комиссии и сборы'");
    expect(russianSource).toContain("'Projected portfolio net value, fees and commissions (including accrued margin interest), daily margin interest, and balance by date.':");
  });
});
