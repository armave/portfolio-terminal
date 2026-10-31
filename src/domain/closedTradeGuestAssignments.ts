import type { ClosedTradeAllocation, GuestTrancheLedgerRecord } from '../types/portfolio';

interface ClosedTradeGuestMetrics {
  quantity: number;
  averagePrice: number | null;
  purchasedAt: number | null;
  assignedAt?: number | null;
}

export interface ClosedTradeOperationDateSource {
  /** The same close-date precedence used by the Trades / Closed History table. */
  exitDate?: unknown;
  sellDate?: unknown;
  closedAt?: unknown;
  date?: unknown;
}

/** Match ClosedHistoryDesk's canonical Trade operation-date precedence. */
export function resolveClosedTradeOperationDate(
  trade: ClosedTradeOperationDateSource
): number | string | null {
  // Match the display's truthy precedence so an empty exitDate does not
  // hide a valid sellDate or closedAt value.
  const value = trade.exitDate || trade.sellDate || trade.closedAt || trade.date;
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

export interface ClosedTradeLedgerSourceRow {
  allocationKey: string;
  ticker: string;
  name?: string;
  quantity?: number;
  averagePrice?: number | null;
  purchasedAt?: number | string | null;
  operationAt?: number | string | null;
  /** Gross value of the full sell operation, to be apportioned across guest shares. */
  value?: number | null;
  netProfit?: number | null;
  guestMetrics?: Record<string, ClosedTradeGuestMetrics>;
}

export interface ClosedTradeGuestLedgerUpsert {
  guestId: string;
  record: GuestTrancheLedgerRecord;
}

function parseTrancheTimestamp(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 20000 && value < 100000) {
      return Date.UTC(1899, 11, 30) + value * 86400000;
    }
    return value > 0 ? (value < 1e11 ? value * 1000 : value) : null;
  }
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text);
    if (numeric > 20000 && numeric < 100000) {
      return Date.UTC(1899, 11, 30) + numeric * 86400000;
    }
    if (numeric > 0) return numeric < 1e11 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableKey(value: string): string {
  // Two independent 32-bit hashes keep opaque row identities short enough for
  // the guest-ledger API while remaining deterministic across browser sessions.
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return (first >>> 0).toString(36) + (second >>> 0).toString(36);
}

/**
 * Convert guest assignments made on closed Trades rows into durable, closed
 * guest-ledger rows. A reassigned/cleared guest remains in history as
 * "unassigned"; only the currently selected guest has a closed assignment.
 */
