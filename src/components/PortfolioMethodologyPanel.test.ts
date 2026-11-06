import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PORTFOLIO_METHODOLOGY_SECTIONS } from '../domain/portfolioMethodology';

describe('PortfolioMethodologyPanel', () => {
  it('renders every methodology section as an accessible collapsed disclosure', () => {
    const source = readFileSync(new URL('./PortfolioMethodologyPanel.tsx', import.meta.url), 'utf8');

    expect(source).toContain('aria-labelledby="portfolioMethodologyTitle"');
    expect(source).toContain('<details');
    expect(source).toContain('<summary');
    expect(source).toContain('focus-visible:outline');
    expect(source).toContain('data-methodology-section={section.id}');
    expect(PORTFOLIO_METHODOLOGY_SECTIONS.map(section => section.id)).toEqual([
      'valuation', 'reliability', 'unrealized', 'commission', 'financing', 'provenance', 'limitations'
    ]);
  });

  it('is mounted in Settings for both administrator and guest views', () => {
    const source = readFileSync(new URL('./SettingsDesk.tsx', import.meta.url), 'utf8');
    expect(source).toContain("import { PortfolioMethodologyPanel } from './PortfolioMethodologyPanel';");
    expect(source).toContain('<PortfolioMethodologyPanel />');

    const mountIndex = source.indexOf('<PortfolioMethodologyPanel />');
    const adminOnlyIndex = source.indexOf('{account?.role === "admin" && <details', source.lastIndexOf('<PortfolioMethodologyPanel />'));
    expect(mountIndex).toBeGreaterThan(-1);
    expect(adminOnlyIndex).toBe(-1);
  });
});
