import type { ActiveBrokerTranche, ActiveTrancheType, PositionRecord } from '../types/portfolio';

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

/** Normalize broker rows into one active tranche per ticker for the Balance table. */
export function getActiveBrokerTranches(snapshot: FreedomPortfolioSnapshotLike | undefined): ActiveBrokerTranche[] {
  if (!snapshot?.loaded || !Array.isArray(snapshot.positions)) return [];
  const byTicker = new Map<string, ActiveBrokerTranche & { weightedAverageTotal: number; averageWeight: number }>();

  for (const item of snapshot.positions) {
    const ticker = tickerKey(item?.ticker);
    const quantity = Number(item?.quantity);
    if (!ticker || !Number.isFinite(quantity) || quantity <= 0) continue;
    const marketPrice = positiveFinite(item?.marketPrice);
    const averagePrice = positiveFinite((item as any)?.averagePrice);
    const previous = byTicker.get(ticker);
    const nextQuantity = (previous?.quantity || 0) + quantity;
    const averageWeight = (previous?.averageWeight || 0) + (averagePrice !== null ? quantity : 0);
    const weightedAverageTotal = (previous?.weightedAverageTotal || 0) + (averagePrice !== null ? averagePrice * quantity : 0);
    byTicker.set(ticker, {
      ticker,
      name: String((item as any)?.name || ticker),
      quantity: nextQuantity,
      marketPrice: marketPrice ?? previous?.marketPrice ?? null,
      averagePrice: averageWeight > 0 ? weightedAverageTotal / averageWeight : previous?.averagePrice ?? null,
      marketValue: (marketPrice ?? previous?.marketPrice) !== null
        ? nextQuantity * Number(marketPrice ?? previous?.marketPrice)
        : null,
      weightedAverageTotal,
      averageWeight
    });
  }

  return [...byTicker.values()]
    .map(({ weightedAverageTotal: _weightedAverageTotal, averageWeight: _averageWeight, ...item }) => item)
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
  receivedAt = Date.now()
): { positions: Record<string, PositionRecord>; cashStocks: any[] } {
  const positions: Record<string, PositionRecord> = {};
  const cashStocks: any[] = [];
  const previousCash = new Map<string, any>();
  for (const holding of Array.isArray(sourceCashHoldings) ? sourceCashHoldings : []) {
    const ticker = tickerKey(holding?.ticker);
    if (ticker && !previousCash.has(ticker)) previousCash.set(ticker, holding);
  }

  for (const tranche of getActiveBrokerTranches(snapshot)) {
    const type = classifications[tranche.ticker] || 'cash';
    const prior = sourcePositions[tranche.ticker];
    const priorCash = previousCash.get(tranche.ticker);
    const currentPrice = tranche.marketPrice ?? prior?.currentPrice ?? (Number(priorCash?.currentPrice ?? priorCash?.price) || 0);
    const entryPrice = tranche.averagePrice ?? (Number(prior?.tranches?.[0]?.price) || currentPrice);

    if (type === 'margin') {
      positions[tranche.ticker] = {
        ...(prior || {}),
        ticker: tranche.ticker,
        shares: tranche.quantity,
        currentPrice,
        pt: Number(prior?.pt) || entryPrice,
        commBuy: Number(prior?.commBuy) || 0,
        tranches: entryPrice > 0 ? [{ qty: tranche.quantity, price: entryPrice, ...(prior?.startDate ? { date: prior.startDate } : {}) }] : [],
        quoteSource: tranche.marketPrice !== null ? 'Freedom TradeNet' : prior?.quoteSource,
        ...(tranche.marketPrice !== null ? { quoteDetails: { ...(prior?.quoteDetails || {}), price: tranche.marketPrice, freshness: 'unknown', receivedAt } } : {})
      };
    } else {
      cashStocks.push({
        ...(priorCash || {}),
        ticker: tranche.ticker,
        shares: tranche.quantity,
        ...(tranche.marketPrice !== null ? { currentPrice: tranche.marketPrice, price: tranche.marketPrice } : {})
      });
    }
  }

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
