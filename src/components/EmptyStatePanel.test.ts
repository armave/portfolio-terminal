import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getBrokerSnapshotHealth } from '../ui/portfolioDataHealth';

const source = readFileSync(new URL('./EmptyStatePanel.tsx', import.meta.url), 'utf8');

describe('contextual margin empty state', () => {
  it('distinguishes no tracked positions from stale or unavailable broker data', () => {
    expect(source).toContain("brokerHealth === 'current'");
    expect(source).toContain("brokerHealth === 'stale'");
    expect(source).toContain("brokerHealth === 'partial' || brokerHealth === 'empty'");
    expect(source).toContain("brokerHealth === 'unavailable'");
    expect(getBrokerSnapshotHealth(undefined)).toBe('unknown');
  });

  it('reuses authorized synchronization, backup import, and Balance navigation actions', () => {
    expect(source).toContain("emitUiEvent('portfolio:sync-request'");
    expect(source).toContain("emitUiEvent('settings:backup-import-request')");
    expect(source).toContain("emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' })");
    expect(source).toContain('disabled={syncing}');
  });

  it('localizes empty-state headings and descriptions', () => {
    expect(source).toContain('translateText(copy.title, getAppLanguage())');
    expect(source).toContain('translateText(copy.description, getAppLanguage())');
  });
});
