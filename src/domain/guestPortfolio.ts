import type { ActiveBrokerTranche, ActiveTrancheMix, ActiveTrancheType } from '../types/portfolio';
import { getAssignableActiveTrancheCashQuantity } from './activeTrancheGuestAssignment';
import { normalizeActiveTrancheMix } from './freedomPortfolio';

export interface GuestCashHolding {
  ticker: string;
  shares: number;
  averagePrice: number | null;
  currentPrice: number | null;
  price: number | null;
  marketValue: number | null;
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: Record<string, unknown>;
}

interface CashHoldingQuoteLike {
  ticker?: string;
  currentPrice?: unknown;
  price?: unknown;
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: Record<string, unknown>;
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Build the cash-backed holdings visible to one guest. Each operation contributes
 * only its assigned cash quantity; other guests, margin quantity, and unassigned
 * operations are excluded.
 */
export function getGuestAssignedCashHoldings(input: {
  guestId: string;
  activeTranches: ActiveBrokerTranche[];
  assignments?: Record<string, string>;
  types?: Record<string, ActiveTrancheType>;
  mixes?: Record<string, ActiveTrancheMix>;
  cashHoldings?: CashHoldingQuoteLike[];
}): GuestCashHolding[] {
  const { guestId, activeTranches } = input;
  if (!guestId) return [];

  const quotesByTicker = new Map(
    (input.cashHoldings || []).map((holding) => [String(holding.ticker || '').trim().toUpperCase(), holding])
  );
  const aggregates = new Map<string, {
    shares: number;
    cost: number;
    costShares: number;
    marketPrice: number | null;
    quote?: CashHoldingQuoteLike;
  }>();

  for (const tranche of activeTranches || []) {
    if (input.assignments?.[tranche.id] !== guestId) continue;
    const ticker = String(tranche.ticker || '').trim().toUpperCase();
    if (!ticker) continue;

    const type = input.types?.[tranche.id] || input.types?.[ticker] || 'cash';
    const mix = normalizeActiveTrancheMix(
      tranche.quantity,
      input.mixes?.[tranche.id] || input.mixes?.[ticker]
    );
    const shares = getAssignableActiveTrancheCashQuantity(type, tranche.quantity, mix);
    if (shares <= 0) continue;

    const quote = quotesByTicker.get(ticker);
    const marketPrice = positiveNumber(tranche.marketPrice) ??
      positiveNumber(quote?.currentPrice) ??
      positiveNumber(quote?.price);
    const averagePrice = positiveNumber(tranche.averagePrice);
    const aggregate = aggregates.get(ticker) || {
      shares: 0,
      cost: 0,
      costShares: 0,
      marketPrice: null,
      quote
    };

    aggregate.shares += shares;
    if (averagePrice !== null) {
      aggregate.cost += shares * averagePrice;
      aggregate.costShares += shares;
    }
    if (aggregate.marketPrice === null && marketPrice !== null) aggregate.marketPrice = marketPrice;
    if (!aggregate.quote && quote) aggregate.quote = quote;
    aggregates.set(ticker, aggregate);
  }

  return Array.from(aggregates.entries()).map(([ticker, aggregate]) => {
    const averagePrice = aggregate.costShares > 0 &&
      Math.abs(aggregate.costShares - aggregate.shares) <= Math.max(1e-8, aggregate.shares * 1e-8)
      ? aggregate.cost / aggregate.shares
      : null;
    const marketValue = aggregate.marketPrice === null
      ? null
      : aggregate.shares * aggregate.marketPrice;
    return {
      ticker,
      shares: aggregate.shares,
      averagePrice,
      currentPrice: aggregate.marketPrice,
      price: aggregate.marketPrice,
      marketValue,
      ...(aggregate.quote?.quoteUpdatedAt ? { quoteUpdatedAt: aggregate.quote.quoteUpdatedAt } : {}),
      ...(aggregate.quote?.quoteSource ? { quoteSource: aggregate.quote.quoteSource } : {}),
      ...(aggregate.quote?.quoteDetails ? { quoteDetails: aggregate.quote.quoteDetails } : {})
    };
  }).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Personal equity is the current market value of the guest's assigned cash-backed stocks. */
export function calculateGuestPersonalEquity(holdings: GuestCashHolding[]): number {
  return (holdings || []).reduce((total, holding) => {
    const price = positiveNumber(holding.currentPrice) ?? positiveNumber(holding.price);
    return total + (price === null ? 0 : Math.max(0, Number(holding.shares) || 0) * price);
  }, 0);
}
