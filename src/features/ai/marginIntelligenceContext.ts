import { calculateMarginRiskSnapshot, hasUnresolvedBrokerPositionIntegrity } from '../../domain/marginRisk';
import { calculatePortfolioValuation } from '../../domain/portfolioValuation';
import {
  normalizeMarginReviewTicker,
  reconcileMarginReviewShares,
  sumMarginReviewCashShares
} from './marginIntelligence';
import { DEFAULT_ADMIN_REFRESH_INTERVAL_MS } from '../../services/portfolioAutoRefresh';
import { getQuoteFreshness } from '../../utils/formatters';
import type { BoardState, PositionRecord } from '../../types/portfolio';

/** Build the evidence snapshot used by Margin Intelligence without coupling it to the app shell. */
function finiteReviewNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildMarginReviewContext(
  snapshot: BoardState,
  requestedTicker: string | null,
  now = Date.now(),
  refreshIntervalMs = DEFAULT_ADMIN_REFRESH_INTERVAL_MS
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
  const assumptions = snapshot.brokerAssumptions;
  const positionIntegrityComplete = !hasUnresolvedBrokerPositionIntegrity(snapshot.brokerAccountInfo);
  const brokerSnapshotStatus = snapshot.brokerAccountInfo?.status ||
    (snapshot.brokerAccountInfo?.loaded ? 'loaded' : 'not-loaded');
  const riskHoldings = [...allPositions, ...cashHoldings.filter(holding => Number(holding.shares) > 0)];
  const riskQuoteStatuses = riskHoldings.map(position => getQuoteFreshness(position, now, refreshIntervalMs));
  const quotesProvisional = riskQuoteStatuses.some(status => status !== 'fresh');
  const riskFreshness = riskQuoteStatuses.includes('stale') ? 'stale'
    : riskQuoteStatuses.includes('delayed') ? 'delayed'
      : quotesProvisional ? 'unknown' : 'fresh';
  const valuationReliability = !valuation.accountBalanceAvailable || valuation.unpricedHoldings > 0
    ? 'incomplete'
    : brokerSnapshotStatus !== 'current' || quotesProvisional ? 'provisional' : 'current';
  const riskObservationValues: unknown[] = [
    snapshot.brokerAccountInfo?.observedAt,
    ...riskHoldings.map(position => position.quoteDetails?.sourceTimestamp)
  ];
  const riskObservedAt = riskObservationValues.length > 0 &&
    riskObservationValues.every(value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    ? Math.min(...riskObservationValues as number[])
    : null;
  const marginRisk = assumptions
    ? calculateMarginRiskSnapshot({
      currency: 'USD',
      positionIntegrityComplete,
      longExposure: valuation.totalHoldingsValue,
      shortExposure: 0,
      cashBalance: valuation.cashBalance,
      marginDebt: valuation.marginDebt,
      // The current client snapshot has no broker-confirmed eligible-collateral field.
      // Account cash is used only as a configured assumption and remains provisional.
      eligibleCollateral: valuation.cashBalance,
      eligibleCollateralSource: 'configured-assumption',
      assumptions,
      quality: valuationReliability,
      freshness: riskFreshness,
      observedAt: riskObservedAt,
      calculatedAt: now
    })
    : null;
  const account = {
    reportingCurrency: 'USD',
    brokerSnapshotStatus,
    brokerSnapshotReceivedAt: snapshot.brokerAccountInfo?.receivedAt || null,
    positionIntegrityComplete,
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
    marginRisk: marginRisk && assumptions ? marginRisk.status === 'unavailable' ? {
      status: 'unavailable',
      reason: marginRisk.reason,
      warnings: marginRisk.warnings
    } : {
      status: marginRisk.status,
      quality: marginRisk.quality,
      observedAt: marginRisk.value.observedAt,
      freshness: marginRisk.value.freshness,
      calculatedAt: marginRisk.value.calculatedAt,
      equityRatioPct: marginRisk.value.equityRatio === null ? null : marginRisk.value.equityRatio * 100,
      maintenanceEquityRatioPct: assumptions.maintenanceEquityRatio * 100,
      stopOutRatioPct: assumptions.stopOutRatio * 100,
      eligibleCollateral: marginRisk.value.eligibleCollateral,
      eligibleCollateralSource: marginRisk.value.eligibleCollateralSource,
      initialMarginRequirement: marginRisk.value.initialMarginRequirement,
      maintenanceMarginRequirement: marginRisk.value.maintenanceMarginRequirement,
      concentrationAddOn: marginRisk.value.concentrationAddOn,
      maintenanceBuffer: marginRisk.value.maintenanceBuffer,
      maintenanceState: marginRisk.value.maintenanceState,
      stopOutBuffer: marginRisk.value.stopOutBuffer,
      marginCallBufferPct: marginRisk.value.marginCallBufferPct,
      stopOutBufferPct: marginRisk.value.stopOutBufferPctOfLongExposure,
      dailyBorrowCostEstimate: marginRisk.value.dailyInterestCost,
      annualBorrowCostEstimate: marginRisk.value.annualInterestCost,
      annualBorrowRatePct: assumptions.annualBorrowRate * 100,
      dayCountBasis: assumptions.dayCountBasis,
      warnings: marginRisk.warnings,
      qualification: marginRisk.value.disclaimer
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

