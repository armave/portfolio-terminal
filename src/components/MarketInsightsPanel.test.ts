import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./MarketInsightsPanel.tsx', import.meta.url), 'utf8');

describe('Combined Market Insights ticker selection', () => {
  it('uses selectedTicker without navigating away from Combined', () => {
    expect(source).toContain('getMarketInsightsTicker(state)');
    expect(source).not.toContain('selectedTicker: state.activeView');
    expect(source).toContain('portfolioStore.setDerivedState({ selectedTicker: nextTicker }, false)');
    expect(source).toContain('id="marketInsightsTickerSelect"');
  });

  it('shows the selector only for Combined view with multiple positions', () => {
    expect(source).toContain("const isCombinedView = activeView === 'COMBINED'");
    expect(source).toContain('isCombinedView && tickerOptions.length > 1');
  });
});


describe('Market Insights news quantity control', () => {
  it('defaults to three visible articles and allows a bounded choice from three through ten', () => {
    expect(source).toContain('const [newsDisplayLimit, setNewsDisplayLimit] = useState(3)');
    expect(source).toContain('currentNewsData.slice(0, newsDisplayLimit)');
    expect(source).toContain('value >= 3 && value <= 10');
    expect(source).toContain('Array.from({ length: 8 }, (_, index) => index + 3)');
    expect(source).toContain("translateText('News count', getAppLanguage())");
  });
});
