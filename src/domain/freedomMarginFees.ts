import { isFreedomCashflowRow, type NormalizedFreedomCashflow } from './freedomCashflows';

type CashflowInput = Omit<NormalizedFreedomCashflow, 'raw'> & { raw?: Record<string, string> };
type BrokerExecutionFeeInput = {
  executedAt?: string | null;
  date?: string | number | null;
  ticker?: string | null;
  side?: string | null;
  quantity?: number | null;
  shares?: number | null;
  price?: number | null;
  executionPrice?: number | null;
  tradeValue?: number | null;
  currency?: string | null;
};
type AppClosedTradeFeeInput = {
  buyDate?: string | number | null;
  purchaseDate?: string | number | null;
  entryDate?: string | number | null;
  openDate?: string | number | null;
  sellDate?: string | number | null;
  exitDate?: string | number | null;
  closedAt?: string | number | null;
  date?: string | number | null;
  shares?: number | null;
  quantity?: number | null;
  entryPrice?: number | null;
  avgBuyPrice?: number | null;
  buyPrice?: number | null;
  currency?: string | null;
};

export interface FreedomMarginFeeAllocations {
  brokerAllocations: Map<number, Record<string, number>>;
  appAllocations: Map<number, number>;
  matchedFeeRows: number;
  allocatedAmount: number;
}

interface WeightedAllocation { index: number; weight: number }

const BUY_SIDES = new Set(['buy', 'b', 'purchase', 'bought', '1']);
const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);
const FINANCING_FEE_PATTERN = /negative\s+cash\s+balance\s+fee|fee\s+for\s+negative\s+cash\s+balance|margin\s+(?:fee|interest)|(?:daily\s+)?(?:margin|financing|overnight|rollover|borrow(?:ing)?)\s+(?:fee|charge|interest)|interest\s+(?:fee|charge)/i;
const TRADE_COMMISSION_PATTERN = /trading\s+fee|commission\s+for\s+trade/i;

function parseCalendarDate(value: unknown): number {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{4,6}(\.\d+)?$/.test(value.trim()))) {
    const serial = Number(value);
    if (serial > 20000 && serial < 100000) return Date.UTC(1899, 11, 30) + serial * 86400000;
  }
  const text = String(value ?? '').trim();
  if (!text) return NaN;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  const dmy = text.match(/^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/);
  if (dmy) return Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return NaN;
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function utcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : NaN;
}

function getFeeDate(fee: CashflowInput): number {
  const direct = parseCalendarDate(fee.date);
  if (Number.isFinite(direct)) return direct;
  const match = [fee.description, ...Object.values(fee.raw ?? {})]
    .join(' ')
    .match(/balance as at (\d{4}-\d{2}-\d{2})/i);
  return match ? parseCalendarDate(match[1]) : NaN;
}

function isUsdCurrency(value: unknown): boolean {
  const currency = String(value ?? '').trim().toUpperCase();
  return currency === '' || currency === 'USD';
}

function allocateCents(totalCents: number, weighted: WeightedAllocation[]): Map<number, number> {
  const result = new Map<number, number>();
  const valid = weighted.filter(item => Number.isFinite(item.weight) && item.weight > 0);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (totalCents <= 0 || totalWeight <= 0 || valid.length === 0) return result;

  const shares = valid.map(item => {
    const exact = totalCents * item.weight / totalWeight;
    const floor = Math.floor(exact);
    return { index: item.index, cents: floor, remainder: exact - floor };
  });
  let remaining = totalCents - shares.reduce((sum, item) => sum + item.cents, 0);
  shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < shares.length && remaining > 0; i++, remaining--) shares[i].cents += 1;
  for (const item of shares) if (item.cents > 0) result.set(item.index, item.cents);
  return result;
}

function isFinancingCashflow(fee: CashflowInput): boolean {
  if (!isFreedomCashflowRow(fee) || !isUsdCurrency(fee.currency)) return false;
  const text = [fee.type, fee.description, ...Object.values(fee.raw ?? {})].join(' ').toLowerCase();
  return FINANCING_FEE_PATTERN.test(text) && !TRADE_COMMISSION_PATTERN.test(text);
}

