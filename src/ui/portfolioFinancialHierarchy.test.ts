import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const runtimeSource = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8');

describe('financial target and carry-break-even scope', () => {
  it('does not show a selected ticker analyst target as a Combined Portfolio metric', () => {
    expect(appSource).toContain("activeDeskView === 'COMBINED' ? ' hidden' : ''");
  });

  it('states that the unchanged break-even estimate is portfolio-wide and localizes its status', () => {
    expect(runtimeSource).toContain("translateText('Portfolio carry break-even', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('No margin debt', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('No active trades', getAppLanguage())");
    expect(runtimeSource).toContain("translateText('days', getAppLanguage())");
  });

  it('visibly identifies the external analyst target source on ticker views', () => {
    expect(runtimeSource).toContain('${analystTargetLabel} · ${snapshot.source}');
  });
});
