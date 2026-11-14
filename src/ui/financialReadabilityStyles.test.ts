import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');
const readabilityStyles = stylesheet.slice(stylesheet.lastIndexOf(
  '/* Financial readability: prioritize decision-critical figures over metadata. */'
));

describe('financial readability styles', () => {
  it('gives primary portfolio values more weight than supporting labels', () => {
    expect(readabilityStyles).toMatch(/\.portfolio-micro-heading,\s*\.portfolio-metric-label\s*\{[^}]*font-size:\s*0\.6875rem/s);
    expect(readabilityStyles).toMatch(/\.portfolio-micro-row \.portfolio-metric-value\s*\{[^}]*font-size:\s*0\.875rem;[^}]*font-weight:\s*700/s);
    expect(readabilityStyles).toMatch(/\.portfolio-micro-market-primary \.portfolio-metric-value\s*\{[^}]*font-size:\s*1rem/s);
  });

  it('keeps margin-risk equity and buffer values legible', () => {
    expect(readabilityStyles).toMatch(/\.margin-risk-equity\s*\{[^}]*font-size:\s*1rem/s);
    expect(readabilityStyles).toMatch(/\.margin-risk-buffer-stat strong\s*\{[^}]*font-size:\s*0\.875rem/s);
  });

  it('styles margin stress disclosures and keeps the scenario table scrollable', () => {
    expect(readabilityStyles).toContain('.margin-risk-scope-note');
    expect(readabilityStyles).toContain('.margin-risk-overview-item strong.danger');
    expect(readabilityStyles).toContain('.margin-risk-stress-table-wrap');
    expect(readabilityStyles).toContain('.margin-risk-stress-table');
  });

  it('retains a deliberate compact scale on phone-sized screens', () => {
    expect(readabilityStyles).toMatch(/@media\s*\(max-width:\s*767px\)[\s\S]*?\.portfolio-micro-row \.portfolio-metric-value\s*\{[^}]*font-size:\s*0\.8125rem/s);
    expect(readabilityStyles).toMatch(/\.portfolio-micro-market-primary \.portfolio-metric-value\s*\{[^}]*font-size:\s*0\.9375rem/s);
  });
});
