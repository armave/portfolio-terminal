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

  it('gives new user credentials explicit accessible names', () => {
    const source = readSource('../components/SettingsDesk.tsx');
    expect(source).toContain('aria-label="User name"');
    expect(source).toContain('aria-label="Password (6+ characters)"');
  });
});
