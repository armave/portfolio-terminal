import { deduplicateClosedHistoryRows } from '../../domain/closedHistoryFees';
import { normalizeExecutionTicker, type BrokerExecutionMetrics } from '../../domain/brokerExecutionMetrics';
import type { ClosedTradeAttribution } from '../../domain/closedTradeAttribution';
import { resolveClosedTradeAllocation } from '../../domain/closedTradeAllocation';
import type { ClosedTradeAllocation } from '../../types/portfolio';
import type { FreedomExecutedTrade } from '../../types/freedomTrade';

type ClosedHistoryAppRow = {
  trade: object;
  [key: string]: any;
};

export interface ClosedHistoryRowsInput {
  brokerTrades: FreedomExecutedTrade[];
  brokerTradeMetrics: ReadonlyMap<FreedomExecutedTrade, BrokerExecutionMetrics>;
  trancheAttributions: ReadonlyMap<FreedomExecutedTrade, ClosedTradeAttribution>;
  appTrades: ClosedHistoryAppRow[];
  closedTradeAllocations?: Record<string, ClosedTradeAllocation>;
}

/**
 * Create the canonical Closed History display rows.
 * Broker executions take precedence over duplicate app-owned sales. Adjacent
 * same-ticker sells are grouped only when the gap from the previous sell is
 * no more than one hour; allocations are resolved after grouping.
 */
