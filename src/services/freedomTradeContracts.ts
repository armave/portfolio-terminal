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
  const normalizedSide = (...values: unknown[]): 'BUY' | 'SELL' | 'SELL_SHORT' | null => {
    for (const value of values) {
      const side = String(value ?? '').trim().toLowerCase();
      if (side === '1' || ['b', 'buy', 'bought', 'purchase'].includes(side)) return 'BUY';
      if (side === '2' || side === '3' || ['s', 'sell', 'sold', 'sale'].includes(side)) return 'SELL';
      if (side === '4' || ['ss', 'sell_short', 'sell short', 'short'].includes(side)) return 'SELL_SHORT';
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
    const executedAt = row.executedAt ?? row.date ?? row.time ?? row.datetime ?? row.exec_time ?? null;
    return {
      id: String(row.id ?? row.trade_id ?? row.tradeId ?? stableFallbackId(row)),
      ticker: String(row.instr_nm ?? row.i ?? row.ticker ?? row.symbol ?? row.instr ?? ''),
      // Ignore unrecognized operation placeholders and continue to side/type aliases.
      side: normalizedSide(row.operation, row.side, row.buy_sell, row.type) || 'Unknown',
      quantity: positiveMagnitudeOrNull(row.q, row.quantity, row.qty),
      price: positiveMagnitudeOrNull(row.p, row.price, row.exec_price),
      currency: String(row.curr_c ?? row.curr ?? row.currency ?? row.base_currency ?? ''),
      executedAt: executedAt === null || executedAt === undefined ? null : String(executedAt),
      tradeValue: numberOrNull(row.tradeValue ?? row.v ?? row.summ ?? row.value),
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

/** Resolve an explicit execution collection; null means the provider envelope is incomplete. */
export function extractFreedomTradeHistoryRows(response: unknown): unknown[] | null {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const responseRecord = asRecord(response);
  const responseData = responseRecord?.data;
  const dataRecord = asRecord(responseData);
  const root = dataRecord?.result ?? responseData ?? responseRecord?.result ?? response;
  const rootRecord = asRecord(root);
  const tradesValue = rootRecord?.trades;
  const tradesRecord = asRecord(tradesValue);
  if (Array.isArray(root)) return root;
  if (Array.isArray(tradesRecord?.trade)) return tradesRecord.trade;
  if (Array.isArray(tradesValue)) return tradesValue;
  if (Array.isArray(rootRecord?.items)) return rootRecord.items;
  if (Array.isArray(rootRecord?.history)) return rootRecord.history;
  if (Array.isArray(rootRecord?.data)) return rootRecord.data;
  return null;
}

function isCompleteNormalizedExecution(trade: FreedomExecutedTrade): boolean {
  return Boolean(
    typeof trade.id === 'string' && trade.id.trim() &&
    typeof trade.ticker === 'string' && trade.ticker.trim() &&
    ['BUY', 'SELL', 'SELL_SHORT'].includes(String(trade.side).toUpperCase()) &&
    typeof trade.quantity === 'number' && Number.isFinite(trade.quantity) && trade.quantity > 0 &&
    typeof trade.price === 'number' && Number.isFinite(trade.price) && trade.price > 0 &&
    typeof trade.currency === 'string' && trade.currency.trim() &&
    typeof trade.executedAt === 'string' && trade.executedAt.trim()
  );
}

/** An explicit empty collection is valid; a missing collection is not empty history. */
export function isCompleteFreedomTradeHistoryResponse(
  response: unknown,
  normalizedTrades: readonly FreedomExecutedTrade[]
): boolean {
  const rows = extractFreedomTradeHistoryRows(response);
  if (!rows || rows.length !== normalizedTrades.length) return false;
  if (rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row))) return false;
  return normalizedTrades.every(isCompleteNormalizedExecution);
}

/** Parse optional fills embedded in an order snapshot without accepting partial rows. */
export function parseFreedomOrderFillsResponse(response: unknown): {
  present: boolean;
  valid: boolean;
  fills: FreedomExecutedTrade[];
} {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const envelope = asRecord(response);
  const data = asRecord(envelope?.data) ?? envelope;
  const result = asRecord(data?.result);
  const payload = result?.trades !== undefined ? result : data;
  if (!payload || payload.trades === undefined) return { present: false, valid: true, fills: [] };
  const trades = asRecord(payload.trades);
  const rows = Array.isArray(trades?.trade) ? trades.trade
    : Array.isArray(payload.trades) ? payload.trades
      : null;
  if (!rows) return { present: true, valid: false, fills: [] };
  const fills = normalizeFreedomOrderFills(payload);
  const valid = rows.length === fills.length &&
    rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row)) &&
    fills.every(isCompleteNormalizedExecution);
  return { present: true, valid, fills: valid ? fills : [] };
}



/**
 * Normalize fills embedded in the authenticated TradeNet orders subscription.
 * TradeNet's order operation determines the execution side:
 * 1=Buy, 2=Buy on Margin, 3=Sell, 4=Sell Short.
 * The fill's own trade ID is retained for idempotent history merging.
 */
export function normalizeFreedomOrderFills(response: unknown): FreedomExecutedTrade[] {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  const trades = asRecord(data?.trades);
  const rows = Array.isArray(trades?.trade) ? trades.trade : [];
  if (!rows.length) return [];

  const normalizedRows = rows.flatMap((value) => {
    const row = asRecord(value);
    if (!row) return [];
    const operation = String(row.side ?? row.operation ?? '').trim().toUpperCase();
    const side = operation === '1' || operation === '2' ? 'BUY'
      : operation === '3' ? 'SELL'
        : operation === '4' ? 'SELL_SHORT'
          : operation;
    return [{
      ...row,
      side: side || 'Unknown',
      curr: row.curr ?? row.currency ?? '',
      instr: row.instr ?? row.ticker ?? row.symbol ?? ''
    }];
  });

  return normalizeFreedomTrades({ trades: { trade: normalizedRows } });
}
