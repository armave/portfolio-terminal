import { describe, expect, it } from 'vitest';
import { createBlankPortfolioState } from '../../store/portfolioDefaults';
import { buildMarginReviewContext } from './marginIntelligenceContext';

describe('margin review portfolio context', () => {
  const now = Date.UTC(2026, 10, 11, 8, 0, 0);

  it('builds an empty context without inventing a focus position', () => {
    const snapshot = createBlankPortfolioState(now);
    const result = buildMarginReviewContext(snapshot, null, now, 60_000);

    expect(result.allPositions).toEqual([]);
    expect(result.focusPosition).toBeNull();
    expect(result.portfolioContext.focusPosition).toBeNull();
    expect(result.priorityTickers).toEqual([]);
    expect(result.portfolioContext.asOf).toBe(new Date(now).toISOString());
  });

  it('builds position-specific valuation and share-reconciliation evidence', () => {
    const snapshot = createBlankPortfolioState(now);
    snapshot.balance = 1_000;
    snapshot.cashCushion = {
      freeCash: 10,
      holdings: [{
        ticker: 'GOOGL',
        shares: 2,
        price: 150,
        currentPrice: 150,
        quoteSource: 'Example',
        quoteUpdatedAt: now,
        quoteDetails: { sourceTimestamp: now, freshness: 'fresh' }
      }]
    };
    snapshot.positions = {
      GOOGL: {
        ticker: 'GOOGL',
        shares: 3,
        currentPrice: 200,
        pt: 250,
        commBuy: 3,
        quoteSource: 'Example',
        quoteUpdatedAt: now,
        quoteDetails: { sourceTimestamp: now, freshness: 'fresh' },
        tranches: [{ qty: 3, price: 100, date: '2026-01-01', buyCommission: 1 }]
      }
    };

    const result = buildMarginReviewContext(snapshot, 'googl.us', now, 60_000);
    const focusPosition = result.portfolioContext.focusPosition;

    expect(result.focusPosition?.ticker).toBe('GOOGL');
    expect(result.priorityTickers).toEqual(['GOOGL']);
    expect(focusPosition).toMatchObject({
      ticker: 'GOOGL',
      appMarginShares: 3,
      appCashShares: 2,
      appTotalShares: 5,
      entryLotShares: 3,
      quantityReconciliation: {
        appMarginSharesMatchEntryLots: true,
        appTotalSharesMatchBroker: null,
        status: 'broker quantity unavailable'
      },
      marketPrice: 200,
      marketValue: 600,
      averageEntryPrice: 100,
      unrealizedGrossPnl: 300,
      marginMarketValueWeightPct: 100
    });
    expect(result.portfolioContext).toMatchObject({
      asOf: new Date(now).toISOString(),
      focusTicker: 'googl.us',
      account: {
        brokerSnapshotStatus: 'not-loaded',
        valuation: { reliability: 'provisional' }
      }
    });
  });
});
