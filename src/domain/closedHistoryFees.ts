type FeeRecord = Record<string, unknown>;
function asFeeRecord(value: unknown): FeeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as FeeRecord;
}

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
export function preservePersistedBrokerFeeAllocations<T extends object>(
  executions: T[],
  persistedExecutions: readonly unknown[]
): T[] {
  const rowsWithAllocations = new Map<string, FeeRecord>();
  for (const candidate of persistedExecutions) {
    const trade = asFeeRecord(candidate);
    if (!trade) continue;
    const id = trade.id == null ? '' : String(trade.id);
    const allocations = asFeeRecord(trade.marginFeeAllocations);
    if (!id || !allocations ||
        !Object.values(allocations).some((amount) => Number(amount) > 0)) continue;
    rowsWithAllocations.set(id, trade);
  }

  return executions.map((trade) => {
    const current = asFeeRecord(trade) ?? {};
    const id = current.id == null ? '' : String(current.id);
    const persisted = id ? rowsWithAllocations.get(id) : undefined;
    if (!persisted) return trade;
    const currentAllocations = asFeeRecord(current.marginFeeAllocations);
    if (currentAllocations &&
        Object.values(currentAllocations).some((amount) => Number(amount) > 0)) return trade;

    return {
      ...trade,
      marginFeeAllocations: persisted.marginFeeAllocations,
      marginFee: persisted.marginFee,
      feesAndCommissions: persisted.feesAndCommissions,
      netProfit: persisted.netProfit
    } as T;
  });
}


/** Merge a refreshed bounded broker page into the retained execution history. */
export function mergeBrokerExecutionHistory<T extends object>(persisted: T[], fetched: T[]): T[] {
  const byId = new Map<string, T>();
  for (const trade of persisted) {
    const record = asFeeRecord(trade);
    const id = record?.id == null ? '' : String(record.id);
    if (id) byId.set(id, trade);
  }
  for (const trade of fetched) {
    const record = asFeeRecord(trade);
    const id = record?.id == null ? '' : String(record.id);
    if (!id || !record) continue;
    const previous = byId.get(id);
    byId.set(id, previous ? { ...asFeeRecord(previous), ...record } as T : trade);
  }
  return [...byId.values()].sort((left, right) => {
    const a = asFeeRecord(left) ?? {};
    const b = asFeeRecord(right) ?? {};
    const aTime = Date.parse(String(a.executedAt ?? a.date ?? ''));
    const bTime = Date.parse(String(b.executedAt ?? b.date ?? ''));
    if (!Number.isFinite(aTime)) return Number.isFinite(bTime) ? -1 : 0;
    if (!Number.isFinite(bTime)) return 1;
    return aTime - bTime || String(a.id).localeCompare(String(b.id));
  });
}

export function applyCashflowAllocationsToBrokerExecutions<T extends object>(
  executions: T[],
  allocationsBySell: ReadonlyMap<number, Record<string, number>>
): T[] {
  return executions.map((trade, index) => {
    const record = asFeeRecord(trade) ?? {};
    if (!SELL_SIDES.has(String(record.side ?? '').toLowerCase())) return trade;

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
    const commission = Math.abs(Number(record.commission ?? 0)) || 0;
    const profit = record.profit == null ? null : Number(record.profit);

    const feesAndCommissions = Number((commission + marginFee).toFixed(2));
    const netProfit = profit == null ? null : Number((profit - feesAndCommissions).toFixed(2));
    const previousAllocations = record.marginFeeAllocations ?? {};
    const sameAllocations = JSON.stringify(previousAllocations) === JSON.stringify(marginFeeAllocations);
    if (
      sameAllocations &&
      Number(record.marginFee ?? 0) === marginFee &&
      Number(trade.feesAndCommissions ?? 0) === feesAndCommissions &&
      (record.netProfit == null ? netProfit == null : Number(record.netProfit) === netProfit)
    ) return trade;
    return { ...trade, marginFeeAllocations, marginFee, feesAndCommissions, netProfit } as T;
  });
}

