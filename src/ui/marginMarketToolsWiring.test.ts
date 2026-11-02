import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const summarySource = readFileSync(new URL('../components/SummaryMetricsGrid.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const quickActionsSource = readFileSync(new URL('../components/ConsoleQuickActions.tsx', import.meta.url), 'utf8');

describe('Margin Market Tools placement', () => {
  it('provides ticker market depth, news review, and external research in the fourth metrics column', () => {
    expect(summarySource).toContain('class="portfolio-micro-column portfolio-micro-actions"');
    expect(summarySource).toContain('<MarketDepthButton ticker={ticker} compact />');
    expect(summarySource).toContain('<BoardExternalLinks />');
    expect(summarySource).toContain('<MarginMarketTools />');
    expect(summarySource).toContain('<MarginMarketTools ticker={pos.ticker} />');
    expect(summarySource).toContain("emitUiEvent('terminal:margin-intelligence-request', ticker ? { ticker } : {})");
    expect(summarySource).toContain("const reviewLabel = ticker ? 'News + Review' : 'Portfolio Review'");
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

  it('removes market-depth and review actions from their previous toolbar and console locations', () => {
    expect(appSource).not.toContain('<MarketDepthButton');
    expect(appSource).not.toContain('BoardExternalLinks');
    expect(appSource).toContain('boardAnalystConsensus');
    expect(quickActionsSource).not.toContain('News + Review');
    expect(quickActionsSource).not.toContain('Portfolio Review');
    expect(quickActionsSource).toContain('Compare Exits…');
  });
});
