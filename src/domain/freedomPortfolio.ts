import type { ActiveBrokerTranche, ActiveTrancheMix, ActiveTrancheType, CashStockHolding, PositionRecord } from '../types/portfolio';
import { calculateCommission, type CommissionConfig } from './portfolio';
import type { FreedomExecutedTrade } from '../types/freedomTrade';
import { getPositiveMarketPrice } from './portfolioValuation';

/**
 * Parse one edited side of a cash/margin split. Empty or invalid input keeps the
 * last valid value; valid input is clamped so the opposite side remains non-negative.
 */
export function resolveActiveTrancheMixInput(
  value: unknown,
  totalQuantity: number,
  previousValue: number
): number {
  const total = Number(totalQuantity);
  if (!Number.isFinite(total) || total <= 0) return 0;

  const previous = Number(previousValue);
  const fallback = Number.isFinite(previous)
    ? Math.min(total, Math.max(0, previous))
    : 0;

  if (value === null || value === undefined ||
      (typeof value === 'string' && value.trim() === '')) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(total, Math.max(0, parsed))
    : fallback;
}

/** Preserve the cash/margin ratio when an open operation's quantity changes. */
export function normalizeActiveTrancheMix(
  quantity: number,
  allocation?: Partial<ActiveTrancheMix> | null
): ActiveTrancheMix {
  const totalQuantity = Number(quantity);
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0) return { cash: 0, margin: 0 };

  const cash = Number(allocation?.cash);
  const margin = Number(allocation?.margin);
  if (!Number.isFinite(cash) || !Number.isFinite(margin) || cash < 0 || margin < 0) {
    return { cash: totalQuantity, margin: 0 };
  }

  const allocatedQuantity = cash + margin;
  if (!Number.isFinite(allocatedQuantity) || allocatedQuantity <= 1e-8) {
    return { cash: totalQuantity, margin: 0 };
  }

  const cashQuantity = totalQuantity * (cash / allocatedQuantity);
  return { cash: cashQuantity, margin: totalQuantity - cashQuantity };
}

export interface FreedomPortfolioSnapshotLike {
  loaded: boolean;
  balances: Array<{ currency: string; amount: number }>;
  positions: Array<{ ticker: string; quantity: number; marketPrice: number | null }>;
}

interface FreedomQuantityMismatch {
  ticker: string;
  marginQuantity: number;
  freedomQuantity: number;
}

export type FreedomReconciliationPosition = Pick<PositionRecord, 'ticker' | 'shares'> &
  Partial<Omit<PositionRecord, 'ticker' | 'shares'>>;

export interface FreedomReconciliationResult {
  brokerUsdBalance?: { amount: number };
  /** Legacy reconciliation rows may omit newer PositionRecord fields. */
  positions: Record<string, FreedomReconciliationPosition>;
  cashStocks: CashStockHolding[];
  mismatches: FreedomQuantityMismatch[];
}

export interface FreedomPortfolioClassificationResult {
  positions: Record<string, PositionRecord>;
  cashStocks: CashStockHolding[];
}

function tickerKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/i, '');
}

function positiveFinite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

interface StoredQuoteRecord {
  currentPrice?: unknown;
  price?: unknown;
  quoteUpdatedAt?: unknown;
  quoteRequestStartedAt?: unknown;
  quoteRequestSequence?: unknown;
  quoteSource?: unknown;
  quoteDetails?: { sourceTimestamp?: unknown; receivedAt?: unknown; transport?: unknown; [key: string]: unknown };
}

function getLatestPreservedQuote(
  ...records: Array<StoredQuoteRecord | null | undefined>
): { record: StoredQuoteRecord; price: number; orderingTimestamp: number } | null {
  let latest: { record: StoredQuoteRecord; price: number; orderingTimestamp: number } | null = null;

  for (const record of records) {
    if (!record) continue;
    const price = getPositiveMarketPrice(record.currentPrice, record.price);
    if (price === null) continue;

    const sourceTimestamp = Number(record.quoteDetails?.sourceTimestamp);
    const isLiveWebSocketQuote = record.quoteDetails?.transport === 'websocket';
    // TradeNet q timestamps can be missing or non-numeric (for example, an ISO
    // ltt string). The browser receive time is still a reliable local ordering
    // signal and must protect that live price from a later account/history
    // reclassification built from an older, untimestamped broker snapshot.
    const arrivalTimestamp = isLiveWebSocketQuote
      ? Number(record.quoteDetails?.receivedAt) ||
        Number(record.quoteUpdatedAt) ||
        Number(record.quoteRequestStartedAt)
      : 0;
    const orderingTimestamp = Number.isFinite(sourceTimestamp) && sourceTimestamp > 0
      ? sourceTimestamp
      : Number.isFinite(arrivalTimestamp) && arrivalTimestamp > 0
        ? arrivalTimestamp
        : 0;
    if (orderingTimestamp <= 0) continue;
    if (!latest || orderingTimestamp > latest.orderingTimestamp) {
      latest = { record, price, orderingTimestamp };
    }
  }

  return latest;
}

