import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const summarySource = readFileSync(new URL('../components/SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const marketToolsStyles = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

describe('Market Tools wiring', () => {
  it('keeps Market Insights and Margin Intelligence launchers in a separate tools row after Margin Health', () => {
    expect(summarySource).toContain('class="portfolio-market-tools"');
    expect(summarySource).toContain('<div class="portfolio-market-tools-row">');
    expect(summarySource.indexOf('<MarginRiskGaugeCard')).toBeLessThan(summarySource.indexOf('<div class="portfolio-market-tools-row">'));
    expect(summarySource).toContain('<BoardExternalLinks />');
    expect(summarySource).toContain('<MarginMarketTools isAdmin={isAdmin} />');
    expect(summarySource).toContain('<MarginMarketTools ticker={pos.ticker} isAdmin={isAdmin} />');
    expect(summarySource).toContain("emitUiEvent('margin:intelligence-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("emitUiEvent('market:depth-request', { ticker })");
    expect(summarySource).toContain("emitUiEvent('scenario:buy-more-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("emitUiEvent('scenario:exit-comparison-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("translateText('Simulate Buy', language)");
    expect(summarySource).toContain("translateText('Compare Exits', language)");
    expect(summarySource).toContain("const reviewLabel = ticker ? 'AI Risk Review' : 'AI Portfolio Review';");
    expect(summarySource).toContain('aria-label={translateText(reviewLabel, language)}');
    expect(summarySource).toContain("translateText('Live Order Book', language)");
    expect(summarySource).toContain("ticker && isAdmin && marketDepthAvailable");
  });

  it('keeps card hover and pressed feedback independent from page-entry animation', () => {
    const animationRuleStart = marketToolsStyles.indexOf('.closed-history-page-transition');
    const animationRuleOpen = marketToolsStyles.indexOf('{', animationRuleStart);
    const animationSelectors = marketToolsStyles.slice(animationRuleStart, animationRuleOpen).trim();
    const cardRule = marketToolsStyles.match(/\.market-tool-card\s*\{([^}]*)\}/)?.[1] ?? '';
    const hoverRule = marketToolsStyles.match(/\.market-tool-card:hover\s*\{([^}]*)\}/)?.[1] ?? '';
    const activeRule = marketToolsStyles.match(/\.market-tool-card:active\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(animationSelectors).toBe('.closed-history-page-transition');
    expect(cardRule).toContain('transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease;');
    expect(hoverRule).toContain('transform: translateY(-1px);');
    expect(activeRule).toContain('transform: translateY(0);');
  });

  it('wires the read-only Market Tools dialogs through semantic app events', () => {
    expect(appSource).toContain("addUiEventListener('scenario:exit-comparison-request', handleExitComparisonRequest)");
    expect(appSource).toContain("removeUiEventListener('scenario:exit-comparison-request', handleExitComparisonRequest)");
    expect(appSource).toContain('<ExitComparisonModal');
    expect(appSource).toContain('initialTicker={exitComparisonRequest.ticker}');
    expect(appSource).toContain('portfolio-terminal:exit-comparison:v1:');
    expect(appSource).toContain("addUiEventListener('scenario:buy-more-request', handleBuyMoreRequest)");
    expect(appSource).toContain("removeUiEventListener('scenario:buy-more-request', handleBuyMoreRequest)");
    expect(appSource).toContain('<BuyMoreModal');
    expect(appSource).toContain('initialTicker={buyMoreRequest.ticker}');
    expect(appSource).toContain('portfolio-terminal:buy-more:v1:');
  });

  it('keeps Market Depth and analyst targets in the board, not in a console toolbar', () => {
    const titleRowStart = appSource.indexOf('id="boardTitleRow"');
    const title = appSource.indexOf('id="boardTitle"', titleRowStart);
    const analystTarget = appSource.indexOf('id="boardAnalystConsensus"', titleRowStart);
    const actionsRow = appSource.indexOf('id="boardTitleActions"', titleRowStart);

    expect(titleRowStart).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(titleRowStart);
    expect(analystTarget).toBeGreaterThan(title);
    expect(actionsRow).toBeGreaterThan(analystTarget);
    expect(appSource).toContain('boardAnalystConsensus');
    expect(appSource).not.toContain('TradingConsole');
    expect(appSource).not.toContain('tradingTerminalColumn');
  });
});
