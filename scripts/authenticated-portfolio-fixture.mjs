const DAY_MS = 86_400_000;
const POSITION_COUNT = 100;
const LOTS_PER_POSITION = 2;
const CLOSED_TRADE_COUNT = 10;
const FIXTURE_SOURCE = 'authenticated-performance-fixture';

function makeEvent(id, type, effectiveAt, recordedAt, ticker, fields) {
  return {
    id,
    schemaVersion: 1,
    type,
    actor: { type: 'system' },
    source: FIXTURE_SOURCE,
    effectiveAt,
    recordedAt,
    idempotencyKey: `performance-fixture:${id}`,
    requestFingerprint: `${type}:${ticker || 'portfolio'}:${id}`,
    ...(ticker ? { ticker } : {}),
    ...fields
  };
}

/**
 * Build an entirely synthetic, internally consistent authenticated benchmark
 * fixture. This is test data only and never represents a customer or broker
 * account. The returned event history must pass the production replay/parity
 * validators before it is used by the browser performance journey.
 */
export function buildAuthenticatedPortfolioFixture(nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 250 * DAY_MS) {
    throw new RangeError('Fixture timestamp must be a positive safe millisecond timestamp.');
  }

  const positions = {};
  const transactionEvents = [];
  const closedTrades = [];
  let recordedAt = nowMs - 600_000;

  for (let index = 0; index < POSITION_COUNT; index += 1) {
    const ticker = index === 0
      ? 'AAPL'
      : index === 1
        ? 'MSFT'
        : `SYN${String(index + 1).padStart(3, '0')}`;
    const tranches = [];

    for (let lotIndex = 0; lotIndex < LOTS_PER_POSITION; lotIndex += 1) {
      const quantity = 10;
      const price = 9 + (index % 7) + lotIndex * 2;
      const buyCommission = 0.1;
      const acquiredAt = nowMs - (31 + index * 2 - lotIndex) * DAY_MS;
      const acquisitionDate = new Date(acquiredAt).toISOString().slice(0, 10);
      const lotId = `performance-${ticker}-lot-${lotIndex + 1}`;
      const eventId = `performance-open-buy-${index + 1}-${lotIndex + 1}`;

      transactionEvents.push(makeEvent(
        eventId,
        'trade.buy',
        acquiredAt,
        recordedAt,
        ticker,
        {
          lotId,
          acquisitionDate,
          quantity,
          unitPrice: price,
          grossAmount: quantity * price,
          fees: buyCommission,
          positionQuantityDelta: quantity,
          cashDelta: 0,
          marginDebtDelta: 0
        }
      ));
      recordedAt += 100;

      tranches.push({
        lotId,
        qty: quantity,
        price,
        date: acquisitionDate,
        acquiredAt,
        buyCommission
      });
    }

    const shares = tranches.reduce((sum, lot) => sum + lot.qty, 0);
    const buyCommissionTotal = tranches.reduce((sum, lot) => sum + lot.buyCommission, 0);
    positions[ticker] = {
      ticker,
      shares,
      currentPrice: 11,
      pt: 12,
      commBuy: buyCommissionTotal,
      startDate: tranches[0].date,
      tranches,
      quoteUpdatedAt: nowMs,
      quoteSource: 'synthetic-performance-fixture',
      quoteDetails: {
        price: 11,
        currency: 'USD',
        provider: 'synthetic-performance-fixture',
        sourceTimestamp: nowMs,
        receivedAt: nowMs,
        freshness: 'indicative',
        delayClass: 'indicative',
        dataQuality: 'complete',
        cacheStatus: 'network',
        marketSession: 'UNKNOWN'
      }
    };
  }

  let freeCash = 0;
  for (let index = 0; index < CLOSED_TRADE_COUNT; index += 1) {
    const ticker = `HIST${String(index + 1).padStart(3, '0')}`;
    const quantity = 4;
    const entryPrice = 20 + index;
    const sellPrice = entryPrice + 5;
    const buyCommission = 0.4;
    const sellCommission = 0.2;
    const financingCost = 0;
    const acquiredAt = nowMs - (180 - index) * DAY_MS;
    const soldAt = nowMs - (20 - index) * DAY_MS;
    const acquisitionDate = new Date(acquiredAt).toISOString().slice(0, 10);
    const saleDate = new Date(soldAt).toISOString().slice(0, 10);
    const lotId = `performance-${ticker}-closed-lot`;
    const buyEventId = `performance-closed-buy-${index + 1}`;
    const saleEventId = `performance-closed-sale-${index + 1}`;
    const grossProceeds = quantity * sellPrice;
    const grossProfit = grossProceeds - quantity * entryPrice;
    const commissions = buyCommission + sellCommission;
    const realizedPnl = grossProfit - commissions - financingCost;
    const cashDelta = grossProceeds - sellCommission - financingCost;

    transactionEvents.push(makeEvent(
      buyEventId,
      'trade.buy',
      acquiredAt,
      recordedAt,
      ticker,
      {
        lotId,
        acquisitionDate,
        quantity,
        unitPrice: entryPrice,
        grossAmount: quantity * entryPrice,
        fees: buyCommission,
        positionQuantityDelta: quantity,
        cashDelta: 0,
        marginDebtDelta: 0
      }
    ));
    recordedAt += 100;

    transactionEvents.push(makeEvent(
      saleEventId,
      'trade.sell',
      soldAt,
      recordedAt,
      ticker,
      {
        quantity,
        unitPrice: sellPrice,
        grossAmount: grossProceeds,
        fees: commissions,
        financingCost,
        realizedPnl,
        positionQuantityDelta: -quantity,
        cashDelta,
        marginDebtDelta: 0,
        netAmount: cashDelta,
        lotAllocations: [{
          lotId,
          identity: 'stable',
          quantity,
          acquisitionPrice: entryPrice,
          acquisitionDate,
          acquiredAt,
          buyCommissionAllocated: buyCommission,
          sellPrice,
          sellCommissionAllocated: sellCommission,
          financingCostAllocated: financingCost,
          realizedPnl
        }]
      }
    ));
    recordedAt += 100;
    freeCash += cashDelta;

    closedTrades.push({
      id: `performance-closed-trade-${index + 1}`,
      transactionEventId: saleEventId,
      ticker,
      shares: quantity,
      avgBuyPrice: entryPrice,
      entryPrice,
      sellPrice,
      exitPrice: sellPrice,
      buyDate: acquisitionDate,
      purchaseDate: acquisitionDate,
      sellDate: saleDate,
      exitDate: saleDate,
      date: soldAt,
      closedAt: new Date(soldAt).toISOString(),
      grossProfit,
      commissions,
      feesAndCommissions: commissions,
      totalCommissions: commissions,
      marginInterest: financingCost,
      netProfit: realizedPnl,
      netRealizedGain: realizedPnl,
      holdingDays: Math.round((soldAt - acquiredAt) / DAY_MS)
    });
  }

  return {
    generatedAt: nowMs,
    startDate: new Date(nowMs - 230 * DAY_MS).toISOString().slice(0, 10),
    positions,
    transactionEvents,
    closedTrades,
    cashCushion: { freeCash, holdings: [] },
    summary: {
      positionCount: POSITION_COUNT,
      openLotCount: POSITION_COUNT * LOTS_PER_POSITION,
      closedTradeCount: CLOSED_TRADE_COUNT,
      transactionEventCount: transactionEvents.length,
      syntheticQuoteClass: 'indicative',
      liveBrokerVerification: false
    }
  };
}
