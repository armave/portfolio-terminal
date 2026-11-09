import type { ClosedTrade, PositionRecord, TrancheItem } from '../types/portfolio';
import type {
  PortfolioTransactionEvent,
  PortfolioTransactionLotAllocation
} from '../types/portfolioTransaction';
import { isPortfolioTransactionEventList } from './portfolioTransactionJournal';

export interface PortfolioLotReplayOpenLot {
  lotId: string;
  ticker: string;
  buyEventId: string;
  acquiredAt: number;
  acquisitionDate: string;
  acquisitionPrice: number;
  acquiredQuantity: number;
  openQuantity: number;
  originalBuyCommission: number | null;
  openBuyCommission: number | null;
  buyCommissionAllocated: number;
  sellCommissionAllocated: number;
  financingCostAllocated: number;
  realizedPnl: number;
}

export interface PortfolioLotReplaySale {
  eventId: string;
  ticker: string;
  quantity: number;
  sellPrice: number;
  soldCostBasis: number;
  grossProceeds: number;
  grossProfit: number;
  buyCommissionAllocated: number;
  sellCommissionAllocated: number;
  commissions: number;
  financingCost: number;
  realizedPnl: number;
  allocations: PortfolioTransactionLotAllocation[];
}

export interface PortfolioLotJournalIssue {
  eventId?: string;
  disposition: 'incomplete' | 'unsupported';
  reason: string;
}

export interface PortfolioLotJournalReplay {
  status: 'complete' | 'incomplete' | 'unsupported';
  openLots: PortfolioLotReplayOpenLot[];
  sales: PortfolioLotReplaySale[];
  issues: PortfolioLotJournalIssue[];
}

export interface PortfolioLotParityDiscrepancy {
  field:
    | 'open-lot-missing'
    | 'open-lot-quantity'
    | 'open-lot-cost'
    | 'open-lot-buy-commission'
    | 'position-lot-quantity'
    | 'position-buy-commission'
    | 'closed-trade-missing'
    | 'closed-trade-duplicate'
    | 'closed-trade-ticker'
    | 'closed-trade-quantity'
    | 'closed-trade-cost'
    | 'closed-trade-price'
    | 'closed-trade-gross-profit'
    | 'closed-trade-commissions'
    | 'closed-trade-financing'
    | 'closed-trade-net-profit';
  identity: string;
  replayed: number | string;
  canonical: number | string;
  delta?: number;
}

export interface PortfolioLotParityResult {
  status: 'complete' | 'incomplete' | 'unsupported';
  matches: boolean;
  replay: PortfolioLotJournalReplay;
  discrepancies: PortfolioLotParityDiscrepancy[];
  issues: PortfolioLotJournalIssue[];
}

const DEFAULT_TOLERANCE = 0.011;

