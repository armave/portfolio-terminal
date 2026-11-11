import type { CashStockHolding, ClosedTrade, PositionRecord, TrancheItem } from '../types/portfolio';
import type {
  PortfolioTransactionEvent,
  PortfolioTransactionLotAllocation
} from '../types/portfolioTransaction';
import { isPortfolioTransactionEventList } from './portfolioTransactionJournal';

interface PortfolioLotReplayOpenLot {
  lotId: string;
  ticker: string;
  buyEventId: string;
  acquiredAt: number;
  acquisitionDate: string | null;
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

interface PortfolioLotReplaySale {
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

interface PortfolioLotJournalIssue {
  eventId?: string;
  disposition: 'incomplete' | 'unsupported';
  reason: string;
}

export interface PortfolioLotJournalReplay {
  status: 'complete' | 'incomplete' | 'unsupported';
  openLots: PortfolioLotReplayOpenLot[];
  sales: PortfolioLotReplaySale[];
  cashHoldingOpenLots: PortfolioLotReplayOpenLot[];
  cashHoldingSales: PortfolioLotReplaySale[];
  issues: PortfolioLotJournalIssue[];
}

interface PortfolioLotParityDiscrepancy {
  field:
    | 'open-lot-missing'
    | 'open-lot-quantity'
    | 'open-lot-cost'
    | 'open-lot-acquisition-date'
    | 'open-lot-buy-commission'
    | 'cash-holding-lot-missing'
    | 'cash-holding-lot-quantity'
    | 'cash-holding-lot-cost'
    | 'cash-holding-lot-acquisition-date'
    | 'cash-holding-lot-buy-commission'
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

function summarizeStatus(issues: readonly PortfolioLotJournalIssue[]): PortfolioLotJournalReplay['status'] {
  return issues.some((issue) => issue.disposition === 'unsupported')
    ? 'unsupported'
    : issues.length > 0 ? 'incomplete' : 'complete';
}

/**
 * Rebuild stable margin-position and cash-holding acquisition lots and FIFO
 * sale slices from immutable events. Legacy holdings without app-owned lot
 * history, resets and direct quantity corrections are never assigned guesses.
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
  const cashLots = new Map<string, PortfolioLotReplayOpenLot>();
  const sales: PortfolioLotReplaySale[] = [];
  const cashHoldingSales: PortfolioLotReplaySale[] = [];
  const issues: PortfolioLotJournalIssue[] = [];
  const addIssue = (
    event: PortfolioTransactionEvent | undefined,
    disposition: PortfolioLotJournalIssue['disposition'],
    reason: string
  ) => issues.push({ ...(event ? { eventId: event.id } : {}), disposition, reason });

  for (const event of events) {
    if (event.type === 'portfolio.reset') {
      lots.clear();
      cashLots.clear();
      sales.length = 0;
      cashHoldingSales.length = 0;
      continue;
    }

    if (event.type === 'cash-holding.adjustment') {
      addIssue(event, 'incomplete', 'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics; removed cost basis is not treated as a sale.');
      continue;
    }

    if (event.type === 'trade.buy' || event.type === 'cash-holding.buy') {
      const isCashHolding = event.type === 'cash-holding.buy';
      const targetLots = isCashHolding ? cashLots : lots;
      const ticker = cleanTicker(event.ticker);
      const quantity = optionalNumber(event.quantity);
      const price = optionalNumber(event.unitPrice);
      const quantityDelta = isCashHolding ? event.cashHoldingQuantityDelta : event.positionQuantityDelta;
      const acquisitionDate = event.acquisitionDate?.trim() || null;
      if (!event.lotId || !ticker || quantity === null || quantity <= 0 || price === null || price <= 0 ||
        quantityDelta === undefined || !closeEnough(quantityDelta, quantity, DEFAULT_TOLERANCE) ||
        (isCashHolding && !acquisitionDate)) {
        addIssue(event, 'incomplete', 'Buy event does not contain a stable lot ID, ticker, exact acquisition date, positive quantity, acquisition price and matching quantity delta.');
        continue;
      }
      if (targetLots.has(event.lotId) || (isCashHolding ? lots.has(event.lotId) : cashLots.has(event.lotId))) {
        addIssue(event, 'unsupported', 'A stable acquisition lot ID is reused by more than one buy event.');
        continue;
      }
      if (!acquisitionDate) {
        addIssue(event, 'incomplete', 'Buy event predates exact acquisition-date capture; source date was not inferred from the event timestamp.');
      }
      const commission = optionalNumber(event.fees);
      if (commission === null || commission < 0) {
        addIssue(event, 'incomplete', 'Buy event does not contain a verifiable non-negative commission amount.');
      }
      targetLots.set(event.lotId, {
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

    if (event.type === 'trade.sell' || event.type === 'cash-holding.sell') {
      const isCashHolding = event.type === 'cash-holding.sell';
      const targetLots = isCashHolding ? cashLots : lots;
      const saleCollection = isCashHolding ? cashHoldingSales : sales;
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
        const lot = allocation.lotId ? targetLots.get(allocation.lotId) : undefined;
        if (!lot) {
          addIssue(event, 'incomplete', 'Sale references a stable lot ID that is absent from the available buy-event history.');
          validStableAllocations = false;
          continue;
        }
        const quantity = allocation.quantity;
        if (lot.ticker !== ticker ||
          !closeEnough(lot.acquisitionPrice, allocation.acquisitionPrice, DEFAULT_TOLERANCE) ||
          quantity - lot.openQuantity > DEFAULT_TOLERANCE ||
          (lot.acquisitionDate !== null && allocation.acquisitionDate !== undefined &&
            allocation.acquisitionDate !== lot.acquisitionDate) ||
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
      // The event schema validates slice totals and unique identities, but
      // FIFO ordering is a domain invariant: a sale cannot skip an older open
      // lot or move to the next lot before exhausting the current one.
      if (validStableAllocations) {
        const fifoLots = [...targetLots.values()].filter((lot) =>
          lot.ticker === ticker && lot.openQuantity > DEFAULT_TOLERANCE
        );
        let fifoIndex = 0;
        for (let index = 0; index < stableAllocations.length; index += 1) {
          const allocation = stableAllocations[index];
          const expectedLot = fifoLots[fifoIndex];
          if (!expectedLot || allocation.lotId !== expectedLot.lotId ||
            (index < stableAllocations.length - 1 &&
              allocation.quantity < expectedLot.openQuantity - DEFAULT_TOLERANCE)) {
            addIssue(event, 'unsupported', 'Sale allocations do not consume the known open acquisition lots in FIFO order.');
            validStableAllocations = false;
            break;
          }
          fifoIndex += 1;
        }
      }
      if (!validStableAllocations) continue;

      for (const allocation of stableAllocations) {
        const lot = targetLots.get(allocation.lotId!)!;
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
      saleCollection.push({
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
    } else if ((event.type === 'portfolio.reconciliation' || event.type === 'corporate-action') &&
      event.cashHoldingQuantityDelta !== undefined &&
      Math.abs(event.cashHoldingQuantityDelta) > DEFAULT_TOLERANCE) {
      addIssue(event, 'incomplete', 'Cash-holding quantity changed without exact acquisition-lot or disposal allocations; cost basis was not inferred.');
    } else if (event.type === 'correction' &&
      ((event.positionQuantityDelta !== undefined && Math.abs(event.positionQuantityDelta) > DEFAULT_TOLERANCE) ||
        (event.cashHoldingQuantityDelta !== undefined && Math.abs(event.cashHoldingQuantityDelta) > DEFAULT_TOLERANCE))) {
      addIssue(event, 'unsupported', 'Trade or cash-holding lot quantity corrections are not supported by the current reversal contract.');
    } else if (event.type === 'history.correction') {
      addIssue(event, 'incomplete', 'Closed-history correction has no linked lot-level correction projection.');
    }
  }

  const openLots = [...lots.values()].filter((lot) => lot.openQuantity > DEFAULT_TOLERANCE);
  const cashHoldingOpenLots = [...cashLots.values()].filter((lot) => lot.openQuantity > DEFAULT_TOLERANCE);
  const detachLots = (items: PortfolioLotReplayOpenLot[]) => items.map((lot) => Object.freeze({ ...lot }));
  const detachSales = (items: PortfolioLotReplaySale[]) => items.map((sale) => Object.freeze({
    ...sale,
    allocations: Object.freeze(sale.allocations.map((allocation) => Object.freeze({ ...allocation }))) as unknown as PortfolioTransactionLotAllocation[]
  }));
  return {
    status: summarizeStatus(issues),
    openLots: detachLots(openLots),
    sales: detachSales(sales),
    cashHoldingOpenLots: detachLots(cashHoldingOpenLots),
    cashHoldingSales: detachSales(cashHoldingSales),
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
    cashHoldings?: readonly Pick<CashStockHolding, 'ticker' | 'shares' | 'lots'>[];
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
    if (canonicalLot.tranche.date && lot.acquisitionDate !== null) {
      if (canonicalLot.tranche.date !== lot.acquisitionDate) {
        discrepancies.push({
          field: 'open-lot-acquisition-date',
          identity: lot.lotId,
          replayed: lot.acquisitionDate,
          canonical: canonicalLot.tranche.date
        });
      }
    } else {
      issues.push({ disposition: 'incomplete', reason: `Canonical lot ${lot.lotId} cannot be checked against a source acquisition date.` });
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

  const replayCashLots = new Map(replay.cashHoldingOpenLots.map((lot) => [lot.lotId, lot]));
  const canonicalCashLots = new Map<string, { ticker: string; lot: NonNullable<CashStockHolding['lots']>[number] }>();
  for (const holding of canonical.cashHoldings || []) {
    const ticker = cleanTicker(holding.ticker);
    const holdingShares = optionalNumber(holding.shares);
    if (holdingShares === null || holdingShares <= tolerance) continue;
    const rawLots = Array.isArray(holding.lots) ? holding.lots : [];
    if (!rawLots.length) {
      issues.push({
        disposition: 'incomplete',
        reason: `Canonical cash holding ${ticker} has no app-recorded acquisition lots; broker average prices were not converted into synthetic lots.`
      });
      continue;
    }
    let lotQuantity = 0;
    for (const lot of rawLots) {
      if (!lot || typeof lot !== 'object' || typeof lot.lotId !== 'string' || !lot.lotId.trim() ||
        !Number.isFinite(lot.qty) || lot.qty <= 0 ||
        !Number.isFinite(lot.price) || lot.price <= 0 ||
        typeof lot.date !== 'string' || !lot.date.trim() ||
        !Number.isFinite(lot.acquiredAt) || lot.acquiredAt <= 0 ||
        !Number.isFinite(lot.buyCommission) || lot.buyCommission < 0) {
        issues.push({ disposition: 'incomplete', reason: `Canonical cash holding ${ticker} contains an invalid or incomplete acquisition lot.` });
        continue;
      }
      lotQuantity += lot.qty;
      if (canonicalCashLots.has(lot.lotId) || canonicalById.has(lot.lotId)) {
        issues.push({ disposition: 'unsupported', reason: `Canonical portfolio reuses acquisition lot ID ${lot.lotId}.` });
        continue;
      }
      canonicalCashLots.set(lot.lotId, { ticker, lot });
    }
    if (Math.abs(lotQuantity - holdingShares) > tolerance) {
      issues.push({
        disposition: 'incomplete',
        reason: `Canonical cash holding ${ticker} has ${holdingShares} shares but only ${lotQuantity} shares with app-recorded cost basis; remaining quantity is unmapped.`
      });
    }
  }

  for (const [lotId, replayedLot] of replayCashLots) {
    const canonicalLot = canonicalCashLots.get(lotId);
    if (!canonicalLot) {
      discrepancies.push({ field: 'cash-holding-lot-missing', identity: lotId, replayed: replayedLot.openQuantity, canonical: 0 });
      continue;
    }
    if (canonicalLot.ticker !== replayedLot.ticker) {
      discrepancies.push({ field: 'cash-holding-lot-cost', identity: lotId, replayed: replayedLot.ticker, canonical: canonicalLot.ticker });
      continue;
    }
    addDiscrepancy(discrepancies, 'cash-holding-lot-quantity', lotId, replayedLot.openQuantity, canonicalLot.lot.qty, tolerance);
    addDiscrepancy(discrepancies, 'cash-holding-lot-cost', lotId, replayedLot.acquisitionPrice, canonicalLot.lot.price, tolerance);
    if (replayedLot.acquisitionDate !== canonicalLot.lot.date) {
      discrepancies.push({
        field: 'cash-holding-lot-acquisition-date',
        identity: lotId,
        replayed: replayedLot.acquisitionDate || 'unknown',
        canonical: canonicalLot.lot.date
      });
    }
    addDiscrepancy(
      discrepancies,
      'cash-holding-lot-buy-commission',
      lotId,
      replayedLot.openBuyCommission ?? 'unknown',
      canonicalLot.lot.buyCommission,
      tolerance
    );
  }
  for (const [lotId, canonicalLot] of canonicalCashLots) {
    if (!replayCashLots.has(lotId)) {
      discrepancies.push({ field: 'cash-holding-lot-missing', identity: lotId, replayed: 0, canonical: canonicalLot.lot.qty });
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