/** Preserve the latest local quote provenance when reclassifying an untimestamped broker snapshot. */
function preserveLocalQuoteMetadata<T extends object>(
  target: T,
  storedQuote: StoredQuoteRecord | null | undefined
): T {
  if (!storedQuote) return target;
  return {
    ...target,
    ...(storedQuote.quoteUpdatedAt !== undefined ? { quoteUpdatedAt: storedQuote.quoteUpdatedAt } : {}),
    ...(storedQuote.quoteRequestStartedAt !== undefined ? { quoteRequestStartedAt: storedQuote.quoteRequestStartedAt } : {}),
    ...(storedQuote.quoteRequestSequence !== undefined ? { quoteRequestSequence: storedQuote.quoteRequestSequence } : {}),
    ...(storedQuote.quoteSource !== undefined ? { quoteSource: storedQuote.quoteSource } : {}),
    ...(storedQuote.quoteDetails !== undefined ? { quoteDetails: storedQuote.quoteDetails } : {})
  } as T;
}


export interface FreedomActiveLimitSellOrderLike {
  ticker?: string;
  operation?: number | null;
  orderType?: number | null;
  limitPrice?: number | null;
  remainingQuantity?: number | null;
  date?: string | number | null;
  createdAt?: string | number | null;
  placedAt?: string | number | null;
  timestamp?: string | number | null;
  status?: string | number | null;
}

function activeOrderTimestamp(order: FreedomActiveLimitSellOrderLike): number | null {
  const value = order.date ?? order.createdAt ?? order.placedAt ?? order.timestamp;
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value)) ? Number(value) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e11 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Resolve one target per ticker from a single active limit-sell order. Never
 * synthesize a target by averaging distinct broker limit prices. Prefer an order
 * that exactly covers the tracked position; otherwise use the largest remaining
 * order, and leave the target unchanged when equally sized prices are ambiguous.
 */
export function getActiveLimitSellTargets(
  orders: FreedomActiveLimitSellOrderLike[],
  marginQuantities: Record<string, number> = {}
): Record<string, number> {
  const ordersByTicker = new Map<string, Array<{ price: number; quantity: number; timestamp: number | null; index: number }>>();
  orders.forEach((order, index) => {
    const ticker = tickerKey(order?.ticker);
    const price = positiveFinite(order?.limitPrice);
    const quantity = positiveFinite(order?.remainingQuantity);
    const status = String(order?.status ?? '').trim().toLowerCase();
    // TradeNet's active-orders endpoint can include historical rows. In the
    // observed broker payload, stat=10 is the live order; 21/31 are not active.
    // Keep status-less callers compatible with the pure helper's existing API.
    if (status && !['10', '16', 'active', 'open', 'working'].includes(status)) return;
    if (!ticker || order?.operation !== 3 || ![2, 4].includes(Number(order?.orderType)) || price === null || quantity === null) return;
    const entries = ordersByTicker.get(ticker) || [];
    entries.push({ price, quantity, timestamp: activeOrderTimestamp(order), index });
    ordersByTicker.set(ticker, entries);
  });

  const targets: Record<string, number> = {};
  for (const [ticker, tickerOrders] of ordersByTicker) {
    const rawMarginQuantity = marginQuantities[ticker];
    const marginQuantity = Number(rawMarginQuantity);
    let candidates = tickerOrders;

    // If a single broker order exactly covers the tracked position, that order
    // is authoritative even when other order rows are present.
    if (rawMarginQuantity !== undefined && Number.isFinite(marginQuantity) && marginQuantity > 0) {
      const exactOrders = tickerOrders.filter(order => Math.abs(order.quantity - marginQuantity) <= 1e-8);
      if (exactOrders.length) candidates = exactOrders;
    }

    // Never average different broker limit prices into a synthetic target.
    // If no exact-quantity order exists, use the order with the most shares
    // remaining. Equal-size orders at different prices are ambiguous unless a
    // unique newest timestamp resolves the choice.
    if (candidates === tickerOrders) {
      const largestQuantity = Math.max(...tickerOrders.map(order => order.quantity));
      candidates = tickerOrders.filter(order => Math.abs(order.quantity - largestQuantity) <= 1e-8);
    }

    const prices = new Set(candidates.map(order => order.price));
    if (prices.size === 1) {
      targets[ticker] = candidates[0].price;
      continue;
    }

    const dated = candidates
      .filter(order => order.timestamp !== null)
      .sort((a, b) => (b.timestamp as number) - (a.timestamp as number) || a.index - b.index);
    if (dated.length && dated[0].timestamp !== null &&
        (dated.length === 1 || dated[0].timestamp !== dated[1].timestamp)) {
      targets[ticker] = dated[0].price;
    }
  }
  return targets;
}

