import type { ClosedTradeAllocation, GuestTrancheLedgerRecord } from '../types/portfolio';

export interface ClosedTradeLedgerSourceRow {
  allocationKey: string;
  ticker: string;
  name?: string;
}

export interface ClosedTradeGuestLedgerUpsert {
  guestId: string;
  record: GuestTrancheLedgerRecord;
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

  for (const [allocationKey, allocation] of Object.entries(allocations || {})) {
    const source = sourceByKey.get(allocationKey);
    if (!source) continue;
    const ticker = String(source.ticker || '').trim().toUpperCase().replace(/\.US$/i, '');
    if (!/^[A-Z0-9.^=-]{1,20}$/.test(ticker)) continue;

    const currentGuestId = String(allocation?.guestId || '').trim();
    const currentCashQuantity = Number(allocation?.cashQuantity);
    const hasCurrentAssignment = Boolean(currentGuestId) &&
      Number.isFinite(currentCashQuantity) && currentCashQuantity > 0 && currentCashQuantity <= 1e9;

    const history = new Map<string, { guestId: string; assignedQuantity: number; assignedAt: number }>();
    for (const item of Array.isArray(allocation?.guestAssignments) ? allocation.guestAssignments : []) {
      const guestId = String(item?.guestId || '').trim();
      const quantity = Number(item?.assignedQuantity);
      const assignedAt = Number(item?.assignedAt);
      if (!guestId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1e9) continue;
      history.set(guestId, {
        guestId,
        assignedQuantity: quantity,
        assignedAt: Number.isFinite(assignedAt) && assignedAt > 0 ? assignedAt : updatedAt
      });
    }

    // Migrate rows saved before assignment history was introduced.
    if (hasCurrentAssignment) {
      const previous = history.get(currentGuestId);
      history.set(currentGuestId, {
        guestId: currentGuestId,
        assignedQuantity: currentCashQuantity,
        assignedAt: previous?.assignedAt ||
          (Number.isFinite(Number(allocation.assignedAt)) && Number(allocation.assignedAt) > 0
            ? Number(allocation.assignedAt) : updatedAt)
      });
    }

    const rowKey = stableKey(allocationKey);
    for (const assignment of history.values()) {
      const isCurrent = hasCurrentAssignment && assignment.guestId === currentGuestId;
      const guestKey = stableKey(assignment.guestId);
      result.push({
        guestId: assignment.guestId,
        record: {
          assignmentId: 'closed-trade:' + rowKey + ':' + guestKey,
          trancheId: 'closed-trade:' + rowKey,
          ticker,
          name: String(source.name || ticker).trim().slice(0, 120) || ticker,
          assignedQuantity: isCurrent ? currentCashQuantity : assignment.assignedQuantity,
          openQuantity: 0,
          averagePrice: null,
          marketPrice: null,
          purchasedAt: null,
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
