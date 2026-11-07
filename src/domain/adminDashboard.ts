import type { PortfolioState } from '../types/portfolio';
import { calculatePortfolioValuation, getPortfolioValuationReliability } from './portfolioValuation';
import { getCashCushionTotal } from './portfolioSelectors';
import { summarizeQuoteFreshness } from '../utils/formatters';
import { calculateMarginRiskMetrics } from './marginRisk';

type AdminDashboardStatus = 'current' | 'provisional' | 'incomplete';

export interface AdminDashboardSummary {
  equity: number | null;
  marketValue: number;
  pricedMarketValue: number;
  marginMarketValue: number;
  marginUnpricedPositions: number;
  marginDebt: number;
  freeCash: number;
  dailyMarginCost: number;
  investedCostBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  cashInvestedCostBasis: number | null;
  cashUnrealizedPnl: number | null;
  cashUnrealizedPnlPercent: number | null;
  cashUnpricedHoldings: number;
  cashMissingCostBasisHoldings: number;
  positionCount: number;
  cashHoldingCount: number;
  pricedHoldings: number;
  unpricedHoldings: number;
  quoteSummary: ReturnType<typeof summarizeQuoteFreshness>;
  status: AdminDashboardStatus;
  statusReason: string;
  marginRisk: ReturnType<typeof calculateMarginRiskMetrics> | null;
  marginRiskStatus: 'healthy' | 'elevated' | 'margin-call' | 'stop-out' | 'unavailable';
  marginBufferPct: number | null;
}

