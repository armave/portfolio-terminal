import { isFreedomCashflowRow, type NormalizedFreedomCashflow } from './freedomCashflows';

type CashflowInput = Omit<NormalizedFreedomCashflow, 'raw'> & { raw?: Record<string, string> };
type FundingType = 'cash' | 'margin' | 'mix';

type BrokerExecutionFeeInput = {
  id?: string | null;
  executedAt?: string | number | null;
  date?: string | number | null;
  ticker?: string | null;
  side?: string | null;
  quantity?: number | null;
  shares?: number | null;
  price?: number | null;
  executionPrice?: number | null;
  tradeValue?: number | null;
  commission?: number | string | null;
  profit?: number | null;
  marginFeeAllocations?: Record<string, number>;
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

export interface FreedomMarginFeeFundingOptions {
  /** App-owned funding classification, keyed by stable active tranche ID or ticker. */
  trancheTypes?: Record<string, FundingType>;
  /** Cash/margin quantity split for tranches classified as mix. */
  trancheMixes?: Record<string, { cash: number; margin: number }>;
  /** Active app-owned Margin desk positions used only when broker execution history is absent. */
  openAppPositions?: Record<string, {
    ticker?: string;
    shares?: number;
    startDate?: string;
    tranches?: readonly { qty?: number; price?: number; date?: string; acquiredAt?: number }[];
  }>;
}

export interface FreedomMarginFeeAllocations {
  /** Financing fee amounts transferred to closed broker sell executions. */
  brokerAllocations: Map<number, Record<string, number>>;
  /** Financing fee amounts retained against the still-open quantity of broker buy executions. */
  brokerOpenAllocations: Map<number, Record<string, number>>;
  /** Legacy app-owned closed-trade fallback, used only when broker executions are absent. */
  appAllocations: Map<number, number>;
  /** Financing fees carried by still-open app-owned margin positions, keyed by position ticker/key. */
  appOpenAllocations: Map<string, Record<string, number>>;
  matchedFeeRows: number;
  /** Total financing fees matched to margin exposure, including open and closed shares. */
  allocatedAmount: number;
  /** Portion assigned to closed sales. */
  closedAllocatedAmount: number;
  /** Portion retained on still-open buy lots until those shares close. */
  openAllocatedAmount: number;
}

interface WeightedAllocation { index: number; weight: number }

interface NormalizedExecution {
  index: number;
  id: string;
  time: number;
  day: number;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  currency: string;
}

interface OpenMarginLot {
  buyIndex: number;
  id: string;
  ticker: string;
  time: number;
  buyDay: number;
  buyPrice: number;
  remainingQuantity: number;
  fundingType?: FundingType;
  marginRatio?: number;
  /** True only for app/user classification, never for compatibility fallbacks. */
  fundingExplicit?: boolean;
}

interface ClosedExposureSegment {
  buyDay: number;
  sellDay: number;
  sellIndex: number;
  marginQuantity: number;
  buyPrice: number;
}

const BUY_SIDES = new Set(['buy', 'b', 'purchase', 'bought', '1']);
const SELL_SIDES = new Set(['sell', 's', 'sale', 'sold', '2']);
const FINANCING_FEE_PATTERN = /negative\s+cash\s+balance\s+fee|fee\s+for\s+negative\s+cash\s+balance|margin\s+(?:fee|interest)|(?:daily\s+)?(?:margin|financing|overnight|rollover|borrow(?:ing)?)\s+(?:fee|charge|interest)|interest\s+(?:fee|charge)/i;
const TRADE_COMMISSION_PATTERN = /trading\s+fee|commission\s+for\s+trade/i;
const GROUP_BUYS_WITHIN_MS = 5 * 60 * 1000;
const EPSILON = 1e-8;

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

function parseExecutionTimestamp(value: unknown): number {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const numeric = Number(value);
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
    if (numeric > 20000 && numeric < 100000) {
      return Date.UTC(1899, 11, 30) + numeric * 86400000;
    }
  }
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : NaN;
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

function normalizeTicker(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/i, '');
}

function stableTrancheId(lot: OpenMarginLot): string {
  return `${lot.ticker}:${Number.isFinite(lot.time) ? lot.time : 'undated'}:${lot.id}`;
}

function isFundingType(value: unknown): value is FundingType {
  return value === 'cash' || value === 'margin' || value === 'mix';
}

