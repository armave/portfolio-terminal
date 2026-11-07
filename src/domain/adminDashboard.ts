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
  marginDebt: number;
  freeCash: number;
  dailyMarginCost: number;
  investedCostBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
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

  let investedCostBasis = 0;
  let costBasisComplete = true;
  for (const position of positions) {
    const tranches = (position.tranches || []).filter(tranche =>
      Number.isFinite(Number(tranche.qty)) && Number(tranche.qty) > 0 &&
      Number.isFinite(Number(tranche.price)) && Number(tranche.price) > 0
    );
    const trancheShares = tranches.reduce((sum, tranche) => sum + Number(tranche.qty), 0);
    if (Math.abs(trancheShares - Number(position.shares)) > Math.max(0.000001, Number(position.shares) * 0.000001)) {
      costBasisComplete = false;
    }
    investedCostBasis += tranches.reduce((sum, tranche) => sum + Number(tranche.qty) * Number(tranche.price), 0);
  }
  for (const holding of cashHoldings) {
    const shares = Number(holding.shares);
    const averagePrice = Number(holding.averagePrice);
    if (!Number.isFinite(averagePrice) || averagePrice <= 0) costBasisComplete = false;
    else investedCostBasis += shares * averagePrice;
  }
  if (valuation.unpricedHoldings > 0 || !costBasisComplete) investedCostBasis = Number.NaN;

  const unrealizedPnl = status === 'incomplete' || !Number.isFinite(investedCostBasis)
    ? null
    : valuation.totalHoldingsValue - investedCostBasis;
  const unrealizedPnlPercent = unrealizedPnl !== null && investedCostBasis > 0
    ? unrealizedPnl / investedCostBasis * 100
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
    investedCostBasis: Number.isFinite(investedCostBasis) ? investedCostBasis : null,
    unrealizedPnl,
    unrealizedPnlPercent,
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
