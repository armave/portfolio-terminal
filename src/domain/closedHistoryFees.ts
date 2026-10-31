type FeeRecord = Record<string, any>;

const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);

/**
 * Reattach locally persisted cashflow allocations when freshly fetched broker rows
 * omit client-calculated fields. Broker refreshes are authoritative for execution
 * facts, but are not authoritative for the fee allocations derived by this app.
 */
export function preservePersistedBrokerFeeAllocations<T extends FeeRecord>(
  executions: T[],
  persistedExecutions: FeeRecord[]
): T[] {
  const rowsWithAllocations = new Map<string, FeeRecord>();
  for (const trade of persistedExecutions) {
    const id = trade?.id == null ? '' : String(trade.id);
    const allocations = trade?.marginFeeAllocations;
    if (!id || !allocations || typeof allocations !== 'object' ||
        !Object.values(allocations).some((amount) => Number(amount) > 0)) continue;
    // Prefer the last persisted candidate for each stable execution ID.
    rowsWithAllocations.set(id, trade);
  }

  return executions.map((trade) => {
    const id = trade?.id == null ? '' : String(trade.id);
    const persisted = id ? rowsWithAllocations.get(id) : undefined;
    if (!persisted) return trade;
    const currentAllocations = trade.marginFeeAllocations;
    if (currentAllocations && typeof currentAllocations === 'object' &&
        Object.values(currentAllocations).some((amount) => Number(amount) > 0)) return trade;

    return {
      ...trade,
      marginFeeAllocations: persisted.marginFeeAllocations,
      marginFee: persisted.marginFee,
      feesAndCommissions: persisted.feesAndCommissions,
      netProfit: persisted.netProfit
    };
  });
}

export function applyCashflowAllocationsToBrokerExecutions(
  executions: FeeRecord[],
  allocationsBySell: ReadonlyMap<number, Record<string, number>>
): FeeRecord[] {
  return executions.map((trade, index) => {
    if (!SELL_SIDES.has(String(trade.side ?? '').toLowerCase())) return trade;

    // Rebuild from the current broker cashflows. Keeping the old allocation
    // object here would retain fees from cashflow rows that were replaced/removed.
    const marginFeeAllocations = Object.fromEntries(
      Object.entries(allocationsBySell.get(index) ?? {})
        .map(([id, amount]) => [id, Number(amount.toFixed(6))])
    ) as Record<string, number>;
    const marginFee = Number(
      Object.values(marginFeeAllocations)
        .reduce((sum, amount) => sum + (Number(amount) || 0), 0)
        .toFixed(2)
    );
    const commission = Math.abs(Number(trade.commission ?? 0)) || 0;
    const profit = trade.profit == null ? null : Number(trade.profit);

    const feesAndCommissions = Number((commission + marginFee).toFixed(2));
    const netProfit = profit == null ? null : Number((profit - feesAndCommissions).toFixed(2));
    const previousAllocations = trade.marginFeeAllocations ?? {};
    const sameAllocations = JSON.stringify(previousAllocations) === JSON.stringify(marginFeeAllocations);
    if (
      sameAllocations &&
      Number(trade.marginFee ?? 0) === marginFee &&
      Number(trade.feesAndCommissions ?? 0) === feesAndCommissions &&
      (trade.netProfit == null ? netProfit == null : Number(trade.netProfit) === netProfit)
    ) return trade;
    return { ...trade, marginFeeAllocations, marginFee, feesAndCommissions, netProfit };
  });
}

