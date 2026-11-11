import { getGuestAssignedCashHoldings, type GuestCashHolding } from '../../domain/guestPortfolio';
import { formatUSD } from '../../utils/formatters';
import { getUsEquityMarketSession } from '../../services/marketSession';
import type {
  ActiveBrokerTranche,
  ActiveTrancheMix,
  ActiveTrancheType,
  CashStockHolding,
  PortfolioState,
  QuoteDetails
} from '../../types/portfolio';
import type { PortfolioTransactionEvent } from '../../types/portfolioTransaction';

/** Market Depth is only actionable while a US equity session is open. */
export function shouldShowCashHoldingMarketDepth(date = new Date()): boolean {
  return getUsEquityMarketSession(date) !== 'CLOSED';
}

type CashHoldingGroup<T extends { ticker: string }> = {
  key: string;
  label: string;
  holdings: T[];
};

type CashHoldingTableRow<T extends { ticker: string }> =
  | { type: 'group'; key: string; label: string }
  | { type: 'holding'; key: string; holding: T };

/**
 * Build table rows at group granularity. Group headings have their own stable
 * keyed sibling rows, instead of being nested inside the first holding fragment.
 */
export function buildCashHoldingTableRows<T extends { ticker: string }>(
  groups: CashHoldingGroup<T>[],
  isAdmin: boolean
): CashHoldingTableRow<T>[] {
  return groups.flatMap((group) => [
    ...(isAdmin
      ? [{ type: 'group' as const, key: `group-${group.key}`, label: group.label }]
      : []),
    ...group.holdings.map((holding) => ({
      type: 'holding' as const,
      key: `holding-${group.key}-${holding.ticker}`,
      holding
    }))
  ]);
}

export function selectCashCushionPortfolioState(state: PortfolioState) {
  return {
    brokerAccountInfo: state.brokerAccountInfo,
    brokerExecutedTrades: state.brokerExecutedTrades,
    guestPortfolioSnapshot: state.guestPortfolioSnapshot,
    activeTrancheGuestAssignments: state.activeTrancheGuestAssignments,
    activeTrancheTypes: state.activeTrancheTypes,
    activeTrancheMixes: state.activeTrancheMixes,
    cashHoldings: state.cashCushion?.holdings,
    positions: state.positions,
    transactionEvents: state.transactionEvents
  };
}

export function areCashCushionPortfolioStatesEqual(
  previous: ReturnType<typeof selectCashCushionPortfolioState>,
  next: ReturnType<typeof selectCashCushionPortfolioState>
): boolean {
  return previous.brokerAccountInfo === next.brokerAccountInfo &&
    previous.brokerExecutedTrades === next.brokerExecutedTrades &&
    previous.guestPortfolioSnapshot === next.guestPortfolioSnapshot &&
    previous.activeTrancheGuestAssignments === next.activeTrancheGuestAssignments &&
    previous.activeTrancheTypes === next.activeTrancheTypes &&
    previous.activeTrancheMixes === next.activeTrancheMixes &&
    previous.cashHoldings === next.cashHoldings &&
    previous.positions === next.positions &&
    previous.transactionEvents === next.transactionEvents;
}

export function formatDailyQuoteRange(details: Pick<QuoteDetails, 'high' | 'low'>): string {
  return `H ${formatUSD(details.high)} / L ${formatUSD(details.low)}`;
}

export function getAssignedGuestIds(assignments: Record<string, string> | undefined): string[] {
  return [...new Set(Object.values(assignments || {}).filter(Boolean))].sort();
}

export function getCashHoldingMarketPrice(holding: { currentPrice?: unknown; price?: unknown }): number | null {
  const positivePrice = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  return positivePrice(holding.currentPrice) ?? positivePrice(holding.price);
}

/**
 * Return only unreversed cash/margin balance adjustments that the store's
 * guarded reversal command explicitly supports. Trade, lot and corporate
 * action events remain excluded.
 */
