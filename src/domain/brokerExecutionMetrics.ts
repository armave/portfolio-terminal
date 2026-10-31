export interface BrokerExecutionMetrics {
  holdingDays: number | null;
  buyCommission: number | null;
}

/**
 * Minimal allowlisted broker execution fields consumed by FIFO metrics.
 * Values stay unknown at this boundary because broker and persisted history
 * payloads may contain numeric strings, nulls, or legacy aliases.
 */
export interface BrokerExecutionMetricInput {
  ticker?: unknown;
  side?: unknown;
  quantity?: unknown;
  shares?: unknown;
  executedAt?: unknown;
  date?: unknown;
  commission?: unknown;
  commissionCurrency?: unknown;
  currency?: unknown;
}

const BUY_SIDES = new Set(['buy', 'b', 'purchase', 'bought', '1']);
const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);

function isUsdCommission(trade: BrokerExecutionMetricInput): boolean {
  const currency = String(trade.commissionCurrency ?? trade.currency ?? '').trim().toUpperCase();
  return currency === '' || currency === 'USD';
}

export function normalizeExecutionTicker(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/, '');
}

/** FIFO-match buy lots to sells; incomplete source history never becomes a fabricated zero. */
export function calculateBrokerExecutionMetrics<T extends BrokerExecutionMetricInput>(executions: readonly T[]): Map<T, BrokerExecutionMetrics> {
  const sorted = executions.map((trade, index) => ({
    trade,
    index,
    ticker: normalizeExecutionTicker(trade.ticker),
    side: String(trade.side ?? '').trim().toLowerCase(),
    quantity: Math.abs(Number(trade.quantity ?? trade.shares ?? 0)),
    time: Date.parse(String(trade.executedAt ?? trade.date ?? ''))
  })).filter(row => row.ticker && Number.isFinite(row.time) && Number.isFinite(row.quantity) && row.quantity > 0)
    .sort((a, b) => a.time - b.time || a.index - b.index);

  const queues = new Map<string, Array<{ date: number; quantity: number; commissionCentsRemaining: number | null }>>();
  const metrics = new Map<T, BrokerExecutionMetrics>();
  for (const row of sorted) {
    if (BUY_SIDES.has(row.side)) {
      const queue = queues.get(row.ticker) ?? [];
      const rawCommission = row.trade.commission;
      const commission = rawCommission === null || rawCommission === undefined || rawCommission === ''
        ? NaN
        : Math.abs(Number(rawCommission));
      queue.push({
        date: row.time,
        quantity: row.quantity,
        commissionCentsRemaining: Number.isFinite(commission) && isUsdCommission(row.trade)
          ? Math.round(commission * 100)
          : null
      });
      queues.set(row.ticker, queue);
      continue;
    }
    if (!SELL_SIDES.has(row.side)) continue;

    const queue = queues.get(row.ticker) ?? [];
    let remaining = row.quantity;
    let weightedDays = 0;
    let matched = 0;
    let buyCommissionCents = 0;
    let commissionKnown = true;
    while (remaining > 1e-8 && queue.length > 0) {
      const lot = queue[0];
      const used = Math.min(remaining, lot.quantity);
      weightedDays += Math.max(0, row.time - lot.date) / 86400000 * used;
      matched += used;
      if (lot.commissionCentsRemaining === null) {
        commissionKnown = false;
      } else {
        // Carry residual cents forward through partial closes. The final slice
        // receives the remainder, so all matched buy-side commission is retained.
        const allocatedCents = used >= lot.quantity - 1e-8
          ? lot.commissionCentsRemaining
          : Math.floor(lot.commissionCentsRemaining * used / lot.quantity);
        buyCommissionCents += allocatedCents;
        lot.commissionCentsRemaining -= allocatedCents;
      }
      remaining -= used;
      lot.quantity -= used;
      if (lot.quantity <= 1e-8) queue.shift();
    }
    const fullyMatched = matched > 0 && remaining <= 1e-8;
    metrics.set(row.trade, {
      holdingDays: fullyMatched ? weightedDays / matched : null,
      buyCommission: fullyMatched && commissionKnown ? Number((buyCommissionCents / 100).toFixed(2)) : null
    });
  }
  return metrics;
}
