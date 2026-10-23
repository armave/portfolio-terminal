import { describe, expect, it } from 'vitest';
import { formatQuoteMetadata, formatRiskTrigger, formatTrancheDate, formatUSD, getQuoteFreshness } from './formatters';

describe('display formatters', () => {
  it('formats currency consistently and safely', () => {
    expect(formatUSD(1234.5)).toBe('1,234.50');
    expect(formatUSD('12')).toBe('12.00');
    expect(formatUSD(Number.NaN)).toBe('0.00');
  });

  it('formats supported tranche date inputs', () => {
    expect(formatTrancheDate('2026-10-20')).toBe('20 Oct');
    expect(formatTrancheDate('7 Jan')).toBe('07Jan');
    expect(formatTrancheDate('New')).toBe('New');
    expect(formatTrancheDate(null)).toBe('New');
  });

  it('formats risk trigger context without changing calculations', () => {
    expect(formatRiskTrigger(90, 100)).toBe('Position value 90.00 (10.0% buffer)');
    expect(formatRiskTrigger(110, 100)).toBe('Position value 110.00 (already10.0% below trigger)');
    expect(formatRiskTrigger(90, 0)).toBe('Position value 90.00');
  });


  it('classifies quote freshness from provider observation time, not client receipt time', () => {
    const now = 1_800_000_000_000;
    expect(getQuoteFreshness({ quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 30_000 } }, now, 60_000)).toBe('fresh');
    expect(getQuoteFreshness({ quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 300_000 } }, now, 60_000)).toBe('fresh');
    expect(getQuoteFreshness({ quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 300_001 } }, now, 60_000)).toBe('stale');
    expect(getQuoteFreshness({ quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now + 1 } }, now, 60_000)).toBe('stale');
    expect(getQuoteFreshness({ quoteUpdatedAt: now }, now, 60_000)).toBe('unknown');
    expect(getQuoteFreshness({ quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 86_400_000, marketState: 'CLOSED' } }, now, 60_000)).toBe('delayed');
    expect(getQuoteFreshness({}, now, 60_000)).toBe('unavailable');
  });

  it('reports missing and unverified quote timestamps honestly', () => {
    expect(formatQuoteMetadata({ quoteSource: 'Yahoo' })).toBe('Yahoo');
    expect(formatQuoteMetadata({ quoteSource: 'Twelve Data', quoteUpdatedAt: 1_800_000_000_000 })).toBe('Quote time unknown · Twelve Data');
    expect(formatQuoteMetadata({})).toBe('Not fetched');
  });
});
