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
    const symbol = ticker.endsWith('.US') ? ticker.slice(0, -3) : '';
    const validSymbol = symbol.length >= 1 && symbol.length <= 16 &&
      Array.from(symbol).every(character =>
        (character >= 'A' && character <= 'Z') ||
        (character >= '0' && character <= '9') ||
        character === '.' || character === '-'
      );
    if (!validSymbol) continue;
    const rawId = row.instr_id;
    if (!(typeof rawId === 'number' || typeof rawId === 'string') || String(rawId).trim() === '') continue;
    const instrumentId = Number(rawId);
    if (Number.isSafeInteger(instrumentId) && instrumentId > 0) return { ticker, instrumentId };
  }
  return null;
}

 
/**
 * Classify a failed getTradingLimits diagnostic without turning a rejected
 * request into a broker limit. HTTP 400 confirms rejection of this request,
 * but does not distinguish a bad parameter name from a bad parameter value.
 */
export function getTradeNetProbeFailureMessage(response: unknown, ticker: string): string | null {
  const probe = asRecord(response);
  if (!probe || probe.ok === true) return null;
  if (probe.source !== 'getTradingLimits') {
    return 'TradeNet trading-limits probe returned an invalid response.';
  }
  if (probe.providerHttpStatus === 400) {
    return 'TradeNet rejected the candidate getTradingLimits request with HTTP 400. The response does not identify whether the parameter name or value is invalid; broker limits remain unverified.';
  }
  const providerError = typeof probe.providerError === 'string' ? probe.providerError : '';
  return providerError
    ? `TradeNet getTradingLimits for ${ticker}: ${providerError}`
    : 'TradeNet did not return verified limits for this instrument.';
}
