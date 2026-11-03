import { describe, expect, it } from 'vitest';
import { getMarketStatusLabel, getMarketStatusTone } from './MarketStatusBadge';

describe('US-equities market status presentation', () => {
  it('maps the documented provider states without guessing unknown codes', () => {
    expect(getMarketStatusLabel('OPEN')).toBe('Open');
    expect(getMarketStatusLabel('CLOSE')).toBe('Closed');
    expect(getMarketStatusLabel('PRE')).toBe('Pre-market');
    expect(getMarketStatusLabel('POST')).toBe('After-hours');
    expect(getMarketStatusLabel('MIXED')).toBe('Mixed');
    expect(getMarketStatusLabel('PREV')).toBe('PREV');
    expect(getMarketStatusLabel(null)).toBe('Unavailable');
  });

  it('uses role-neutral tones for known, transition, and unrecognized states', () => {
    expect(getMarketStatusTone('OPEN')).toBe('open');
    expect(getMarketStatusTone('CLOSED')).toBe('closed');
    expect(getMarketStatusTone('PRE')).toBe('transition');
    expect(getMarketStatusTone('MIXED')).toBe('transition');
    expect(getMarketStatusTone('PREV')).toBe('unknown');
  });
});