/** Build the admin-only overview from canonical portfolio state without inventing missing values. */
export function buildAdminDashboardSummary(
  state: Pick<PortfolioState, 'balance' | 'cashCushion' | 'positions' | 'brokerAccountInfo' | 'brokerAssumptions'>,
  now = Date.now(),
  refreshIntervalMs = 60000
): AdminDashboardSummary {
  const positions = Object.values(state.positions || {}).filter(position =>
    position && Number(position.shares) > 0
  );
  const cashHoldings = (state.cashCushion?.holdings || []).filter(holding =>
    Number(holding.shares) > 0
  );
  const valuation = calculatePortfolioValuation({
    signedAccountBalance: state.balance,
    freeCash: state.cashCushion?.freeCash,
    marginPositions: positions,
    cashHoldings
  });
  const quoteSummary = summarizeQuoteFreshness([...positions, ...cashHoldings], now, refreshIntervalMs);
  const hasCurrentBrokerUsdBalance = state.brokerAccountInfo?.loaded === true &&
    Array.isArray(state.brokerAccountInfo.balances) &&
    state.brokerAccountInfo.balances.some(balance =>
      String(balance.currency ?? '').toUpperCase() === 'USD' &&
      balance.amount !== null && balance.amount !== undefined && Number.isFinite(Number(balance.amount))
    );
  const accountBalanceStale = state.brokerAccountInfo?.status === 'stale' ||
    (state.brokerAccountInfo?.loaded === true && !hasCurrentBrokerUsdBalance);
  const status = getPortfolioValuationReliability({
    accountBalanceAvailable: valuation.accountBalanceAvailable,
    accountBalanceStale,
    unpricedHoldings: valuation.unpricedHoldings,
    staleQuotes: quoteSummary.stale,
    delayedQuotes: quoteSummary.delayed,
    unknownQuotes: quoteSummary.unknown,
    unavailableQuotes: quoteSummary.unavailable
  });

  // Unrealized P/L is a margin-book metric only. Cash-funded holdings still
  // contribute to total equity and market value, but never to this cost basis.
  let investedCostBasis = 0;
  let costBasisComplete = positions.length > 0;
  let marginMarketValue = 0;
  let marginUnpricedPositions = 0;
  for (const position of positions) {
    const shares = Number(position.shares);
    const tranches = (position.tranches || []).filter(tranche =>
      Number.isFinite(Number(tranche.qty)) && Number(tranche.qty) > 0 &&
      Number.isFinite(Number(tranche.price)) && Number(tranche.price) > 0
    );
    const trancheShares = tranches.reduce((sum, tranche) => sum + Number(tranche.qty), 0);
    if (Math.abs(trancheShares - shares) > Math.max(0.000001, shares * 0.000001)) {
      costBasisComplete = false;
    }
    investedCostBasis += tranches.reduce((sum, tranche) => sum + Number(tranche.qty) * Number(tranche.price), 0);
    const marketPrice = Number(position.currentPrice);
    if (Number.isFinite(marketPrice) && marketPrice > 0) marginMarketValue += shares * marketPrice;
    else marginUnpricedPositions += 1;
  }
  if (!costBasisComplete) investedCostBasis = Number.NaN;

  const marginPnlAvailable = positions.length > 0 && costBasisComplete && marginUnpricedPositions === 0;
  const unrealizedPnl = marginPnlAvailable ? marginMarketValue - investedCostBasis : null;
  const unrealizedPnlPercent = unrealizedPnl !== null && investedCostBasis > 0
    ? unrealizedPnl / investedCostBasis * 100
    : null;
  // Cash-funded holdings have an independent P/L calculation; they are never
  // folded into the margin-book unrealized P/L above.
  let cashInvestedCostBasis = 0;
  let cashMarketValue = 0;
  let cashUnpricedHoldings = 0;
  let cashMissingCostBasisHoldings = 0;
  for (const holding of cashHoldings) {
    const shares = Number(holding.shares);
    const marketPrice = Number(holding.currentPrice ?? holding.price);
    const averagePrice = Number(holding.averagePrice);
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) cashUnpricedHoldings += 1;
    else cashMarketValue += shares * marketPrice;
    if (!Number.isFinite(averagePrice) || averagePrice <= 0) cashMissingCostBasisHoldings += 1;
    else cashInvestedCostBasis += shares * averagePrice;
  }
  const cashPnlAvailable = cashHoldings.length > 0 &&
    cashUnpricedHoldings === 0 && cashMissingCostBasisHoldings === 0;
  const cashUnrealizedPnl = cashPnlAvailable ? cashMarketValue - cashInvestedCostBasis : null;
  const cashUnrealizedPnlPercent = cashUnrealizedPnl !== null && cashInvestedCostBasis > 0
    ? cashUnrealizedPnl / cashInvestedCostBasis * 100
    : null;

  const debt = valuation.marginDebt;
  const dailyMarginCost = debt * (state.brokerAssumptions.annualBorrowRate / state.brokerAssumptions.dayCountBasis);
  const marginCollateral = getCashCushionTotal(state as PortfolioState);
  const marginRisk = status === 'incomplete'
    ? null
    : calculateMarginRiskMetrics(debt, valuation.marginHoldingsValue, marginCollateral, state.brokerAssumptions);
  const marginBufferPct = marginRisk && Number.isFinite(marginRisk.marginCallBufferPct)
    ? marginRisk.marginCallBufferPct
    : null;
  const marginRiskStatus = !marginRisk ? 'unavailable'
    : marginRisk.showStopOut ? 'stop-out'
      : marginRisk.showMarginCall ? 'margin-call'
        : marginBufferPct !== null && marginBufferPct < 30 ? 'elevated' : 'healthy';

  return {
    equity: status === 'incomplete' ? null : valuation.equity,
    marketValue: valuation.totalHoldingsValue,
    pricedMarketValue: valuation.totalHoldingsValue,
    marginDebt: debt,
    freeCash: Math.max(0, Number(state.cashCushion?.freeCash) || 0),
    dailyMarginCost,
    investedCostBasis: positions.length > 0 && Number.isFinite(investedCostBasis) ? investedCostBasis : null,
    marginMarketValue,
    marginUnpricedPositions,
    unrealizedPnl,
    unrealizedPnlPercent,
    cashInvestedCostBasis: cashPnlAvailable ? cashInvestedCostBasis : null,
    cashUnrealizedPnl,
    cashUnrealizedPnlPercent,
    cashUnpricedHoldings,
    cashMissingCostBasisHoldings,
    positionCount: positions.length,
    cashHoldingCount: cashHoldings.length,
    pricedHoldings: valuation.pricedHoldings,
    unpricedHoldings: valuation.unpricedHoldings,
    quoteSummary,
    status,
    statusReason: !valuation.accountBalanceAvailable
      ? 'Account balance unavailable'
      : valuation.unpricedHoldings > 0
        ? 'Unpriced holdings'
        : accountBalanceStale
          ? 'Broker balance is stale'
          : status === 'provisional'
            ? 'Quote data is provisional'
            : 'Valuation is current',
    marginRisk,
    marginRiskStatus,
    marginBufferPct
  };
}
