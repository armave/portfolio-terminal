import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('navigation performance wiring', () => {
  it('uses an active-view channel in the app shell rather than a full portfolio selector', () => {
    const app = readSource('../App.tsx');
    const store = readSource('../store/portfolioStore.ts');
    expect(app).toContain('const activeDeskView = useActiveView();');
    expect(app).not.toContain('deskLoadingView');
    expect(store).toContain('public subscribeActiveView');
    expect(store).toContain('export function useActiveView()');
  });

  it('does not gate Margin navigation on quote refresh or remount the console per ticker', () => {
    const tabs = readSource('../components/TickerTab.tsx');
    const app = readSource('../App.tsx');
    expect(tabs).toContain('if (refreshQuotes) void handleRefreshQuotes();');
    expect(tabs).not.toContain('onDeskLoadingChange');
    expect(app).not.toContain('key={`trading-console-${activeDeskView}`}');
  });

  it('routes desk changes through the lightweight device-local store path', () => {
    const runtime = readSource('../../app.ts');
    expect(runtime).toContain('portfolioStore.setActiveView(normalizedView);');
    expect(runtime).toContain('state = portfolioStore.getState();');
    expect(runtime).not.toContain('portfolioStore.setState({ activeView: normalizedView });');
  });
});
