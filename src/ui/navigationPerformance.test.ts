import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('navigation performance wiring', () => {
  it('uses an active-view channel in the app shell rather than a full portfolio selector', () => {
    const app = readSource('../App.tsx');
    const runtime = readSource('../services/portfolioNavigationRuntime.ts');
    const rootRuntime = readSource('../../app.ts');
    const store = readSource('../store/portfolioStore.ts');
    expect(app).toContain('const activeDeskView = useActiveView();');
    expect(runtime).toContain('shouldRefreshQuotesWhenEnteringBalance');
    expect(runtime).toContain('dependencies.refreshLivePrices().catch(() => undefined)');
    expect(rootRuntime).toContain('getActiveView: () => portfolioStore.getState().activeView');
    expect(app).toContain('const hasMarginPositions = usePortfolioSelector((state) => Object.keys(state.positions || {}).length > 0);');
    expect(app).not.toContain('const portfolioSnapshot = usePortfolio();');
    expect(app).not.toContain('deskLoadingView');
    expect(store).toContain('public subscribeActiveView');
    expect(store).toContain('export function useActiveView()');
    expect(store).toContain('export function subscribeToPortfolioSelector');
    expect(store).toContain('export function usePortfolioSelector');
  });

  it('does not gate Margin navigation on quote refresh or remount the console per ticker', () => {
    const tabs = readSource('../components/TickerTab.tsx');
    const app = readSource('../App.tsx');
    expect(tabs).toContain('if (refreshQuotes) void handleRefreshQuotes();');
    expect(tabs).toContain('usePortfolioSelector(selectPositionTickers, areTickerListsEqual)');
    expect(tabs).toContain('BalanceEquityBadge');
    expect(tabs).not.toContain('const state = usePortfolio();');
    expect(tabs).not.toContain('onDeskLoadingChange');
    expect(tabs).not.toContain("localStorage.setItem('portfolio_active_view'");
    expect(app).not.toContain('key={`trading-console-${activeDeskView}`}');
  });

  it('routes desk changes through the lightweight device-local store path', () => {
    const runtime = readSource('../../app.ts');
    expect(runtime).toContain('portfolioStore.setActiveView(normalizedView);');
    expect(runtime).toContain('state = portfolioStore.getState();');
    expect(runtime).not.toContain('portfolioStore.setState({ activeView: normalizedView });');
  });
});