/** Apply broker limit prices after every portfolio reclassification so defaults cannot overwrite them. */
export function applyActiveLimitSellTargets(
  positions: Record<string, PositionRecord>,
  targets: Record<string, number>
): Record<string, PositionRecord> {
  const result = { ...positions };
  for (const [key, position] of Object.entries(positions || {})) {
    const ticker = tickerKey(position?.ticker || key);
    const target = targets[ticker];
    if (target && Number.isFinite(target) && target > 0 && Number(position.pt) !== target) {
      result[key] = { ...position, pt: target };
    }
  }
  return result;
}

function operationTimestamp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value)) ? Number(value) : NaN;
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e11 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function tradeSide(value: unknown): 'buy' | 'sell' | null {
  const side = String(value ?? '').trim().toLowerCase();
  if (side === '1' || /\b(buy|bought|purchase)\b/.test(side)) return 'buy';
  if (side === '2' || /\b(sell|sold|sale)\b/.test(side)) return 'sell';
  return null;
}

export type FreedomExecutedTradeLike = Omit<Partial<FreedomExecutedTrade>, 'commission'> & {
  /** Legacy broker aliases remain accepted for older saved/imported rows. */
  operation?: string | number | null;
  type?: string | number | null;
  date?: string | number | null;
  time?: string | number | null;
  qty?: number | string | null;
  commission?: number | string | null;
};

/** Derive still-open purchase operations from Freedom's executed-trades history using FIFO sells. */
function executedBuyCommission(trade: FreedomExecutedTradeLike, quantity: number, price: number | null, rules?: CommissionConfig): number | undefined {
  const record = trade as Record<string, unknown>;
  for (const key of ['buyCommission', 'commission', 'commissionAmount', 'commissionUsd', 'commission_usd', 'brokerCommission', 'comission', 'fee']) {
    const value = record[key];
    if (value !== null && value !== undefined && value !== '') {
      const amount = Number(value);
      if (Number.isFinite(amount) && amount >= 0) return amount;
    }
  }
  if (!rules || !price || price <= 0) return undefined;
  try {
    return calculateCommission(quantity, quantity * price, rules);
  } catch {
    return undefined;
  }
}

