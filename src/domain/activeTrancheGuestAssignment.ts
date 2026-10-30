import type { ActiveTrancheMix, ActiveTrancheType } from '../types/portfolio';

/** Return the cash-backed quantity that may be associated with a guest. */
export function getAssignableActiveTrancheCashQuantity(
  type: ActiveTrancheType,
  quantity: unknown,
  mix?: Partial<ActiveTrancheMix> | null
): number {
  const totalQuantity = Number(quantity);
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) return 0;
  if (type === 'margin') return 0;
  if (type === 'cash') return totalQuantity;

  const cashQuantity = Number(mix?.cash);
  if (!Number.isFinite(cashQuantity)) return 0;
  return Math.min(totalQuantity, Math.max(0, cashQuantity));
}
