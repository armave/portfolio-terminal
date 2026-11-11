import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function getTableHeaderTags(source: string): string[] {
  return Array.from(source.matchAll(/<th\b[^>]*>/g), ([tag]) => tag);
}

describe('Stage 10 accessibility wiring', () => {
  it('keeps portfolio synchronization outside the workspace destination group', () => {
    const app = readSource('../App.tsx');
    const ticker = readSource('../components/TickerTab.tsx');
    const settings = readSource('../components/SettingsDesk.tsx');
    const tabsStart = ticker.indexOf('export const TickerTabs');
    const syncStart = ticker.indexOf('export function PortfolioSyncButton');
    expect(tabsStart).toBeGreaterThan(-1);
    expect(syncStart).toBeGreaterThan(tabsStart);
    expect(ticker.slice(tabsStart, syncStart)).toContain('workspace-nav-ticker-list');
    expect(app).not.toContain('<MemoPortfolioSyncButton');
    expect(settings).toContain("emitUiEvent('portfolio:sync-request'");
    expect(app).toContain("aria-label={translateText('Workspace navigation', getAppLanguage())}");
    expect(app).toContain('id="tickerTabs" role="group"');
    expect(ticker).toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })");
  });


  it('uses shared modal focus behavior for News and restores focus to the article trigger', () => {
    const source = readSource('../components/MarketInsightsPanel.tsx');
    expect(source).toContain("import { createPortal, memo } from 'preact/compat';");
    expect(source).toContain('document.body');
    expect(source).toContain('news-article-content min-h-0 flex-1');
    expect(source).toContain('useDialogFocus(newsDialogRef, {');
    expect(source).toContain('active: currentSelectedNews !== null');
    expect(source).toContain('initialFocusRef: newsCloseButtonRef');
    expect(source).toContain('restoreFocusRef: newsTriggerRef');
    expect(source).toContain('onEscape: requestCloseNewsDialog');
    expect(source).toContain('ref={newsCloseButtonRef}');
    expect(source).not.toContain('NEWS_DIALOG_FOCUSABLE_SELECTOR');
  });

  it('mounts Margin Risk Overview at the document root for stable cross-device positioning', () => {
    const modal = readSource('../components/MarginRiskOverviewModal.tsx');
    const styles = readSource('../../style.css');

    expect(modal).toContain("import { createPortal } from 'preact/compat';");
    expect(modal).toContain('document.body');
    expect(styles).toContain('height: 100dvh;');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('.margin-risk-overview-dialog');
  });

  it('makes News and Stocktwits feeds keyboard-scrollable named regions', () => {
    const source = readSource('../components/MarketInsightsPanel.tsx');

    expect(source).toContain('role="region" aria-label="Company news articles" tabIndex={0}');
    expect(source).toContain('role="region" aria-label="Stocktwits messages" tabIndex={0}');
  });

  it('wires translated, focusable controls through the Margin Intelligence dialog', () => {
    const intelligence = readSource('../components/MarginIntelligenceModal.tsx');
    const coverageCopy = readSource('../features/ai/marginIntelligenceCopy.ts');

    expect(intelligence).toContain('formatMarginCoverageStatus(item, getAppLanguage())');
    expect(intelligence).toContain("translateText('News coverage by position', getAppLanguage())");
    expect(intelligence).toContain('min-h-11');
    expect(intelligence).toContain('focus-visible:ring-2');
    expect(coverageCopy).toContain("translateText('Feed unavailable', language)");
    expect(coverageCopy).toContain("translateText('Feed returned no articles', language)");
  });

  it('provides accessible, keyboard-managed controls in the Market Tools exit comparison dialog', () => {
    const exit = readSource('../components/ExitComparisonModal.tsx');
    expect(exit).toContain('useDialogFocus(dialogRef');
    expect(exit).toContain('<ModalFrame');
    expect(exit).toContain('ariaLabelledBy="exitComparisonTitle"');
    expect(exit).toContain('initialFocusRef: closeButtonRef');
    expect(exit).toContain('type="date"');
    expect(exit).toContain('type="number"');
    expect(exit).toContain('min-h-11');
    expect(exit).toContain('focus-visible:ring-2');
    expect(exit).toContain("translateText('Compare Exits', language)");
  });

  it('portals Compare Exits above app layers and constrains it to the safe viewport', () => {
    const exit = readSource('../components/ExitComparisonModal.tsx');
    const styles = readSource('../../style.css');

    expect(exit).toContain("import { createPortal } from 'preact/compat';");
    expect(exit).toContain('document.body');
    expect(exit).toContain('exit-comparison-backdrop');
    expect(exit).toContain('exit-comparison-dialog');
    // useDialogFocus owns the shared reference-counted body + document scroll lock.
    // A second component-local lock would restore "hidden" after shared cleanup.
    expect(exit).toContain('useDialogFocus(dialogRef');
    expect(exit).not.toContain('document.body.style.overflow');
    expect(exit).not.toContain('document.documentElement.style.overflow');
    expect(exit).toContain('formatUSDDisplayValue(value)');
    expect(styles).toContain('.exit-comparison-backdrop {');
    expect(styles).toContain('z-index: 10000;');
    expect(styles).toContain('height: 100dvh;');
    expect(styles).toContain('align-items: center;');
    expect(styles).toContain('overflow-y: auto;');
    expect(styles).toContain('env(safe-area-inset-top)');
    expect(styles).toContain('env(safe-area-inset-bottom)');
    expect(styles).toContain('.exit-comparison-backdrop .exit-comparison-dialog');
    expect(styles).toContain('max-height: calc(');
    expect(styles).toContain('.exit-comparison-dialog>div');
  });

  it('uses the shared modal frame for smooth opening and closing transitions', () => {
    const exit = readSource('../components/ExitComparisonModal.tsx');
    const frame = readSource('../components/ModalFrame.tsx');

    expect(exit).toContain('<ModalFrame');
    expect(exit).toContain('closeRef={closeRef}');
    expect(exit).not.toContain('scheduleDialogClose');
    expect(frame).toContain('MODAL_TRANSITION_MS = 200');
    expect(frame).toContain('view.requestAnimationFrame');
    expect(frame).toContain('window.setTimeout');
    expect(frame).toContain('prefers-reduced-motion: reduce');
    expect(frame).toContain('transform: isVisible');
  });

  it('keeps empty-state, auth, and quote-link actions touch-sized with visible keyboard focus', () => {
    const auth = readSource('../components/AuthModal.tsx');
    const emptyState = readSource('../components/EmptyStatePanel.tsx');
    const externalLinks = readSource('../components/BoardExternalLinks.tsx');

    for (const source of [emptyState, externalLinks]) {
      expect(source).toContain('min-h-11');
      expect(source).toContain('focus-visible:ring-2');
    }
    expect(auth).toContain('focus-visible:ring-2');
    expect(externalLinks).toContain('inline-flex min-h-11 min-w-11 items-center justify-center');
  });

  it('makes long Market Insights and Margin Intelligence content keyboard-scrollable', () => {
    const news = readSource('../components/MarketInsightsPanel.tsx');
    const intelligence = readSource('../components/MarginIntelligenceModal.tsx');

    expect(news).toContain('role="region" aria-labelledby="newsArticleModalTitle" tabIndex={0}');
    expect(intelligence).toContain('role="region" aria-labelledby="marginIntelligenceTitle" tabIndex={0}');
  });



  it('keeps Market Insights news controls touch-sized and visibly keyboard-focused', () => {
    const source = readSource('../components/MarketInsightsPanel.tsx');

    expect(source).toContain('news-feed-item block min-h-11');
    expect(source).toContain('insight-tab min-h-11');
    expect(source).toContain('min-h-11 min-w-11 items-center justify-center');
    expect(source).toContain('inline-flex min-h-11 items-center gap-2');
    expect(source).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400');
  });

  it('keeps Market Insights and portfolio summary actions touch-sized', () => {
    const marketInsights = readSource('../components/MarketInsightsPanel.tsx');
    const summary = readSource('../components/SummaryMetricsGrid.tsx');

    expect(marketInsights.match(/class="min-h-11 rounded border border-slate-700 px-2 py-1 text-\[10px\] font-semibold text-cyan-300 disabled:opacity-50"/g)).toHaveLength(2);
    expect(marketInsights).toContain('class="min-h-11 rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"');
    expect(marketInsights).toContain('class="min-h-11 rounded border border-slate-700 px-2 text-[9px] text-cyan-300 disabled:opacity-40"');
    expect(marketInsights).toContain('class="min-h-11 rounded border border-cyan-700 px-2 py-1 text-[10px] font-semibold text-cyan-300 disabled:opacity-40"');
    expect(marketInsights).toContain('class="min-h-11 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300"');
    expect(summary).toContain('class="min-h-11 rounded border border-cyan-800/70');
    expect(summary).toContain('class="min-h-11 rounded border border-emerald-800/70');
    expect(summary).toContain('inline-flex min-h-11 items-center rounded border border-slate-700/80');
  });

  it('keeps Guest LOTS filters and broker reconciliation actions touch-sized', () => {
    const guestHistory = readSource('../components/GuestTrancheHistory.tsx');
    const reconciliation = readSource('../components/BrokerTransactionReconciliation.tsx');

    expect(guestHistory.match(/class="min-h-11 rounded border border-slate-700/g)).toHaveLength(4);
    expect(guestHistory).not.toContain('class="h-8 rounded border border-slate-700');
    expect(reconciliation.match(/inline-flex min-h-11 min-w-11 items-center justify-center rounded border/g)).toHaveLength(3);
    expect(reconciliation).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300');
    expect(reconciliation).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-300');
  });

  it('keeps Closed History funding controls at least 44px tall for touch use', () => {
    const source = readSource('../components/ClosedHistoryDesk.tsx');

    expect(source).toContain("aria-label={String((trade as any).ticker || 'Trade') + ' funding type'}");
    expect(source.match(/inline-flex min-h-11 min-w-11 items-center justify-center/g)).toHaveLength(6);
    expect(source).toContain("aria-pressed={allocationType === 'cash'}");
    expect(source).toContain("aria-pressed={allocationType === 'margin'}");
    expect(source).toContain("aria-pressed={allocationType === 'mix'}");
  });

  it('does not display missing margin quotes as zero-value positions or false negative returns', () => {
    const source = readSource('../components/SummaryMetricsGrid.tsx');
    expect(source).toContain('getUsableMarketPrice(pos.currentPrice)');
    expect(source).toContain("usableMarketPrice !== null ? formatUSD(usableMarketPrice) : '—'");
    expect(source).toContain("translateText('Unrealized return unavailable', getAppLanguage())");
    expect(source).toContain('unpricedMarginPositionCount > 0');
    expect(source).toContain("translateText('Unpriced positions', getAppLanguage())");
    expect(source).toContain('valuationStatus={valuationStatus}');
    expect(source).toContain('valuationStatus={positionValuationStatus}');
    expect(source).toContain('cashHoldingsForQuotes');
    expect(source).toContain('accountBalanceStale: brokerBalanceIsStale');
    expect(source).toContain("valuationStatus === 'incomplete'");
    expect(source).toContain('Margin risk estimate unavailable until the account balance and every holding can be valued.');
    expect(source).not.toContain('Some market quotes or broker account data are stale, delayed, or lack verifiable observation times.');
  });



  it('marks the compact admin Balance equity badge as partial when holdings are unpriced', () => {
    const source = readSource('../components/TickerTab.tsx');
    expect(source).toContain('portfolioValuation.unpricedHoldings > 0');
    expect(source).toContain('hasPricedPortfolioHoldings = portfolioValuation.pricedHoldings > 0');
    expect(source).toContain('formatPortfolioEquityBadge({');
    expect(source).toContain('hasUnpricedHoldings: isAdmin ? hasUnpricedPortfolioHoldings : hasUnpricedGuestHoldings');
    expect(source).toContain("'Partial value: holdings without a valid market quote are excluded.'");
    expect(source).toContain("aria-label={`${translateText('Balance', getAppLanguage())}: ${equityBadgeText}. ${equityBadgeTitle}`}");
  });

  it('makes the Margin projection table a named keyboard-scrollable region', () => {
    const source = readSource('../App.tsx');
    expect(source).toContain('<TableScrollRegion');
    expect(source).toContain("label={translateText('Portfolio projection by date', getAppLanguage())}");
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

  it('uses the same positive-price fallback across broker cash refresh and tranche valuation', () => {
    const app = readSource('../../app.ts');
    const cashModel = readSource('../features/cash/cashCushionModel.ts');
    expect(app).toContain('getPositiveMarketPrice(holding.currentPrice, holding.price)');
    expect(app.split('const brokerCashHoldings = classified.cashStocks.map((holding) => {').length - 1).toBe(3);
    expect(cashModel).toContain('getCashHoldingMarketPrice(cashHolding || {}) ??');
    expect(cashModel).toContain('getCashHoldingMarketPrice({ currentPrice: tranche.marketPrice })');
  });

  it('warns before a manual cloud pull can replace local portfolio changes', () => {
    const settings = readSource('../components/SettingsDesk.tsx');
    const app = readSource('../../app.ts');

    expect(settings).toContain("aria-label={translateText('Replace local portfolio from KV cloud')}");
    expect(settings).toContain("aria-label={translateText('Reset local and cloud portfolio data')}");
    expect(settings).toContain("Pull cloud replaces this device's local portfolio with the shared KV cloud snapshot. Changes that have not synced can be lost.");
    expect(settings).toContain("Reset deletes saved portfolio and history data from this device and KV cloud. TradeNet records held by the broker are not deleted.");
    expect(settings).toContain("Export a JSON backup before pulling cloud state or resetting the portfolio.");
    expect(app).toContain("if (!window.confirm(translateText(\"Pulling cloud will replace this device's local portfolio with the shared KV cloud snapshot. Any changes that have not synced can be lost. Export a JSON backup first if you may need them. Continue?\"))) return;");
    expect(app).toContain("void syncCloudState('pull');");
  });

  it('gives new user credentials explicit accessible names', () => {
    const source = readSource('../components/SettingsDesk.tsx');
    expect(source).toContain('aria-label="User name"');
    expect(source).toContain('aria-label="Password (6+ characters)"');
  });

  it('keeps admin user-management and broker-rule actions at least 44px for touch use', () => {
    const source = readSource('../components/SettingsDesk.tsx');

    expect(source.match(/min-h-11 min-w-11/g)).toHaveLength(5);
    expect(source).toContain('Add user</button>');
    expect(source).toContain('>Save</button>');
    expect(source).toContain('>Delete</button>');
    expect(source).toContain('Save rules');
    expect(source).toContain('Restore defaults');
  });
});


describe('position integrity valuation guard wiring', () => {
  it('marks a partial broker snapshot as stale for the margin-risk valuation gate', () => {
    const source = readSource('../components/SummaryMetricsGrid.tsx');
    expect(source).toContain("state.brokerAccountInfo?.quality === 'partial'");
    expect(source).toContain('accountBalanceStale: brokerBalanceIsStale');
  });
});