export function getActiveTranchesFromTrades(
  trades: FreedomExecutedTradeLike[] | undefined,
  snapshot?: FreedomPortfolioSnapshotLike,
  commissionRules?: CommissionConfig,
  groupBuysWithinFiveMinutes = true
): ActiveBrokerTranche[] {
  if (!Array.isArray(trades)) return [];
  type BuyLot = {
    id: string; ticker: string; name: string; quantity: number;
    marketPrice: number | null; averagePrice: number | null; buyCommission?: number;
    purchasedAt: number | null; lastPurchasedAt: number | null; rowIndex: number;
  };
  const firstPositiveMagnitude = (...values: unknown[]): number => {
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed !== 0) return Math.abs(parsed);
    }
    return 0;
  };
  const firstPositivePrice = (...values: unknown[]): number | null => {
    for (const value of values) {
      if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  };
  const firstNonEmptyText = (...values: unknown[]): string => {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) return value;
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
  };
  const firstTimestamp = (...values: unknown[]): number | null => {
    for (const value of values) {
      const parsed = operationTimestamp(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const ordered = trades.map((trade, rowIndex) => {
    const raw = trade?.raw && typeof trade.raw === 'object' ? trade.raw : {};
    const side = [
      trade?.side, trade?.operation, trade?.type,
      raw.side, raw.operation, raw.oper, raw.buy_sell, raw.type
    ].map(tradeSide).find((value): value is 'buy' | 'sell' => value !== null) || null;
    return {
      trade,
      rowIndex,
      ticker: tickerKey(firstNonEmptyText(trade?.ticker, raw.instr_nm, raw.i, raw.ticker, raw.symbol)),
      side,
      quantity: firstPositiveMagnitude(
        trade?.quantity, trade?.qty,
        raw.q, raw.quantity, raw.qty
      ),
      price: firstPositivePrice(trade?.price, raw.p, raw.price, raw.exec_price),
      at: firstTimestamp(
        trade?.executedAt, trade?.date, trade?.time,
        raw.date, raw.time, raw.datetime, raw.exec_time
      )
    };
  }).filter(item => item.ticker && item.side && Number.isFinite(item.quantity) && item.quantity > 0)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.rowIndex - b.rowIndex);

  const lots: BuyLot[] = [];
  for (const item of ordered) {
    if (item.side === 'buy') {
      const brokerPosition = snapshot?.positions?.find(position => tickerKey(position.ticker) === item.ticker);
      lots.push({
        id: String(item.trade.id ?? item.rowIndex),
        ticker: item.ticker,
        name: String(item.trade.ticker || item.ticker).replace(/\.US$/i, ''),
        quantity: item.quantity,
        marketPrice: positiveFinite(brokerPosition?.marketPrice),
        averagePrice: item.price,
        buyCommission: item.price !== null ? executedBuyCommission(item.trade, item.quantity, item.price, commissionRules) : undefined,
        purchasedAt: item.at,
        lastPurchasedAt: item.at,
        rowIndex: item.rowIndex
      });
      continue;
    }
    let remainingToSell = item.quantity;
    for (const lot of lots.filter(candidate => candidate.ticker === item.ticker && candidate.quantity > 1e-8 && (item.at === null || candidate.purchasedAt === null || candidate.purchasedAt <= item.at)).sort((a, b) => (a.purchasedAt ?? 0) - (b.purchasedAt ?? 0) || a.rowIndex - b.rowIndex)) {
      const sold = Math.min(lot.quantity, remainingToSell);
      const previousQuantity = lot.quantity;
      lot.quantity -= sold;
      if (lot.buyCommission !== undefined && previousQuantity > 0) {
        lot.buyCommission *= lot.quantity / previousQuantity;
      }
      remainingToSell -= sold;
      if (remainingToSell <= 1e-8) break;
    }
  }

  const openLots = lots.filter(lot => lot.quantity > 1e-8)
    .sort((a, b) => a.ticker.localeCompare(b.ticker) || (a.purchasedAt ?? Number.MAX_SAFE_INTEGER) - (b.purchasedAt ?? Number.MAX_SAFE_INTEGER) || a.rowIndex - b.rowIndex);
  const grouped: BuyLot[] = [];
  for (const lot of openLots) {
    const previous = grouped[grouped.length - 1];
    const withinWindow = groupBuysWithinFiveMinutes && previous && previous.ticker === lot.ticker && previous.lastPurchasedAt !== null && lot.purchasedAt !== null && lot.purchasedAt - previous.lastPurchasedAt <= 5 * 60 * 1000;
    if (!withinWindow) { grouped.push({ ...lot }); continue; }
    const previousQuantity = previous.quantity;
    const totalQuantity = previousQuantity + lot.quantity;
    previous.averagePrice = previous.averagePrice !== null && lot.averagePrice !== null
      ? (previous.averagePrice * previousQuantity + lot.averagePrice * lot.quantity) / totalQuantity
      : previous.averagePrice ?? lot.averagePrice;
    previous.quantity = totalQuantity;
    if (previous.buyCommission !== undefined || lot.buyCommission !== undefined) {
      previous.buyCommission = (previous.buyCommission || 0) + (lot.buyCommission || 0);
    }
    previous.lastPurchasedAt = lot.purchasedAt;
    previous.marketPrice = lot.marketPrice ?? previous.marketPrice;
    previous.name = lot.name || previous.name;
  }
  grouped.sort((a, b) =>
    (b.purchasedAt ?? Number.MIN_SAFE_INTEGER) - (a.purchasedAt ?? Number.MIN_SAFE_INTEGER) ||
    a.ticker.localeCompare(b.ticker) || a.rowIndex - b.rowIndex
  );
  return grouped.map(lot => ({
    id: lot.ticker + ':' + (lot.purchasedAt ?? 'undated') + ':' + lot.id,
    ticker: lot.ticker,
    name: lot.name,
    quantity: lot.quantity,
    marketPrice: lot.marketPrice,
    averagePrice: lot.averagePrice,
    marketValue: lot.marketPrice !== null ? lot.marketPrice * lot.quantity : null,
    purchasedAt: lot.purchasedAt,
    ...(lot.buyCommission !== undefined ? { buyCommission: lot.buyCommission } : {})
  }));
}

/** Compatibility helper for account-position snapshots; the Balance table uses trade history instead. */
export function getActiveBrokerTranches(snapshot: FreedomPortfolioSnapshotLike | undefined): ActiveBrokerTranche[] {
  if (!snapshot?.loaded || !Array.isArray(snapshot.positions)) return [];
  return snapshot.positions.map((item, index) => {
    const ticker = tickerKey(item.ticker);
    const quantity = Number(item.quantity);
    const marketPrice = positiveFinite(item.marketPrice);
    const averagePrice = positiveFinite((item as Record<string, unknown>).averagePrice);
    return {
      id: ticker + ':snapshot:' + index,
      ticker,
      name: String((item as Record<string, unknown>).name || ticker),
      quantity,
      marketPrice,
      averagePrice,
      marketValue: marketPrice !== null ? marketPrice * quantity : null,
      purchasedAt: null
    };
  }).filter(item => item.ticker && Number.isFinite(item.quantity) && item.quantity > 0)
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/**
 * Project the broker's current open quantities into the app's cash and margin
 * ledgers. Broker data is authoritative for active quantities; classifications
 * are user preferences and default to cash for newly observed tickers.
 */
export function classifyFreedomPortfolio(
  snapshot: FreedomPortfolioSnapshotLike,
  sourcePositions: Record<string, PositionRecord>,
  sourceCashHoldings: CashStockHolding[],
  classifications: Record<string, ActiveTrancheType> = {},
  receivedAt = Date.now(),
  executedTrades?: FreedomExecutedTradeLike[],
  commissionRules?: CommissionConfig,
  mixedAllocations: Record<string, ActiveTrancheMix> = {}
): FreedomPortfolioClassificationResult {
  const positions: Record<string, PositionRecord> = {};
  const cashByTicker = new Map<string, CashStockHolding>();
  const cashCostByTicker = new Map<string, { totalCost: number; pricedQuantity: number }>();
  const marginByTicker = new Map<string, {
    tranche: ActiveBrokerTranche;
    prior: PositionRecord | undefined;
    currentPrice: number;
    preservedQuote: ReturnType<typeof getLatestPreservedQuote>;
    snapshotPrice: number | null;
    entryTranches: Array<{ qty: number; price: number; date?: string; buyCommission?: number }>;
  }>();
  const previousCash = new Map<string, CashStockHolding>();
  for (const holding of Array.isArray(sourceCashHoldings) ? sourceCashHoldings : []) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker && !previousCash.has(ticker)) previousCash.set(ticker, holding);
  }

  const activeTranches = Array.isArray(executedTrades)
    ? getActiveTranchesFromTrades(executedTrades, snapshot, commissionRules)
    : getActiveBrokerTranches(snapshot);
  for (const tranche of activeTranches) {
    const type = classifications[tranche.id] || classifications[tranche.ticker] || 'cash';
    const allocation = type === 'mix'
      ? normalizeActiveTrancheMix(tranche.quantity, mixedAllocations[tranche.id] || mixedAllocations[tranche.ticker])
      : null;
    const cashQuantity = type === 'mix' ? (allocation?.cash || 0) : type === 'margin' ? 0 : tranche.quantity;
    const marginQuantity = type === 'margin' ? tranche.quantity : (allocation?.margin || 0);
    const marginBuyCommission = tranche.buyCommission !== undefined && tranche.quantity > 0
      ? tranche.buyCommission * (marginQuantity / tranche.quantity)
      : undefined;
    const prior = sourcePositions[tranche.ticker];
    const priorCash = previousCash.get(tranche.ticker);
    // Freedom account snapshots expose mkt_price without an observation timestamp.
    // Do not let that unprovable value overwrite a locally observed quote: use
    // the provider timestamp when available, or q's browser receive time when
    // TradeNet sends an ISO ltt that cannot be normalized numerically.
    const preservedQuote = getLatestPreservedQuote(prior, priorCash);
    const snapshotPrice = positiveFinite(tranche.marketPrice);
    const currentPrice = preservedQuote?.price ?? getPositiveMarketPrice(
      tranche.marketPrice,
      prior?.currentPrice,
      priorCash?.currentPrice,
      priorCash?.price
    ) ?? 0;
    // When executed operations are available, they are the sole source of lot cost basis and fees.
    // Snapshot-only fallback may retain legacy cost basis for interest continuity, but never its commissions.
    const entryPrice = tranche.averagePrice ?? (!Array.isArray(executedTrades) ? (Number(prior?.tranches?.[0]?.price) || currentPrice) : 0);

    if (marginQuantity > 1e-8) {
      const existing = marginByTicker.get(tranche.ticker);
      const entryTranches = existing?.entryTranches || [];
      if (entryPrice > 0) entryTranches.push({
        qty: marginQuantity,
        price: entryPrice,
        ...(tranche.purchasedAt !== null ? { date: new Date(tranche.purchasedAt).toISOString() } : {}),
        ...(marginBuyCommission !== undefined ? { buyCommission: marginBuyCommission } : {})
      });
      const combinedQuantity = (existing?.tranche.quantity || 0) + marginQuantity;
      const combinedMarketPrice = tranche.marketPrice ?? existing?.tranche.marketPrice ?? null;
      marginByTicker.set(tranche.ticker, {
        tranche: { ...tranche, quantity: combinedQuantity, marketPrice: combinedMarketPrice, marketValue: combinedMarketPrice !== null ? combinedMarketPrice * combinedQuantity : null },
        prior,
        currentPrice,
        preservedQuote,
        snapshotPrice,
        entryTranches
      });
    }

    if (cashQuantity > 1e-8) {
      const existing = cashByTicker.get(tranche.ticker);
      const quantity = (Number(existing?.shares) || 0) + cashQuantity;
      const hasKnownEntryPrice = tranche.averagePrice !== null &&
        Number.isFinite(tranche.averagePrice) && tranche.averagePrice > 0;
      const previousCost = cashCostByTicker.get(tranche.ticker);
      cashCostByTicker.set(tranche.ticker, {
        totalCost: (previousCost?.totalCost || 0) +
          (hasKnownEntryPrice ? cashQuantity * tranche.averagePrice! : 0),
        pricedQuantity: (previousCost?.pricedQuantity || 0) +
          (hasKnownEntryPrice ? cashQuantity : 0)
      });
      const cashHolding: CashStockHolding = {
        ...(existing || priorCash || {}),
        ticker: tranche.ticker,
        shares: quantity,
        ...(currentPrice > 0 ? { currentPrice, price: currentPrice } : {}),
        ...(!preservedQuote && snapshotPrice !== null ? {
          quoteSource: 'Freedom TradeNet',
          quoteDetails: {
            ...(priorCash?.quoteDetails || {}),
            price: snapshotPrice,
            freshness: 'unknown',
            receivedAt
          }
        } : {})
      };
      cashByTicker.set(
        tranche.ticker,
        preserveLocalQuoteMetadata(cashHolding, preservedQuote?.record)
      );
    }
  }

  for (const [ticker, item] of marginByTicker) {
    const tranche = item.tranche;
    const prior = item.prior;
    const priorTranches = Array.isArray(prior?.tranches) ? prior.tranches : [];
    const priorTrancheQuantity = priorTranches.reduce(
      (sum, entry) => sum + (Number(entry?.qty) > 0 ? Number(entry.qty) : 0),
      0
    );
    const quantityTolerance = Math.max(1e-8, Math.abs(tranche.quantity) * 1e-8);
    // When the trade-history baseline is unavailable, the account snapshot has
    // no lot-level detail. Keep imported FIFO lots intact when their total still
    // matches the broker quantity instead of collapsing them to one average lot.
    const canRetainPriorTranches = !Array.isArray(executedTrades) &&
      priorTranches.length > 0 &&
      priorTranches.every((entry) =>
        Number.isFinite(Number(entry?.qty)) && Number(entry.qty) > 0 &&
        Number.isFinite(Number(entry?.price)) && Number(entry.price) > 0
      ) &&
      Math.abs(priorTrancheQuantity - tranche.quantity) <= quantityTolerance;
    const finalTranches = canRetainPriorTranches ? priorTranches : item.entryTranches;
    const totalEntryQuantity = finalTranches.reduce((sum, entry) => sum + entry.qty, 0);
    const entryPrice = totalEntryQuantity > 0
      ? finalTranches.reduce((sum, entry) => sum + entry.qty * entry.price, 0) / totalEntryQuantity
      : (!Array.isArray(executedTrades) ? (Number(prior?.tranches?.[0]?.price) || item.currentPrice) : item.currentPrice);
    const preservedQuote = item.preservedQuote;
    const snapshotPrice = item.snapshotPrice;
    const classifiedPosition: PositionRecord = {
      ...(prior || {}),
      ticker,
      shares: tranche.quantity,
      currentPrice: item.currentPrice,
      // Match app-created positions: use a modest 5% upside target when a newly
      // classified margin position has no user-defined target. A target equal
      // to cost basis makes Combined Breakeven's net target zero immediately.
      pt: Number(prior?.pt) || Number(((entryPrice > 0 ? entryPrice : item.currentPrice) * 1.05).toFixed(2)),
      commBuy: Array.isArray(executedTrades)
        ? item.entryTranches.reduce((sum, entry) => sum + Math.max(0, Number(entry.buyCommission) || 0), 0)
        : (Number(prior?.commBuy) || 0),
      tranches: finalTranches,
      quoteSource: !preservedQuote && snapshotPrice !== null ? 'Freedom TradeNet' : prior?.quoteSource,
      ...(!preservedQuote && snapshotPrice !== null ? {
        quoteDetails: {
          ...(prior?.quoteDetails || {}),
          price: snapshotPrice,
          freshness: 'unknown',
          receivedAt
        }
      } : {})
    };
    positions[ticker] = preserveLocalQuoteMetadata(classifiedPosition, preservedQuote?.record);
  }
  const cashStocks = [...cashByTicker.values()].map((holding) => {
    const cost = cashCostByTicker.get(tickerKey(holding.ticker));
    const quantity = Number(holding.shares) || 0;
    const hasCompleteCostBasis = cost !== undefined && quantity > 0 &&
      Math.abs(cost.pricedQuantity - quantity) <= 1e-8;
    const priorCash = previousCash.get(tickerKey(holding.ticker));
    const priorQuantity = Number(priorCash?.shares);
    const canRetainPriorAverage = !Array.isArray(executedTrades) &&
      Number.isFinite(priorQuantity) &&
      Math.abs(priorQuantity - quantity) <= Math.max(1e-8, Math.abs(quantity) * 1e-8);
    return {
      ...holding,
      // Do not fabricate a partial average when the broker supplies no cost
      // basis. Keep an imported average only while the matching quantity remains.
      averagePrice: hasCompleteCostBasis
        ? cost.totalCost / quantity
        : canRetainPriorAverage ? positiveFinite(priorCash?.averagePrice) : null
    };
  });
  return { positions, cashStocks };
}

