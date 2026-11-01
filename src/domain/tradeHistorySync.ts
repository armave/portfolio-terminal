type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function parseTradeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
    if (numeric > 20000 && numeric < 100000) {
      return Date.UTC(1899, 11, 30) + numeric * 86400000;
    }
    return null;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function localDateString(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);

/**
 * Return the most recent closed-trade calendar date across cached TradeNet sells
 * and app-owned closed trades. Buy executions are excluded because the Trades
 * table represents completed sales; older saved executions remain available
 * locally for FIFO matching after the incremental page is merged.
 */
export function getLatestClosedTradeDate(
  brokerExecutions: readonly unknown[] = [],
  appClosedTrades: readonly unknown[] = []
): string | undefined {
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const candidate of brokerExecutions) {
    const row = asRecord(candidate);
    if (!row || !SELL_SIDES.has(String(row.side ?? '').trim().toLowerCase())) continue;
    const timestamp = parseTradeTimestamp(row.executedAt ?? row.date ?? row.time ?? row.datetime);
    if (timestamp !== null && timestamp > latestTimestamp) latestTimestamp = timestamp;
  }

  for (const candidate of appClosedTrades) {
    const row = asRecord(candidate);
    if (!row) continue;
    const timestamp = parseTradeTimestamp(row.exitDate ?? row.sellDate ?? row.closedAt ?? row.date);
    if (timestamp !== null && timestamp > latestTimestamp) latestTimestamp = timestamp;
  }

  return Number.isFinite(latestTimestamp) ? localDateString(latestTimestamp) : undefined;
}
