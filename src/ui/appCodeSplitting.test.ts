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

    expect(app).toContain("import { lazy, Suspense } from 'preact/compat';");
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

  it('does not dynamically import the API module for logout after it is already statically loaded', () => {
    const runtime = readSource('../../app.ts');
    expect(runtime).toContain('  logoutAccount,');
    expect(runtime).toContain('await logoutAccount();');
    expect(runtime).not.toContain("await import('./src/services/api')");
  });
});
