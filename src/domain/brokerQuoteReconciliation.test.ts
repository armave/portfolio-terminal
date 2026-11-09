import { describe, expect, it } from 'vitest';
import type { BrokerPosition } from '../types/broker';
import type { AppQuoteHolding, BrokerQuoteSnapshot } from './brokerQuoteReconciliation';
import { reconcileBrokerQuotePrices } from './brokerQuoteReconciliation';

const now = Date.parse('2026-11-09T08:00:00.000Z');

function brokerPosition(overrides: Partial<BrokerPosition> = {}): BrokerPosition {
  return {
    ticker: 'AAPL',
    name: 'Apple',
    quantity: 10,
    currency: 'USD',
    marketPrice: 100,
    marketValue: 1000,
    averagePrice: 90,
    profitClose: 100,
    accountPositionId: 1,
    ...overrides
  };
}

function appQuote(overrides: Partial<AppQuoteHolding> = {}): AppQuoteHolding {
  return {
    ticker: 'AAPL',
    price: 100,
    quoteSource: 'YAHOO',
    quoteUpdatedAt: now - 5_000,
    quoteDetails: {
      currency: 'USD',
      provider: 'YAHOO',
      exchange: 'NASDAQ',
      sourceTimestamp: now - 5_000,
      receivedAt: now - 4_000,
      freshness: 'fresh',
      delayClass: 'live',
      dataQuality: 'complete',
      cacheStatus: 'network'
    },
    ...overrides
  };
}

function snapshot(overrides: Partial<BrokerQuoteSnapshot> = {}): BrokerQuoteSnapshot {
  return {
    loaded: true,
    positions: [brokerPosition()],
    provider: 'FREEDOM',
    source: 'rest',
    quality: 'complete',
    status: 'current',
    observedAt: now - 3_000,
    receivedAt: now - 2_000,
    warnings: [],
    ...overrides
  };
}

function reconcile(
  appQuotes: AppQuoteHolding[],
  brokerSnapshot: BrokerQuoteSnapshot = snapshot(),
  extra: Partial<Parameters<typeof reconcileBrokerQuotePrices>[0]> = {}
) {
  return reconcileBrokerQuotePrices({ appQuotes, brokerSnapshot, now, ...extra });
}