function closeEnough(left: number, right: number, tolerance: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) &&
    Math.abs(left - right) <= tolerance;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanTicker(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function dateOnly(value: number): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

function summarizeStatus(issues: readonly PortfolioLotJournalIssue[]): PortfolioLotJournalReplay['status'] {
  return issues.some((issue) => issue.disposition === 'unsupported')
    ? 'unsupported'
    : issues.length > 0 ? 'incomplete' : 'complete';
}

/**
 * Rebuild the stable acquisition lots and FIFO sale slices from immutable
 * trade events. Legacy tranches without an ID, old sales without allocations,
 * resets and direct quantity corrections are never assigned guessed history.
 *
 * This is a read-only shadow projection. PortfolioState.positions remains the
 * canonical state and this projection never writes back to the store.
 */
export function replayPortfolioTransactionLots(
  events: readonly PortfolioTransactionEvent[]
): PortfolioLotJournalReplay {
  if (!isPortfolioTransactionEventList(events)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }

  const lots = new Map<string, PortfolioLotReplayOpenLot>();
  const sales: PortfolioLotReplaySale[] = [];
  const issues: PortfolioLotJournalIssue[] = [];
  const addIssue = (
    event: PortfolioTransactionEvent | undefined,
    disposition: PortfolioLotJournalIssue['disposition'],
    reason: string
  ) => issues.push({ ...(event ? { eventId: event.id } : {}), disposition, reason });

  for (const event of events) {
    if (event.type === 'portfolio.reset') {
      lots.clear();
      sales.length = 0;
      continue;
    }

    if (event.type === 'trade.buy') {
      const ticker = cleanTicker(event.ticker);
      const quantity = optionalNumber(event.quantity);
      const price = optionalNumber(event.unitPrice);
      if (!event.lotId || !ticker || quantity === null || quantity <= 0 || price === null || price <= 0) {
        addIssue(event, 'incomplete', 'Buy event does not contain a stable lot ID, ticker, positive quantity and acquisition price.');
        continue;
      }
      if (lots.has(event.lotId)) {
        addIssue(event, 'unsupported', 'A stable acquisition lot ID is reused by more than one buy event.');
        continue;
      }
      const acquisitionDate = event.acquisitionDate?.trim() || dateOnly(event.effectiveAt);
      if (!acquisitionDate) {
        addIssue(event, 'incomplete', 'Buy event has no valid source acquisition date.');
        continue;
      }
      const commission = optionalNumber(event.fees);
      if (commission === null || commission < 0) {
        addIssue(event, 'incomplete', 'Buy event does not contain a verifiable non-negative commission amount.');
      }
      lots.set(event.lotId, {
        lotId: event.lotId,
        ticker,
        buyEventId: event.id,
        acquiredAt: event.effectiveAt,
        acquisitionDate,
        acquisitionPrice: price,
        acquiredQuantity: quantity,
        openQuantity: quantity,
        originalBuyCommission: commission,
        openBuyCommission: commission,
        buyCommissionAllocated: 0,
        sellCommissionAllocated: 0,
        financingCostAllocated: 0,
        realizedPnl: 0
      });
      continue;
    }

    if (event.type === 'trade.sell') {
      if (!event.lotAllocations?.length) {
        addIssue(event, 'incomplete', 'Sale event has no exact FIFO lot allocations; no acquisition lot was inferred.');
        continue;
      }
      const ticker = cleanTicker(event.ticker);
      const stableAllocations = event.lotAllocations.filter((allocation) => allocation.identity === 'stable');
      const legacyAllocations = event.lotAllocations.filter((allocation) => allocation.identity === 'legacy-unmapped');
      if (legacyAllocations.length) {
        addIssue(event, 'incomplete', 'Sale contains legacy-unmapped acquisition slices; those slices remain unlinked and are not reconstructed.');
      }

      let validStableAllocations = stableAllocations.length > 0;
      for (const allocation of stableAllocations) {
        const lot = allocation.lotId ? lots.get(allocation.lotId) : undefined;
        if (!lot) {
          addIssue(event, 'incomplete', 'Sale references a stable lot ID that is absent from the available buy-event history.');
          validStableAllocations = false;
          continue;
        }
        const quantity = allocation.quantity;
        if (lot.ticker !== ticker ||
          !closeEnough(lot.acquisitionPrice, allocation.acquisitionPrice, DEFAULT_TOLERANCE) ||
          quantity - lot.openQuantity > DEFAULT_TOLERANCE ||
          (allocation.acquisitionDate !== undefined && allocation.acquisitionDate !== lot.acquisitionDate) ||
          (allocation.acquiredAt !== undefined && !closeEnough(allocation.acquiredAt, lot.acquiredAt, 1))) {
          addIssue(event, 'unsupported', 'Sale allocation conflicts with the referenced acquisition lot identity, price, date or remaining quantity.');
          validStableAllocations = false;
        }
        if (lot.openBuyCommission !== null &&
          allocation.buyCommissionAllocated - lot.openBuyCommission > DEFAULT_TOLERANCE) {
          addIssue(event, 'unsupported', 'Sale allocation consumes more buy commission than remains on the referenced lot.');
          validStableAllocations = false;
        }
      }
      if (!validStableAllocations) continue;

      for (const allocation of stableAllocations) {
        const lot = lots.get(allocation.lotId!)!;
        lot.openQuantity = Math.max(0, lot.openQuantity - allocation.quantity);
        if (lot.openQuantity <= DEFAULT_TOLERANCE) lot.openQuantity = 0;
        if (lot.openBuyCommission !== null) {
          lot.openBuyCommission = Number(Math.max(
            0,
            lot.openBuyCommission - allocation.buyCommissionAllocated
          ).toFixed(2));
        }
        lot.buyCommissionAllocated = Number((lot.buyCommissionAllocated + allocation.buyCommissionAllocated).toFixed(2));
        lot.sellCommissionAllocated = Number((lot.sellCommissionAllocated + allocation.sellCommissionAllocated).toFixed(2));
        lot.financingCostAllocated = Number((lot.financingCostAllocated + allocation.financingCostAllocated).toFixed(2));
        lot.realizedPnl = Number((lot.realizedPnl + allocation.realizedPnl).toFixed(2));
      }

      // A mixed stable/legacy sale can advance the known stable lots, but it is
      // not a complete closed-sale projection because part of the cost basis is unknown.
      if (legacyAllocations.length || stableAllocations.length !== event.lotAllocations.length) continue;

      const quantity = stableAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
      const soldCostBasis = stableAllocations.reduce(
        (sum, allocation) => sum + allocation.quantity * allocation.acquisitionPrice, 0
      );
      const grossProceeds = stableAllocations.reduce(
        (sum, allocation) => sum + allocation.quantity * allocation.sellPrice, 0
      );
      const buyCommissionAllocated = stableAllocations.reduce((sum, allocation) => sum + allocation.buyCommissionAllocated, 0);
      const sellCommissionAllocated = stableAllocations.reduce((sum, allocation) => sum + allocation.sellCommissionAllocated, 0);
      const financingCost = stableAllocations.reduce((sum, allocation) => sum + allocation.financingCostAllocated, 0);
      const realizedPnl = stableAllocations.reduce((sum, allocation) => sum + allocation.realizedPnl, 0);
      const sellPrice = optionalNumber(event.unitPrice);
      if (sellPrice === null || !closeEnough(sellPrice * quantity, grossProceeds, DEFAULT_TOLERANCE) ||
        !closeEnough(optionalNumber(event.grossAmount) ?? Number.NaN, grossProceeds, DEFAULT_TOLERANCE)) {
        addIssue(event, 'unsupported', 'Stable lot sale allocations do not agree with the sale event price and gross proceeds.');
        continue;
      }
      sales.push({
        eventId: event.id,
        ticker,
        quantity,
        sellPrice,
        soldCostBasis: Number(soldCostBasis.toFixed(8)),
        grossProceeds: Number(grossProceeds.toFixed(8)),
        grossProfit: Number((grossProceeds - soldCostBasis).toFixed(2)),
        buyCommissionAllocated: Number(buyCommissionAllocated.toFixed(2)),
        sellCommissionAllocated: Number(sellCommissionAllocated.toFixed(2)),
        commissions: Number((buyCommissionAllocated + sellCommissionAllocated).toFixed(2)),
        financingCost: Number(financingCost.toFixed(2)),
        realizedPnl: Number(realizedPnl.toFixed(2)),
        allocations: stableAllocations.map((allocation) => ({ ...allocation }))
      });
    }

    if ((event.type === 'position.adjustment' ||
      event.type === 'portfolio.reconciliation' ||
      event.type === 'corporate-action') &&
      event.positionQuantityDelta !== undefined &&
      Math.abs(event.positionQuantityDelta) > DEFAULT_TOLERANCE) {
      addIssue(event, 'incomplete', 'Position quantity changed without an exact acquisition-lot adjustment; lot identity was not inferred.');
    } else if (event.type === 'correction' &&
      event.positionQuantityDelta !== undefined &&
      Math.abs(event.positionQuantityDelta) > DEFAULT_TOLERANCE) {
      addIssue(event, 'unsupported', 'Trade or lot quantity corrections are not supported by the current reversal contract.');
    } else if (event.type === 'history.correction') {
      addIssue(event, 'incomplete', 'Closed-history correction has no linked lot-level correction projection.');
    }
  }

  const openLots = [...lots.values()].filter((lot) => lot.openQuantity > DEFAULT_TOLERANCE);
  const detachedLots = openLots.map((lot) => Object.freeze({ ...lot }));
  const detachedSales = sales.map((sale) => Object.freeze({
    ...sale,
    allocations: Object.freeze(sale.allocations.map((allocation) => Object.freeze({ ...allocation }))) as unknown as PortfolioTransactionLotAllocation[]
  }));
  return {
    status: summarizeStatus(issues),
    openLots: detachedLots,
    sales: detachedSales,
    issues
  };
}

function addDiscrepancy(
  discrepancies: PortfolioLotParityDiscrepancy[],
  field: PortfolioLotParityDiscrepancy['field'],
  identity: string,
  replayed: number | string,
  canonical: number | string,
  tolerance: number
) {
  const left = typeof replayed === 'number' ? replayed : Number.NaN;
  const right = typeof canonical === 'number' ? canonical : Number.NaN;
  if (Number.isFinite(left) && Number.isFinite(right)) {
    if (Math.abs(left - right) > tolerance) {
      discrepancies.push({ field, identity, replayed, canonical, delta: right - left });
    }
  } else if (replayed !== canonical) {
    discrepancies.push({ field, identity, replayed, canonical });
  }
}

/**
 * Compare stable replay lots and linked closed-sale outcomes to a canonical
 * snapshot. Any legacy lot or unlinked legacy closed row makes parity
 * explicitly incomplete rather than guessing its identity or cost basis.
 */
export function verifyPortfolioTransactionLotParity(
  events: readonly PortfolioTransactionEvent[],
  canonical: {
    positions?: Record<string, Pick<PositionRecord, 'shares' | 'commBuy' | 'tranches'>>;
    closedTrades?: readonly ClosedTrade[];
  },
  tolerance = DEFAULT_TOLERANCE
): PortfolioLotParityResult {
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('Lot parity tolerance must be finite and non-negative.');
  const replay = replayPortfolioTransactionLots(events);
  const issues = [...replay.issues];
  const discrepancies: PortfolioLotParityDiscrepancy[] = [];
  const replayById = new Map(replay.openLots.map((lot) => [lot.lotId, lot]));
  const canonicalById = new Map<string, { ticker: string; tranche: TrancheItem }>();
  const positions = canonical.positions || {};

  for (const [rawTicker, position] of Object.entries(positions)) {
    const ticker = cleanTicker(rawTicker);
    const tranches = Array.isArray(position.tranches) ? position.tranches : [];
    if (Number(position.shares) > tolerance && !tranches.length) {
      issues.push({ disposition: 'incomplete', reason: `Canonical ${ticker} position has no acquisition lots.` });
      continue;
    }
    let hasLegacyLot = false;
    for (const tranche of tranches) {
      if (!tranche.lotId) {
        hasLegacyLot = true;
        issues.push({ disposition: 'incomplete', reason: `Canonical ${ticker} contains a legacy lot without stable identity; it was not assigned a synthetic ID.` });
        continue;
      }
      if (canonicalById.has(tranche.lotId)) {
        issues.push({ disposition: 'unsupported', reason: `Canonical snapshot reuses acquisition lot ID ${tranche.lotId}.` });
        continue;
      }
      canonicalById.set(tranche.lotId, { ticker, tranche });
    }
    const replayTickerLots = replay.openLots.filter((lot) => lot.ticker === ticker);
    if (!hasLegacyLot) {
      const replayQuantity = replayTickerLots.reduce((sum, lot) => sum + lot.openQuantity, 0);
      const canonicalQuantity = Number(position.shares) || 0;
      addDiscrepancy(discrepancies, 'position-lot-quantity', ticker, replayQuantity, canonicalQuantity, tolerance);
      const knownFees = replayTickerLots.every((lot) => lot.openBuyCommission !== null);
      if (knownFees) {
        const replayFees = replayTickerLots.reduce((sum, lot) => sum + (lot.openBuyCommission ?? 0), 0);
        addDiscrepancy(discrepancies, 'position-buy-commission', ticker, replayFees, Number(position.commBuy) || 0, tolerance);
      } else {
        issues.push({ disposition: 'incomplete', reason: `Canonical ${ticker} position has a lot whose remaining buy commission cannot be replayed.` });
      }
    }
  }

  for (const lot of replay.openLots) {
    const canonicalLot = canonicalById.get(lot.lotId);
    if (!canonicalLot) {
      discrepancies.push({
        field: 'open-lot-missing', identity: lot.lotId, replayed: lot.openQuantity, canonical: 0
      });
      continue;
    }
    if (canonicalLot.ticker !== lot.ticker) {
      discrepancies.push({ field: 'open-lot-cost', identity: lot.lotId, replayed: lot.ticker, canonical: canonicalLot.ticker });
      continue;
    }
    addDiscrepancy(discrepancies, 'open-lot-quantity', lot.lotId, lot.openQuantity, Number(canonicalLot.tranche.qty), tolerance);
    addDiscrepancy(discrepancies, 'open-lot-cost', lot.lotId, lot.acquisitionPrice, Number(canonicalLot.tranche.price), tolerance);
    if (canonicalLot.tranche.date) {
      if (canonicalLot.tranche.date !== lot.acquisitionDate) {
        discrepancies.push({
          field: 'open-lot-acquisition-date',
          identity: lot.lotId,
          replayed: lot.acquisitionDate,
          canonical: canonicalLot.tranche.date
        });
      }
    } else {
      issues.push({ disposition: 'incomplete', reason: `Canonical lot ${lot.lotId} has no acquisition date.` });
    }
    if (lot.openBuyCommission !== null && canonicalLot.tranche.buyCommission !== undefined) {
      addDiscrepancy(discrepancies, 'open-lot-buy-commission', lot.lotId, lot.openBuyCommission, Number(canonicalLot.tranche.buyCommission), tolerance);
    } else if (lot.openBuyCommission !== null && canonicalLot.tranche.buyCommission === undefined) {
      issues.push({ disposition: 'incomplete', reason: `Canonical lot ${lot.lotId} does not expose its remaining buy commission.` });
    } else {
      issues.push({ disposition: 'incomplete', reason: `Replay cannot verify remaining buy commission for lot ${lot.lotId}.` });
    }
  }
  for (const [lotId, canonicalLot] of canonicalById) {
    if (!replayById.has(lotId)) {
      discrepancies.push({ field: 'open-lot-missing', identity: lotId, replayed: 0, canonical: Number(canonicalLot.tranche.qty) || 0 });
    }
  }

  const replaySales = new Map(replay.sales.map((sale) => [sale.eventId, sale]));
  const linkedClosedTrades = new Map<string, ClosedTrade[]>();
  for (const trade of canonical.closedTrades || []) {
    const eventId = trade.transactionEventId?.trim();
    if (!eventId) {
      issues.push({ disposition: 'incomplete', reason: `Legacy closed trade ${trade.id || trade.ticker} has no source sale-event link.` });
      continue;
    }
    const group = linkedClosedTrades.get(eventId) || [];
    group.push(trade);
    linkedClosedTrades.set(eventId, group);
  }

  for (const [eventId, linked] of linkedClosedTrades) {
    if (linked.length !== 1) {
      discrepancies.push({ field: 'closed-trade-duplicate', identity: eventId, replayed: 1, canonical: linked.length });
      continue;
    }
    const sale = replaySales.get(eventId);
    if (!sale) {
      issues.push({ disposition: 'incomplete', reason: `Closed trade links to sale event ${eventId}, but that event has no complete stable-lot replay projection.` });
      continue;
    }
    const trade = linked[0];
    if (cleanTicker(trade.ticker) !== sale.ticker) {
      discrepancies.push({ field: 'closed-trade-ticker', identity: eventId, replayed: sale.ticker, canonical: cleanTicker(trade.ticker) });
    }
    addDiscrepancy(discrepancies, 'closed-trade-quantity', eventId, sale.quantity, Number(trade.shares), tolerance);
    const entryPrice = optionalNumber(trade.avgBuyPrice ?? trade.entryPrice);
    if (entryPrice === null) {
      issues.push({ disposition: 'incomplete', reason: `Closed trade linked to ${eventId} has no recorded average entry price.` });
    } else {
      addDiscrepancy(discrepancies, 'closed-trade-cost', eventId, sale.soldCostBasis / sale.quantity, entryPrice, tolerance);
    }
    const sellPrice = optionalNumber(trade.sellPrice ?? trade.exitPrice);
    if (sellPrice === null) {
      issues.push({ disposition: 'incomplete', reason: `Closed trade linked to ${eventId} has no recorded sale price.` });
    } else {
      addDiscrepancy(discrepancies, 'closed-trade-price', eventId, sale.sellPrice, sellPrice, tolerance);
    }
    for (const [field, replayed, rawCanonical] of [
      ['closed-trade-gross-profit', sale.grossProfit, trade.grossProfit],
      ['closed-trade-commissions', sale.commissions, trade.commissions ?? trade.feesAndCommissions ?? trade.totalCommissions],
      ['closed-trade-financing', sale.financingCost, trade.marginInterest],
      ['closed-trade-net-profit', sale.realizedPnl, trade.netProfit ?? trade.netRealizedGain]
    ] as const) {
      const value = optionalNumber(rawCanonical);
      if (value === null) issues.push({ disposition: 'incomplete', reason: `Closed trade linked to ${eventId} lacks ${field.replace('closed-trade-', '')} data.` });
      else addDiscrepancy(discrepancies, field, eventId, replayed, value, tolerance);
    }
  }

  for (const sale of replay.sales) {
    if (!linkedClosedTrades.has(sale.eventId)) {
      issues.push({ disposition: 'incomplete', eventId: sale.eventId, reason: 'Stable sale event has no linked canonical closed-trade record.' });
    }
  }

  const status = summarizeStatus(issues);
  return {
    status,
    matches: status === 'complete' && discrepancies.length === 0,
    replay,
    discrepancies,
    issues
  };
}
