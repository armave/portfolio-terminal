import { validateSaleCostBasisTranches } from '../../domain/saleCostBasis';

export interface ExitComparisonReferencePosition {
  currentPrice?: unknown;
  shares?: unknown;
  commBuy?: unknown;
  tranches?: unknown;
}

export interface ExitComparisonReference {
  price: number | null;
  source: 'quote' | 'average-entry' | null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Prefer the selected market quote. Average entry is only a fallback when the
 * complete tracked-lot ledger reconciles to every open share; partial lots
 * must never be presented as a complete reference price.
 */
export function getExitComparisonReference(
  position?: ExitComparisonReferencePosition,
  ticker?: string
): ExitComparisonReference {
  if (!position) return { price: null, source: null };

  const quote = finiteNumber(position.currentPrice);
  if (quote !== null && quote > 0) return { price: quote, source: 'quote' };

  const shares = finiteNumber(position.shares);
  if (shares === null || shares <= 0) return { price: null, source: null };

  const aggregateBuyCommission = position.commBuy === undefined || position.commBuy === null
    ? 0
    : finiteNumber(position.commBuy);
  if (aggregateBuyCommission === null) return { price: null, source: null };

  try {
    const validated = validateSaleCostBasisTranches(
      position.tranches,
      shares,
      aggregateBuyCommission,
      ticker
    );
    const averageEntry = validated.totalCostBasis / shares;
    return Number.isFinite(averageEntry) && averageEntry > 0
      ? { price: averageEntry, source: 'average-entry' }
      : { price: null, source: null };
  } catch {
    return { price: null, source: null };
  }
}