export function getReversibleBalanceAdjustmentEvents(
  events: readonly PortfolioTransactionEvent[] | undefined
): PortfolioTransactionEvent[] {
  if (!Array.isArray(events) || events.length === 0) return [];
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const reversedEventIds = new Set<string>();
  for (const correction of events) {
    if (correction.type !== 'correction' || typeof correction.relatedEventId !== 'string') continue;
    const original = eventsById.get(correction.relatedEventId);
    if (!original || (original.type !== 'cash.adjustment' && original.type !== 'margin.adjustment')) continue;
    const cashDeltaMatches = original.cashDelta === undefined
      ? correction.cashDelta === undefined
      : typeof correction.cashDelta === 'number' &&
        Math.abs(correction.cashDelta + original.cashDelta) <= 1e-10;
    const debtDeltaMatches = original.marginDebtDelta === undefined
      ? correction.marginDebtDelta === undefined
      : typeof correction.marginDebtDelta === 'number' &&
        Math.abs(correction.marginDebtDelta + original.marginDebtDelta) <= 1e-10;
    if (cashDeltaMatches && debtDeltaMatches) reversedEventIds.add(original.id);
  }
  return events
    .filter((event) => {
      if (event.type !== 'cash.adjustment' && event.type !== 'margin.adjustment') return false;
      if (reversedEventIds.has(event.id)) return false;
      return [event.cashDelta, event.marginDebtDelta].some((delta) =>
        typeof delta === 'number' && Number.isFinite(delta) && Math.abs(delta) > 1e-10
      );
    })
    .sort((left, right) => right.recordedAt - left.recordedAt)
    .slice(0, 5);
}

type ActiveTrancheQuoteRecord = {
  currentPrice?: unknown;
  price?: unknown;
  quoteUpdatedAt?: unknown;
  quoteDetails?: { sourceTimestamp?: unknown; receivedAt?: unknown; transport?: unknown;[key: string]: unknown };
};

export function getActiveTrancheMarketPrice(
  tranche: { ticker: string; marketPrice?: unknown },
  cashHoldings: Array<{ ticker: string } & ActiveTrancheQuoteRecord>,
  positions: Record<string, ActiveTrancheQuoteRecord>
): number | null {
  const ticker = tranche.ticker.trim().toUpperCase();
  const cashHolding = cashHoldings.find((holding) => holding.ticker.trim().toUpperCase() === ticker);
  const position = positions[ticker];

  // Prefer the newest verifiable observation across cash and margin ledgers.
  // q events may carry an ISO ltt value that the provider cannot normalize into
  // a numeric sourceTimestamp; their local receive time is still authoritative.
  // The broker tranche snapshot has no observation timestamp and is last resort.
  let latestTimestamp = 0;
  let latestPrice: number | null = null;
  for (const candidate of [cashHolding, position]) {
    if (!candidate) continue;
    const price = getCashHoldingMarketPrice(candidate);
    const sourceTimestamp = Number(candidate.quoteDetails?.sourceTimestamp);
    const arrivalTimestamp = candidate.quoteDetails?.transport === 'websocket'
      ? Number(candidate.quoteDetails?.receivedAt) || Number(candidate.quoteUpdatedAt)
      : 0;
    const orderingTimestamp = Number.isFinite(sourceTimestamp) && sourceTimestamp > 0
      ? sourceTimestamp
      : Number.isFinite(arrivalTimestamp) && arrivalTimestamp > 0
        ? arrivalTimestamp
        : 0;
    if (price !== null && orderingTimestamp > latestTimestamp) {
      latestTimestamp = orderingTimestamp;
      latestPrice = price;
    }
  }
  if (latestPrice !== null) return latestPrice;

  return getCashHoldingMarketPrice(cashHolding || {}) ??
    getCashHoldingMarketPrice(position || {}) ??
    getCashHoldingMarketPrice({ currentPrice: tranche.marketPrice });
}

