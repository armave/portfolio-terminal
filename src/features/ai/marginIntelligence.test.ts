import { describe, expect, it } from 'vitest';
import {
  buildMarginReviewPrompt,
  fingerprintMarginReviewSnapshot,
  getMarginDigestFreshness,
  MARGIN_REVIEW_MAX_AGE_MS,
  MARGIN_REVIEW_PROMPT_VERSION,
  normalizeMarginReviewTicker,
  reconcileMarginReviewShares,
  sumMarginReviewCashShares,
  selectMarginReviewNews
} from './marginIntelligence';

describe('margin review prompt', () => {
  it('requires source-linked, position-specific claims and distinguishes unavailable news from empty feeds', () => {
    const prompt = buildMarginReviewPrompt(
      { focusPosition: { ticker: 'AAPL', marginMarketValueWeightPct: 42 } },
      [{ ticker: 'MSFT', status: 'error', fetchedAt: '2026-11-04T08:00:00.000Z', availableArticleCount: 0, selectedArticleCount: 0, error: 'Provider unavailable' }],
      [{ sourceId: 'N1', ticker: 'AAPL', headline: 'AAPL company update', source: 'Example', url: 'https://news.test/aapl' }]
    );

    expect(prompt).toContain('"marginMarketValueWeightPct":42');
    expect(prompt).toContain('cite its supplied source ID exactly, e.g. [N2]');
    expect(prompt).toContain('"sourceId":"N1"');
    expect(prompt).toContain('a failed feed means news is unavailable, not that no news exists');
    expect(prompt).toContain('If brokerReportedShares is null or unavailable');
    expect(prompt).toContain('Compare brokerReportedShares with appTotalShares');
    expect(prompt).toContain('Compare entryLotShares only with appMarginShares');
    expect(prompt).toContain('do not fill space with generic market risks');
    expect(prompt).not.toContain('Do not include inline source citations');
  });
});

