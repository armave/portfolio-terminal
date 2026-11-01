import { afterEach, describe, expect, it } from 'vitest';
import { setAppLanguage } from '../services/i18n';
import { decodeHtmlEntities, formatQuoteFreshnessSummary, formatQuoteMetadata, formatRiskTrigger, formatTrancheDate, formatUSD, getQuoteFreshness, summarizeQuoteFreshness } from './formatters';

afterEach(() => setAppLanguage('en'));

describe('display formatters', () => {
  it('decodes common HTML character entities into plain text', () => {
    expect(decodeHtmlEntities('It&#39;s a test')).toBe("It's a test");
    expect(decodeHtmlEntities('&quot;quoted&quot;')).toBe('"quoted"');
    expect(decodeHtmlEntities('A&amp;B')).toBe('A&B');
    expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>');
    expect(decodeHtmlEntities('It&#39;s &quot;up&quot; &amp; running &lt;today&gt;')).toBe('It\'s "up" & running <today>');
    expect(decodeHtmlEntities('&#x27;hex&#x27; &#34;decimal&#34; &copy;')).toBe("'hex' \"decimal\" ©");
    expect(decodeHtmlEntities('unknown &notAnEntity; stays encoded')).toBe('unknown &notAnEntity; stays encoded');
  });

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

  it('formats dates and financial numbers with the selected locale', () => {
    setAppLanguage('ru');
    expect(formatUSD(1234.5)).toContain('234,50');
    expect(formatTrancheDate('2026-10-20')).toMatch(/^20.*окт/i);
    expect(formatTrancheDate('7 Jan')).toContain('янв');
    expect(formatTrancheDate('New')).toBe('Новая');
  });

  it('formats risk trigger context without changing calculations', () => {
    expect(formatRiskTrigger(90, 100)).toBe('Position value 90.00');
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

  it('summarizes freshness across every held position instead of only the latest response', () => {
    const now = 1_800_000_000_000;
    const summary = summarizeQuoteFreshness([
      { quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 30_000 } },
      { quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 600_000 } },
      { quoteSource: 'Yahoo', quoteUpdatedAt: now, quoteDetails: { sourceTimestamp: now - 86_400_000, marketState: 'CLOSED' } },
      { quoteSource: 'Twelve Data', quoteUpdatedAt: now },
      {},
      { quoteSource: 'Manual', quoteUpdatedAt: now }
    ], now, 60_000);

    expect(summary).toEqual({
      total: 6,
      fresh: 1,
      stale: 1,
      delayed: 1,
      unknown: 1,
      unavailable: 2
    });
    expect(formatQuoteFreshnessSummary(summary))
      .toBe('Fresh: 1 · Stale: 1 · Delayed: 1 · Time unknown: 1 · Not fetched: 2');
  });

  it('reports missing and unverified quote timestamps honestly', () => {
    expect(formatQuoteMetadata({ quoteSource: 'Yahoo' })).toBe('Yahoo · Time unknown');
    expect(formatQuoteMetadata({ quoteSource: 'Twelve Data', quoteUpdatedAt: 1_800_000_000_000 })).toBe('Twelve Data · Time unknown');
    expect(formatQuoteMetadata({})).toBe('Not fetched');
  });
});