/**
 * Summarize only positive-share holdings with verifiable positive market prices.
 * Missing prices remain visible as unpriced rather than being valued at zero.
 */
export function summarizeCashHoldings<T extends { shares: unknown; currentPrice?: unknown; price?: unknown }>(
  holdings: ReadonlyArray<T>
): { unpricedHoldingCount: number; pricedHoldingCount: number; stocksTotal: number } {
  let unpricedHoldingCount = 0;
  let pricedHoldingCount = 0;
  let stocksTotal = 0;

  for (const holding of holdings) {
    const shares = Number(holding.shares);
    if (!Number.isFinite(shares) || shares <= 0) continue;
    const price = getCashHoldingMarketPrice(holding);
    if (price === null) unpricedHoldingCount++;
    else {
      pricedHoldingCount++;
      stocksTotal += shares * price;
    }
  }

  return { unpricedHoldingCount, pricedHoldingCount, stocksTotal };
}

type CashHoldingLike = CashStockHolding | GuestCashHolding;

interface CashHoldingDisplayGroupsInput {
  isAdmin: boolean;
  guestNames: ReadonlyMap<string, string>;
  guestDirectoryPending: boolean;
  guestUnavailableLabel: string;
  activeTranches: ActiveBrokerTranche[];
  activeTrancheGuestAssignments: Record<string, string>;
  activeTrancheTypes: Record<string, ActiveTrancheType>;
  activeTrancheMixes: Record<string, ActiveTrancheMix>;
  cashHoldings: CashStockHolding[];
  holdings: CashHoldingLike[];
}

/** Build the admin guest-assignment groups and the exact display rows for Balance. */
export function buildCashHoldingDisplayGroups(input: CashHoldingDisplayGroupsInput): {
  adminHoldingGroups: CashHoldingGroup<GuestCashHolding>[];
  unassignedHoldings: CashStockHolding[];
  displayHoldingGroups: CashHoldingGroup<CashHoldingLike>[];
  displayTableRows: CashHoldingTableRow<CashHoldingLike>[];
} {
  const adminHoldingGroups = input.isAdmin
    ? getAssignedGuestIds(input.activeTrancheGuestAssignments).map((guestId) => ({
      key: guestId,
      label: input.guestNames.get(guestId) ||
        (input.guestDirectoryPending ? '' : input.guestUnavailableLabel),
      holdings: getGuestAssignedCashHoldings({
        guestId,
        activeTranches: input.activeTranches,
        assignments: input.activeTrancheGuestAssignments,
        types: input.activeTrancheTypes,
        mixes: input.activeTrancheMixes,
        cashHoldings: input.cashHoldings
      })
    })).filter((group) => group.holdings.length > 0)
    : [];

  const unassignedHoldings = input.isAdmin
    ? (() => {
      const assignedByTicker = new Map<string, number>();
      adminHoldingGroups.forEach((group) => group.holdings.forEach((holding) => {
        assignedByTicker.set(holding.ticker, (assignedByTicker.get(holding.ticker) || 0) + holding.shares);
      }));
      return input.cashHoldings.flatMap((holding) => {
        const shares = Math.max(0, Number(holding.shares || 0) - (assignedByTicker.get(holding.ticker) || 0));
        return shares > 1e-8 ? [{ ...holding, shares }] : [];
      });
    })()
    : [];

  const displayHoldingGroups: CashHoldingGroup<CashHoldingLike>[] = input.isAdmin
    ? [
      ...adminHoldingGroups,
      ...(unassignedHoldings.length
        ? [{ key: 'unassigned', label: 'Unassigned · shared holdings', holdings: unassignedHoldings }]
        : [])
    ]
    : [{ key: 'guest', label: '', holdings: input.holdings }];

  return {
    adminHoldingGroups,
    unassignedHoldings,
    displayHoldingGroups,
    displayTableRows: buildCashHoldingTableRows(displayHoldingGroups, input.isAdmin)
  };
}

