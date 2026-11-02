import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('on-demand application code splitting', () => {
  it('loads infrequently used desks and market insights through lazy component imports', () => {
    const app = readSource('../App.tsx');
    const components = [
      ['ClosedHistoryDesk', 'ClosedHistoryDesk'],
      ['GuestTrancheHistory', 'GuestTrancheHistory'],
      ['CashCushionDesk', 'CashCushionDesk'],
      ['SettingsDesk', 'SettingsDesk'],
      ['MarketInsightsPanel', 'MarketInsightsPanel']
    ] as const;

    expect(app).toContain("import { lazy, memo, Suspense } from 'preact/compat';");
    for (const [component, moduleName] of components) {
      expect(app, component).toContain(`const ${component} = lazy(() =>`);
      expect(app, component).toContain(`import('./components/${moduleName}')`);
      expect(app, component).not.toContain(`import { ${component} } from './components/${moduleName}'`);
    }
    expect(app.match(/<Suspense\b/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(app).toContain('Preparing balance');
    expect(app).toContain('Preparing trades');
    expect(app).toContain('Preparing settings');
  });

  it('defers modal-only code until the corresponding dialog is opened', () => {
    const app = readSource('../App.tsx');
    const components = [
      ['ScenarioComparisonModal', 'ScenarioComparisonModal'],
      ['ScenarioReportModal', 'ScenarioReportModal'],
      ['MarginIntelligenceModal', 'MarginIntelligenceModal']
    ] as const;

    for (const [component, moduleName] of components) {
      expect(app, component).toContain(`const ${component} = lazy(() =>`);
      expect(app, component).toContain(`import('./components/${moduleName}')`);
      expect(app, component).not.toContain(`import { ${component} } from './components/${moduleName}'`);
    }
    expect(app.match(/<Suspense fallback=\{null\}>/g)?.length ?? 0).toBe(3);
  });

  it('keeps logout on the statically injected API dependency behind the session runtime', () => {
    const appRuntime = readSource('../../app.ts');
    const sessionRuntime = readSource('../services/portfolioSessionRuntime.ts');
    expect(appRuntime).toContain('  logoutAccount,');
    expect(appRuntime).toContain('  logoutAccount,');
    expect(sessionRuntime).toContain('await dependencies.logoutAccount();');
    expect(sessionRuntime).toContain('dependencies.clearSavedGatewaySecret();');
    expect(appRuntime).not.toContain("await import('./src/services/api')");
  });
});
