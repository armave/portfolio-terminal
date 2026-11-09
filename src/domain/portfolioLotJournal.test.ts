import { describe, expect, it } from 'vitest';
import type { ClosedTrade } from '../types/portfolio';
import {
  createPortfolioTransactionEvent,
  isPortfolioTransactionEvent
} from './portfolioTransactionJournal';
import {
  replayPortfolioTransactionLots,
  verifyPortfolioTransactionLotParity
} from './portfolioLotJournal';

const buy = (
  id: string,
  lotId: string | undefined,
  acquisitionDate: string,
  quantity: number,
  price: number,
  fees: number
) => createPortfolioTransactionEvent({
  type: 'trade.buy',
  effectiveAt: Date.parse(acquisitionDate),
  ticker: 'AAPL',
  ...(lotId ? { lotId } : {}),
  ...(lotId ? { acquisitionDate } : {}),
  quantity,
  positionQuantityDelta: quantity,
  unitPrice: price,
  grossAmount: quantity * price,
  fees,
  cashDelta: 0,
  marginDebtDelta: 0
}, { eventId: id, source: 'lot-journal-test' });

const sale = (
  id: string,
  quantity: number,
  price: number,
  allocations: Array<{
    lotId?: string;
    identity: 'stable' | 'legacy-unmapped';
    quantity: number;
    acquisitionPrice: number;
    acquisitionDate?: string;
    buyCommissionAllocated: number;
    sellPrice: number;
    sellCommissionAllocated: number;
    financingCostAllocated: number;
    realizedPnl: number;
  }>
) => {
  const buyFees = allocations.reduce((sum, item) => sum + item.buyCommissionAllocated, 0);
  const sellFees = allocations.reduce((sum, item) => sum + item.sellCommissionAllocated, 0);
  const financing = allocations.reduce((sum, item) => sum + item.financingCostAllocated, 0);
  const realized = allocations.reduce((sum, item) => sum + item.realizedPnl, 0);
  const gross = allocations.reduce((sum, item) => sum + item.quantity * item.sellPrice, 0);
  return createPortfolioTransactionEvent({
    type: 'trade.sell',
    effectiveAt: Date.parse('2026-11-03T00:00:00.000Z'),
    ticker: 'AAPL',
    quantity,
    positionQuantityDelta: -quantity,
    unitPrice: price,
    grossAmount: gross,
    fees: buyFees + sellFees,
    financingCost: financing,
    cashDelta: gross - sellFees - financing,
    marginDebtDelta: 0,
    netAmount: gross - sellFees - financing,
    realizedPnl: realized,
    lotAllocations: allocations
  }, { eventId: id, source: 'lot-journal-test' });
};

const buyOne = buy('buy-one', 'lot-one', '2026-11-01', 2, 100, 2);
const buyTwo = buy('buy-two', 'lot-two', '2026-11-02', 3, 120, 6);
const partialSale = sale('sale-partial', 3, 130, [
  {
    lotId: 'lot-one',
    identity: 'stable',
    quantity: 2,
    acquisitionPrice: 100,
    acquisitionDate: '2026-11-01',
    buyCommissionAllocated: 2,
    sellPrice: 130,
    sellCommissionAllocated: 0.8,
    financingCostAllocated: 0,
    realizedPnl: 57.2
  },
  {
    lotId: 'lot-two',
    identity: 'stable',
    quantity: 1,
    acquisitionPrice: 120,
    acquisitionDate: '2026-11-02',
    buyCommissionAllocated: 2,
    sellPrice: 130,
    sellCommissionAllocated: 0.4,
    financingCostAllocated: 0,
    realizedPnl: 7.6
  }
]);
const finalSale = sale('sale-final', 2, 140, [
  {
    lotId: 'lot-two',
    identity: 'stable',
    quantity: 2,
    acquisitionPrice: 120,
    acquisitionDate: '2026-11-02',
    buyCommissionAllocated: 4,
    sellPrice: 140,
    sellCommissionAllocated: 1.2,
    financingCostAllocated: 0,
    realizedPnl: 34.8
  }
]);

