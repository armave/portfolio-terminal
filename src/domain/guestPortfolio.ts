import type { ActiveBrokerTranche, ActiveTrancheMix, ActiveTrancheType, GuestTrancheLedgerRecord, QuoteDetails } from '../types/portfolio';
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
  quoteDetails?: QuoteDetails;
}

interface CashHoldingQuoteLike {
  ticker?: string;
  currentPrice?: unknown;
  price?: unknown;
  quoteUpdatedAt?: number;
  quoteSource?: string;
  quoteDetails?: QuoteDetails;
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
    // Live cash-holding quotes are refreshed more frequently than the broker
    // execution snapshot used to derive tranche metadata.
    const marketPrice = positiveNumber(quote?.currentPrice) ??
      positiveNumber(quote?.price) ??
      positiveNumber(tranche.marketPrice);
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


export interface GuestTrancheLedgerFilters {
  ticker?: string;
  status?: 'all' | 'active' | 'closed' | 'unassigned';
  operationDateFrom?: number;
  operationDateTo?: number;
}

export interface GuestTrancheLedgerSummary {
  totalAssignments: number;
  activeAssignments: number;
  closedAssignments: number;
  unassignedAssignments: number;
  totalAssignedCostBasis: number;
  openCostBasis: number;
  currentMarketValue: number;
  pricedOpenTranches: number;
  unpricedOpenTranches: number;
}

/** Filter a guest's private assignment ledger for dashboard tables and reports. */
export function filterGuestTrancheLedger(
  records: GuestTrancheLedgerRecord[],
  filters: GuestTrancheLedgerFilters = {}
): GuestTrancheLedgerRecord[] {
  const ticker = String(filters.ticker || '').trim().toUpperCase();
  const status = filters.status || 'all';
  return (records || [])
    .filter((record) => {
      if (ticker && !String(record.ticker || '').toUpperCase().includes(ticker)) return false;
      if (status !== 'all' && record.status !== status) return false;
      const isClosedTrade = record.trancheId.startsWith('closed-trade:');
      const operationDateValue = isClosedTrade ? record.operationAt : record.operationAt ?? record.purchasedAt;
      const operationDate = operationDateValue === null || operationDateValue === undefined
        ? Number.NaN : Number(operationDateValue);
      if (Number.isFinite(filters.operationDateFrom) &&
          (!Number.isFinite(operationDate) || operationDate < Number(filters.operationDateFrom))) return false;
      if (Number.isFinite(filters.operationDateTo) &&
          (!Number.isFinite(operationDate) || operationDate > Number(filters.operationDateTo))) return false;
      return true;
    })
    .slice()
    .sort((a, b) => {
      const aDate = a.trancheId.startsWith('closed-trade:')
        ? a.operationAt : a.operationAt ?? a.purchasedAt;
      const bDate = b.trancheId.startsWith('closed-trade:')
        ? b.operationAt : b.operationAt ?? b.purchasedAt;
      return (bDate ?? Number.NEGATIVE_INFINITY) - (aDate ?? Number.NEGATIVE_INFINITY) ||
        b.assignedAt - a.assignedAt || a.ticker.localeCompare(b.ticker);
    });
}

/** A display row containing one or more closely timed operations of the same ticker and side. */
export interface GuestTrancheLedgerOperationGroup {
  records: GuestTrancheLedgerRecord[];
  /** Timestamp of the first (newest) operation in this group. */
  operationAt: number | null;
}

function getGuestTrancheLedgerOperationAt(record: GuestTrancheLedgerRecord): number | null {
  const isClosedTrade = record.trancheId.startsWith('closed-trade:');
  const value = isClosedTrade ? record.operationAt : record.operationAt ?? record.purchasedAt;
  if (value === null || value === undefined) return null;
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Group LOTS rows by ticker, operation side, and the calendar date shown in
 * the user's local timezone. The display is date-only, so intraday time gaps
 * do not split operations that appear on the same date.
 */
export function groupGuestTrancheLedgerOperations(
  records: GuestTrancheLedgerRecord[]
): GuestTrancheLedgerOperationGroup[] {
  const groups: GuestTrancheLedgerOperationGroup[] = [];
  const groupsByOperation = new Map<string, GuestTrancheLedgerOperationGroup>();

  for (const record of records || []) {
    const ticker = String(record.ticker || '').trim().toUpperCase();
    const isClosedTrade = record.trancheId.startsWith('closed-trade:');
    const operationAt = getGuestTrancheLedgerOperationAt(record);
    if (!ticker || operationAt === null) {
      groups.push({ records: [record], operationAt });
      continue;
    }

    const date = new Date(operationAt);
    const localOperationDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
    const key = ticker + ':' + (isClosedTrade ? 'trade' : 'tranche') + ':' + localOperationDate;
    const existing = groupsByOperation.get(key);
    if (existing) {
      existing.records.push(record);
      continue;
    }

    const group = { records: [record], operationAt };
    groups.push(group);
    groupsByOperation.set(key, group);
  }

  return groups;
}

export function summarizeGuestTrancheLedger(
  records: GuestTrancheLedgerRecord[],
  activeTranches: ActiveBrokerTranche[] = []
): GuestTrancheLedgerSummary {
  const activeById = new Map(activeTranches.map((tranche) => [tranche.id, tranche]));
  const summary: GuestTrancheLedgerSummary = {
    totalAssignments: 0,
    activeAssignments: 0,
    closedAssignments: 0,
    unassignedAssignments: 0,
    totalAssignedCostBasis: 0,
    openCostBasis: 0,
    currentMarketValue: 0,
    pricedOpenTranches: 0,
    unpricedOpenTranches: 0
  };
  for (const record of records || []) {
    summary.totalAssignments += 1;
    if (record.status === 'active') summary.activeAssignments += 1;
    else if (record.status === 'closed') summary.closedAssignments += 1;
    else if (record.status === 'unassigned') summary.unassignedAssignments += 1;

    const averagePrice = positiveNumber(record.averagePrice);
    const assignedQuantity = Math.max(0, Number(record.assignedQuantity) || 0);
    const openQuantity = Math.max(0, Number(record.openQuantity) || 0);
    if (averagePrice !== null) {
      summary.totalAssignedCostBasis += assignedQuantity * averagePrice;
      if (record.status === 'active') summary.openCostBasis += openQuantity * averagePrice;
    }
    if (record.status !== 'active') continue;

    const marketValue = activeById.get(record.trancheId)?.marketValue;
    if (marketValue !== null && marketValue !== undefined && Number.isFinite(Number(marketValue))) {
      summary.currentMarketValue += Math.max(0, Number(marketValue));
      summary.pricedOpenTranches += 1;
    } else {
      summary.unpricedOpenTranches += 1;
    }
  }
  return summary;
}

export interface GuestHoldingValuation {
  shares: number;
  currentPrice: number | null;
  marketValue: number | null;
  averagePrice: number | null;
  costBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
}

/**
 * Calculate a guest card's values without treating a missing quote as $0.
 * Cost basis and P/L stay unknown unless both required prices are available.
 */
export function getGuestHoldingValuation(
  holding: Pick<GuestCashHolding, 'shares' | 'currentPrice' | 'price' | 'averagePrice'>
): GuestHoldingValuation {
  const shares = Math.max(0, Number(holding.shares) || 0);
  const currentPrice = positiveNumber(holding.currentPrice) ?? positiveNumber(holding.price);
  const averagePrice = positiveNumber(holding.averagePrice);
  const marketValue = currentPrice === null ? null : shares * currentPrice;
  const costBasis = averagePrice === null ? null : shares * averagePrice;
  const unrealizedPnl = marketValue === null || costBasis === null ? null : marketValue - costBasis;
  const unrealizedPnlPercent = unrealizedPnl === null || costBasis === null || costBasis <= 0
    ? null
    : unrealizedPnl / costBasis * 100;
  return { shares, currentPrice, marketValue, averagePrice, costBasis, unrealizedPnl, unrealizedPnlPercent };
}
