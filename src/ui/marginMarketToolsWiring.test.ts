import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const summarySource = readFileSync(new URL('../components/SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

describe('Market Tools wiring', () => {
  it('keeps Market Insights and Margin Intelligence launchers in the metrics grid', () => {
    expect(summarySource).toContain('class="portfolio-micro-column portfolio-micro-actions"');
    expect(summarySource).toContain('<BoardExternalLinks />');
    expect(summarySource).toContain('<MarginMarketTools isAdmin={isAdmin} />');
    expect(summarySource).toContain('<MarginMarketTools ticker={pos.ticker} isAdmin={isAdmin} />');
    expect(summarySource).toContain("emitUiEvent('margin:intelligence-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("emitUiEvent('market:depth-request', { ticker })");
    expect(summarySource).toContain("emitUiEvent('scenario:buy-more-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("emitUiEvent('scenario:exit-comparison-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("translateText('Buy More', language)");
    expect(summarySource).toContain("translateText('Compare Exits', language)");
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