/**
 * Apply the same five-minute buy grouping and stable tranche IDs used by the
 * active-tranche and closed-trade attribution paths. A sale establishes the
 * legacy closed-row Margin fallback; unsold, unclassified lots use the active
 * portfolio's Cash fallback. Explicit cash/margin/mix settings always win.
 */
function resolveOpenLotFunding(
  lots: OpenMarginLot[],
  options: FreedomMarginFeeFundingOptions,
  fallbackType: FundingType
): void {
  const ordered = lots
    .filter(lot => lot.remainingQuantity > EPSILON)
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || a.time - b.time || a.buyIndex - b.buyIndex);

  const groups: OpenMarginLot[][] = [];
  for (const lot of ordered) {
    const previous = groups[groups.length - 1];
    const previousLot = previous?.[previous.length - 1];
    const withinWindow = previous && previousLot &&
      previousLot.ticker === lot.ticker &&
      lot.time - previousLot.time <= GROUP_BUYS_WITHIN_MS;
    if (!withinWindow) groups.push([lot]);
    else previous.push(lot);
  }

  const trancheTypes = options.trancheTypes ?? {};
  const trancheMixes = options.trancheMixes ?? {};
  for (const group of groups) {
    const first = group[0];
    const groupId = stableTrancheId(first);
    const candidateKeys = [
      groupId,
      ...group.slice(1).map(stableTrancheId),
      first.ticker
    ];
    const explicitType = candidateKeys
      .map(key => trancheTypes[key])
      .find(isFundingType);
    const inherited = group.find(lot => lot.fundingExplicit === true && lot.fundingType !== undefined);
    const fundingType = explicitType ?? inherited?.fundingType ?? fallbackType;
    const fundingExplicit = explicitType !== undefined || inherited?.fundingExplicit === true;
    const mix = candidateKeys
      .map(key => trancheMixes[key])
      .find(value => value !== undefined);
    const inheritedRatio = group.find(lot => lot.marginRatio !== undefined)?.marginRatio;

    let marginRatio = fundingType === 'margin' ? 1 : 0;
    if (fundingType === 'mix') {
      const cash = Number(mix?.cash);
      const margin = Number(mix?.margin);
      const total = cash + margin;
      marginRatio = Number.isFinite(cash) && Number.isFinite(margin) &&
        cash >= 0 && margin >= 0 && total > EPSILON
        ? margin / total
        : inheritedRatio ?? 0;
    }

    for (const lot of group) {
      lot.fundingType = fundingType;
      lot.fundingExplicit = fundingExplicit;
      lot.marginRatio = Math.min(1, Math.max(0, marginRatio));
    }
  }
}

