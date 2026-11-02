import type { BrokerAssumptions, TrancheItem } from '../types/portfolio';
import { calculateCommission, resolveCommissionConfig } from './portfolio';

export interface FifoSaleAllocation {
  soldCostBasis: number;
  buyCommissionAllocated: number;
  remainingTranches: TrancheItem[];
}

/**
 * Allocate a partial or full sale across purchase lots in FIFO order.
 * This preserves per-execution buy fees when available and the historical
 * proportional aggregate-fee fallback for legacy positions.
 */
export function allocateFifoSaleTranches(
  tranches: readonly TrancheItem[],
  sharesToSell: number,
  positionShares: number,
  aggregateBuyCommission: number
): FifoSaleAllocation {
  let remainingToSell = sharesToSell;
  let soldCostBasis = 0;
  let buyCommissionAllocated = 0;
  const remainingTranches: TrancheItem[] = [];
  const hasPerTrancheCommissions = tranches.length > 0 && tranches.every(
    (tranche) => Number.isFinite(Number(tranche.buyCommission))
  );

  for (const tranche of tranches) {
    const trancheShares = Number(tranche.qty ?? tranche.shares) || 0;
    const tranchePrice = Number(tranche.price ?? tranche.entryPrice) || 0;

    if (remainingToSell <= 0) {
      remainingTranches.push({ ...tranche });
      continue;
    }

    const take = Math.min(trancheShares, remainingToSell);
    soldCostBasis += take * tranchePrice;
    remainingToSell -= take;

    const trancheBuyCommission = hasPerTrancheCommissions
      ? Math.max(0, Number(tranche.buyCommission) || 0)
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

  const sellRatio = positionShares > 0 ? sharesToSell / positionShares : 1;
  const allocatedCommission = hasPerTrancheCommissions
    ? Number(buyCommissionAllocated.toFixed(2))
    : Number((aggregateBuyCommission * sellRatio).toFixed(2));

  return {
    soldCostBasis,
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