export function buildClosedHistoryRows({
  brokerTrades,
  brokerTradeMetrics,
  trancheAttributions,
  appTrades,
  closedTradeAllocations
}: ClosedHistoryRowsInput): any[] {
  const brokerRows = brokerTrades
    .filter((broker) => ['sell', 's', 'sale', 'sold', '2'].includes(String(broker.side ?? '').toLowerCase()))
    .map((broker, index) => {
      const allocatedMarginFee = Object.values((broker.marginFeeAllocations || {}) as Record<string, number>)
        .reduce((sum, amount) => sum + (Number(amount) || 0), 0);
      const marginFee = Number((broker.marginFeeAllocations && typeof broker.marginFeeAllocations === 'object')
        ? allocatedMarginFee
        : broker.marginFee ?? 0) || 0;
      const metrics = brokerTradeMetrics.get(broker);
      const sellCommissionCurrency = String(broker.commissionCurrency ?? broker.currency ?? '').trim().toUpperCase();
      const sellCommissionCurrencyIsUsd = sellCommissionCurrency === '' || sellCommissionCurrency === 'USD';
      const rawSellCommission = !sellCommissionCurrencyIsUsd || broker.commission === null || broker.commission === undefined
        ? NaN
        : Math.abs(Number(broker.commission));
      const sellCommission = Number.isFinite(rawSellCommission) ? rawSellCommission : null;
      const buyCommission = metrics?.buyCommission ?? null;
      const commissionsComplete = sellCommission !== null && buyCommission !== null;
      const commissions = Number(((sellCommission ?? 0) + (buyCommission ?? 0)).toFixed(2));
      const fees = Number(Math.abs(marginFee).toFixed(2));
      const totalFees = Number((commissions + fees).toFixed(2));
      const ticker = normalizeExecutionTicker(broker.ticker);
      const attribution = trancheAttributions.get(broker);
      const quantity = Math.abs(Number(broker.quantity ?? 0));
      const directSellPrice = Number(broker.price);
      const tradeValue = Math.abs(Number(broker.tradeValue ?? 0));
      const sellPrice = Number.isFinite(directSellPrice) && directSellPrice > 0
        ? directSellPrice
        : tradeValue > 0 && quantity > 0 ? tradeValue / quantity : null;
      const averageBuyPrice = attribution?.averagePrice;
      const hasCompleteFifoCostBasis = Boolean(
        attribution &&
        Number.isFinite(attribution.unmatchedQuantity) &&
        attribution.unmatchedQuantity <= 1e-8 &&
        averageBuyPrice !== null &&
        averageBuyPrice !== undefined &&
        Number.isFinite(averageBuyPrice) &&
        averageBuyPrice > 0 &&
        sellPrice !== null &&
        Number.isFinite(sellPrice) &&
        sellPrice > 0 &&
        quantity > 0
      );
      // Prefer TradeNet's reported gross result. If it is absent, derive gross
      // P&L only from a complete FIFO match with a known acquisition cost and
      // a usable sell execution price; never price unmatched shares by guesswork.
      const fifoGrossProfit = hasCompleteFifoCostBasis
        ? Number(((sellPrice! - averageBuyPrice!) * quantity).toFixed(2))
        : null;
      const grossProfit = broker.profit !== null && broker.profit !== undefined && Number.isFinite(broker.profit)
        ? broker.profit
        : fifoGrossProfit;
      // Known commission/fee components form a lower bound on total costs.
      // When gross P&L is known but one commission side is missing, expose the
      // resulting net value as an upper bound rather than hiding it or calling
      // it exact. The UI and summary keep that distinction explicit.
      const profit = grossProfit === null
        ? null
        : Number((grossProfit - totalFees).toFixed(2));
      const profitIsUpperBound = profit !== null && !commissionsComplete;
      const allocationType = attribution?.fundingType || 'unclassified';
      return {
        trade: {
          id: broker.id ?? ('tradenet-' + index),
          ticker,
          shares: broker.quantity,
          exitDate: broker.executedAt,
          sellDate: broker.executedAt,
          holdingDays: metrics?.holdingDays ?? null,
          feesAndCommissions: totalFees,
          netProfit: profit,
          side: broker.side,
          price: broker.price,
          source: 'tradenet' as const
        },
        index: -1,
        source: 'tradenet' as const,
        allocationKey: 'broker:' + String(broker.id ?? ('tradenet-' + index)),
        profit,
        profitIsUpperBound,
        fees,
        commissions,
        commissionsComplete,
        feesTotal: totalFees,
        allocationType,
        allocationTypes: [allocationType],
        cashQuantity: attribution?.cashQuantity || 0,
        marginQuantity: attribution?.marginQuantity || 0,
        guestAllocations: attribution?.guestAllocations || [],
        unmatchedQuantity: attribution?.unmatchedQuantity || 0
      };
    });

  const groupedBrokerRows = (() => {
    const sorted = [...brokerRows].sort((a, b) =>
      Date.parse(String((a.trade as any).exitDate ?? '')) -
      Date.parse(String((b.trade as any).exitDate ?? ''))
    );
    const groups: typeof brokerRows = [];
    for (const row of sorted) {
      const ticker = String((row.trade as any).ticker ?? '').trim().toUpperCase();
      const time = Date.parse(String((row.trade as any).exitDate ?? ''));
      const previous = groups[groups.length - 1];
      const previousTicker = previous ? String((previous.trade as any).ticker ?? '').trim().toUpperCase() : '';
      const previousTime = previous ? Date.parse(String((previous.trade as any).exitDate ?? '')) : NaN;
      if (previous && ticker && ticker === previousTicker &&
          Number.isFinite(time) && Number.isFinite(previousTime) && time - previousTime <= 60 * 60 * 1000) {
        // The grouped display ID expands, but saved allocation identity stays anchored to its first execution.
        const oldQty = Number((previous.trade as any).shares ?? 0);
        const newQty = Number((row.trade as any).shares ?? 0);
        const oldProfit = previous.profit;
        const newProfit = row.profit;
        const oldDuration = (previous.trade as any).holdingDays;
        const newDuration = (row.trade as any).holdingDays;
        const totalQty = oldQty + newQty;
        (previous.trade as any).shares = totalQty;
        (previous.trade as any).exitDate = (row.trade as any).exitDate;
        (previous.trade as any).sellDate = (row.trade as any).exitDate;
        (previous.trade as any).id = String((previous.trade as any).id) + '+' + String((row.trade as any).id);
        (previous.trade as any).holdingDays = oldDuration != null && newDuration != null && totalQty > 0
          ? (Number(oldDuration) * oldQty + Number(newDuration) * newQty) / totalQty
          : oldDuration ?? newDuration;
        previous.profit = oldProfit == null || newProfit == null ? null : oldProfit + newProfit;
        previous.profitIsUpperBound = previous.profit !== null &&
          (previous.profitIsUpperBound === true || row.profitIsUpperBound === true);
        previous.fees = (previous.fees || 0) + (row.fees || 0);
        previous.commissions = (previous.commissions || 0) + (row.commissions || 0);
        previous.commissionsComplete = previous.commissionsComplete && row.commissionsComplete;
        previous.feesTotal = (previous.feesTotal || 0) + (row.feesTotal || 0);
        // Keep the embedded trade record in sync with the display-row totals;
        // downstream consumers must not see only the first fill's P&L/fees.
        (previous.trade as any).netProfit = previous.profit;
        (previous.trade as any).feesAndCommissions = previous.feesTotal;
        previous.cashQuantity = (previous.cashQuantity || 0) + (row.cashQuantity || 0);
        previous.marginQuantity = (previous.marginQuantity || 0) + (row.marginQuantity || 0);
        const allocationTypes = Array.from(new Set([
          ...(previous.allocationTypes || [previous.allocationType]),
          ...(row.allocationTypes || [row.allocationType])
        ]));
        const knownTypes = allocationTypes.filter((type) => type !== 'unclassified');
        previous.allocationTypes = allocationTypes;
        previous.allocationType = knownTypes.length > 1 || knownTypes.includes('mix')
          ? 'mix'
          : knownTypes[0] || 'unclassified';
        const guestTotals = new Map<string, number>();
        [...(previous.guestAllocations || []), ...(row.guestAllocations || [])].forEach((item) => {
          guestTotals.set(item.guestId, (guestTotals.get(item.guestId) || 0) + item.quantity);
        });
        previous.guestAllocations = Array.from(guestTotals.entries())
          .map(([guestId, quantity]) => ({ guestId, quantity }))
          .sort((a, b) => a.guestId.localeCompare(b.guestId));
        previous.unmatchedQuantity = (previous.unmatchedQuantity || 0) + (row.unmatchedQuantity || 0);
        (previous.trade as any).price = totalQty > 0
          ? (Number((previous.trade as any).price ?? 0) * oldQty +
            Number((row.trade as any).price ?? 0) * newQty) / totalQty
          : (row.trade as any).price;
      } else {
        groups.push({
          ...row,
          trade: { ...(row.trade as any) },
          allocationTypes: [...(row.allocationTypes || [row.allocationType])],
          guestAllocations: [...(row.guestAllocations || [])]
        });
      }
    }
    return groups;
  })();

  // Match app-owned records to individual broker fills before comparing with
  // grouped broker rows. A grouped 5-share sale may contain the same 2-share
  // execution as an app row; matching only against the 5-share aggregate would
  // leave that duplicate in the table and double-count its P&L and fees.
  const appTradesWithoutFillDuplicates = deduplicateClosedHistoryRows(appTrades, brokerRows);
  const uniqueAppTrades = deduplicateClosedHistoryRows(appTradesWithoutFillDuplicates, groupedBrokerRows);
  const getExitTimestamp = (row: any): number => {
    const raw = row.trade?.exitDate ?? row.trade?.sellDate ?? row.trade?.closedAt ?? row.trade?.date;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (raw > 1e12) return raw;
      if (raw > 20000 && raw < 100000) return Date.UTC(1899, 11, 30) + raw * 86400000;
    }
    const parsed = Date.parse(String(raw ?? ''));
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  };

  return [...uniqueAppTrades, ...groupedBrokerRows].map((row: any) => {
    const allocation = resolveClosedTradeAllocation(
      row.trade?.shares,
      row.allocationType,
      row.guestAllocations || [],
      closedTradeAllocations?.[row.allocationKey],
      row.cashQuantity
    );
    return {
      ...row,
      ...allocation,
      allocationType: allocation.fundingType,
      allocationTypes: [allocation.fundingType]
    };
  }).sort((a, b) => getExitTimestamp(b) - getExitTimestamp(a));
}

