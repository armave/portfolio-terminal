import { describe, expect, it } from 'vitest';
import {
  buildHoldingsProjection,
  migrateLegacyHoldingsToPositions
} from './portfolioStore';
import type { Holding, PositionRecord } from '../types/portfolio';

describe('canonical portfolio-state migration', () => {
  it('migrates legacy holdings into positions with weighted cost basis and stable dates', () => {
    const legacy: Holding[] = [{
      ticker: 'aapl',
      isMargin: true,
      currentPrice: 125,
      analystTarget: 150,
      tranches: [
        { id: 'old-1', shares: 2, entryPrice: 100, purchaseDate: '2026-01-03' },
        { id: 'old-2', shares: 3, entryPrice: 120, purchaseDate: '2026-01-05' }
      ]
    }];

    const positions = migrateLegacyHoldingsToPositions({}, legacy, '2026-10-16');

    expect(positions.AAPL).toMatchObject({
      ticker: 'AAPL',
      shares: 5,
      currentPrice: 125,
      pt: 150,
      commBuy: 0,
      startDate: '2026-01-03',
      tranches: [
        { qty: 2, price: 100, date: '2026-01-03' },
        { qty: 3, price: 120, date: '2026-01-05' }
      ]
    });
  });

  it('keeps canonical positions authoritative when legacy data has the same ticker', () => {
    const canonical: Record<string, PositionRecord> = {
      AAPL: {
        ticker: 'AAPL',
        shares: 7,
        currentPrice: 130,
        pt: 160,
        commBuy: 4,
        tranches: [{ qty: 7, price: 110, date: '2026-02-01', buyCommission: 4 }]
      }
    };
    const legacy: Holding[] = [{
      ticker: 'AAPL',
      isMargin: true,
      currentPrice: 99,
      analystTarget: 100,
      tranches: [{ id: 'legacy', shares: 2, entryPrice: 50, purchaseDate: '2025-01-01' }]
    }];

    const positions = migrateLegacyHoldingsToPositions(canonical, legacy, '2026-10-16');

    expect(positions).toEqual(canonical);
    expect(positions.AAPL.shares).toBe(7);
    expect(positions.AAPL.tranches).toHaveLength(1);
  });

  it('ignores legacy holdings without valid positive share and price lots', () => {
    const legacy: Holding[] = [
      { ticker: 'EMPTY', isMargin: true, tranches: [] },
      { ticker: 'BAD', isMargin: true, tranches: [{ id: 'bad', shares: 3, entryPrice: 0, purchaseDate: '2026-01-01' }] },
      { ticker: '   ', isMargin: true, tranches: [{ id: 'blank', shares: 1, entryPrice: 10, purchaseDate: '2026-01-01' }] }
    ];

    expect(migrateLegacyHoldingsToPositions({}, legacy, '2026-10-16')).toEqual({});
  });

  it('rebuilds the legacy holdings projection from canonical positions while preserving legacy metadata', () => {
    const positions: Record<string, PositionRecord> = {
      MSFT: {
        ticker: 'MSFT',
        shares: 4,
        currentPrice: 420,
        pt: 460,
        commBuy: 2,
        startDate: '2026-03-01',
        tranches: [
          { qty: 4, price: 400, date: '2026-03-01', buyCommission: 2 }
        ]
      }
    };
    const legacy: Holding[] = [{
      ticker: 'MSFT',
      isMargin: true,
      notes: 'Keep this user note',
      tranches: []
    }];

    expect(buildHoldingsProjection(positions, legacy, '2026-10-16')).toEqual([{
      ticker: 'MSFT',
      isMargin: true,
      notes: 'Keep this user note',
      tranches: [{
        id: 'MSFT-0',
        shares: 4,
        entryPrice: 400,
        purchaseDate: '2026-03-01',
        targetPrice: 460
      }],
      currentPrice: 420,
      analystTarget: 460
    }]);
  });

  it('does not create compatibility holdings for an empty canonical positions map', () => {
    expect(buildHoldingsProjection({}, [], '2026-10-16')).toEqual([]);
  });
});
