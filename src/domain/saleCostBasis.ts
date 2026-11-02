interface ValidatedSaleCostBasisTranche {
  qty: number;
  price: number;
  buyCommission?: number;
  date?: string;
  acquiredAt?: number;
  [key: string]: unknown;
}

export interface ValidatedSaleCostBasis {
  tranches: ValidatedSaleCostBasisTranche[];
  positionShares: number;
  aggregateBuyCommission: number;
  totalShares: number;
  totalCostBasis: number;
  explicitBuyCommissionTotal: number;
  hasPerTrancheCommissions: boolean;
}

function readPositiveFiniteAlias(
  values: unknown[],
  label: string,
  ticker?: string
): number {
  for (const value of values) {
    if (value === undefined || value === null || value === '' || typeof value === 'boolean') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  throw new Error(`Position contains an invalid cost-basis tranche${ticker ? ` for ${ticker}` : ''}: ${label} must be a finite positive number; reconcile lots before selling.`);
}

function readOptionalCommission(value: unknown, ticker?: string): number | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.trim() === '')
  ) {
    throw new Error(`Position contains an invalid cost-basis tranche${ticker ? ` for ${ticker}` : ''}: buy commission must be finite and non-negative; reconcile lots before selling.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Position contains an invalid cost-basis tranche${ticker ? ` for ${ticker}` : ''}: buy commission must be finite and non-negative; reconcile lots before selling.`);
  }
  return parsed;
}

/**
 * Validate the canonical acquisition ledger before a sale can calculate P&L
 * or mutate portfolio state. Legacy field aliases are normalized here, but a
 * market quote is deliberately never considered an acquisition-price source.
 */
export function validateSaleCostBasisTranches(
  sourceTranches: unknown,
  positionShares: number,
  aggregateBuyCommission: number,
  ticker?: string
): ValidatedSaleCostBasis {
  if (!Number.isFinite(positionShares) || positionShares <= 0) {
    throw new Error('Position has no valid open share quantity; reconcile the position before selling.');
  }

  if (!Number.isFinite(aggregateBuyCommission) || aggregateBuyCommission < 0) {
    throw new Error('Position entry commission must be finite and non-negative; reconcile fees before selling.');
  }

  if (!Array.isArray(sourceTranches) || sourceTranches.length === 0) {
    throw new Error('Position has no cost-basis tranches; reconcile its entry cost before selling.');
  }

  const tranches: ValidatedSaleCostBasisTranche[] = sourceTranches.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Position contains an invalid cost-basis tranche ${index + 1}; reconcile lots before selling.`);
    }

    const tranche = value as Record<string, unknown>;
    const qty = readPositiveFiniteAlias(
      [tranche.qty, tranche.shares, tranche.quantity],
      'quantity',
      ticker
    );
    const price = readPositiveFiniteAlias(
      [tranche.price, tranche.entryPrice, tranche.averagePrice],
      'entry price',
      ticker
    );
    const buyCommission = readOptionalCommission(tranche.buyCommission, ticker);
    const rawDate = tranche.date ?? tranche.purchaseDate ?? tranche.entryDate;
    const date = typeof rawDate === 'string' && rawDate.trim() ? rawDate : undefined;
    const rawAcquiredAt = tranche.acquiredAt;
    const acquiredAt = typeof rawAcquiredAt === 'number' &&
      Number.isFinite(rawAcquiredAt) && rawAcquiredAt > 0
      ? rawAcquiredAt
      : undefined;
    const metadata = { ...tranche };
    for (const field of [
      'qty', 'shares', 'quantity',
      'price', 'entryPrice', 'averagePrice',
      'buyCommission',
      'date', 'purchaseDate', 'entryDate',
      'acquiredAt'
    ]) {
      delete metadata[field];
    }

    return {
      ...metadata,
      qty,
      price,
      ...(buyCommission !== undefined ? { buyCommission } : {}),
      ...(date ? { date } : {}),
      ...(acquiredAt !== undefined ? { acquiredAt } : {})
    };
  });

  let totalShares = tranches.reduce((total, tranche) => total + tranche.qty, 0);
  if (!Number.isFinite(totalShares) || totalShares <= 0) {
    throw new Error('Position cost-basis tranche quantities are invalid; reconcile lots before selling.');
  }

  const shareTolerance = Math.max(1e-8, Math.abs(positionShares) * 1e-8);
  const difference = positionShares - totalShares;
  if (difference > shareTolerance) {
    throw new Error(
      `Recorded open shares (${positionShares}) do not match tranche total (${totalShares}); reconcile lots before selling.`
    );
  }
  if (difference < -shareTolerance) {
    throw new Error(
      `Position tranche total (${totalShares}) exceeds recorded open shares (${positionShares}); reconcile lots before selling.`
    );
  }

  // Correct only floating-point drift within the explicit tolerance. Scale all
  // lots and aggregate fees together so average entry cost and fee allocation
  // remain consistent whether the recorded lot sum is slightly above or below.
  const shareScale = positionShares / totalShares;
  if (!Number.isFinite(shareScale) || shareScale <= 0) {
    throw new Error('Position cost-basis tranche quantities are inconsistent; reconcile lots before selling.');
  }
  if (difference !== 0) {
    tranches.forEach((tranche) => {
      tranche.qty *= shareScale;
      if (tranche.buyCommission !== undefined) tranche.buyCommission *= shareScale;
    });
    totalShares = positionShares;
  }
  const normalizedAggregateBuyCommission = aggregateBuyCommission * shareScale;
  if (!Number.isFinite(normalizedAggregateBuyCommission) || normalizedAggregateBuyCommission < 0) {
    throw new Error('Position entry commission is invalid after share reconciliation; reconcile fees before selling.');
  }

  const totalCostBasis = tranches.reduce((total, tranche) => total + tranche.qty * tranche.price, 0);
  if (!Number.isFinite(totalCostBasis) || totalCostBasis <= 0) {
    throw new Error('Position has no finite positive acquisition cost basis; reconcile its entry cost before selling.');
  }

  const explicitBuyCommissionTotal = tranches.reduce(
    (total, tranche) => total + (tranche.buyCommission ?? 0),
    0
  );
  if (!Number.isFinite(explicitBuyCommissionTotal)) {
    throw new Error('Position entry commissions are invalid; reconcile fees before selling.');
  }
  if (explicitBuyCommissionTotal - normalizedAggregateBuyCommission > 0.01) {
    throw new Error('Tranche entry commissions exceed the recorded position commission; reconcile fees before selling.');
  }

  return {
    tranches,
    positionShares,
    aggregateBuyCommission: normalizedAggregateBuyCommission,
    totalShares,
    totalCostBasis,
    explicitBuyCommissionTotal,
    hasPerTrancheCommissions: tranches.every((tranche) => tranche.buyCommission !== undefined)
  };
}
