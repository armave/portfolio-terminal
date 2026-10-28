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

    return {
      ...trade,
      marginFeeAllocations,
      marginFee,
      feesAndCommissions: Number((commission + marginFee).toFixed(2)),
      netProfit: profit == null ? null : Number((profit - marginFee).toFixed(2))
    };
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
