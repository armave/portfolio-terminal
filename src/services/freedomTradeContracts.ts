import type { FreedomExecutedTrade } from '../types/freedomTrade';

/** Normalize common TradeNet history field aliases without fabricating missing values. */
export function normalizeFreedomTrades(response: unknown): FreedomExecutedTrade[] {
  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };
  const responseRecord = asRecord(response);
  const responseData = responseRecord?.data;
  const dataRecord = asRecord(responseData);
  const root = dataRecord?.result ?? responseData ?? responseRecord?.result ?? response;
  const rootRecord = asRecord(root);
  const tradesValue = rootRecord?.trades;
  const tradesRecord = asRecord(tradesValue);
  // Actual Freedom wrapper shape from example.json: data.trades.trade[]
  const rows: unknown[] = Array.isArray(root) ? root
    : Array.isArray(tradesRecord?.trade) ? tradesRecord.trade
      : Array.isArray(tradesValue) ? tradesValue
        : Array.isArray(rootRecord?.items) ? rootRecord.items
          : Array.isArray(rootRecord?.history) ? rootRecord.history
            : Array.isArray(rootRecord?.data) ? rootRecord.data
              : [];
  const numberOrNull = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  // A broker row can include placeholder aliases (for example q=0 alongside
  // quantity=5). Prefer a real positive magnitude instead of letting the first
  // non-null placeholder erase an otherwise valid execution.
  const positiveMagnitudeOrNull = (...values: unknown[]): number | null => {
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed !== 0) return Math.abs(parsed);
    }
    return null;
  };
  const normalizedSide = (...values: unknown[]): 'BUY' | 'SELL' | null => {
    for (const value of values) {
      const side = String(value ?? '').trim().toLowerCase();
      if (side === '1' || ['b', 'buy', 'bought', 'purchase'].includes(side)) return 'BUY';
      if (side === '2' || ['s', 'sell', 'sold', 'sale'].includes(side)) return 'SELL';
    }
    return null;
  };
  const numericRecordOrUndefined = (value: unknown): Record<string, number> | undefined => {
    const record = asRecord(value);
    if (!record) return undefined;
    const entries = Object.entries(record).filter((entry): entry is [string, number] =>
      typeof entry[1] === 'number' && Number.isFinite(entry[1])
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  };
  const fallbackOccurrences = new Map<string, number>();
  const stableFallbackId = (row: Record<string, unknown>): string => {
    const fingerprint = JSON.stringify([
      row.order_id ?? row.orderId ?? '',
      row.instr_nm ?? row.i ?? row.ticker ?? row.symbol ?? row.instr ?? '',
      row.oper ?? row.operation ?? row.side ?? row.buy_sell ?? row.type ?? '',
      row.date ?? row.time ?? row.datetime ?? row.exec_time ?? '',
      row.q ?? row.quantity ?? row.qty ?? '',
      row.p ?? row.price ?? row.exec_price ?? '',
      row.v ?? row.summ ?? row.value ?? '',
      row.profit ?? row.pnl ?? ''
    ]);
    let hash = 2166136261;
    for (let index = 0; index < fingerprint.length; index += 1) {
      hash ^= fingerprint.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const key = (hash >>> 0).toString(36);
    const occurrence = fallbackOccurrences.get(key) || 0;
    fallbackOccurrences.set(key, occurrence + 1);
    return `fallback-${key}-${occurrence}`;
  };
  return rows.map((value): FreedomExecutedTrade => {
    const row = asRecord(value) ?? {};
    const executedAt = row.date ?? row.time ?? row.datetime ?? row.exec_time ?? null;
    return {
      id: String(row.id ?? row.trade_id ?? row.tradeId ?? stableFallbackId(row)),
      ticker: String(row.instr_nm ?? row.i ?? row.ticker ?? row.symbol ?? row.instr ?? ''),
      // Ignore unrecognized operation placeholders and continue to side/type aliases.
      side: normalizedSide(row.operation, row.side, row.buy_sell, row.type) || 'Unknown',
      quantity: positiveMagnitudeOrNull(row.q, row.quantity, row.qty),
      price: positiveMagnitudeOrNull(row.p, row.price, row.exec_price),
      currency: String(row.curr_c ?? row.curr ?? row.currency ?? row.base_currency ?? ''),
      executedAt: executedAt === null || executedAt === undefined ? null : String(executedAt),
      tradeValue: numberOrNull(row.v ?? row.summ ?? row.value),
      profit: numberOrNull(row.profit ?? row.pnl),
      marginFee: numberOrNull(row.margin_fee ?? row.marginFee ?? row.margin_interest ?? row.marginInterest ?? row.fee_margin ?? row.feeMargin ?? row.margin_commission ?? row.margin_commiss),
      commission: numberOrNull(row.commission ?? row.commiss ?? row.commissions ?? row.fee ?? row.commiss_exchange),
      commissionCurrency: String(row.commission_currency ?? row.curr_c ?? row.currency ?? ''),
      raw: row,
      marginFeeAllocations: numericRecordOrUndefined(row.marginFeeAllocations),
      feesAndCommissions: numberOrNull(row.feesAndCommissions) ?? undefined,
      netProfit: row.netProfit === null ? null : numberOrNull(row.netProfit) ?? undefined
    };
  });
}

