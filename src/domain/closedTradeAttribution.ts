import type { ActiveTrancheGuestAssignmentDetail, ActiveTrancheMix, ActiveTrancheType } from '../types/portfolio';
import { normalizeActiveTrancheMix } from './freedomPortfolio';

const EPSILON = 1e-8;
const GROUP_BUYS_WITHIN_MS = 5 * 60 * 1000;

export interface ClosedTradeGuestAllocation {
  guestId: string;
  quantity: number;
}

export type ClosedTradeFundingType = ActiveTrancheType | 'unclassified';

export interface ClosedTradeAttribution {
  fundingType: ClosedTradeFundingType;
  guestAllocations: ClosedTradeGuestAllocation[];
  /** Shares whose opening purchase could not be matched to the available history. */
  unmatchedQuantity: number;
}

interface ExecutionLike {
  id?: unknown;
  ticker?: unknown;
  side?: unknown;
  operation?: unknown;
  type?: unknown;
  quantity?: unknown;
  qty?: unknown;
  executedAt?: unknown;
  date?: unknown;
  time?: unknown;
  raw?: Record<string, unknown>;
}

interface AssignmentMetadata {
  fundingType: ActiveTrancheType;
  cashRatio: number;
  guestId: string | null;
  assignedAt: number | null;
  assignedQuantity: number | null;
  assignmentKey: string;
}

interface BuyLot<T extends ExecutionLike> {
  trade: T;
  id: string;
  ticker: string;
  quantity: number;
  purchasedAt: number | null;
  rowIndex: number;
  metadata?: AssignmentMetadata;
}

interface NormalizedEvent<T extends ExecutionLike> {
  trade: T;
  rowIndex: number;
  ticker: string;
  side: 'buy' | 'sell';
  quantity: number;
  at: number | null;
}

function firstPositiveMagnitude(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed !== 0) return Math.abs(parsed);
  }
  return 0;
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

function normalizeTicker(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/\.US$/i, '');
}

function resolveSide(trade: ExecutionLike): 'buy' | 'sell' | null {
  const raw = trade.raw && typeof trade.raw === 'object' ? trade.raw : {};
  return [
    trade.side, trade.operation, trade.type,
    raw.side, raw.operation, raw.oper, raw.buy_sell, raw.type
  ].map(tradeSide).find((value): value is 'buy' | 'sell' => value !== null) || null;
}