/**
 * Apply only the tickers present in a broker snapshot. A live snapshot can be
 * partial (or scoped to the broker's active inventory), so holdings imported
 * from backup but absent from that response must remain in the app.
 *
 * For a ticker the broker did report, its new cash/margin classification replaces
 * the old classification atomically: it cannot remain in both ledgers.
 */
export function mergeFreedomPortfolioRefresh(
  snapshot: FreedomPortfolioSnapshotLike,
  sourcePositions: Record<string, PositionRecord>,
  sourceCashHoldings: CashStockHolding[],
  classified: FreedomPortfolioClassificationResult
): FreedomPortfolioClassificationResult {
  const observedTickers = new Set(
    (Array.isArray(snapshot.positions) ? snapshot.positions : [])
      .map((item) => tickerKey(item?.ticker))
      .filter(Boolean)
  );
  const retainedPositions = Object.fromEntries(
    Object.entries(sourcePositions || {}).filter(([key, position]) =>
      !observedTickers.has(tickerKey(position?.ticker || key))
    )
  );
  const positions = {
    ...retainedPositions,
    ...classified.positions
  };

  const cashByTicker = new Map<string, CashStockHolding>();
  for (const holding of Array.isArray(sourceCashHoldings) ? sourceCashHoldings : []) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker && !observedTickers.has(ticker)) cashByTicker.set(ticker, holding);
  }
  for (const holding of classified.cashStocks) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker) cashByTicker.set(ticker, holding);
  }
  return { positions, cashStocks: [...cashByTicker.values()] };
}


