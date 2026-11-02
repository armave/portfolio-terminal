import type { BrokerAssumptions, ClosedTrade, PositionRecord, TrancheItem } from '../types/portfolio';
import { calculateCommission, calculateMarginInterest, resolveCommissionConfig } from './portfolio';
import { validateSaleCostBasisTranches } from './saleCostBasis';

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
    aggregateBuyCommission - validated.explicitBuyCommissionTotal
  );
  const allocatedCommission = hasPerTrancheCommissions
    ? Number((buyCommissionAllocated + unassignedBuyCommission * sellRatio).toFixed(2))
    : Number((aggregateBuyCommission * sellRatio).toFixed(2));

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
  const { commPerShare, commVolumePct, minCommOrder } = resolveCommissionConfig(rules);
  const fallback = Number(Math.max(minCommOrder, shares * commPerShare + proceeds * commVolumePct).toFixed(2));

  try {
    const calculated = calculateCommission(shares, proceeds, {
      commPerShare,
      commVolumePct,
      minCommOrder
    });
    return Number.isFinite(calculated) && calculated > 0
      ? Number(calculated.toFixed(2))
      : fallback;
  } catch {
    return fallback;
  }
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
  const normalizedDebt = Math.max(0, Number(debt) || 0);
  const normalizedCash = Math.max(0, Number(freeCash) || 0);
  const normalizedProceeds = Math.max(0, Number(netProceeds) || 0);
  const debtRepaid = Math.min(normalizedDebt, normalizedProceeds);
  const cashSurplus = Math.max(0, normalizedProceeds - debtRepaid);

  return {
    remainingDebt: Math.max(0, normalizedDebt - debtRepaid),
    freeCash: normalizedCash + cashSurplus,
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
  const dailyRate = brokerAssumptions.annualBorrowRate / brokerAssumptions.dayCountBasis;
  const totalPortfolioInvested = Object.values(positions).reduce(
    (acc, position) =>
      acc +
      (position.tranches || []).reduce(
        (sum, tranche) =>
          sum +
          (Number(tranche.qty ?? tranche.shares) || 0) *
          (Number(tranche.price ?? tranche.entryPrice) || 0),
        0
      ),
    0
  );
  const positionInvested = tranches.reduce(
    (sum, tranche) =>
      sum +
      (Number(tranche.qty ?? tranche.shares) || 0) *
      (Number(tranche.price ?? tranche.entryPrice) || 0),
    0
  );
  const weight = totalPortfolioInvested > 0 ? positionInvested / totalPortfolioInvested : 1;
  const totalDebt = Math.abs(Number(balance) || 0);
  const allocatedDebt = totalDebt * weight;

  let positionMarginInterest = 0;
  try {
    positionMarginInterest = calculateMarginInterest([...tranches], {
      dailyRate,
      marginDebt: allocatedDebt,
      totalDebt,
      ...(now ? { now } : {})
    });
  } catch {
    positionMarginInterest = 0;
  }
  // Keep any already-recorded position charge if the current accrual is lower.
  positionMarginInterest = Math.max(positionMarginInterest, Number(positionMarginCharged) || 0);
  const sellRatio = positionShares > 0 ? sharesSold / positionShares : 1;
  const marginInterestAllocated = Number((positionMarginInterest * sellRatio).toFixed(2));
  const totalCommissions = Number((buyCommissionAllocated + sellCommission).toFixed(2));
  const grossProfit = Number((sellProceeds - soldCostBasis).toFixed(2));
  const netProfit = Number((grossProfit - totalCommissions - marginInterestAllocated).toFixed(2));
  // Rollover interest is already reflected in balance before a sale. Do not deduct it again from cash proceeds.
  const netCashProceeds = Number((sellProceeds - sellCommission).toFixed(2));

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