const partialClosedTrade: ClosedTrade = {
  id: 'closed-partial',
  transactionEventId: 'sale-partial',
  ticker: 'AAPL',
  shares: 3,
  avgBuyPrice: 320 / 3,
  entryPrice: 320 / 3,
  sellPrice: 130,
  grossProfit: 70,
  commissions: 5.2,
  marginInterest: 0,
  netProfit: 64.8
};
const finalClosedTrade: ClosedTrade = {
  id: 'closed-final',
  transactionEventId: 'sale-final',
  ticker: 'AAPL',
  shares: 2,
  avgBuyPrice: 120,
  entryPrice: 120,
  sellPrice: 140,
  grossProfit: 40,
  commissions: 5.2,
  marginInterest: 0,
  netProfit: 34.8
};

describe('lot-aware transaction journal replay', () => {
  it('replays a multi-lot FIFO partial sale and verifies open-lot plus closed-sale parity', () => {
    const events = [buyOne, buyTwo, partialSale];
    const canonical = {
      positions: {
        AAPL: {
          shares: 2,
          commBuy: 4,
          tranches: [{
            lotId: 'lot-two',
            qty: 2,
            price: 120,
            date: '2026-11-02',
            buyCommission: 4
          }]
        }
      },
      closedTrades: [partialClosedTrade]
    };

    const replay = replayPortfolioTransactionLots(events);
    expect(replay.status).toBe('complete');
    expect(replay.openLots).toHaveLength(1);
    expect(replay.openLots[0]).toMatchObject({
      lotId: 'lot-two',
      acquiredQuantity: 3,
      openQuantity: 2,
      originalBuyCommission: 6,
      openBuyCommission: 4,
      buyCommissionAllocated: 2,
      sellCommissionAllocated: 0.4,
      realizedPnl: 7.6
    });
    expect(replay.sales).toHaveLength(1);
    expect(replay.sales[0]).toMatchObject({
      eventId: 'sale-partial',
      quantity: 3,
      soldCostBasis: 320,
      grossProceeds: 390,
      grossProfit: 70,
      buyCommissionAllocated: 4,
      sellCommissionAllocated: 1.2,
      commissions: 5.2,
      realizedPnl: 64.8
    });

    const parity = verifyPortfolioTransactionLotParity(events, canonical);
    expect(parity).toMatchObject({ status: 'complete', matches: true, discrepancies: [], issues: [] });
  });

  it('replays the final lot close and links both closed-history rows to their sale events', () => {
    const events = [buyOne, buyTwo, partialSale, finalSale];
    const replay = replayPortfolioTransactionLots(events);
    expect(replay.status).toBe('complete');
    expect(replay.openLots).toEqual([]);
    expect(replay.sales.map((item) => item.eventId)).toEqual(['sale-partial', 'sale-final']);
    expect(replay.sales[1]).toMatchObject({
      quantity: 2,
      soldCostBasis: 240,
      grossProceeds: 280,
      grossProfit: 40,
      commissions: 5.2,
      financingCost: 0,
      realizedPnl: 34.8
    });

    const parity = verifyPortfolioTransactionLotParity(events, {
      positions: {},
      closedTrades: [partialClosedTrade, finalClosedTrade]
    });
    expect(parity).toMatchObject({ status: 'complete', matches: true, discrepancies: [], issues: [] });
  });

  it('rejects canonical cost-basis and closed-trade drift with precise parity findings', () => {
    const result = verifyPortfolioTransactionLotParity([buyOne, buyTwo, partialSale], {
      positions: {
        AAPL: {
          shares: 2,
          commBuy: 3,
          tranches: [{
            lotId: 'lot-two',
            qty: 1,
            price: 121,
            date: '2026-11-02',
            buyCommission: 3
          }]
        }
      },
      closedTrades: [{ ...partialClosedTrade, netProfit: 63 }]
    });
    expect(result.matches).toBe(false);
    expect(result.discrepancies.map((finding) => finding.field)).toEqual(expect.arrayContaining([
      'position-buy-commission',
      'open-lot-quantity',
      'open-lot-cost',
      'open-lot-buy-commission',
      'closed-trade-net-profit'
    ]));
    expect(result.status).toBe('complete');
  });

  it('keeps legacy lots and legacy sale allocations explicitly incomplete', () => {
    const legacyBuy = buy('legacy-buy', undefined, '2026-11-01', 2, 100, 2);
    const legacySale = sale('legacy-sale', 1, 110, [{
      identity: 'legacy-unmapped',
      quantity: 1,
      acquisitionPrice: 100,
      acquisitionDate: '2026-11-01',
      buyCommissionAllocated: 1,
      sellPrice: 110,
      sellCommissionAllocated: 0.5,
      financingCostAllocated: 0,
      realizedPnl: 8.5
    }]);
    const replay = replayPortfolioTransactionLots([legacyBuy, legacySale]);
    expect(replay.status).toBe('incomplete');
    expect(replay.openLots).toEqual([]);
    expect(replay.sales).toEqual([]);
    expect(replay.issues.map((issue) => issue.reason)).toEqual(expect.arrayContaining([
      expect.stringContaining('stable lot ID'),
      expect.stringContaining('legacy-unmapped')
    ]));
  });

  it('does not infer a missing lot or sale allocation from ticker and quantity alone', () => {
    const missingBuyIdentity = buy('missing-lot-id', undefined, '2026-11-01', 2, 100, 2);
    const legacySaleWithoutSlices = createPortfolioTransactionEvent({
      type: 'trade.sell',
      effectiveAt: Date.parse('2026-11-03'),
      ticker: 'AAPL',
      quantity: 1,
      positionQuantityDelta: -1,
      unitPrice: 110,
      grossAmount: 110,
      fees: 0,
      financingCost: 0,
      realizedPnl: 10
    }, { eventId: 'sale-no-slices' });
    const replay = replayPortfolioTransactionLots([missingBuyIdentity, legacySaleWithoutSlices]);
    expect(replay.status).toBe('incomplete');
    expect(replay.openLots).toEqual([]);
    expect(replay.issues).toHaveLength(2);
  });

  it('rejects sale allocations that skip an older open lot instead of following FIFO', () => {
    const nonFifoSale = sale('sale-skips-oldest-lot', 1, 130, [{
      lotId: 'lot-two',
      identity: 'stable',
      quantity: 1,
      acquisitionPrice: 120,
      acquisitionDate: '2026-11-02',
      buyCommissionAllocated: 2,
      sellPrice: 130,
      sellCommissionAllocated: 0.4,
      financingCostAllocated: 0,
      realizedPnl: 7.6
    }]);
    const replay = replayPortfolioTransactionLots([buyOne, buyTwo, nonFifoSale]);
    expect(replay.status).toBe('unsupported');
    expect(replay.sales).toEqual([]);
    expect(replay.openLots.map((lot) => [lot.lotId, lot.openQuantity])).toEqual([
      ['lot-one', 2],
      ['lot-two', 3]
    ]);
    expect(replay.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventId: 'sale-skips-oldest-lot',
        disposition: 'unsupported',
        reason: expect.stringContaining('FIFO order')
      })
    ]));
  });

  it('flags a stable lot reference that cannot be found in the buy-event history', () => {
    const orphaned = sale('orphaned-sale', 1, 110, [{
      lotId: 'unknown-lot',
      identity: 'stable',
      quantity: 1,
      acquisitionPrice: 100,
      acquisitionDate: '2026-11-01',
      buyCommissionAllocated: 0,
      sellPrice: 110,
      sellCommissionAllocated: 0,
      financingCostAllocated: 0,
      realizedPnl: 10
    }]);
    const replay = replayPortfolioTransactionLots([orphaned]);
    expect(replay.status).toBe('incomplete');
    expect(replay.openLots).toEqual([]);
    expect(replay.sales).toEqual([]);
  });

  it('rejects duplicate stable lot identities and unsupported quantity corrections', () => {
    const duplicateBuy = buy('another-buy-same-lot', 'lot-one', '2026-11-02', 1, 90, 0);
    const correction = createPortfolioTransactionEvent({
      type: 'correction',
      effectiveAt: Date.parse('2026-11-04'),
      ticker: 'AAPL',
      positionQuantityDelta: -1,
      relatedEventId: 'buy-one',
      note: 'Attempted unmodeled trade correction.'
    }, { eventId: 'unsafe-correction' });
    const replay = replayPortfolioTransactionLots([buyOne, duplicateBuy, correction]);
    expect(replay.status).toBe('unsupported');
    expect(replay.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: 'another-buy-same-lot', disposition: 'unsupported' }),
      expect.objectContaining({ eventId: 'unsafe-correction', disposition: 'unsupported' })
    ]));
  });

  it('treats position adjustments and app-posted corporate actions without lot slices as incomplete', () => {
    const adjustment = createPortfolioTransactionEvent({
      type: 'position.adjustment',
      effectiveAt: Date.parse('2026-11-04'),
      ticker: 'AAPL',
      positionQuantityDelta: -1
    }, { eventId: 'position-adjustment' });
    const corporateAction = createPortfolioTransactionEvent({
      type: 'corporate-action',
      effectiveAt: Date.parse('2026-11-05'),
      ticker: 'AAPL',
      positionQuantityDelta: 2
    }, { eventId: 'split-adjustment', actor: { type: 'system' } });
    const replay = replayPortfolioTransactionLots([buyOne, adjustment, corporateAction]);
    expect(replay.status).toBe('incomplete');
    expect(replay.issues.map((issue) => issue.eventId)).toEqual(['position-adjustment', 'split-adjustment']);
  });

  it('rejects invalid replay tolerances', () => {
    expect(() => verifyPortfolioTransactionLotParity([], { positions: {} }, -1))
      .toThrow('Lot parity tolerance must be finite and non-negative');
  });

  it('validates stable sale slices as unique and gross-proceeds-consistent', () => {
    const validSale = sale('valid-two-lot-sale', 2, 110, [
      {
        lotId: 'lot-one', identity: 'stable', quantity: 1,
        acquisitionPrice: 100, acquisitionDate: '2026-11-01',
        buyCommissionAllocated: 0, sellPrice: 110,
        sellCommissionAllocated: 0, financingCostAllocated: 0, realizedPnl: 10
      },
      {
        lotId: 'lot-two', identity: 'stable', quantity: 1,
        acquisitionPrice: 120, acquisitionDate: '2026-11-02',
        buyCommissionAllocated: 0, sellPrice: 110,
        sellCommissionAllocated: 0, financingCostAllocated: 0, realizedPnl: -10
      }
    ]);
    const duplicateAllocation = {
      ...validSale,
      lotAllocations: validSale.lotAllocations?.map((allocation) => ({
        ...allocation,
        lotId: 'lot-one'
      }))
    };
    const wrongGross = {
      ...validSale,
      id: 'wrong-gross',
      grossAmount: 999
    };
    expect(isPortfolioTransactionEvent(duplicateAllocation)).toBe(false);
    expect(isPortfolioTransactionEvent(wrongGross)).toBe(false);
  });

  it('keeps older stable-lot events readable but marks missing source dates incomplete', () => {
    expect(isPortfolioTransactionEvent(buyOne)).toBe(true);
    const missingAcquisitionDate = { ...buyOne, acquisitionDate: undefined };
    expect(isPortfolioTransactionEvent(missingAcquisitionDate)).toBe(true);
    const replay = replayPortfolioTransactionLots([missingAcquisitionDate]);
    expect(replay.status).toBe('incomplete');
    expect(replay.openLots[0]).toMatchObject({
      lotId: 'lot-one',
      openQuantity: 2,
      acquisitionDate: null
    });
  });
});