describe('margin review snapshot identity', () => {
  it('sums cash holdings for the same normalized ticker only', () => {
    expect(sumMarginReviewCashShares('GOOGL', [
      { ticker: 'GOOGL.US', shares: 38 },
      { ticker: 'AAPL', shares: 10 },
      { ticker: 'GOOGL', shares: '2' },
      { ticker: 'GOOGL', shares: 'invalid' }
    ])).toBe(40);
  });

  it('reconciles account-wide broker shares against combined margin and cash holdings', () => {
    expect(reconcileMarginReviewShares({
      appMarginShares: 68,
      appCashShares: 38,
      brokerReportedShares: 106,
      entryLotShares: 68
    })).toEqual({
      appTotalShares: 106,
      appMarginSharesMatchEntryLots: true,
      appTotalSharesMatchBroker: true,
      status: 'matched'
    });
  });

  it('still flags real broker-total or margin-lot discrepancies', () => {
    expect(reconcileMarginReviewShares({
      appMarginShares: 68, appCashShares: 38, brokerReportedShares: 105, entryLotShares: 68
    }).status).toBe('discrepancy');
    expect(reconcileMarginReviewShares({
      appMarginShares: 68, appCashShares: 38, brokerReportedShares: 106, entryLotShares: 67
    }).status).toBe('discrepancy');
  });

  it('keeps missing broker totals distinct from a confirmed mismatch', () => {
    expect(reconcileMarginReviewShares({
      appMarginShares: 68, appCashShares: 38, brokerReportedShares: null, entryLotShares: 68
    })).toEqual({
      appTotalShares: 106,
      appMarginSharesMatchEntryLots: true,
      appTotalSharesMatchBroker: null,
      status: 'broker quantity unavailable'
    });
  });

  it('normalizes broker market suffixes without changing other ticker suffixes', () => {
    expect(normalizeMarginReviewTicker(' googl.us ')).toBe('GOOGL');
    expect(normalizeMarginReviewTicker('brk.b')).toBe('BRK.B');
    expect(normalizeMarginReviewTicker(null)).toBe('');
  });

  it('is stable regardless of object key order and changes when supplied facts change', async () => {
    const first = await fingerprintMarginReviewSnapshot({ ticker: 'AAPL', facts: { price: 10, shares: 2 } });
    const reordered = await fingerprintMarginReviewSnapshot({ facts: { shares: 2, price: 10 }, ticker: 'AAPL' });
    const changed = await fingerprintMarginReviewSnapshot({ ticker: 'AAPL', facts: { price: 11, shares: 2 } });

    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
  });

  it('ignores broker/quote observation timestamps but still fingerprints financial fact changes', async () => {
    const original = {
      brokerSnapshotReceivedAt: 1000,
      brokerSnapshotStatus: 'stale',
      reliability: 'provisional',
      positions: [{ ticker: 'GOOGL', appTrackedShares: 68, brokerReportedShares: 68, marketPrice: 294, quoteFreshness: 'stale', quoteSource: 'Yahoo Finance', quoteUpdatedAt: 1000, quoteSourceTimestamp: 900 }]
    };
    const refreshed = {
      brokerSnapshotReceivedAt: 2000,
      brokerSnapshotStatus: 'current',
      reliability: 'current',
      positions: [{ ticker: 'GOOGL', appTrackedShares: 68, brokerReportedShares: 68, marketPrice: 294, quoteFreshness: 'fresh', quoteSource: 'Freedom TradeNet', quoteUpdatedAt: 2000, quoteSourceTimestamp: 1900 }]
    };
    const resized = {
      ...refreshed,
      positions: [{ ...refreshed.positions[0], appTrackedShares: 69 }]
    };
    const quoteBecameStale = {
      ...refreshed,
      brokerSnapshotStatus: 'stale',
      reliability: 'provisional',
      positions: [{ ...refreshed.positions[0], quoteFreshness: 'stale' }]
    };
    const priceChanged = {
      ...refreshed,
      positions: [{ ...refreshed.positions[0], marketPrice: 295 }]
    };

    expect(await fingerprintMarginReviewSnapshot(original)).toBe(await fingerprintMarginReviewSnapshot(refreshed));
    expect(await fingerprintMarginReviewSnapshot(original)).not.toBe(await fingerprintMarginReviewSnapshot(resized));
    expect(await fingerprintMarginReviewSnapshot(original)).toBe(await fingerprintMarginReviewSnapshot(quoteBecameStale));
    expect(await fingerprintMarginReviewSnapshot(original)).not.toBe(await fingerprintMarginReviewSnapshot(priceChanged));
  });
});

