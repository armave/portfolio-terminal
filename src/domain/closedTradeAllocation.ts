import type { ActiveTrancheType, ClosedTradeAllocation } from '../types/portfolio';

export interface ClosedTradeGuestAllocation {
  guestId: string;
  quantity: number;
}

export interface ResolvedClosedTradeAllocation {
  fundingType: ActiveTrancheType;
  cashQuantity: number;
  marginQuantity: number;
  guestAllocations: ClosedTradeGuestAllocation[];
}

const isFundingType = (value: unknown): value is ActiveTrancheType =>
  value === 'cash' || value === 'margin' || value === 'mix';

const finiteNonNegative = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
};

/**
 * Resolve a closed-history row's visible allocation. Explicit admin edits win;
 * otherwise retain FIFO tranche attribution, with unclassified legacy rows
 * defaulting to Margin. Guest ownership is limited to the cash-funded shares.
 */
export function resolveClosedTradeAllocation(
  quantityValue: unknown,
  inferredType: ActiveTrancheType | 'unclassified' | null | undefined,
  inferredGuests: readonly ClosedTradeGuestAllocation[] = [],
  saved?: Partial<ClosedTradeAllocation> | null,
  inferredCashQuantity?: number
): ResolvedClosedTradeAllocation {
  const quantity = finiteNonNegative(quantityValue);
  const inferredCash = inferredCashQuantity === undefined
    ? inferredGuests.reduce((sum, item) => sum + finiteNonNegative(item.quantity), 0)
    : finiteNonNegative(inferredCashQuantity);
  const fundingType = isFundingType(saved?.fundingType)
    ? saved.fundingType
    : isFundingType(inferredType) ? inferredType : inferredCash > 0 ? 'mix' : 'margin';

  let cashQuantity = 0;
  if (fundingType === 'cash') {
    cashQuantity = quantity;
  } else if (fundingType === 'mix') {
    const requestedCash = saved && saved.cashQuantity !== undefined
      ? finiteNonNegative(saved.cashQuantity)
      : inferredCash;
    cashQuantity = Math.min(quantity, requestedCash);
  }
  const marginQuantity = Math.max(0, quantity - cashQuantity);

  const guestAllocations = saved
    ? (cashQuantity > 0 && String(saved.guestId || '').trim()
      ? [{ guestId: String(saved.guestId).trim(), quantity: cashQuantity }]
      : [])
    : inferredGuests
      .map((item) => ({ guestId: String(item.guestId || '').trim(), quantity: finiteNonNegative(item.quantity) }))
      .filter((item) => item.guestId && item.quantity > 0)
      .reduce<ClosedTradeGuestAllocation[]>((result, item) => {
        const remaining = Math.max(0, cashQuantity - result.reduce((sum, current) => sum + current.quantity, 0));
        const quantityForGuest = Math.min(remaining, item.quantity);
        if (quantityForGuest > 0) result.push({ guestId: item.guestId, quantity: quantityForGuest });
        return result;
      }, []);

  return { fundingType, cashQuantity, marginQuantity, guestAllocations };
}
