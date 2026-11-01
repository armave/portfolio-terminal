import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function getTableHeaderTags(source: string): string[] {
  return Array.from(source.matchAll(/<th\b[^>]*>/g), ([tag]) => tag);
}

describe('Stage 10 accessibility wiring', () => {
  it('uses shared modal focus behavior for News and restores focus to the article trigger', () => {
    const source = readSource('../components/MarketInsightsPanel.tsx');
    expect(source).toContain("import { createPortal } from 'preact/compat'");
    expect(source).toContain('document.body');
    expect(source).toContain('news-article-content min-h-0 flex-1');
    expect(source).toContain('useDialogFocus(newsDialogRef, {');
    expect(source).toContain('active: selectedNews !== null');
    expect(source).toContain('initialFocusRef: newsCloseButtonRef');
    expect(source).toContain('restoreFocusRef: newsTriggerRef');
    expect(source).toContain('onEscape: closeNewsDialog');
    expect(source).toContain('ref={newsCloseButtonRef}');
    expect(source).not.toContain('NEWS_DIALOG_FOCUSABLE_SELECTOR');
  });

  it('uses shared modal focus behavior for Market Depth and restores its trigger', () => {
    const source = readSource('../components/MarketDepthButton.tsx');
    expect(source).toContain('useDialogFocus(dialogRef, {');
    expect(source).toContain('active: isOpen');
    expect(source).toContain('initialFocusRef: closeButtonRef');
    expect(source).toContain('restoreFocusRef: triggerRef');
    expect(source).toContain('onEscape: closeModal');
    expect(source).toContain('ref={dialogRef} tabIndex={-1}');
    expect(source).toContain('ref={closeButtonRef}');
  });

  it('keeps the terminal log keyboard-scrollable and avoids forcing readers back to the latest line', () => {
    const source = readSource('../components/TerminalLog.tsx');

    expect(source).toContain('shouldFollowLatestRef.current) viewport.scrollTop = viewport.scrollHeight');
    expect(source).toContain('shouldFollowLatestRef.current = isTerminalLogAtBottom(viewport)');
    expect(source).toContain('role="region" aria-label="Terminal activity log" tabIndex={0}');
    expect(source).toContain('onScroll={handleViewportScroll}');
  });

  it('makes News and Stocktwits feeds keyboard-scrollable named regions', () => {
    const source = readSource('../components/MarketInsightsPanel.tsx');

    expect(source).toContain('role="region" aria-label="Company news articles" tabIndex={0}');
    expect(source).toContain('role="region" aria-label="Stocktwits messages" tabIndex={0}');
  });

  it('makes long modal content keyboard-scrollable and labelled by its dialog title', () => {
    const news = readSource('../components/MarketInsightsPanel.tsx');
    const report = readSource('../components/ScenarioReportModal.tsx');
    const comparison = readSource('../components/ScenarioComparisonModal.tsx');
    const intelligence = readSource('../components/MarginIntelligenceModal.tsx');

    expect(news).toContain('role="region" aria-labelledby="newsArticleModalTitle" tabIndex={0}');
    expect(report).toContain('role="region" aria-labelledby="scenarioReportTitle" tabIndex={0}');
    expect(comparison).toContain('role="region" aria-labelledby="scenarioComparisonTitle" tabIndex={0}');
    expect(intelligence).toContain('role="region" aria-labelledby="marginIntelligenceTitle" tabIndex={0}');
  });

  it('provides scoped row and column headings for scenario comparison tables', () => {
    const source = readSource('../components/ScenarioComparisonModal.tsx');

    expect(source).toContain('<caption class="sr-only">{data.title}</caption>');
    expect(source).toContain('<th scope="col"');
    expect(source).toContain('<th scope="row"');
  });

  it('uses a body portal and viewport-sized scrolling for Market Depth on mobile', () => {
    const source = readSource('../components/MarketDepthButton.tsx');
    const stylesheet = readSource('../../style.css');

    expect(source).toContain("import { createPortal } from 'preact/compat'");
    expect(source).toContain('isOpen && createPortal(');
    expect(source).toContain('document.body');
    expect(source).toContain('market-depth-dialog flex min-h-0');
    expect(source).toContain('market-depth-content min-h-0 flex-1');
    expect(source).toContain('role="region" aria-label={`Market depth order book for ${ticker}`} tabIndex={0}');
    expect(stylesheet).toContain('.market-depth-modal');
    expect(stylesheet).toContain('height: 100dvh;');
    expect(stylesheet).toContain('.market-depth-content');
    expect(stylesheet).toContain('max-height: min(calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 1.5rem), 52rem);');
  });

  it('renders order-book levels with semantic table headings and localized captions', () => {
    const source = readSource('../components/MarketDepthButton.tsx');
    expect(source).toContain('<caption class="sr-only">{caption}</caption>');
    expect(source).toContain("'Bid prices and quantities' : 'Ask prices and quantities'");
    const headers = getTableHeaderTags(source);
    expect(headers).toHaveLength(2);
    expect(headers.every((tag) => tag.includes('scope="col"'))).toBe(true);
  });

  it('makes the Margin projection table a named keyboard-scrollable region', () => {
    const source = readSource('../App.tsx');
    expect(source).toContain('<TableScrollRegion');
    expect(source).toContain('label="Portfolio projection by date"');
    expect(source).toContain('id="projectionTableContainer"');
    expect(source).toContain('</TableScrollRegion>');
  });

  it('gives Cash, LOTS, Closed History, and Settings data tables column headers', () => {
    const paths = [
      '../components/CashCushionDesk.tsx',
      '../components/GuestTrancheHistory.tsx',
      '../components/ClosedHistoryDesk.tsx',
      '../components/SettingsDesk.tsx'
    ];
    for (const path of paths) {
      const headers = getTableHeaderTags(readSource(path));
      expect(headers.length, path).toBeGreaterThan(0);
      expect(headers.every((tag) => tag.includes('scope="col"')), path).toBe(true);
    }
  });

  it('warns before a manual cloud pull can replace local portfolio changes', () => {
    const settings = readSource('../components/SettingsDesk.tsx');
    const app = readSource('../../app.ts');

    expect(settings).toContain("aria-label={translateText('Replace local portfolio from KV cloud')}");
    expect(settings).toContain("aria-label={translateText('Reset local and cloud portfolio data')}");
    expect(settings).toContain("Export a JSON backup before pulling cloud state or resetting the portfolio.");
    expect(app).toContain("if (!window.confirm(translateText(\"Pulling cloud will replace this device's local portfolio with the shared KV cloud snapshot. Any changes that have not synced can be lost. Export a JSON backup first if you may need them. Continue?\"))) return;");
    expect(app).toContain("void syncCloudState('pull');");
  });

  it('gives new user credentials explicit accessible names', () => {
    const source = readSource('../components/SettingsDesk.tsx');
    expect(source).toContain('aria-label="User name"');
    expect(source).toContain('aria-label="Password (6+ characters)"');
  });
});
