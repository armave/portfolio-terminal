import { calculatePortfolioValuation } from '../../domain/portfolioValuation';
import { calculateMarginRiskMetrics } from '../../domain/marginRisk';
import { getCashCushionTotal } from '../../domain/portfolioSelectors';
import { getQuoteFreshness } from '../../utils/formatters';
import {
  normalizeMarginReviewTicker,
  reconcileMarginReviewShares,
  sumMarginReviewCashShares
} from './marginIntelligence';
import type { BoardState, PositionRecord } from '../../types/portfolio';

function finiteReviewNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildMarginReviewContext(
  snapshot: BoardState,
  requestedTicker: string | null,
  now = Date.now(),
  refreshIntervalMs = 60000
) {
  const allPositions = Object.values(snapshot.positions || {}).filter(
    (position): position is PositionRecord => Boolean(position && Number(position.shares) > 0)
  ).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const focusPosition = requestedTicker
    ? allPositions.find(position => normalizeMarginReviewTicker(position.ticker) === normalizeMarginReviewTicker(requestedTicker))
    : null;
  const brokerPositions = snapshot.brokerAccountInfo?.positions || [];
  const cashHoldings = snapshot.cashCushion?.holdings || [];
  const summarizePosition = (position: PositionRecord) => {
    const tranches = (position.tranches || []).filter(tranche =>
      Number.isFinite(Number(tranche.qty)) && Number(tranche.qty) > 0 &&
      Number.isFinite(Number(tranche.price)) && Number(tranche.price) > 0
    );
    const lotShares = tranches.reduce((total, tranche) => total + Number(tranche.qty), 0);
    const entryCost = tranches.reduce((total, tranche) => total + Number(tranche.qty) * Number(tranche.price), 0);
    const averageEntryPrice = lotShares > 0 ? entryCost / lotShares : null;
    const observedPrice = finiteReviewNumber(position.currentPrice);
    const marketPrice = observedPrice !== null && observedPrice > 0 ? observedPrice : null;
    const appShares = Number(position.shares);
    const normalizedTicker = normalizeMarginReviewTicker(position.ticker);
    const matchingBrokerPositions = brokerPositions.filter(item =>
      normalizeMarginReviewTicker(item.ticker) === normalizedTicker
    );
    const brokerShares = matchingBrokerPositions.length
      ? matchingBrokerPositions.reduce((total, item) => total + Math.max(0, finiteReviewNumber(item.quantity) ?? 0), 0)
      : null;
    const appCashShares = sumMarginReviewCashShares(normalizedTicker, cashHoldings);
    const shareReconciliation = reconcileMarginReviewShares({
      appMarginShares: appShares,
      appCashShares,
      brokerReportedShares: brokerShares,
      entryLotShares: lotShares
    });
    const targetPrice = finiteReviewNumber(position.pt);
    const lotBasedPnl = marketPrice !== null && tranches.length > 0
      ? tranches.reduce((total, tranche) => total + (marketPrice - Number(tranche.price)) * Number(tranche.qty), 0)
      : null;
    return {
      ticker: position.ticker,
      appMarginShares: appShares,
      appCashShares,
      appTotalShares: shareReconciliation.appTotalShares,
      brokerReportedShares: brokerShares,
      entryLotShares: lotShares,
      quantityReconciliation: {
        appMarginSharesMatchEntryLots: shareReconciliation.appMarginSharesMatchEntryLots,
        appTotalSharesMatchBroker: shareReconciliation.appTotalSharesMatchBroker,
        status: shareReconciliation.status
      },
      marketPrice,
      quoteSource: position.quoteSource || null,
      quoteUpdatedAt: position.quoteUpdatedAt || null,
      quoteFreshness: getQuoteFreshness(position, now, refreshIntervalMs),
      quoteSourceTimestamp: position.quoteDetails?.sourceTimestamp || null,
      targetOrActiveSellLimit: targetPrice !== null && targetPrice > 0 ? targetPrice : null,
      marketValue: marketPrice === null ? null : appShares * marketPrice,
      entryLots: tranches.slice(-8).map(tranche => ({
        shares: Number(tranche.qty),
        entryPrice: Number(tranche.price),
        purchaseDate: tranche.date || null,
        buyCommission: Number(tranche.buyCommission || 0)
      })),
      averageEntryPrice,
      unrealizedGrossPnl: lotBasedPnl,
      unrealizedGrossPnlBasis: lotBasedPnl === null
        ? 'unavailable: valid entry lots or market price missing'
        : 'sum of open-lot P&L; excludes commissions, fees, and interest',
      holdingStartDate: position.startDate || null,
      recordedBuyCommission: Number(position.commBuy || 0)
    };
  };
  const summarizedPositions = allPositions.map(summarizePosition);
  const totalMarginMarketValue = summarizedPositions.reduce((sum, position) => sum + (position.marketValue || 0), 0);
  const positionsWithWeight = summarizedPositions.map(position => ({
    ...position,
    marginMarketValueWeightPct: totalMarginMarketValue > 0 && position.marketValue !== null
      ? position.marketValue / totalMarginMarketValue * 100
      : null
  }));
  const positionsByTicker = new Map(positionsWithWeight.map(position => [normalizeMarginReviewTicker(position.ticker), position]));
  const marginPositions = allPositions.map(position => ({
    ...position,
    currentPrice: finiteReviewNumber(position.currentPrice),
    shares: Number(position.shares)
  }));
  const valuation = calculatePortfolioValuation({
    signedAccountBalance: snapshot.balance,
    freeCash: snapshot.cashCushion?.freeCash,
    marginPositions,
    cashHoldings
  });
  const grossAssets = valuation.totalHoldingsValue + valuation.cashBalance;
  const equityPct = valuation.accountBalanceAvailable && grossAssets > 0
    ? valuation.equity / grossAssets * 100
    : null;
  const debt = valuation.marginDebt;
  const assumptions = snapshot.brokerAssumptions;
  const cashCushion = getCashCushionTotal(snapshot);
  const marginRisk = assumptions
    ? calculateMarginRiskMetrics(debt, valuation.marginHoldingsValue, cashCushion, assumptions)
    : null;
  const brokerSnapshotStatus = snapshot.brokerAccountInfo?.status ||
    (snapshot.brokerAccountInfo?.loaded ? 'loaded' : 'not-loaded');
  const quotesProvisional = [...allPositions, ...cashHoldings.filter(holding => Number(holding.shares) > 0)]
    .some(position => getQuoteFreshness(position, now, refreshIntervalMs) !== 'fresh');
  const valuationReliability = !valuation.accountBalanceAvailable || valuation.unpricedHoldings > 0
    ? 'incomplete'
    : brokerSnapshotStatus !== 'current' || quotesProvisional ? 'provisional' : 'current';
  const account = {
    reportingCurrency: 'USD',
    brokerSnapshotStatus,
    brokerSnapshotReceivedAt: snapshot.brokerAccountInfo?.receivedAt || null,
    balance: finiteReviewNumber(snapshot.balance),
    cashBalance: finiteReviewNumber(snapshot.cashBalance),
    freeCash: finiteReviewNumber(snapshot.cashCushion?.freeCash),
    realizedMarginCharged: finiteReviewNumber(snapshot.realizedMarginCharged),
    brokerAssumptions: assumptions || null,
    valuation: {
      accountBalanceAvailable: valuation.accountBalanceAvailable,
      equity: valuation.accountBalanceAvailable ? valuation.equity : null,
      grossAssets: valuation.accountBalanceAvailable ? grossAssets : null,
      equityPct,
      marginDebt: valuation.marginDebt,
      marginHoldingsValue: valuation.marginHoldingsValue,
      cashHoldingsValue: valuation.cashHoldingsValue,
      unpricedHoldings: valuation.unpricedHoldings,
      reliability: valuationReliability
    },
    marginRisk: marginRisk && assumptions ? {
      equityRatioPct: Number.isFinite(marginRisk.equityRatio) ? marginRisk.equityRatio * 100 : null,
      maintenanceEquityRatioPct: assumptions.maintenanceEquityRatio * 100,
      stopOutRatioPct: assumptions.stopOutRatio * 100,
      marginCallBufferPct: Number.isFinite(marginRisk.marginCallBufferPct) ? marginRisk.marginCallBufferPct : null,
      stopOutBufferPct: Number.isFinite(marginRisk.stopOutBufferPct) ? marginRisk.stopOutBufferPct : null,
      dailyBorrowCostEstimate: debt * assumptions.annualBorrowRate / assumptions.dayCountBasis,
      annualBorrowRatePct: assumptions.annualBorrowRate * 100,
      dayCountBasis: assumptions.dayCountBasis,
      qualification: 'Application estimate using configured assumptions; not a live broker margin or liquidation indicator.'
    } : null
  };
  const identity = {
    focusTicker: requestedTicker,
    account,
    focusPosition: focusPosition ? positionsByTicker.get(normalizeMarginReviewTicker(focusPosition.ticker)) : null,
    otherOpenPositions: positionsWithWeight.filter(position =>
      !requestedTicker || normalizeMarginReviewTicker(position.ticker) !== normalizeMarginReviewTicker(requestedTicker)
    )
  };
  const portfolioContext = {
    asOf: new Date(now).toISOString(),
    ...identity
  };
  const priorityTickers = [...positionsWithWeight]
    .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0) || a.ticker.localeCompare(b.ticker))
    .map(position => position.ticker);

  return { allPositions, focusPosition, portfolioContext, snapshotIdentity: identity, priorityTickers };
}