/** Allocate daily USD financing fees across all margin-funded exposure on each fee date. */
export function calculateFreedomMarginFeeAllocations(
  cashflows: CashflowInput[],
  brokerExecutions: BrokerExecutionFeeInput[],
  appTrades: AppClosedTradeFeeInput[] = [],
  fundingOptions: FreedomMarginFeeFundingOptions = {}
): FreedomMarginFeeAllocations {
  const brokerAllocations = new Map<number, Record<string, number>>();
  const brokerOpenAllocations = new Map<number, Record<string, number>>();
  const appAllocations = new Map<number, number>();
  const appOpenAllocations = new Map<string, Record<string, number>>();
  const feeRows = cashflows.filter(isFinancingCashflow);
  if (feeRows.length === 0) {
    return {
      brokerAllocations, brokerOpenAllocations, appAllocations, appOpenAllocations,
      matchedFeeRows: 0, allocatedAmount: 0, closedAllocatedAmount: 0, openAllocatedAmount: 0
    };
  }

  const executions: NormalizedExecution[] = brokerExecutions.map((trade, index) => {
    const quantity = Math.abs(Number(trade.quantity ?? trade.shares ?? 0));
    const tradeValue = Math.abs(Number(trade.tradeValue ?? 0));
    const directPrice = Math.abs(Number(trade.price ?? trade.executionPrice ?? 0));
    const side = String(trade.side ?? '').trim().toLowerCase();
    const normalizedSide: 'buy' | 'sell' = BUY_SIDES.has(side) ? 'buy' : 'sell';
    const time = parseExecutionTimestamp(trade.executedAt ?? trade.date);
    return {
      index,
      id: String(trade.id ?? index),
      time,
      day: utcDay(time),
      ticker: normalizeTicker(trade.ticker),
      side: normalizedSide,
      quantity,
      price: directPrice || (tradeValue > 0 && quantity > 0 ? tradeValue / quantity : 0),
      currency: String(trade.currency ?? '').trim().toUpperCase()
    };
  }).filter((row, index) => {
    const sourceSide = String(brokerExecutions[index]?.side ?? '').trim().toLowerCase();
    return row.ticker && Number.isFinite(row.time) && Number.isFinite(row.day) &&
      row.quantity > 0 && isUsdCurrency(row.currency) &&
      (BUY_SIDES.has(sourceSide) || SELL_SIDES.has(sourceSide));
  }).sort((a, b) => a.time - b.time || a.index - b.index);

  const segments: ClosedExposureSegment[] = [];
  const queues = new Map<string, OpenMarginLot[]>();
  if (brokerExecutions.length > 0) {
    for (const execution of executions) {
      if (execution.side === 'buy') {
        const queue = queues.get(execution.ticker) ?? [];
        queue.push({
          buyIndex: execution.index,
          id: execution.id,
          ticker: execution.ticker,
          time: execution.time,
          buyDay: execution.day,
          buyPrice: execution.price,
          remainingQuantity: execution.quantity
        });
        queues.set(execution.ticker, queue);
        continue;
      }

      const queue = queues.get(execution.ticker) ?? [];
      resolveOpenLotFunding(queue, fundingOptions, 'margin');
      let remaining = execution.quantity;
      for (const lot of queue) {
        if (remaining <= EPSILON) break;
        if (lot.remainingQuantity <= EPSILON || lot.time > execution.time) continue;
        const soldQuantity = Math.min(remaining, lot.remainingQuantity);
        const marginQuantity = soldQuantity * (lot.marginRatio ?? 0);
        if (marginQuantity > EPSILON && lot.buyPrice > 0) {
          segments.push({
            buyDay: lot.buyDay,
            sellDay: execution.day,
            sellIndex: execution.index,
            marginQuantity,
            buyPrice: lot.buyPrice
          });
        }
        lot.remainingQuantity -= soldQuantity;
        remaining -= soldQuantity;
      }
    }

    // A lot that remains open is classified with the active-position Cash
    // fallback unless the user explicitly classified it or an earlier partial
    // close already established its funding metadata.
    for (const queue of queues.values()) resolveOpenLotFunding(queue, fundingOptions, 'cash');
  }

  let matchedFeeRows = 0;
  let allocatedCents = 0;
  let closedAllocatedCents = 0;
  let openAllocatedCents = 0;

  for (const fee of feeRows) {
    const date = getFeeDate(fee);
    const cents = Math.round(Math.abs(Number(fee.amount)) * 100);
    if (!Number.isFinite(date) || !Number.isFinite(cents) || cents <= 0) continue;

    if (brokerExecutions.length > 0) {
      const weightsBySell = new Map<number, number>();
      const weightsByBuy = new Map<number, number>();
      for (const segment of segments) {
        if (date < segment.buyDay || date > segment.sellDay || segment.marginQuantity <= 0 || segment.buyPrice <= 0) continue;
        weightsBySell.set(
          segment.sellIndex,
          (weightsBySell.get(segment.sellIndex) || 0) + segment.marginQuantity * segment.buyPrice
        );
      }
      for (const queue of queues.values()) {
        for (const lot of queue) {
          if (date < lot.buyDay || lot.remainingQuantity <= EPSILON || lot.buyPrice <= 0) continue;
          const marginQuantity = lot.remainingQuantity * (lot.marginRatio ?? 0);
          if (marginQuantity <= EPSILON) continue;
          weightsByBuy.set(
            lot.buyIndex,
            (weightsByBuy.get(lot.buyIndex) || 0) + marginQuantity * lot.buyPrice
          );
        }
      }

      // Synthetic indexes keep open buy-lot shares disjoint from sell execution
      // indexes while preserving deterministic largest-remainder cent allocation.
      const openIndexBySynthetic = new Map<number, number>();
      const weighted: WeightedAllocation[] = [
        ...[...weightsBySell].map(([index, weight]) => ({ index, weight })),
        ...[...weightsByBuy].map(([buyIndex, weight]) => {
          const syntheticIndex = brokerExecutions.length + buyIndex;
          openIndexBySynthetic.set(syntheticIndex, buyIndex);
          return { index: syntheticIndex, weight };
        })
      ];
      const shares = allocateCents(cents, weighted);
      if (shares.size === 0) continue;

      for (const [index, allocated] of shares) {
        if (index < brokerExecutions.length) {
          const byFee = brokerAllocations.get(index) ?? {};
          byFee[fee.id] = Number((((byFee[fee.id] || 0) * 100 + allocated) / 100).toFixed(2));
          brokerAllocations.set(index, byFee);
          closedAllocatedCents += allocated;
        } else {
          const buyIndex = openIndexBySynthetic.get(index);
          if (buyIndex === undefined) continue;
          const byFee = brokerOpenAllocations.get(buyIndex) ?? {};
          byFee[fee.id] = Number((((byFee[fee.id] || 0) * 100 + allocated) / 100).toFixed(2));
          brokerOpenAllocations.set(buyIndex, byFee);
          openAllocatedCents += allocated;
        }
      }
    } else {
      // Without broker executions, split the same fee between historical app
      // closed rows and the current open Margin desk lots. Never copy the full
      // daily fee into both stages. App positions are margin-only by contract.
      const closedWeights = appTrades.map((trade, index) => {
        const buy = parseCalendarDate(trade.buyDate ?? trade.purchaseDate ?? trade.entryDate ?? trade.openDate);
        const sell = parseCalendarDate(trade.sellDate ?? trade.exitDate ?? trade.closedAt ?? trade.date);
        const shares = Math.abs(Number(trade.shares ?? trade.quantity ?? 0));
        const price = Math.abs(Number(trade.entryPrice ?? trade.avgBuyPrice ?? trade.buyPrice ?? 0));
        return { index, buy, sell, weight: shares * price, usdCompatible: isUsdCurrency(trade.currency) };
      }).filter(item => item.usdCompatible && Number.isFinite(item.buy) && Number.isFinite(item.sell) &&
        date >= item.buy && date <= item.sell && item.weight > 0);

      const openWeights: Array<{ key: string; weight: number }> = [];
      for (const [key, position] of Object.entries(fundingOptions.openAppPositions ?? {})) {
        const positionTicker = normalizeTicker(position.ticker ?? key);
        if (!positionTicker) continue;
        const tranches = Array.isArray(position.tranches) ? position.tranches : [];
        for (let index = 0; index < tranches.length; index += 1) {
          const tranche = tranches[index];
          const quantity = Math.max(0, Number(tranche.qty) || 0);
          const price = Math.max(0, Number(tranche.price) || 0);
          const rawAcquiredAt = Number(tranche.acquiredAt);
          const acquired = Number.isFinite(rawAcquiredAt) && rawAcquiredAt > 0
            ? utcDay(parseExecutionTimestamp(tranche.acquiredAt))
            : parseCalendarDate(tranche.date ?? position.startDate);
          if (quantity <= EPSILON || price <= 0 || !Number.isFinite(acquired) || acquired > date) continue;
          openWeights.push({ key, weight: quantity * price });
        }
      }

      const syntheticByIndex = new Map<number, string>();
      const combined: WeightedAllocation[] = [
        ...closedWeights.map(({ index, weight }) => ({ index, weight })),
        ...openWeights.map(({ key, weight }, index) => {
          const syntheticIndex = appTrades.length + index;
          syntheticByIndex.set(syntheticIndex, key);
          return { index: syntheticIndex, weight };
        })
      ];
      const allocations = allocateCents(cents, combined);
      if (allocations.size === 0) continue;
      for (const [index, amount] of allocations) {
        if (index < appTrades.length) {
          appAllocations.set(index, Number((((appAllocations.get(index) || 0) * 100 + amount) / 100).toFixed(2)));
          closedAllocatedCents += amount;
        } else {
          const key = syntheticByIndex.get(index);
          if (!key) continue;
          const byFee = appOpenAllocations.get(key) ?? {};
          byFee[fee.id] = Number((((byFee[fee.id] || 0) * 100 + amount) / 100).toFixed(2));
          appOpenAllocations.set(key, byFee);
          openAllocatedCents += amount;
        }
      }
    }
    matchedFeeRows++;
    allocatedCents += cents;
  }

  return {
    brokerAllocations,
    brokerOpenAllocations,
    appAllocations,
    appOpenAllocations,
    matchedFeeRows,
    allocatedAmount: Number((allocatedCents / 100).toFixed(2)),
    closedAllocatedAmount: Number((closedAllocatedCents / 100).toFixed(2)),
    openAllocatedAmount: Number((openAllocatedCents / 100).toFixed(2))
  };
}
