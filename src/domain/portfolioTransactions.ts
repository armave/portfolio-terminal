import type { BrokerAssumptions, ClosedTrade, PositionRecord, TrancheItem } from '../types/portfolio';
import { calculateCommission, calculateMarginInterest, resolveCommissionConfig } from './portfolio';
import { validateSaleCostBasisTranches } from './saleCostBasis';

function requireFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return value;
}

function requireNonNegativeNumber(value: number, label: string): number {
  requireFiniteNumber(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative.`);
  }
  return value;
}

function roundMoney(value: number, label: string): number {
  requireFiniteNumber(value, label);
  const rounded = Number(value.toFixed(2));
  return requireFiniteNumber(rounded, label);
}

type InvestmentTrancheLike = {
  qty?: unknown;
  shares?: unknown;
  price?: unknown;
  entryPrice?: unknown;
};

function sumTrancheInvestment(
  tranches: readonly InvestmentTrancheLike[],
  label: string
): number {
  return tranches.reduce((total, tranche, index) => {
    if (!tranche || typeof tranche !== 'object' || Array.isArray(tranche)) {
      throw new RangeError(`${label} tranche ${index + 1} is invalid.`);
    }

    const quantity = Number(tranche.qty ?? tranche.shares);
    const price = Number(tranche.price ?? tranche.entryPrice);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError(`${label} tranche ${index + 1} quantity must be finite and non-negative.`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new RangeError(`${label} tranche ${index + 1} entry price must be finite and non-negative.`);
    }

    const invested = quantity * price;
    if (!Number.isFinite(invested)) {
      throw new RangeError(`${label} tranche ${index + 1} investment value must be finite.`);
    }

    const nextTotal = total + invested;
    if (!Number.isFinite(nextTotal)) {
      throw new RangeError(`${label} investment total must be finite.`);
    }
    return nextTotal;
  }, 0);
}

export interface FifoSaleAllocation {
  soldCostBasis: number;
  buyCommissionAllocated: number;
  remainingTranches: TrancheItem[];
}

/**
 * Allocate a partial or full sale across a validated acquisition ledger in FIFO
 * order. Invalid/missing lots fail closed before any caller can mutate state.
 * Per-lot fees are retained when complete; otherwise the validated aggregate
 * fee is allocated proportionally for legacy records.
 */
export function allocateFifoSaleTranches(
  tranches: readonly TrancheItem[],
  sharesToSell: number,
  positionShares: number,
  aggregateBuyCommission: number
): FifoSaleAllocation {
  if (!Number.isFinite(sharesToSell) || sharesToSell <= 0) {
    throw new Error('Sale quantity must be a finite positive number.');
  }

  const validated = validateSaleCostBasisTranches(
    tranches,
    positionShares,
    aggregateBuyCommission
  );
  const normalizedAggregateBuyCommission = validated.aggregateBuyCommission;
  const shareTolerance = Math.max(1e-8, Math.abs(positionShares) * 1e-8);
  if (sharesToSell - positionShares > shareTolerance) {
    throw new Error('Sale quantity cannot exceed the validated open position.');
  }
  const normalizedSharesToSell = Math.min(sharesToSell, positionShares);
  let remainingToSell = normalizedSharesToSell;
  let soldCostBasis = 0;
  let buyCommissionAllocated = 0;
  const remainingTranches: TrancheItem[] = [];
  const hasPerTrancheCommissions = validated.hasPerTrancheCommissions;

  for (const tranche of validated.tranches) {
    const trancheShares = tranche.qty;
    const tranchePrice = tranche.price;

    if (remainingToSell <= 0) {
      remainingTranches.push({ ...tranche });
      continue;
    }

    const take = Math.min(trancheShares, remainingToSell);
    soldCostBasis += take * tranchePrice;
    remainingToSell -= take;

    const trancheBuyCommission = hasPerTrancheCommissions
      ? Number(tranche.buyCommission)
      : 0;
    const commissionForTake = hasPerTrancheCommissions && trancheShares > 0
      ? Number((trancheBuyCommission * take / trancheShares).toFixed(2))
      : 0;
    buyCommissionAllocated += commissionForTake;

    if (trancheShares - take > 0) {
      remainingTranches.push({
        ...tranche,
        qty: trancheShares - take,
        ...(hasPerTrancheCommissions
          ? { buyCommission: Number((trancheBuyCommission - commissionForTake).toFixed(2)) }
          : {})
      });
    }
  }

  if (remainingToSell > shareTolerance || !Number.isFinite(soldCostBasis) || soldCostBasis <= 0) {
    throw new Error('Sale quantity could not be fully allocated to valid acquisition lots; reconcile the cost basis before selling.');
  }

  const sellRatio = normalizedSharesToSell / positionShares;
  const unassignedBuyCommission = Math.max(
    0,
    normalizedAggregateBuyCommission - validated.explicitBuyCommissionTotal
  );
  const allocatedCommission = hasPerTrancheCommissions
    ? Number((buyCommissionAllocated + unassignedBuyCommission * sellRatio).toFixed(2))
    : Number((normalizedAggregateBuyCommission * sellRatio).toFixed(2));

  return {
    soldCostBasis: Number(soldCostBasis.toFixed(8)),
    buyCommissionAllocated: allocatedCommission,
    remainingTranches
  };
}

/** Shared broker commission calculation for all confirmed stock-sale paths. */
export function calculateSaleCommission(
  shares: number,
  proceeds: number,
  rules: BrokerAssumptions
): number {
  requireFiniteNumber(shares, 'Sale quantity');
  if (shares <= 0) return 0;
  requireNonNegativeNumber(proceeds, 'Sale proceeds');

  const config = resolveCommissionConfig(rules);
  const calculated = calculateCommission(shares, proceeds, config);
  return roundMoney(calculated, 'Sale commission');
}

export interface SaleProceedsSettlement {
  remainingDebt: number;
  freeCash: number;
  debtRepaid: number;
  cashSurplus: number;
}

/** Shared debt-first allocation of net sale proceeds. */
export function settleSaleProceeds(
  debt: number,
  freeCash: number,
  netProceeds: number
): SaleProceedsSettlement {
  // Negative legacy values remain clamped to zero, but NaN/Infinity must not
  // silently enter the settlement ledger or be mistaken for a valid amount.
  const normalizedDebt = Math.max(0, requireFiniteNumber(debt, 'Margin debt'));
  const normalizedCash = Math.max(0, requireFiniteNumber(freeCash, 'Free cash'));
  const normalizedProceeds = Math.max(0, requireFiniteNumber(netProceeds, 'Net sale proceeds'));
  const debtRepaid = Math.min(normalizedDebt, normalizedProceeds);
  const cashSurplus = Math.max(0, normalizedProceeds - debtRepaid);
  const remainingDebt = Math.max(0, normalizedDebt - debtRepaid);
  const nextFreeCash = requireFiniteNumber(normalizedCash + cashSurplus, 'Settled free cash');

  return {
    remainingDebt,
    freeCash: nextFreeCash,
    debtRepaid,
    cashSurplus
  };
}


export interface SaleAccountingInput {
  tranches: readonly TrancheItem[];
  positions: Readonly<Record<string, PositionRecord>>;
  positionShares: number;
  sharesSold: number;
  balance: number;
  brokerAssumptions: Pick<BrokerAssumptions, 'annualBorrowRate' | 'dayCountBasis'>;
  positionMarginCharged?: number;
  sellProceeds: number;
  soldCostBasis: number;
  buyCommissionAllocated: number;
  sellCommission: number;
  /** Optional deterministic clock for tests; production preserves the existing system clock. */
  now?: Date;
}

export interface SaleAccountingResult {
  marginInterestAllocated: number;
  totalCommissions: number;
  grossProfit: number;
  netProfit: number;
  netCashProceeds: number;
}

/**
 * Calculate the financing allocation and realized accounting for one sale.
 * This is deliberately pure: PortfolioStore remains responsible for committing
 * the resulting position, debt, cash, and closed-trade state.
 */
export function calculateSaleAccounting(input: SaleAccountingInput): SaleAccountingResult {
  const {
    tranches,
    positions,
    positionShares,
    sharesSold,
    balance,
    brokerAssumptions,
    positionMarginCharged,
    sellProceeds,
    soldCostBasis,
    buyCommissionAllocated,
    sellCommission,
    now
  } = input;

  requireFiniteNumber(positionShares, 'Open position quantity');
  if (positionShares <= 0) {
    throw new RangeError('Open position quantity must be positive.');
  }
  requireFiniteNumber(sharesSold, 'Sale quantity');
  if (sharesSold <= 0) {
    throw new RangeError('Sale quantity must be positive.');
  }
  const shareTolerance = Math.max(1e-8, Math.abs(positionShares) * 1e-8);
  if (sharesSold - positionShares > shareTolerance) {
    throw new RangeError('Sale quantity cannot exceed the open position.');
  }

  requireFiniteNumber(balance, 'Signed account balance');
  requireNonNegativeNumber(sellProceeds, 'Sale proceeds');
  requireNonNegativeNumber(soldCostBasis, 'Sold cost basis');
  requireNonNegativeNumber(buyCommissionAllocated, 'Allocated buy commission');
  requireNonNegativeNumber(sellCommission, 'Sell commission');

  const annualBorrowRate = requireNonNegativeNumber(
    brokerAssumptions.annualBorrowRate,
    'Annual borrow rate'
  );
  const dayCountBasis = requireFiniteNumber(brokerAssumptions.dayCountBasis, 'Day-count basis');
  if (dayCountBasis <= 0) {
    throw new RangeError('Day-count basis must be positive.');
  }
  const dailyRate = annualBorrowRate / dayCountBasis;
  requireNonNegativeNumber(dailyRate, 'Daily margin rate');

  if (!Array.isArray(tranches)) {
    throw new RangeError('Selected position tranches must be an array.');
  }
  const positionInvested = sumTrancheInvestment(tranches, 'Selected position');

  if (!positions || typeof positions !== 'object' || Array.isArray(positions)) {
    throw new RangeError('Portfolio positions must be a record.');
  }
  const totalPortfolioInvested = Object.entries(positions).reduce((total, [ticker, position]) => {
    if (!position || typeof position !== 'object') {
      throw new RangeError(`Portfolio position ${ticker} is invalid.`);
    }
    if (position.tranches === undefined || position.tranches === null) return total;
    if (!Array.isArray(position.tranches)) {
      throw new RangeError(`Portfolio position ${ticker} tranches must be an array.`);
    }

    const invested = sumTrancheInvestment(position.tranches, `Portfolio position ${ticker}`);
    return requireNonNegativeNumber(total + invested, 'Total portfolio investment');
  }, 0);

  if (totalPortfolioInvested > 0) {
    const investmentTolerance = Math.max(1e-8, totalPortfolioInvested * 1e-8);
    if (positionInvested - totalPortfolioInvested > investmentTolerance) {
      throw new RangeError('Selected position investment exceeds total portfolio investment.');
    }
  } else if (positionInvested > 0) {
    throw new RangeError('Selected position investment is missing from the portfolio position ledger.');
  }

  const weight = totalPortfolioInvested > 0
    ? Math.min(1, positionInvested / totalPortfolioInvested)
    : 1;
  requireNonNegativeNumber(weight, 'Position investment weight');

  const totalDebt = Math.abs(balance);
  const allocatedDebt = requireNonNegativeNumber(totalDebt * weight, 'Allocated margin debt');

  let positionMarginInterest = calculateMarginInterest([...tranches], {
    dailyRate,
    marginDebt: allocatedDebt,
    totalDebt,
    ...(now ? { now } : {})
  });
  positionMarginInterest = requireNonNegativeNumber(positionMarginInterest, 'Calculated margin interest');

  const recordedPositionCharge = positionMarginCharged === undefined
    ? 0
    : requireNonNegativeNumber(positionMarginCharged, 'Recorded position margin charge');
  // Keep any already-recorded position charge if the current accrual is lower.
  positionMarginInterest = Math.max(positionMarginInterest, recordedPositionCharge);

  const normalizedSharesSold = Math.min(sharesSold, positionShares);
  const sellRatio = normalizedSharesSold / positionShares;
  const marginInterestAllocated = roundMoney(
    positionMarginInterest * sellRatio,
    'Allocated margin interest'
  );
  const totalCommissions = roundMoney(
    buyCommissionAllocated + sellCommission,
    'Total sale commissions'
  );
  const grossProfit = roundMoney(sellProceeds - soldCostBasis, 'Gross realized profit');
  const netProfit = roundMoney(
    grossProfit - totalCommissions - marginInterestAllocated,
    'Net realized profit'
  );
  // Rollover interest is already reflected in balance before a sale. Do not deduct it again from cash proceeds.
  const netCashProceeds = roundMoney(sellProceeds - sellCommission, 'Net cash proceeds');

  return {
    marginInterestAllocated,
    totalCommissions,
    grossProfit,
    netProfit,
    netCashProceeds
  };
}


/** Resolve the persisted close timestamp using the existing request/date/fallback precedence. */
export function resolveClosedTradeTimestamp(
  requestedClosedAt: number,
  exitTimestamp: number,
  fallbackTimestamp: number
): number {
  return Number.isFinite(requestedClosedAt) && requestedClosedAt > 0
    ? requestedClosedAt
    : Number.isFinite(exitTimestamp) ? exitTimestamp : fallbackTimestamp;
}

export interface ClosedTradeRecordInput {
  id: string;
  ticker: string;
  shares: number;
  soldCostBasis: number;
  sellPrice: number;
  buyDate: string;
  sellDate: string;
  closedTimestamp: number;
  grossProfit: number;
  commissions: number;
  marginInterest: number;
  netProfit: number;
}

/** Build the legacy-compatible closed-trade record without mutating portfolio state. */
export function createClosedTradeRecord(input: ClosedTradeRecordInput): ClosedTrade {
  const buyTimestamp = new Date(input.buyDate).getTime();
  const exitTimestamp = new Date(input.sellDate).getTime();
  const holdingDays = Math.max(
    0,
    Math.round(Math.abs(exitTimestamp - buyTimestamp) / 86400000)
  );

  return {
    id: input.id,
    ticker: input.ticker,
    shares: input.shares,
    avgBuyPrice: input.soldCostBasis / input.shares,
    entryPrice: input.soldCostBasis / input.shares,
    sellPrice: input.sellPrice,
    exitPrice: input.sellPrice,
    buyDate: input.buyDate,
    purchaseDate: input.buyDate,
    sellDate: input.sellDate,
    exitDate: input.sellDate,
    date: input.closedTimestamp,
    closedAt: new Date(input.closedTimestamp).toISOString(),
    grossProfit: input.grossProfit,
    commissions: input.commissions,
    feesAndCommissions: input.commissions,
    totalCommissions: input.commissions,
    marginInterest: input.marginInterest,
    netProfit: input.netProfit,
    netRealizedGain: input.netProfit,
    holdingDays
  };
}