describe('reconcileBrokerQuotePrices', () => {
  it('confirms a same-currency price mismatch only when both source observations are complete and fresh', () => {
    const report = reconcile([appQuote({ price: 101 })]);
    expect(report.status).toBe('differences');
    expect(report.matchedCount).toBe(1);
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'price_mismatch',
      ticker: 'AAPL',
      currency: 'USD',
      appValue: 101,
      brokerValue: 100,
      difference: 1,
      confidence: 'confirmed',
      appProvider: 'YAHOO',
      brokerProvider: 'FREEDOM',
      appObservedAt: now - 5_000,
      brokerObservedAt: now - 3_000
    }));
  });

  it('does not report a mismatch inside the absolute/relative price tolerance', () => {
    const report = reconcile([appQuote({ price: 100.005 })]);
    expect(report.status).toBe('matched');
    expect(report.findings).toEqual([]);
  });

  it('keeps differences provisional when app quote freshness or provider provenance is incomplete', () => {
    const report = reconcile([appQuote({
      price: 101,
      quoteDetails: {
        currency: 'USD',
        provider: 'YAHOO',
        sourceTimestamp: now - 5_000,
        receivedAt: now - 4_000,
        freshness: 'unknown',
        delayClass: 'unknown',
        dataQuality: 'partial'
      }
    })]);
    expect(report.status).toBe('partial');
    expect(report.findings[0]).toMatchObject({
      type: 'price_mismatch',
      confidence: 'provisional',
      explanation: expect.stringContaining('incomplete')
    });
  });

  it('keeps a quote provisional when its stored freshness flag outlives its source observation', () => {
    const report = reconcile([appQuote({
      price: 101,
      quoteUpdatedAt: now - 10 * 60_000,
      quoteDetails: {
        currency: 'USD',
        provider: 'YAHOO',
        sourceTimestamp: now - 10 * 60_000,
        receivedAt: now - 9 * 60_000,
        freshness: 'fresh',
        delayClass: 'live',
        dataQuality: 'complete',
        cacheStatus: 'network'
      }
    })]);
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'price_mismatch',
      confidence: 'provisional'
    }));
  });

  it('does not compare across currencies or invent an FX conversion', () => {
    const report = reconcile([appQuote({
      quoteDetails: { ...appQuote().quoteDetails, currency: 'EUR' }
    })]);
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'currency_mismatch',
      ticker: 'AAPL',
      appCurrency: 'EUR',
      brokerCurrency: 'USD',
      appValue: 100,
      brokerValue: 100,
      confidence: 'provisional',
      explanation: expect.stringContaining('No conversion was attempted')
    }));
  });

  it('withholds price comparison for an explicitly stale broker snapshot', () => {
    const report = reconcile([appQuote({ price: 101 })], snapshot({ status: 'stale' }));
    expect(report.status).toBe('stale');
    expect(report.findings).toEqual([]);
  });

  it('keeps old broker receipt timestamps provisional even when the observation timestamp is recent', () => {
    const report = reconcile(
      [appQuote({ price: 101 })],
      snapshot({ receivedAt: now - 10 * 60_000 })
    );
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'price_mismatch',
      confidence: 'provisional'
    }));
  });

  it('keeps comparisons provisional when broker snapshot quality is partial', () => {
    const report = reconcile([appQuote({ price: 101 })], snapshot({ quality: 'partial' }));
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'price_mismatch',
      confidence: 'provisional'
    }));
    expect(report.warnings).toContain('The broker position snapshot is incomplete; price findings are provisional.');
  });

  it('keeps legacy broker snapshots without current status provisional', () => {
    const report = reconcile(
      [appQuote({ price: 101 })],
      snapshot({ status: undefined })
    );
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'price_mismatch',
      confidence: 'provisional'
    }));
    expect(report.warnings).toContain('The broker snapshot current status is not verified; price findings are provisional.');
  });

  it('does not confirm broker prices without a source observation timestamp', () => {
    const report = reconcile(
      [appQuote({ price: 101 })],
      snapshot({ observedAt: undefined })
    );
    expect(report.status).toBe('partial');
    expect(report.findings[0]).toMatchObject({
      type: 'price_mismatch',
      confidence: 'provisional'
    });
  });

  it('reports ambiguity instead of selecting a conflicting app quote', () => {
    const report = reconcile([
      appQuote({ price: 100 }),
      appQuote({ price: 101 })
    ]);
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'ambiguous_app_quote',
      confidence: 'provisional'
    }));
    expect(report.findings.some(finding => finding.type === 'price_mismatch')).toBe(false);
  });

  it('reports ambiguity instead of selecting a conflicting broker price', () => {
    const report = reconcile(
      [appQuote({ price: 100 })],
      snapshot({ positions: [brokerPosition({ marketPrice: 100 }), brokerPosition({ marketPrice: 102, accountPositionId: 2 })] })
    );
    expect(report.status).toBe('partial');
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'ambiguous_broker_quote',
      confidence: 'provisional'
    }));
  });

  it('never mutates app or broker source records', () => {
    const app = appQuote({ price: 101 });
    const broker = snapshot();
    const appBefore = structuredClone(app);
    const brokerBefore = structuredClone(broker);
    reconcile([app], broker);
    expect(app).toEqual(appBefore);
    expect(broker).toEqual(brokerBefore);
  });

  it('does not claim a successful match when there are no comparable quote pairs', () => {
    const report = reconcile([appQuote({ ticker: 'MSFT' })]);
    expect(report.status).toBe('partial');
    expect(report.matchedCount).toBe(0);
    expect(report.warnings).toContain('No matching ticker and currency pairs were available for price comparison.');
  });
});