function resolveTimestamp(trade: ExecutionLike): number | null {
  const raw = trade.raw && typeof trade.raw === 'object' ? trade.raw : {};
  for (const value of [trade.executedAt, trade.date, trade.time, raw.date, raw.time, raw.datetime, raw.exec_time]) {
    const parsed = operationTimestamp(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function resolveQuantity(trade: ExecutionLike): number {
  const raw = trade.raw && typeof trade.raw === 'object' ? trade.raw : {};
  return firstPositiveMagnitude(trade.quantity, trade.qty, raw.q, raw.quantity, raw.qty);
}

function comparePurchaseLots<T extends ExecutionLike>(a: BuyLot<T>, b: BuyLot<T>): number {
  return a.ticker.localeCompare(b.ticker) ||
    (a.purchasedAt ?? Number.MAX_SAFE_INTEGER) - (b.purchasedAt ?? Number.MAX_SAFE_INTEGER) ||
    a.rowIndex - b.rowIndex;
}

function validTrancheType(value: unknown): value is ActiveTrancheType {
  return value === 'cash' || value === 'margin' || value === 'mix';
}

/**
 * Reconstruct the financing and guest allocation that applied to each sale.
 *
 * FIFO matching and the five-minute grouping deliberately mirror
 * getActiveTranchesFromTrades. Group metadata is copied to every open lot before
 * each sale, so an assignment remains attached when a partial sale exhausts the
 * first buy and the active tranche ID consequently advances to the next buy.
 */
export function attributeClosedTradeExecutions<T extends ExecutionLike>(
  executions: readonly T[],
  input: {
    trancheTypes?: Record<string, ActiveTrancheType>;
    trancheMixes?: Record<string, ActiveTrancheMix>;
    guestAssignments?: Record<string, string>;
    guestAssignmentDetails?: Record<string, ActiveTrancheGuestAssignmentDetail>;
  } = {}
): Map<T, ClosedTradeAttribution> {
  const types = input.trancheTypes || {};
  const mixes = input.trancheMixes || {};
  const assignments = input.guestAssignments || {};
  const assignmentDetails = input.guestAssignmentDetails || {};
  const events: NormalizedEvent<T>[] = (executions || []).map((trade, rowIndex) => {
    const raw = trade?.raw && typeof trade.raw === 'object' ? trade.raw : {};
    const ticker = normalizeTicker(trade?.ticker || raw.instr_nm || raw.i || raw.ticker || raw.symbol);
    const side = resolveSide(trade);
    return {
      trade,
      rowIndex,
      ticker,
      side: side || 'buy',
      quantity: resolveQuantity(trade),
      at: resolveTimestamp(trade)
    };
  }).filter((event) => event.ticker && resolveSide(event.trade) !== null && event.quantity > 0)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.rowIndex - b.rowIndex);

  const lots: BuyLot<T>[] = [];
  const attributions = new Map<T, ClosedTradeAttribution>();
  const guestQuantitySold = new Map<string, number>();

  for (const event of events) {
    if (event.side === 'buy') {
      lots.push({
        trade: event.trade,
        id: String(event.trade.id ?? event.rowIndex),
        ticker: event.ticker,
        quantity: event.quantity,
        purchasedAt: event.at,
        rowIndex: event.rowIndex
      });
      continue;
    }

    const openLots = lots.filter((lot) => lot.quantity > EPSILON).sort(comparePurchaseLots);
    const groups: Array<{ ticker: string; lots: BuyLot<T>[]; lastPurchasedAt: number | null }> = [];
    for (const lot of openLots) {
      const previous = groups[groups.length - 1];
      const withinWindow = previous &&
        previous.ticker === lot.ticker &&
        previous.lastPurchasedAt !== null &&
        lot.purchasedAt !== null &&
        lot.purchasedAt - previous.lastPurchasedAt <= GROUP_BUYS_WITHIN_MS;
      if (!withinWindow) {
        groups.push({ ticker: lot.ticker, lots: [lot], lastPurchasedAt: lot.purchasedAt });
      } else {
        previous.lots.push(lot);
        previous.lastPurchasedAt = lot.purchasedAt;
      }
    }

    // Resolve operation metadata from the ID that is active immediately before
    // this sale. Persist it on all member lots for later partial-sale executions.
    for (const group of groups) {
      const firstLot = group.lots[0];
      const groupId = group.ticker + ':' + (firstLot.purchasedAt ?? 'undated') + ':' + firstLot.id;
      const inherited = group.lots.find((lot) => lot.metadata)?.metadata;
      const totalOpenQuantity = group.lots.reduce((sum, lot) => sum + lot.quantity, 0);
      const fundingType = validTrancheType(types[groupId])
        ? types[groupId]
        : inherited?.fundingType || (validTrancheType(types[group.ticker]) ? types[group.ticker] : 'cash');
      const mix = mixes[groupId]
        ? mixes[groupId]
        : inherited?.fundingType === 'mix'
          ? { cash: inherited.cashRatio, margin: 1 - inherited.cashRatio }
          : mixes[group.ticker];
      const normalizedMix = normalizeActiveTrancheMix(totalOpenQuantity, mix);
      const cashRatio = fundingType === 'margin'
        ? 0
        : fundingType === 'cash'
          ? 1
          : totalOpenQuantity > 0 ? normalizedMix.cash / totalOpenQuantity : 0;

      const currentGuestId = String(assignments[groupId] || '').trim();
      const inheritedGuestId = inherited?.guestId || null;
      const guestId = currentGuestId || inheritedGuestId;
      const currentDetail = guestId && currentGuestId
        ? assignmentDetails[groupId]
        : undefined;
      const detail = currentDetail?.guestId === guestId ? currentDetail : undefined;
      const inheritedAssignment = inheritedGuestId === guestId ? inherited : undefined;
      const metadata: AssignmentMetadata = {
        fundingType,
        cashRatio,
        guestId: guestId || null,
        assignedAt: detail && Number.isFinite(Number(detail.assignedAt))
          ? Number(detail.assignedAt)
          : inheritedAssignment?.assignedAt ?? null,
        assignedQuantity: detail && Number.isFinite(Number(detail.assignedQuantity))
          ? Math.max(0, Number(detail.assignedQuantity))
          : inheritedAssignment?.assignedQuantity ?? null,
        assignmentKey: detail?.assignmentId || inheritedAssignment?.assignmentKey || groupId
      };
      group.lots.forEach((lot) => { lot.metadata = metadata; });
    }

    let remainingToSell = event.quantity;
    const guestAllocations = new Map<string, number>();
    const fundingTypes = new Set<ActiveTrancheType>();
    const eligibleLots = lots.filter((lot) =>
      lot.ticker === event.ticker &&
      lot.quantity > EPSILON &&
      (event.at === null || lot.purchasedAt === null || lot.purchasedAt <= event.at)
    ).sort((a, b) =>
      (a.purchasedAt ?? 0) - (b.purchasedAt ?? 0) || a.rowIndex - b.rowIndex
    );

    for (const lot of eligibleLots) {
      if (remainingToSell <= EPSILON) break;
      const sold = Math.min(lot.quantity, remainingToSell);
      const metadata = lot.metadata;
      const fundingType = metadata?.fundingType || 'cash';
      fundingTypes.add(fundingType);

      const assignmentIsActive = Boolean(metadata?.guestId) &&
        (metadata?.assignedAt === null || event.at === null || event.at >= metadata!.assignedAt);
      if (assignmentIsActive && metadata?.guestId) {
        const assignmentKey = metadata.assignmentKey;
        const alreadySold = guestQuantitySold.get(assignmentKey) || 0;
        const remainingAssigned = metadata.assignedQuantity === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, metadata.assignedQuantity - alreadySold);
        const guestQuantity = Math.min(remainingAssigned, sold * metadata.cashRatio);
        if (guestQuantity > EPSILON) {
          guestAllocations.set(
            metadata.guestId,
            (guestAllocations.get(metadata.guestId) || 0) + guestQuantity
          );
          guestQuantitySold.set(assignmentKey, alreadySold + guestQuantity);
        }
      }

      lot.quantity -= sold;
      remainingToSell -= sold;
    }

    const uniqueFundingTypes = new Set(fundingTypes);
    const fundingType: ClosedTradeFundingType = uniqueFundingTypes.size === 0
      ? 'unclassified'
      : uniqueFundingTypes.size > 1 || uniqueFundingTypes.has('mix')
        ? 'mix'
        : Array.from(uniqueFundingTypes)[0];
    attributions.set(event.trade, {
      fundingType,
      guestAllocations: Array.from(guestAllocations.entries())
        .filter(([, quantity]) => quantity > EPSILON)
        .map(([guestId, quantity]) => ({ guestId, quantity }))
        .sort((a, b) => a.guestId.localeCompare(b.guestId)),
      unmatchedQuantity: Math.max(0, remainingToSell)
    });
  }

  return attributions;
}
