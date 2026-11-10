import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const summarySource = readFileSync(new URL('../components/SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const quickActionsSource = readFileSync(new URL('../components/ConsoleQuickActions.tsx', import.meta.url), 'utf8');

describe('Margin Market Tools placement', () => {
  it('provides news review and external research in the fourth metrics column', () => {
    expect(summarySource).toContain('class="portfolio-micro-column portfolio-micro-actions"');
    expect(summarySource).toContain('<BoardExternalLinks />');
    expect(summarySource).toContain('<MarginMarketTools isAdmin={isAdmin} />');
    expect(summarySource).toContain('<MarginMarketTools ticker={pos.ticker} isAdmin={isAdmin} />');
    expect(summarySource).toContain("emitUiEvent('terminal:margin-intelligence-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("emitUiEvent('terminal:market-depth-request', { ticker })");
    expect(summarySource).toContain('ticker && isAdmin && marketDepthAvailable && <button');
    expect(summarySource).toContain("const reviewLabel = ticker ? 'News + Review' : 'Portfolio Review'");
    expect(summarySource).toContain("emitUiEvent('terminal:buy-more-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("translateText('Buy More', language)");
  });

  it('wires the Market Tools launcher to the lazy, account-scoped exit comparison modal', () => {
    expect(appSource).toContain("addUiEventListener('terminal:exit-comparison-request', handleExitComparisonRequest)");
    expect(appSource).toContain("removeUiEventListener('terminal:exit-comparison-request', handleExitComparisonRequest)");
    expect(appSource).toContain('<ExitComparisonModal');
    expect(appSource).toContain('initialTicker={exitComparisonRequest.ticker}');
    expect(appSource).toContain('portfolio-terminal:exit-comparison:v1:');
    expect(appSource).toContain("addUiEventListener('terminal:buy-more-request', handleBuyMoreRequest)");
    expect(appSource).toContain("removeUiEventListener('terminal:buy-more-request', handleBuyMoreRequest)");
    expect(appSource).toContain('<BuyMoreModal');
    expect(appSource).toContain('initialTicker={buyMoreRequest.ticker}');
    expect(appSource).toContain('portfolio-terminal:buy-more:v1:');
  });

  it('keeps the analyst target beside the ticker title in one wrapping header row', () => {
    const titleRowStart = appSource.indexOf('id="boardTitleRow"');
    const title = appSource.indexOf('id="boardTitle"', titleRowStart);
    const analystTarget = appSource.indexOf('id="boardAnalystConsensus"', titleRowStart);
    const actionsRow = appSource.indexOf('id="boardTitleActions"', titleRowStart);

    expect(titleRowStart).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(titleRowStart);
    expect(analystTarget).toBeGreaterThan(title);
    expect(actionsRow).toBeGreaterThan(analystTarget);
    expect(appSource).toContain('class={"board-analyst-consensus " + analystConsensus.className}');
  });

  it('keeps the remaining review actions out of their previous toolbar and console locations', () => {
    expect(summarySource).not.toContain('MarketDepthButton');
    expect(appSource).not.toContain('MarketDepthButton');
    expect(appSource).not.toContain('BoardExternalLinks');
    expect(appSource).toContain('boardAnalystConsensus');
    expect(quickActionsSource).not.toContain('News + Review');
    expect(quickActionsSource).not.toContain('Portfolio Review');
    expect(quickActionsSource).not.toContain('Compare Exits…');
    expect(quickActionsSource).not.toContain('Buy More Scenario…');
    expect(summarySource).toContain("translateText('Compare Exits', language)");
    expect(summarySource).toContain("emitUiEvent('terminal:exit-comparison-request', ticker ? { ticker } : {})");
  });
});