describe('margin review news selection', () => {
  it('selects one newest story per priority ticker before filling remaining slots by recency', () => {
    const result = selectMarginReviewNews([
      {
        ticker: 'AAPL',
        fetchedAt: '2026-11-04T08:00:00.000Z',
        items: [
          { headline: 'AAPL oldest', datetime: 1_798_000_000 },
          { headline: 'AAPL newer', datetime: 1_799_000_000 },
          { headline: 'AAPL newest', datetime: 1_800_000_000 }
        ]
      },
      {
        ticker: 'MSFT',
        fetchedAt: '2026-11-04T08:00:00.000Z',
        items: [{ headline: 'MSFT latest', datetime: 1_799_500_000 }]
      }
    ], ['MSFT', 'AAPL'], 3);

    expect(result.articles.map(article => article.headline)).toEqual([
      'AAPL newest',
      'MSFT latest',
      'AAPL newer'
    ]);
    expect(result.articles.map(article => article.sourceId)).toEqual(['N1', 'N2', 'N3']);
    expect(result.coverage).toEqual([
      expect.objectContaining({ ticker: 'MSFT', status: 'loaded', selectedArticleCount: 1 }),
      expect.objectContaining({ ticker: 'AAPL', status: 'loaded', selectedArticleCount: 2 })
    ]);
  });

  it('deduplicates equivalent URLs and distinguishes empty results from failed feeds', () => {
    const result = selectMarginReviewNews([
      {
        ticker: 'AAPL',
        fetchedAt: '2026-11-04T08:00:00.000Z',
        items: [{ headline: 'Same story', url: 'https://news.test/story?utm_source=a', datetime: 1_800_000_000 }]
      },
      {
        ticker: 'MSFT',
        fetchedAt: '2026-11-04T08:00:00.000Z',
        items: [{ headline: 'Duplicate story', url: 'https://news.test/story?utm_source=b', datetime: 1_800_000_100 }]
      },
      { ticker: 'GOOG', fetchedAt: '2026-11-04T08:00:00.000Z', items: [] },
      { ticker: 'NVDA', fetchedAt: '2026-11-04T08:00:00.000Z', items: [], error: 'Provider unavailable' }
    ], ['AAPL', 'MSFT', 'GOOG', 'NVDA']);

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].ticker).toBe('AAPL');
    expect(result.coverage).toEqual([
      expect.objectContaining({ ticker: 'AAPL', status: 'loaded' }),
      expect.objectContaining({ ticker: 'MSFT', status: 'loaded', selectedArticleCount: 0 }),
      expect.objectContaining({ ticker: 'GOOG', status: 'empty' }),
      expect.objectContaining({ ticker: 'NVDA', status: 'error', error: 'Provider unavailable' })
    ]);
  });

  it('caps the number of selected stories per ticker and in total', () => {
    const results = Array.from({ length: 5 }, (_, tickerIndex) => ({
      ticker: `T${tickerIndex}`,
      fetchedAt: '2026-11-04T08:00:00.000Z',
      items: Array.from({ length: 5 }, (_, articleIndex) => ({
        headline: `T${tickerIndex} story ${articleIndex}`,
        datetime: 1_800_000_000 - articleIndex
      }))
    }));

    const result = selectMarginReviewNews(results, results.map(item => item.ticker), 6);
    const counts = result.articles.reduce<Record<string, number>>((acc, article) => {
      acc[article.ticker] = (acc[article.ticker] || 0) + 1;
      return acc;
    }, {});

    expect(result.articles).toHaveLength(6);
    expect(Object.values(counts).every(count => count <= 3)).toBe(true);
    expect(Object.keys(counts)).toHaveLength(5);
  });
});

describe('margin review digest freshness', () => {
  const now = Date.parse('2026-11-04T12:00:00.000Z');
  const freshDigest = {
    snapshotFingerprint: 'same-snapshot',
    snapshotAsOf: new Date(now).toISOString(),
    promptVersion: MARGIN_REVIEW_PROMPT_VERSION,
    syncedAt: new Date(now).toISOString(),
    coverage: [{
      ticker: 'AAPL',
      status: 'loaded' as const,
      fetchedAt: new Date(now).toISOString(),
      availableArticleCount: 1,
      selectedArticleCount: 1
    }]
  };

  it('accepts a recent digest with a matching snapshot and prompt version', () => {
    expect(getMarginDigestFreshness(freshDigest, 'same-snapshot', now)).toEqual({ stale: false, reasons: [] });
  });

  it('marks changed snapshots, prompt versions, and legacy metadata stale', () => {
    expect(getMarginDigestFreshness(freshDigest, 'changed', now).reasons).toContain('snapshot-changed');
    expect(getMarginDigestFreshness({ ...freshDigest, promptVersion: 1 }, 'same-snapshot', now).reasons).toContain('prompt-changed');
    expect(getMarginDigestFreshness({ syncedAt: freshDigest.syncedAt }, 'same-snapshot', now).reasons).toContain('metadata-missing');
  });

  it('marks news older than 24 hours stale', () => {
    const old = {
      ...freshDigest,
      coverage: [{ ...freshDigest.coverage[0], fetchedAt: new Date(now - MARGIN_REVIEW_MAX_AGE_MS - 1).toISOString() }]
    };
    expect(getMarginDigestFreshness(old, 'same-snapshot', now).reasons).toContain('news-old');
  });
});
