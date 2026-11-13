export interface TradeNetProbeInstrument {
  ticker: string;
  instrumentId: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Select a broker-held USD US instrument for a read-only limits lookup.
 * The OPQ position's instr_id is the trading-system instrument ID; the
 * quote row's n is only a serial quote number and must not be substituted.
 */
export function resolveTradeNetProbeInstrument(snapshot: unknown): TradeNetProbeInstrument | null {
  const root = asRecord(snapshot);
  const opq = asRecord(root?.OPQ);
  const portfolio = asRecord(opq?.ps);
  const rows = Array.isArray(portfolio?.pos) ? portfolio.pos : [];

  for (const value of rows) {
    const row = asRecord(value);
    if (!row || String(row.curr ?? row.base_currency ?? '').trim().toUpperCase() !== 'USD') continue;
    const ticker = typeof row.i === 'string' ? row.i.trim().toUpperCase() : '';
    if (!/^[A-Z0-9.-]{1,16}\\.US$/.test(ticker)) continue;
    const rawId = row.instr_id;
    if (!(typeof rawId === 'number' || typeof rawId === 'string') || String(rawId).trim() === '') continue;
    const instrumentId = Number(rawId);
    if (Number.isSafeInteger(instrumentId) && instrumentId > 0) return { ticker, instrumentId };
  }
  return null;
}
