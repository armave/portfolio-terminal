type FeeRecord = Record<string, any>;

const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);

export function applyCashflowAllocationsToBrokerExecutions(
  executions: FeeRecord[],
  allocationsBySell: ReadonlyMap<number, Record<string, number>>
): FeeRecord[] {
  return executions.map((trade, index) => {
    if (!SELL_SIDES.has(String(trade.side ?? '').toLowerCase())) return trade;

    // Rebuild from the currently imported cashflows. Keeping the old allocation
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
    const netProfit = profit == null ? null : Number((profit - marginFee).toFixed(2));
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
    const previousMargin = Math.abs(Number(trade.marginInterest ?? trade.marginFee ?? 0)) || 0;
    if (addedFee <= 0 && previousMargin <= 0) return trade;

    // Undo the previous cashflow allocation before applying the current one.
    const previousFees = Number(trade.feesAndCommissions ?? trade.totalCommissions ?? trade.commissions ?? 0) || 0;
    const net = Number(trade.netProfit ?? trade.netRealizedGain ?? trade.grossProfit ?? 0) || 0;
    const fees = Number((Math.max(0, previousFees - previousMargin) + addedFee).toFixed(2));
    const netAfterFee = Number((net + previousMargin - addedFee).toFixed(2));

    if (
      Number(trade.feesAndCommissions ?? trade.totalCommissions ?? 0) === fees &&
      Number(trade.totalCommissions ?? fees) === fees &&
      Number(trade.marginInterest ?? 0) === addedFee &&
      Number(trade.marginFee ?? 0) === addedFee &&
      Number(trade.netProfit ?? trade.netRealizedGain ?? 0) === netAfterFee &&
      Number(trade.netRealizedGain ?? netAfterFee) === netAfterFee
    ) return trade;
    return {
      ...trade,
      feesAndCommissions: fees,
      totalCommissions: fees,
      marginInterest: addedFee,
      marginFee: addedFee,
      netProfit: netAfterFee,
      netRealizedGain: netAfterFee
    };
  });
}

type ClosedHistoryRow = { trade: Record<string, any> };

/** Prefer broker rows for app/broker records that describe the same closed sale. */
export function deduplicateClosedHistoryRows<T extends ClosedHistoryRow>(
  appRows: T[],
  brokerRows: T[]
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