/**
 * Prefer Freedom's live account snapshot without rewriting app-owned trade lots.
 * Broker quantities represent account totals; app-managed margin lots are
 * subtracted to derive cash holdings. Ambiguous quantity mismatches preserve
 * affected local cash quantities and are reported instead of guessed.
 */
export function reconcileFreedomPortfolio(
  snapshot: FreedomPortfolioSnapshotLike,
  sourcePositions: Record<string, FreedomReconciliationPosition>,
  sourceCashHoldings: CashStockHolding[],
  receivedAt = Date.now()
): FreedomReconciliationResult {
  const usdBalance = snapshot.balances.find(
    item => String(item.currency ?? '').toUpperCase() === 'USD' && Number.isFinite(Number(item.amount))
  );

  const positions: Record<string, FreedomReconciliationPosition> = { ...sourcePositions };
  const marginQuantities = new Map<string, number>();
  const marginPositionKeys = new Map<string, string[]>();

  for (const [key, position] of Object.entries(sourcePositions || {})) {
    const ticker = tickerKey(position?.ticker || key);
    const shares = Number(position?.shares);
    if (!ticker || !Number.isFinite(shares) || shares <= 0) continue;
    marginQuantities.set(ticker, (marginQuantities.get(ticker) || 0) + shares);
    marginPositionKeys.set(ticker, [...(marginPositionKeys.get(ticker) || []), key]);
  }

  const brokerByTicker = new Map<string, { ticker: string; quantity: number; marketPrice: number | null }>();
  for (const item of snapshot.positions) {
    const ticker = tickerKey(item?.ticker);
    const quantity = Number(item?.quantity);
    if (!ticker || !Number.isFinite(quantity) || quantity < 0) continue;
    const previous = brokerByTicker.get(ticker);
    const price = positiveFinite(item?.marketPrice);
    brokerByTicker.set(ticker, {
      ticker,
      quantity: (previous?.quantity || 0) + quantity,
      marketPrice: price ?? previous?.marketPrice ?? null
    });
  }

  // Broker prices update valuation only. Lots, quantities, cost basis, targets,
  // and app-owned commissions are deliberately unchanged.
  for (const [ticker, brokerPosition] of brokerByTicker) {
    if (brokerPosition.marketPrice === null) continue;
    for (const key of marginPositionKeys.get(ticker) || []) {
      const position = positions[key];
      positions[key] = {
        ...position,
        currentPrice: brokerPosition.marketPrice,
        quoteSource: 'Freedom TradeNet',
        quoteDetails: {
          ...(position.quoteDetails || {}),
          price: brokerPosition.marketPrice,
          freshness: 'unknown',
          receivedAt
        }
      };
    }
  }

  const mismatches: FreedomQuantityMismatch[] = [];
  const cashStocks: CashStockHolding[] = [];
  const priorCashByTicker = new Map<string, CashStockHolding>();
  for (const holding of Array.isArray(sourceCashHoldings) ? sourceCashHoldings : []) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker && !priorCashByTicker.has(ticker)) priorCashByTicker.set(ticker, holding);
  }

  for (const [ticker, brokerPosition] of brokerByTicker) {
    const marginQuantity = marginQuantities.get(ticker) || 0;
    const freedomQuantity = brokerPosition.quantity;
    if (freedomQuantity + 1e-6 < marginQuantity) {
      mismatches.push({ ticker, marginQuantity, freedomQuantity });
      const priorCash = priorCashByTicker.get(ticker);
      if (priorCash) cashStocks.push(priorCash);
      continue;
    }

    const cashQuantity = freedomQuantity - marginQuantity;
    if (cashQuantity > 1e-6) {
      cashStocks.push({
        ...(priorCashByTicker.get(ticker) || {}),
        ticker,
        shares: cashQuantity,
        ...(brokerPosition.marketPrice !== null ? { currentPrice: brokerPosition.marketPrice } : {})
      });
    }
  }

  for (const [ticker, marginQuantity] of marginQuantities) {
    if (!brokerByTicker.has(ticker) && marginQuantity > 1e-6) {
      mismatches.push({ ticker, marginQuantity, freedomQuantity: 0 });
      const priorCash = priorCashByTicker.get(ticker);
      if (priorCash && !cashStocks.some(holding => tickerKey(holding.ticker) === ticker)) {
        cashStocks.push(priorCash);
      }
    }
  }

  return {
    ...(usdBalance ? { brokerUsdBalance: { amount: Number(usdBalance.amount) } } : {}),
    positions,
    cashStocks,
    mismatches
  };
}
