import { describe, expect, it } from 'vitest';
import type { BrokerDataSnapshot, BrokerPortfolioSnapshot } from '../types/broker';
import { reconcileBrokerPortfolio } from './brokerReconciliation';

function snapshot(
  positions: BrokerPortfolioSnapshot['positions'],
  options: Partial<BrokerDataSnapshot<BrokerPortfolioSnapshot>> = {}
): BrokerDataSnapshot<BrokerPortfolioSnapshot> {
  return {
    provider: 'freedom-tradenet',
    data: {
      loaded: true,
      balances: [{ currency: 'USD', amount: 1000, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 }],
      positions
    },
    quality: 'complete',
    source: 'rest',
    receivedAt: 10_000,
    observedAt: 10_000,
    warnings: [],
    ...options
  };
}

const brokerPosition = (ticker: string, quantity: number, currency = 'USD') => ({
  ticker,
  name: ticker,
  quantity,
  currency,
  marketPrice: 100,
  marketValue: quantity * 100,
  averagePrice: 90,
  profitClose: 0,
  accountPositionId: null
});

describe('reconcileBrokerPortfolio', () => {
  it('matches account-wide broker quantities against combined app margin and cash shares', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('AAPL.US', 10)]),
      appPositions: [
        { ticker: 'AAPL', quantity: 6, currency: 'USD' },
        { ticker: 'AAPL.US', quantity: 4, currency: 'USD' }
      ],
      now: 10_100
    });

    expect(report.status).toBe('matched');
    expect(report.differenceCount).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.freshness).toBe('fresh');
  });

  it('reports quantity differences without changing the supplied app rows', () => {
    const appPositions = [{ ticker: 'MSFT', quantity: 5, currency: 'USD' }];
    const before = structuredClone(appPositions);
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('MSFT', 7)]),
      appPositions,
      now: 10_100
    });

    expect(report.status).toBe('differences');
    expect(report.differenceCount).toBe(1);
    expect(report.findings[0]).toMatchObject({
      type: 'quantity_mismatch',
      subject: 'MSFT',
      currency: 'USD',
      appValue: 5,
      brokerValue: 7,
      difference: -2,
      confidence: 'confirmed'
    });
    expect(appPositions).toEqual(before);
  });

  it('reports app-only and broker-only positions only for a complete, fresh snapshot', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('NVDA', 3)]),
      appPositions: [{ ticker: 'AAPL', quantity: 2, currency: 'USD' }],
      now: 10_100
    });

    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'missing_in_broker', subject: 'AAPL', appValue: 2, brokerValue: null }),
      expect.objectContaining({ type: 'missing_in_app', subject: 'NVDA', appValue: null, brokerValue: 3 })
    ]));
    expect(report.differenceCount).toBe(2);
  });

  it('suppresses absence-based discrepancies for partial broker snapshots', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([], {
        quality: 'partial',
        warnings: ['Position collection unavailable.']
      }),
      appPositions: [{ ticker: 'AAPL', quantity: 2, currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('partial');
    expect(report.differenceCount).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.warnings).toContain('The broker snapshot is partial; absence-based discrepancies are suppressed.');
  });

  it('treats an empty broker snapshot as unverified rather than proof that app holdings are missing', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([], {
        quality: 'empty',
        data: { loaded: true, balances: [], positions: [] }
      }),
      appPositions: [{ ticker: 'AAPL', quantity: 2, currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('partial');
    expect(report.differenceCount).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.warnings).toContain('The broker snapshot contains no account rows; absence-based discrepancies are suppressed.');
  });

  it('marks malformed app rows as partial instead of treating them as zero', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('AAPL', 2)]),
      appPositions: [{ ticker: 'AAPL', quantity: 'not-a-number', currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('partial');
    expect(report.differenceCount).toBe(0);
    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'unclassified_app_position',
      subject: 'AAPL',
      appValue: null
    }));
  });

  it('reports overlapping quantity mismatches as provisional when the snapshot is partial', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('AAPL', 3)], { quality: 'partial' }),
      appPositions: [{ ticker: 'AAPL', quantity: 5, currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('partial');
    expect(report.findings[0]).toMatchObject({
      type: 'quantity_mismatch',
      confidence: 'provisional'
    });
  });

  it('marks stale snapshots and does not emit false missing-position findings', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([]),
      appPositions: [{ ticker: 'AAPL', quantity: 2, currency: 'USD' }],
      now: 600_000,
      maxAgeMs: 60_000
    });

    expect(report.status).toBe('stale');
    expect(report.differenceCount).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.freshness).toBe('stale');
  });

  it('keeps comparisons provisional when provider observation time is unknown', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('AAPL', 3)], { observedAt: undefined }),
      appPositions: [{ ticker: 'AAPL', quantity: 2, currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('provisional');
    expect(report.findings[0]).toMatchObject({
      type: 'quantity_mismatch',
      confidence: 'provisional'
    });
    expect(report.warnings).toContain('The provider observation timestamp is unknown; comparisons are provisional.');
  });

  it('classifies same-ticker currency differences rather than converting or combining them', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('XYZ', 4, 'EUR')]),
      appPositions: [{ ticker: 'XYZ', quantity: 4, currency: 'USD' }],
      now: 10_100
    });

    expect(report.findings).toContainEqual(expect.objectContaining({
      type: 'currency_mismatch',
      subject: 'XYZ',
      appValue: 4,
      brokerValue: 4
    }));
  });

  it('compares cash balances only when the caller explicitly supplies app-side balances', () => {
    const broker = snapshot([], {
      data: {
        loaded: true,
        balances: [{ currency: 'USD', amount: 1200, forecastIn: 0, forecastOut: 0, t2In: 0, t2Out: 0 }],
        positions: []
      }
    });
    const withoutAppBalances = reconcileBrokerPortfolio({
      brokerSnapshot: broker,
      appPositions: [],
      now: 10_100
    });
    const withAppBalances = reconcileBrokerPortfolio({
      brokerSnapshot: broker,
      appPositions: [],
      appBalances: [{ currency: 'USD', amount: 1000 }],
      now: 10_100
    });

    expect(withoutAppBalances.differenceCount).toBe(0);
    expect(withAppBalances.findings).toContainEqual(expect.objectContaining({
      type: 'balance_mismatch',
      subject: 'USD',
      appValue: 1000,
      brokerValue: 1200,
      difference: -200
    }));
  });

  it('returns unavailable without fabricating a zero or a matched result', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: null,
      appPositions: [{ ticker: 'AAPL', quantity: 2, currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('unavailable');
    expect(report.differenceCount).toBe(0);
    expect(report.warnings).toContain('Broker account data is unavailable; no reconciliation was performed.');
  });

  it('preserves real zero quantities as valid values', () => {
    const report = reconcileBrokerPortfolio({
      brokerSnapshot: snapshot([brokerPosition('AAPL', 0)]),
      appPositions: [{ ticker: 'AAPL', quantity: 0, currency: 'USD' }],
      now: 10_100
    });

    expect(report.status).toBe('matched');
    expect(report.findings).toEqual([]);
  });
});
