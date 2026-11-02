import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Market Insights request lifecycle wiring', () => {
  it('keeps the panel instance mounted while the selected ticker changes', () => {
    const app = readSource('../../App.tsx');
    const start = app.indexOf('id="marketInsightsPanel"');
    const end = app.indexOf('</section>', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(app.slice(start, end)).not.toContain('key={`market-insights-');
  });

  it('requests each data family only when its tab and opt-in state require it', () => {
    const panel = readSource('../../components/MarketInsightsPanel.tsx');
    expect(panel).toContain('getMarketInsightsRequestPlan(ticker, activeSection, stocktwitsRequested)');
    expect(panel).toContain('if (!requestPlan.news) return;');
    expect(panel).toContain('if (!requestPlan.deepData)');
    expect(panel).toContain('const forceOnStart = deepDataRefreshRequest !== lastDeepDataManualRefreshRef.current;');
    expect(panel).toContain('fetchYahooDeepStockData(ticker, forceOnStart, controller.signal)');
    expect(panel).toContain('}, [ticker, deepDataRefreshRequest, requestPlan.deepData]);');
    expect(panel).not.toContain('}, [ticker, activeSection, requestPlan.deepData]);');
    expect(panel).toContain('onClick={() => setDeepDataRefreshRequest((value) => value + 1)}');
    expect(panel).toContain('disabled={deepDataRequest.ticker === ticker && deepDataRequest.loading}');
    expect(panel).toContain('if (!requestPlan.stocktwits) return;');
    expect(panel).toContain('if (stocktwitsRequested) setStocktwitsRefreshRequest((value) => value + 1);');
    expect(panel).toContain('else setStocktwitsRequested(true);');
  });

  it('keeps same-ticker data visible during refresh and exposes retry after a failed request', () => {
    const panel = readSource('../../components/MarketInsightsPanel.tsx');
    expect(panel).toContain('const loading = requestPlan.deepData && !currentStockData');
    expect(panel).toContain('if (error && !currentStockData)');
    expect(panel).toContain('{error && currentStockData && (');
    expect(panel).toContain('aria-label="Refresh market data"');
    expect(panel).toContain('aria-label="Retry market data refresh"');
  });

  it('does not display previous-ticker News, Stocktwits, or deep-data state', () => {
    const panel = readSource('../../components/MarketInsightsPanel.tsx');
    expect(panel).toContain('stockDataTicker === ticker ? stockData : null');
    expect(panel).toContain('hasCurrentNews ? newsData : []');
    expect(panel).toContain('hasCurrentStocktwits ? stocktwitsData : null');
    expect(panel).toContain('currentNewsData.map((n, idx) =>');
    expect(panel).toContain('currentStocktwitsData?.messages');
  });

  it('cancels and invalidates older deep-data requests on effect cleanup', () => {
    const panel = readSource('../../components/MarketInsightsPanel.tsx');
    expect(panel).toContain('const controller = new AbortController();');
    expect(panel).toContain('controller.abort();');
    expect(panel).toContain('requestIdRef.current += 1;');
    expect(panel).toContain('if (currentRequestId !== requestIdRef.current) return;');
  });
});
