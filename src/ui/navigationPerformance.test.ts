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
    const marketInsights = readSource('../components/MarketInsightsPanel.tsx');
    expect(marketInsights).toContain('usePortfolioSelector(selectMarketInsightsTicker)');
    expect(marketInsights).not.toContain('usePortfolio()');
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


describe('Settings navigation loading stability', () => {
  it('uses one lazy-load fallback and does not replace the whole Settings desk while users load', () => {
    const app = readSource('../App.tsx');
    const settings = readSource('../components/SettingsDesk.tsx');
    const translations = readSource('../services/i18n-ru.ts');

    expect(app).toContain("const shouldRenderSettings = hasOpenedSettings || activeDeskView === 'SETTINGS';");
    expect(app).toContain('{shouldRenderSettings');
    expect(app).not.toContain('{hasOpenedSettings\n          ?');
    expect(settings).not.toContain('if (initialUsersLoading) {');
    expect(settings).toContain("{initialUsersLoading && <tr>");
    expect(settings).toContain("translateText('Loading users…')");
    expect(translations).toContain('"Loading users…": "Загрузка списка пользователей…"');
  });
});

describe('Settings layout organization', () => {
  it('separates account actions from refresh and backup controls with responsive groups', () => {
    const settings = readSource('../components/SettingsDesk.tsx');
    const styles = readSource('../../style.css');
    const translations = readSource('../services/i18n-ru.ts');

    expect(settings).toContain('settings-account-summary');
    expect(settings).toContain('settings-account-actions');
    expect(settings).toContain('settings-refresh-card');
    expect(settings).toContain('settings-backup-actions');
    expect(settings).toContain('settings-data-safety-note');
    expect(settings).toContain('settings-user-heading');
    expect(styles).toContain('#settingsDesk .settings-toolbar--organized');
    expect(styles).toContain('@container settings-workspace (min-width: 54rem)');
    expect(styles).toContain('#settingsDesk .settings-data-safety-note p');
    expect(translations).toContain('"Account actions": "Действия с учётной записью"');
    expect(translations).toContain("'Portfolio data refresh and backup controls': 'Обновление данных портфеля и управление резервными копиями'");
  });
});