export function applyCashflowAllocationsToClosedTrades(
  trades: FeeRecord[],
  allocationsByTrade: ReadonlyMap<number, number>
): FeeRecord[] {
  return trades.map((trade, index) => {
    const addedFee = Number((allocationsByTrade.get(index) || 0).toFixed(2));
    const previousMargin = Math.abs(Number(trade.marginInterest) || Number(trade.marginFee) || 0);
    if (addedFee <= 0 && previousMargin <= 0) return trade;

    // Undo the previous cashflow allocation before applying the current one.
    const previousFees = Number(trade.feesAndCommissions ?? trade.totalCommissions ?? trade.commissions ?? 0) || 0;
    const netValue = trade.netProfit ?? trade.netRealizedGain;
    const hasKnownNet = netValue !== null && netValue !== undefined && Number.isFinite(Number(netValue));
    const net = hasKnownNet ? Number(netValue) : null;
    const fees = Number((Math.max(0, previousFees - previousMargin) + addedFee).toFixed(2));
    const netAfterFee = hasKnownNet ? Number((net! + previousMargin - addedFee).toFixed(2)) : null;

    if (
      Number(trade.feesAndCommissions ?? trade.totalCommissions ?? 0) === fees &&
      Number(trade.totalCommissions ?? fees) === fees &&
      Number(trade.marginInterest ?? 0) === addedFee &&
      Number(trade.marginFee ?? 0) === addedFee &&
      (!hasKnownNet || (
        Number(trade.netProfit ?? trade.netRealizedGain) === netAfterFee &&
        Number(trade.netRealizedGain ?? netAfterFee) === netAfterFee
      ))
    ) return trade;
    return {
      ...trade,
      feesAndCommissions: fees,
      totalCommissions: fees,
      marginInterest: addedFee,
      marginFee: addedFee,
      ...(hasKnownNet ? { netProfit: netAfterFee, netRealizedGain: netAfterFee } : {})
    };
  });
}


export interface ClosedTradeFeeBreakdown {
  fees: number;
  commissions: number;
  feesTotal: number;
  commissionsKnown: boolean;
}

/** Resolve commission-only and aggregate fee fields without counting margin twice. */
export function resolveClosedTradeFeeBreakdown(trade: FeeRecord): ClosedTradeFeeBreakdown {
  const marginFee = Math.abs(Number(trade.marginFee) || Number(trade.marginInterest) || 0);
  const explicitCommission = trade.commissions ?? trade.commission;
  const aggregateFees = trade.feesAndCommissions;
  const totalCommissions = trade.totalCommissions;
  const explicitValue = explicitCommission === null || explicitCommission === undefined || explicitCommission === ''
    ? NaN
    : Number(explicitCommission);
  const aggregateValue = aggregateFees === null || aggregateFees === undefined || aggregateFees === ''
    ? NaN
    : Number(aggregateFees);
  const totalValue = totalCommissions === null || totalCommissions === undefined || totalCommissions === ''
    ? NaN
    : Number(totalCommissions);
  const commissionsKnown = Number.isFinite(explicitValue) || Number.isFinite(aggregateValue) || Number.isFinite(totalValue);
  const commissions = Number.isFinite(explicitValue)
    ? Math.abs(explicitValue)
    : Number.isFinite(aggregateValue)
      ? Math.max(0, Math.abs(aggregateValue) - marginFee)
      : Number.isFinite(totalValue) ? Math.abs(totalValue) : 0;
  return {
    fees: Number(marginFee.toFixed(2)),
    commissions: Number(commissions.toFixed(2)),
    feesTotal: Number((marginFee + commissions).toFixed(2)),
    commissionsKnown
  };
}

type ClosedHistoryRow = { trade: Record<string, any> };

/** Prefer broker rows for app/broker records that describe the same closed sale. */
export function deduplicateClosedHistoryRows<
  T extends ClosedHistoryRow,
  U extends ClosedHistoryRow
>(
  appRows: T[],
  brokerRows: U[]
): T[] {
  const matchKey = (trade: Record<string, any>): string | null => {
    const ticker = String(trade.ticker ?? '').trim().toUpperCase().replace(/\.US$/, '');
    const rawDate = trade.exitDate ?? trade.sellDate ?? trade.closedAt ?? trade.date;
    const timestamp = typeof rawDate === 'number' ? rawDate : Date.parse(String(rawDate ?? ''));
    const shares = Math.abs(Number(trade.shares ?? trade.quantity ?? 0));
    if (!ticker || !Number.isFinite(timestamp) || !Number.isFinite(shares) || shares <= 0) return null;
    const date = new Date(timestamp);
    const day = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    return `${ticker}|${day}|${shares.toFixed(6)}`;
  };
  const available = new Map<string, number>();
  for (const row of brokerRows) {
    const key = matchKey(row.trade);
    if (key) available.set(key, (available.get(key) || 0) + 1);
  }
  return appRows.filter((row) => {
    const key = matchKey(row.trade);
    const count = key ? available.get(key) || 0 : 0;
    if (!key || count <= 0) return true;
    available.set(key, count - 1);
    return false;
  });
}
