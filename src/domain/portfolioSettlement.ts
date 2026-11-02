import { calculateCommission, resolveCommissionConfig, type CommissionRuleSource } from './portfolio';

export function calculateSaleCommission(shares: number, proceeds: number, rules: CommissionRuleSource): number {
  const { commPerShare, commVolumePct, minCommOrder } = resolveCommissionConfig(rules);
  const fallback = Number(Math.max(minCommOrder, shares * commPerShare + proceeds * commVolumePct).toFixed(2));
  try {
    const calculated = calculateCommission(shares, proceeds, { commPerShare, commVolumePct, minCommOrder });
    return Number.isFinite(calculated) && calculated > 0 ? Number(calculated.toFixed(2)) : fallback;
  } catch {
    return fallback;
  }
}

export function settleSaleProceeds(
  debt: number,
  freeCash: number,
  netProceeds: number
): { remainingDebt: number; freeCash: number; debtRepaid: number; cashSurplus: number } {
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