export function applyCashflowAllocationsToClosedTrades<T extends object>(
  trades: T[],
  allocationsByTrade: ReadonlyMap<number, number>
): T[] {
  return trades.map((trade, index) => {
    const record = asFeeRecord(trade) ?? {};
    const addedFee = Number((allocationsByTrade.get(index) || 0).toFixed(2));
    const previousMargin = Math.abs(Number(record.marginInterest) || Number(record.marginFee) || 0);
    if (addedFee <= 0 && previousMargin <= 0) return trade;

    // Undo the previous cashflow allocation before applying the current one.
    // feesAndCommissions is the aggregate field written by this allocator;
    // legacy totalCommissions/commissions fields without that aggregate remain commission-only.
    const aggregateFees = firstFiniteNumber(record.feesAndCommissions);
    const legacyCommissionBase = firstFiniteNumber(record.totalCommissions, record.commissions, record.commission) ?? 0;
    const previousCommissionBase = aggregateFees !== null
      ? Math.max(0, aggregateFees - previousMargin)
      : legacyCommissionBase;
    const net = firstFiniteNumber(record.netProfit, record.netRealizedGain);
    const hasKnownNet = net !== null;
    const fees = Number((previousCommissionBase + addedFee).toFixed(2));
    const netAfterFee = hasKnownNet ? Number((net + previousMargin - addedFee).toFixed(2)) : null;

    if (
      Number(record.feesAndCommissions ?? record.totalCommissions ?? 0) === fees &&
      Number(record.totalCommissions ?? fees) === fees &&
      Number(record.marginInterest ?? 0) === addedFee &&
      Number(record.marginFee ?? 0) === addedFee &&
      (!hasKnownNet || (
        Number(record.netProfit ?? record.netRealizedGain) === netAfterFee &&
        Number(record.netRealizedGain ?? netAfterFee) === netAfterFee
      ))
    ) return trade;
    return {
      ...trade,
      feesAndCommissions: fees,
      totalCommissions: fees,
      marginInterest: addedFee,
      marginFee: addedFee,
      ...(hasKnownNet ? { netProfit: netAfterFee, netRealizedGain: netAfterFee } : {})
    } as T;
  });
}


export interface ClosedTradeFeeBreakdown {
  fees: number;
  commissions: number;
  feesTotal: number;
  commissionsKnown: boolean;
}

/** Resolve commission-only and aggregate fee fields without counting margin twice. */
export function resolveClosedTradeFeeBreakdown(trade: object): ClosedTradeFeeBreakdown {
  const record = asFeeRecord(trade) ?? {};
  const marginFee = Math.abs(Number(record.marginFee) || Number(record.marginInterest) || 0);
  const explicitValue = firstFiniteNumber(record.commissions, record.commission);
  const aggregateValue = firstFiniteNumber(record.feesAndCommissions);
  const totalValue = firstFiniteNumber(record.totalCommissions);
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
  trade: object,
  feeBreakdown: ClosedTradeFeeBreakdown
): number | null {
  const record = asFeeRecord(trade) ?? {};
  const netValue = firstFiniteNumber(record.netProfit, record.netRealizedGain);
  if (netValue !== null) return netValue;
  const grossValue = firstFiniteNumber(record.grossProfit);
  if (grossValue === null || !feeBreakdown.commissionsKnown) return null;
  return Number((grossValue - feeBreakdown.feesTotal).toFixed(2));
}

type ClosedHistoryRow = { trade: object };

/** Prefer broker rows for app/broker records that describe the same closed sale. */
export function deduplicateClosedHistoryRows<
  T extends ClosedHistoryRow,
  U extends ClosedHistoryRow
>(
  appRows: T[],
  brokerRows: U[]
): T[] {
  const matchKey = (trade: object): string | null => {
    const record = asFeeRecord(trade) ?? {};
    const ticker = String(record.ticker ?? '').trim().toUpperCase().replace(/\.US$/, '');
    const rawDate = record.exitDate ?? record.sellDate ?? record.closedAt ?? record.date;
    const timestamp = typeof rawDate === 'number' ? rawDate : Date.parse(String(rawDate ?? ''));
    const shares = Math.abs(Number(record.shares ?? record.quantity ?? 0));
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
