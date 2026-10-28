import type { ActiveBrokerTranche, ActiveTrancheType, PositionRecord } from '../types/portfolio';
import { calculateCommission, type CommissionConfig } from './portfolio';

export interface FreedomPortfolioSnapshotLike {
  loaded: boolean;
  balances: Array<{ currency: string; amount: number; [key: string]: unknown }>;
  positions: Array<{ ticker: string; quantity: number; marketPrice: number | null; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface FreedomQuantityMismatch {
  ticker: string;
  marginQuantity: number;
  freedomQuantity: number;
}

export interface FreedomReconciliationResult {
  brokerUsdBalance?: { amount: number };
  positions: Record<string, any>;
  cashStocks: any[];
  mismatches: FreedomQuantityMismatch[];
}

function tickerKey(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/i, '');
}

function positiveFinite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

export interface FreedomExecutedTradeLike {
  id?: string;
  ticker?: string;
  side?: string;
  quantity?: number | null;
  price?: number | null;
  executedAt?: string | null;
  [key: string]: unknown;
}

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
  commissionRules?: CommissionConfig
): ActiveBrokerTranche[] {
  if (!Array.isArray(trades)) return [];
  type BuyLot = {
    id: string; ticker: string; name: string; quantity: number;
    marketPrice: number | null; averagePrice: number | null; buyCommission?: number;
    purchasedAt: number | null; lastPurchasedAt: number | null; rowIndex: number;
  };
  const ordered = trades.map((trade, rowIndex) => ({
    trade,
    rowIndex,
    ticker: tickerKey(trade?.ticker),
    side: tradeSide(trade?.side ?? trade?.operation ?? trade?.type),
    quantity: Number(trade?.quantity),
    price: positiveFinite(trade?.price),
    at: operationTimestamp(trade?.executedAt ?? trade?.date ?? trade?.time)
  })).filter(item => item.ticker && item.side && Number.isFinite(item.quantity) && item.quantity > 0)
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
    const withinWindow = previous && previous.ticker === lot.ticker && previous.lastPurchasedAt !== null && lot.purchasedAt !== null && lot.purchasedAt - previous.lastPurchasedAt <= 5 * 60 * 1000;
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
  sourceCashHoldings: any[],
  classifications: Record<string, ActiveTrancheType> = {},
  receivedAt = Date.now(),
  executedTrades?: FreedomExecutedTradeLike[],
  commissionRules?: CommissionConfig
): { positions: Record<string, PositionRecord>; cashStocks: any[] } {
  const positions: Record<string, PositionRecord> = {};
  const cashByTicker = new Map<string, any>();
  const marginByTicker = new Map<string, { tranche: ActiveBrokerTranche; prior: PositionRecord | undefined; currentPrice: number; entryTranches: Array<{ qty: number; price: number; date?: string; buyCommission?: number }> }>();
  const previousCash = new Map<string, any>();
  for (const holding of Array.isArray(sourceCashHoldings) ? sourceCashHoldings : []) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker && !previousCash.has(ticker)) previousCash.set(ticker, holding);
  }

  const activeTranches = Array.isArray(executedTrades)
    ? getActiveTranchesFromTrades(executedTrades, snapshot, commissionRules)
    : getActiveBrokerTranches(snapshot);
  for (const tranche of activeTranches) {
    const type = classifications[tranche.id] || classifications[tranche.ticker] || 'cash';
    const prior = sourcePositions[tranche.ticker];
    const priorCash = previousCash.get(tranche.ticker);
    const currentPrice = tranche.marketPrice ?? prior?.currentPrice ?? (Number(priorCash?.currentPrice ?? priorCash?.price) || 0);
    // When executed operations are available, they are the sole source of lot cost basis and fees.
    // Snapshot-only fallback may retain legacy cost basis for interest continuity, but never its commissions.
    const entryPrice = tranche.averagePrice ?? (!Array.isArray(executedTrades) ? (Number(prior?.tranches?.[0]?.price) || currentPrice) : 0);

    if (type === 'margin') {
      const existing = marginByTicker.get(tranche.ticker);
      const entryTranches = existing?.entryTranches || [];
      if (entryPrice > 0) entryTranches.push({ qty: tranche.quantity, price: entryPrice, ...(tranche.purchasedAt !== null ? { date: new Date(tranche.purchasedAt).toISOString() } : {}), ...(tranche.buyCommission !== undefined ? { buyCommission: tranche.buyCommission } : {}) });
      const combinedQuantity = (existing?.tranche.quantity || 0) + tranche.quantity;
      const combinedMarketPrice = tranche.marketPrice ?? existing?.tranche.marketPrice ?? null;
      marginByTicker.set(tranche.ticker, {
        tranche: { ...tranche, quantity: combinedQuantity, marketPrice: combinedMarketPrice, marketValue: combinedMarketPrice !== null ? combinedMarketPrice * combinedQuantity : null },
        prior,
        currentPrice,
        entryTranches
      });
    } else {
      const existing = cashByTicker.get(tranche.ticker);
      const quantity = (Number(existing?.shares) || 0) + tranche.quantity;
      cashByTicker.set(tranche.ticker, { ...(existing || priorCash || {}), ticker: tranche.ticker, shares: quantity, ...(tranche.marketPrice !== null ? { currentPrice: tranche.marketPrice, price: tranche.marketPrice } : {}) });
    }
  }

  for (const [ticker, item] of marginByTicker) {
    const tranche = item.tranche;
    const prior = item.prior;
    const totalEntryQuantity = item.entryTranches.reduce((sum, entry) => sum + entry.qty, 0);
    const entryPrice = totalEntryQuantity > 0
      ? item.entryTranches.reduce((sum, entry) => sum + entry.qty * entry.price, 0) / totalEntryQuantity
      : (!Array.isArray(executedTrades) ? (Number(prior?.tranches?.[0]?.price) || item.currentPrice) : item.currentPrice);
    positions[ticker] = {
      ...(prior || {}),
      ticker,
      shares: tranche.quantity,
      currentPrice: item.currentPrice,
      pt: Number(prior?.pt) || entryPrice,
      commBuy: Array.isArray(executedTrades)
        ? item.entryTranches.reduce((sum, entry) => sum + Math.max(0, Number(entry.buyCommission) || 0), 0)
        : (Number(prior?.commBuy) || 0),
      tranches: item.entryTranches,
      quoteSource: tranche.marketPrice !== null ? 'Freedom TradeNet' : prior?.quoteSource,
      ...(tranche.marketPrice !== null ? { quoteDetails: { ...(prior?.quoteDetails || {}), price: tranche.marketPrice, freshness: 'unknown', receivedAt } } : {})
    };
  }
  const cashStocks = [...cashByTicker.values()];
  return { positions, cashStocks };
}


/**
 * Prefer Freedom's live account snapshot without rewriting app-owned trade lots.
 * Broker quantities represent account totals; app-managed margin lots are
 * subtracted to derive cash holdings. Ambiguous quantity mismatches preserve
 * affected local cash quantities and are reported instead of guessed.
 */
export function reconcileFreedomPortfolio(
  snapshot: FreedomPortfolioSnapshotLike,
  sourcePositions: Record<string, any>,
  sourceCashHoldings: any[],
  receivedAt = Date.now()
): FreedomReconciliationResult {
  const usdBalance = snapshot.balances.find(
    item => String(item.currency ?? '').toUpperCase() === 'USD' && Number.isFinite(Number(item.amount))
  );

  const positions: Record<string, any> = { ...sourcePositions };
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
  const cashStocks: Array<Record<string, any>> = [];
  const priorCashByTicker = new Map<string, Record<string, any>>();
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
