export interface BrokerExecutionMetrics {
  holdingDays: number | null;
  buyCommission: number | null;
}
type Execution = Record<string, any>;
const BUY_SIDES = new Set(['buy', 'b', 'purchase', 'bought', '1']);
const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);

export function normalizeExecutionTicker(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/, '');
}

/** FIFO-match buy lots to sells; incomplete source history never becomes a fabricated zero. */
export function calculateBrokerExecutionMetrics(executions: Execution[]): Map<Execution, BrokerExecutionMetrics> {
  const sorted = executions.map((trade, index) => ({
    trade,
    index,
    ticker: normalizeExecutionTicker(trade.ticker),
    side: String(trade.side ?? '').trim().toLowerCase(),
    quantity: Math.abs(Number(trade.quantity ?? trade.shares ?? 0)),
    time: Date.parse(String(trade.executedAt ?? trade.date ?? ''))
  })).filter(row => row.ticker && Number.isFinite(row.time) && Number.isFinite(row.quantity) && row.quantity > 0)
    .sort((a, b) => a.time - b.time || a.index - b.index);

  const queues = new Map<string, Array<{ date: number; quantity: number; commissionPerShare: number | null }>>();
  const metrics = new Map<Execution, BrokerExecutionMetrics>();
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
        commissionPerShare: Number.isFinite(commission) ? commission / row.quantity : null
      });
      queues.set(row.ticker, queue);
      continue;
    }
    if (!SELL_SIDES.has(row.side)) continue;

    const queue = queues.get(row.ticker) ?? [];
    let remaining = row.quantity;
    let weightedDays = 0;
    let matched = 0;
    let buyCommission = 0;
    let commissionKnown = true;
    while (remaining > 1e-8 && queue.length > 0) {
      const lot = queue[0];
      const used = Math.min(remaining, lot.quantity);
      weightedDays += Math.max(0, row.time - lot.date) / 86400000 * used;
      matched += used;
      if (lot.commissionPerShare === null) commissionKnown = false;
      else buyCommission += lot.commissionPerShare * used;
      remaining -= used;
      lot.quantity -= used;
      if (lot.quantity <= 1e-8) queue.shift();
    }
    const fullyMatched = matched > 0 && remaining <= 1e-8;
    metrics.set(row.trade, {
      holdingDays: fullyMatched ? weightedDays / matched : null,
      buyCommission: fullyMatched && commissionKnown ? Number(buyCommission.toFixed(2)) : null
    });
  }
  return metrics;
}