/** Aggregate display totals without turning unknown net profit into a fabricated zero. */
export function summarizeClosedHistoryRows(trades: readonly any[]): {
  realizedNet: number;
  totalFees: number;
  hasIncompleteCommissions: boolean;
  hasUnknownProfit: boolean;
  knownProfitCount: number;
  winningTrades: number;
  averageHoldingDays: number | null;
  winRate: number;
} {
  // Bounded results are useful per-row, but are not exact realized P&L and
  // must not enter the Known Net P&L or win-rate denominator.
  const profitKnownTrades = trades.filter((row) =>
    row.profit !== null && row.profitIsUpperBound !== true
  );
  const winningTrades = profitKnownTrades.filter((row) => (row.profit ?? 0) > 0).length;
  const knownDurations = trades
    .map((row) => Number((row.trade as any).holdingDays ?? (row.trade as any).daysHeld))
    .filter((days) => Number.isFinite(days) && days >= 0);

  return {
    realizedNet: profitKnownTrades.reduce((total, row) => total + (row.profit ?? 0), 0),
    totalFees: trades.reduce((total, row) => total + (
      Number.isFinite(row.feesTotal) ? row.feesTotal : ((row.fees || 0) + (row.commissions || 0))
    ), 0),
    hasIncompleteCommissions: trades.some((row: any) => row.commissionsComplete === false),
    hasUnknownProfit: profitKnownTrades.length < trades.length,
    knownProfitCount: profitKnownTrades.length,
    winningTrades,
    averageHoldingDays: knownDurations.length
      ? knownDurations.reduce((total, days) => total + days, 0) / knownDurations.length
      : null,
    winRate: profitKnownTrades.length ? (winningTrades / profitKnownTrades.length) * 100 : 0
  };
}