/** Allocate daily USD financing fees to FIFO-matched closed executions. */
export function calculateFreedomMarginFeeAllocations(
  cashflows: CashflowInput[],
  brokerExecutions: BrokerExecutionFeeInput[],
  appTrades: AppClosedTradeFeeInput[] = []
): FreedomMarginFeeAllocations {
  const brokerAllocations = new Map<number, Record<string, number>>();
  const appAllocations = new Map<number, number>();
  const feeRows = cashflows.filter(isFinancingCashflow);
  if (feeRows.length === 0) return { brokerAllocations, appAllocations, matchedFeeRows: 0, allocatedAmount: 0 };

  const executions = brokerExecutions.map((trade, index) => ({
    index,
    time: Date.parse(String(trade.executedAt ?? trade.date ?? '')),
    ticker: String(trade.ticker ?? '').trim().toUpperCase().replace(/\.US$/, ''),
    side: String(trade.side ?? '').trim().toLowerCase(),
    quantity: Math.abs(Number(trade.quantity ?? trade.shares ?? 0)),
    price: Math.abs(Number(trade.price ?? trade.executionPrice ?? 0)) ||
      (Number(trade.tradeValue) > 0 && Number(trade.quantity ?? trade.shares) > 0
        ? Math.abs(Number(trade.tradeValue) / Number(trade.quantity ?? trade.shares))
        : 0),
    currency: String(trade.currency ?? '').trim().toUpperCase()
  })).filter(row => row.ticker && Number.isFinite(row.time) && row.quantity > 0 && isUsdCurrency(row.currency))
    .sort((a, b) => a.time - b.time || a.index - b.index);

  const segments: Array<{ sellIndex: number; buyDay: number; sellDay: number; quantity: number; buyPrice: number }> = [];
  const queues = new Map<string, Array<{ date: number; quantity: number; price: number }>>();
  for (const execution of executions) {
    if (BUY_SIDES.has(execution.side)) {
      const queue = queues.get(execution.ticker) || [];
      queue.push({ date: execution.time, quantity: execution.quantity, price: execution.price });
      queues.set(execution.ticker, queue);
    } else if (SELL_SIDES.has(execution.side)) {
      const queue = queues.get(execution.ticker) || [];
      let remaining = execution.quantity;
      while (remaining > 1e-8 && queue.length > 0) {
        const lot = queue[0];
        const quantity = Math.min(remaining, lot.quantity);
        segments.push({
          sellIndex: execution.index,
          buyDay: utcDay(lot.date),
          sellDay: utcDay(execution.time),
          quantity,
          buyPrice: lot.price
        });
        remaining -= quantity;
        lot.quantity -= quantity;
        if (lot.quantity <= 1e-8) queue.shift();
      }
    }
  }

  let matchedFeeRows = 0;
  let allocatedCents = 0;
  for (const fee of feeRows) {
    const date = getFeeDate(fee);
    const cents = Math.round(Math.abs(Number(fee.amount)) * 100);
    if (!Number.isFinite(date) || !Number.isFinite(cents) || cents <= 0) continue;

    if (brokerExecutions.length > 0) {
      const weightsBySell = new Map<number, number>();
      for (const segment of segments) {
        if (date < segment.buyDay || date > segment.sellDay || segment.quantity <= 0 || segment.buyPrice <= 0) continue;
        weightsBySell.set(segment.sellIndex, (weightsBySell.get(segment.sellIndex) || 0) + segment.quantity * segment.buyPrice);
      }
      const shares = allocateCents(cents, [...weightsBySell].map(([index, weight]) => ({ index, weight })));
      if (shares.size === 0) continue;
      for (const [sellIndex, allocated] of shares) {
        const byFee = brokerAllocations.get(sellIndex) || {};
        byFee[fee.id] = Number((((byFee[fee.id] || 0) * 100 + allocated) / 100).toFixed(2));
        brokerAllocations.set(sellIndex, byFee);
      }
    } else {
      const weights = appTrades.map((trade, index) => {
        const buy = parseCalendarDate(trade.buyDate ?? trade.purchaseDate ?? trade.entryDate ?? trade.openDate);
        const sell = parseCalendarDate(trade.sellDate ?? trade.exitDate ?? trade.closedAt ?? trade.date);
        const shares = Math.abs(Number(trade.shares ?? trade.quantity ?? 0));
        const price = Math.abs(Number(trade.entryPrice ?? trade.avgBuyPrice ?? trade.buyPrice ?? 0));
        return { index, buy, sell, weight: shares * price, usdCompatible: isUsdCurrency(trade.currency) };
      }).filter(item => item.usdCompatible && Number.isFinite(item.buy) && Number.isFinite(item.sell) &&
        date >= item.buy && date <= item.sell && item.weight > 0);
      const allocations = allocateCents(cents, weights.map(({ index, weight }) => ({ index, weight })));
      if (allocations.size === 0) continue;
      for (const [index, amount] of allocations) {
        appAllocations.set(index, Number((((appAllocations.get(index) || 0) * 100 + amount) / 100).toFixed(2)));
      }
    }
    matchedFeeRows++;
    allocatedCents += cents;
  }

  return {
    brokerAllocations,
    appAllocations,
    matchedFeeRows,
    allocatedAmount: Number((allocatedCents / 100).toFixed(2))
  };
}