export function buildClosedTradeGuestLedgerUpserts(
  allocations: Record<string, ClosedTradeAllocation> = {},
  sourceRows: readonly ClosedTradeLedgerSourceRow[] = [],
  updatedAt: number = Date.now()
): ClosedTradeGuestLedgerUpsert[] {
  const sourceByKey = new Map(sourceRows.map((row) => [row.allocationKey, row]));
  const result: ClosedTradeGuestLedgerUpsert[] = [];
  const savedAllocations = allocations || {};
  const allocationKeys = new Set([
    ...Object.keys(savedAllocations),
    // Active-tranche guest assignments are inferred from FIFO sell attribution.
    // They must flow into LOTS even when an admin never edited the closed row.
    ...sourceRows
      .filter((row) => Object.keys(row.guestMetrics || {}).length > 0)
      .map((row) => row.allocationKey)
  ]);

  for (const allocationKey of allocationKeys) {
    const source = sourceByKey.get(allocationKey);
    if (!source) continue;
    const ticker = String(source.ticker || '').trim().toUpperCase().replace(/\\.US$/i, '');
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(ticker)) continue;

    const isAutomaticallyAttributed = !Object.prototype.hasOwnProperty.call(savedAllocations, allocationKey);
    const allocation = savedAllocations[allocationKey];
    const currentGuestId = String(allocation?.guestId || '').trim();
    const sourceQuantity = Number(source.quantity);
    const rawCashQuantity = Number(allocation?.cashQuantity);
    const currentCashQuantity = Number.isFinite(sourceQuantity) && sourceQuantity >= 0 &&
      Number.isFinite(rawCashQuantity)
      ? Math.min(sourceQuantity, rawCashQuantity)
      : rawCashQuantity;
    const hasCurrentAssignment = Boolean(currentGuestId) &&
      Number.isFinite(currentCashQuantity) && currentCashQuantity > 0 && currentCashQuantity <= 1e9;
    const maximumAssignmentQuantity = Number.isFinite(sourceQuantity) && sourceQuantity > 0
      ? sourceQuantity : 1e9;

    const history = new Map<string, { guestId: string; assignedQuantity: number; assignedAt: number }>();
    if (isAutomaticallyAttributed) {
      for (const [guestIdValue, metric] of Object.entries(source.guestMetrics || {})) {
        const guestId = String(guestIdValue || '').trim();
        const quantity = Number(metric?.quantity);
        const assignedAt = Number(metric?.assignedAt);
        if (!guestId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) continue;
        history.set(guestId, {
          guestId,
          assignedQuantity: quantity,
          assignedAt: Number.isFinite(assignedAt) && assignedAt > 0 ? assignedAt : updatedAt
        });
      }
    } else {
      for (const item of Array.isArray(allocation?.guestAssignments) ? allocation.guestAssignments : []) {
        const guestId = String(item?.guestId || '').trim();
        const rawQuantity = Number(item?.assignedQuantity);
        const quantity = Number.isFinite(rawQuantity)
          ? Math.min(maximumAssignmentQuantity, rawQuantity) : rawQuantity;
        const assignedAt = Number(item?.assignedAt);
        if (!guestId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) continue;
        history.set(guestId, {
          guestId,
          assignedQuantity: quantity,
          assignedAt: Number.isFinite(assignedAt) && assignedAt > 0 ? assignedAt : updatedAt
        });
      }
    }

    // Migrate rows saved before assignment history was introduced.
    if (hasCurrentAssignment) {
      const previous = history.get(currentGuestId);
      history.set(currentGuestId, {
        guestId: currentGuestId,
        assignedQuantity: currentCashQuantity,
        assignedAt: previous?.assignedAt ||
          (Number.isFinite(Number(allocation?.assignedAt)) && Number(allocation?.assignedAt) > 0
            ? Number(allocation?.assignedAt) : updatedAt)
      });
    }

    const rowKey = stableKey(allocationKey);
    const sourceQuantity = Number(source.quantity);
    for (const assignment of history.values()) {
      const isCurrent = isAutomaticallyAttributed ||
        (hasCurrentAssignment && assignment.guestId === currentGuestId);
      const guestKey = stableKey(assignment.guestId);
      const guestMetric = source.guestMetrics?.[assignment.guestId];
      const averagePrice = guestMetric
        ? guestMetric.averagePrice
        : source.averagePrice ?? null;
      const purchasedAt = parseTrancheTimestamp(
        guestMetric ? guestMetric.purchasedAt : source.purchasedAt
      );
      // A Trade date must come from its closing operation, never from the
      // source buy date or the time the guest assignment was created.
      const operationAt = parseTrancheTimestamp(source.operationAt);
      const assignedQuantity = isAutomaticallyAttributed
        ? assignment.assignedQuantity
        : isCurrent ? currentCashQuantity : assignment.assignedQuantity;
      const proportion = Number.isFinite(sourceQuantity) && sourceQuantity > 0
        ? Math.min(1, assignedQuantity / sourceQuantity) : null;
      const netProfit = source.netProfit !== null && source.netProfit !== undefined &&
        Number.isFinite(Number(source.netProfit)) && proportion !== null
        ? Number(source.netProfit) * proportion : null;
      const value = source.value !== null && source.value !== undefined &&
        Number.isFinite(Number(source.value)) && Number(source.value) >= 0 && proportion !== null
        ? Number(source.value) * proportion : null;
      result.push({
        guestId: assignment.guestId,
        record: {
          assignmentId: 'closed-trade:' + rowKey + ':' + guestKey,
          trancheId: 'closed-trade:' + rowKey,
          ticker,
          name: String(source.name || ticker).trim().slice(0, 120) || ticker,
          assignedQuantity,
          openQuantity: 0,
          averagePrice: averagePrice !== null && Number.isFinite(Number(averagePrice)) && Number(averagePrice) > 0
            ? Number(averagePrice) : null,
          netProfit,
          marketPrice: null,
          operationAt,
          value,
          purchasedAt,
          assignedAt: assignment.assignedAt,
          updatedAt,
          endedAt: assignment.assignedAt,
          status: isCurrent ? 'closed' : 'unassigned'
        }
      });
    }
  }

  return result.sort((a, b) =>
    a.guestId.localeCompare(b.guestId) ||
    a.record.assignedAt - b.record.assignedAt ||
    a.record.assignmentId.localeCompare(b.record.assignmentId)
  );
}
