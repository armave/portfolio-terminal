type FeeRecord = Record<string, any>;

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}


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


/** Merge a refreshed bounded broker page into the retained execution history. */
export function mergeBrokerExecutionHistory<T extends FeeRecord>(persisted: T[], fetched: T[]): T[] {
  const byId = new Map<string, T>();
  for (const trade of persisted) {
    const id = trade?.id == null ? '' : String(trade.id);
    if (id) byId.set(id, trade);
  }
  for (const trade of fetched) {
    const id = trade?.id == null ? '' : String(trade.id);
    if (!id) continue;
    const previous = byId.get(id);
    byId.set(id, previous ? { ...previous, ...trade } : trade);
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = Date.parse(String(a.executedAt ?? a.date ?? ''));
    const bTime = Date.parse(String(b.executedAt ?? b.date ?? ''));
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? -1 : 0;
    if (!Number.isFinite(bTime)) return 1;
    return aTime - bTime || String(a.id).localeCompare(String(b.id));
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
    // feesAndCommissions is the aggregate field written by this allocator;
    // legacy totalCommissions/commissions fields without that aggregate remain commission-only.
    const aggregateFees = firstFiniteNumber(trade.feesAndCommissions);
    const legacyCommissionBase = firstFiniteNumber(trade.totalCommissions, trade.commissions, trade.commission) ?? 0;
    const previousCommissionBase = aggregateFees !== null
      ? Math.max(0, aggregateFees - previousMargin)
      : legacyCommissionBase;
    const net = firstFiniteNumber(trade.netProfit, trade.netRealizedGain);
    const hasKnownNet = net !== null;
    const fees = Number((previousCommissionBase + addedFee).toFixed(2));
    const netAfterFee = hasKnownNet ? Number((net + previousMargin - addedFee).toFixed(2)) : null;

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
  const explicitValue = firstFiniteNumber(trade.commissions, trade.commission);
  const aggregateValue = firstFiniteNumber(trade.feesAndCommissions);
  const totalValue = firstFiniteNumber(trade.totalCommissions);
  const commissionsKnown = explicitValue !== null || aggregateValue !== null || totalValue !== null;
  const commissions = explicitValue !== null
    ? Math.abs(explicitValue)
    : aggregateValue !== null
      ? Math.max(0, Math.abs(aggregateValue) - marginFee)
      : totalValue !== null ? Math.abs(totalValue) : 0;
  return {
    fees: Number(marginFee.toFixed(2)),
    commissions: Number(commissions.toFixed(2)),
    feesTotal: Number((marginFee + commissions).toFixed(2)),
    commissionsKnown
  };
}


/** Resolve net P/L without presenting gross P/L as net when fee inputs are incomplete. */
export function resolveClosedTradeNetProfit(
  trade: FeeRecord,
  feeBreakdown: ClosedTradeFeeBreakdown
): number | null {
  const netValue = firstFiniteNumber(trade.netProfit, trade.netRealizedGain);
  if (netValue !== null) return netValue;
  const grossValue = firstFiniteNumber(trade.grossProfit);
  if (grossValue === null || !feeBreakdown.commissionsKnown) return null;
  return Number((grossValue - feeBreakdown.feesTotal).toFixed(2));
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
