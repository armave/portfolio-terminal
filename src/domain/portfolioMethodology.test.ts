import { describe, expect, it } from 'vitest';
import { PORTFOLIO_METHODOLOGY_SECTIONS } from './portfolioMethodology';

describe('portfolio methodology reference', () => {
  it('uses unique stable section identifiers and contains meaningful guidance', () => {
    const ids = PORTFOLIO_METHODOLOGY_SECTIONS.map(section => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PORTFOLIO_METHODOLOGY_SECTIONS).toHaveLength(7);

    for (const section of PORTFOLIO_METHODOLOGY_SECTIONS) {
      expect(section.title.trim()).not.toBe('');
      expect(section.description.trim()).not.toBe('');
      expect(section.points.length).toBeGreaterThanOrEqual(3);
      expect(section.points.every(point => point.trim().length > 0)).toBe(true);
    }
  });

  it('keeps the key financial distinctions and limitations explicit', () => {
    const copy = PORTFOLIO_METHODOLOGY_SECTIONS
      .flatMap(section => [section.description, ...section.points, section.note ?? ''])
      .join(' ');

    expect(copy).toContain('negative signed account balance represents margin debt');
    expect(copy).toContain('Incomplete takes precedence');
    expect(copy).toContain('Gross unrealized P&L excludes commissions');
    expect(copy).toContain('target-price projection');
    expect(copy).toContain('decimal multiplier');
    expect(copy).toContain('not live broker risk indicators');
    expect(copy).toContain('Observation time');
    expect(copy).toContain('no currency or FX conversion contract');
    expect(copy).toContain('time-weighted and money-weighted return');
  });

  it('does not present the reference panel as a calculation or state mutation engine', () => {
    const source = PORTFOLIO_METHODOLOGY_SECTIONS
      .flatMap(section => [section.description, ...section.points, section.note ?? ''])
      .join(' ')
      .toLowerCase();

    expect(source).not.toContain('guaranteed return');
    expect(source).not.toContain('automatically correct');
    expect(source).not.toContain('place an order');
  });
});
