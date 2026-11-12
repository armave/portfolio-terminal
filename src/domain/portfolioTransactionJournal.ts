import {
  PORTFOLIO_TRANSACTION_EVENT_SCHEMA_VERSION,
  type PortfolioTransactionActorType,
  type PortfolioTransactionContext,
  type PortfolioTransactionDraft,
  type PortfolioTransactionEvent,
  type PortfolioTransactionEventType,
  type PortfolioTransactionLotAllocation
} from '../types/portfolioTransaction';

const EVENT_TYPES = new Set<PortfolioTransactionEventType>([
  'trade.buy',
  'trade.sell',
  'cash-holding.buy',
  'cash-holding.sell',
  'cash-holding.adjustment',
  'cash.deposit',
  'cash.withdrawal',
  'broker.execution',
  'portfolio.reconciliation',
  'position.adjustment',
  'history.correction',
  'portfolio.reset',
  'cash.adjustment',
  'cash.transfer',
  'dividend',
  'fee',
  'margin.adjustment',
  'margin.interest',
  'corporate-action',
  'correction'
]);
const ACTOR_TYPES = new Set<PortfolioTransactionActorType>([
  'user',
  'system',
  'broker',
  'ai',
  'import',
  'unknown'
]);
let fallbackIdSequence = 0;

export interface AppendPortfolioTransactionResult {
  events: PortfolioTransactionEvent[];
  appended: boolean;
  duplicate: boolean;
}

export function normalizePortfolioTransactionIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new TypeError('Transaction idempotency key must be a string.');
  const key = value.trim();
  if (!key || key.length > 200) {
    throw new RangeError('Transaction idempotency key must contain between 1 and 200 characters.');
  }
  return key;
}

function createEventId(): string {
  try {
    const randomUUID = globalThis.crypto?.randomUUID;
    if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  } catch {
    // Use the non-secret fallback below in restricted browser/test environments.
  }
  fallbackIdSequence += 1;
  return `tx-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteOptional(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

export function isPortfolioTransactionEvent(value: unknown): value is PortfolioTransactionEvent {
  if (!isPlainRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id.trim()) return false;
  if (value.schemaVersion !== PORTFOLIO_TRANSACTION_EVENT_SCHEMA_VERSION) return false;
  if (typeof value.type !== 'string' || !EVENT_TYPES.has(value.type as PortfolioTransactionEventType)) return false;
  if (!isPlainRecord(value.actor) ||
    typeof value.actor.type !== 'string' ||
    !ACTOR_TYPES.has(value.actor.type as PortfolioTransactionActorType)) return false;
  if (value.actor.id !== undefined &&
    (typeof value.actor.id !== 'string' || !value.actor.id.trim() || value.actor.id.length > 128)) return false;
  if (typeof value.source !== 'string' || !value.source.trim() || value.source.length > 80) return false;
  if (typeof value.effectiveAt !== 'number' || !Number.isFinite(value.effectiveAt) || value.effectiveAt <= 0) return false;
  if (typeof value.recordedAt !== 'number' || !Number.isFinite(value.recordedAt) || value.recordedAt <= 0) return false;
  if (value.idempotencyKey !== undefined &&
    (typeof value.idempotencyKey !== 'string' || !value.idempotencyKey.trim() || value.idempotencyKey.length > 200)) return false;
  if (value.requestFingerprint !== undefined &&
    (typeof value.requestFingerprint !== 'string' || !value.requestFingerprint.trim() || value.requestFingerprint.length > 512)) return false;
  if (value.ticker !== undefined && (typeof value.ticker !== 'string' || !value.ticker.trim())) return false;
  if (value.side !== undefined && (typeof value.side !== 'string' || !value.side.trim())) return false;
  if (value.feeCurrency !== undefined && !/^[A-Z]{3}$/.test(String(value.feeCurrency))) return false;
  if (value.currency !== undefined && !/^[A-Z]{3}$/.test(String(value.currency))) return false;
  if (![
    value.quantity,
    value.unitPrice,
    value.grossAmount,
    value.fees,
    value.externalCashFlowAmount,
    value.positionQuantityDelta,
    value.cashHoldingQuantityDelta,
    value.financingCost,
    value.realizedMarginChargeDelta,
    value.cashDelta,
    value.marginDebtDelta,
    value.netAmount,
    value.realizedPnl
  ].every(isFiniteOptional)) return false;
  if (value.quantity !== undefined && Number(value.quantity) <= 0) return false;
  if (value.fees !== undefined && Number(value.fees) < 0) return false;
  if (value.financingCost !== undefined && Number(value.financingCost) < 0) return false;
  if (value.externalReferenceId !== undefined && (typeof value.externalReferenceId !== 'string' || !value.externalReferenceId.trim())) return false;
  if (value.externalOrderReferenceId !== undefined && (typeof value.externalOrderReferenceId !== 'string' || !value.externalOrderReferenceId.trim())) return false;
  if (value.lotId !== undefined &&
    (typeof value.lotId !== 'string' || !value.lotId.trim() || value.lotId.length > 200)) return false;
  if (value.acquisitionDate !== undefined &&
    ((value.type !== 'trade.buy' && value.type !== 'cash-holding.buy') ||
      typeof value.acquisitionDate !== 'string' || !value.acquisitionDate.trim())) return false;
  if (value.lotId !== undefined) {
    const isCashHoldingBuy = value.type === 'cash-holding.buy';
    if ((!isCashHoldingBuy && value.type !== 'trade.buy') || !value.ticker ||
      typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0 ||
      typeof value.unitPrice !== 'number' || !Number.isFinite(value.unitPrice) || value.unitPrice <= 0 ||
      typeof value.grossAmount !== 'number' || !Number.isFinite(value.grossAmount) || value.grossAmount < 0 ||
      (isCashHoldingBuy
        ? typeof value.cashHoldingQuantityDelta !== 'number' || !Number.isFinite(value.cashHoldingQuantityDelta)
        : typeof value.positionQuantityDelta !== 'number' || !Number.isFinite(value.positionQuantityDelta)) ||
      typeof value.fees !== 'number' || !Number.isFinite(value.fees) || value.fees < 0) return false;
    const closeEnough = (left: number, right: number) => Math.abs(left - right) <= 0.011;
    const quantityDelta = isCashHoldingBuy
      ? value.cashHoldingQuantityDelta as number
      : value.positionQuantityDelta as number;
    if (!closeEnough(value.quantity * value.unitPrice, value.grossAmount) ||
      !closeEnough(quantityDelta, value.quantity)) return false;
  }
  if (value.lotAllocations !== undefined) {
    if ((value.type !== 'trade.sell' && value.type !== 'cash-holding.sell') || !Array.isArray(value.lotAllocations) ||
      value.lotAllocations.length === 0 || value.lotAllocations.length > 500 ||
      !value.ticker ||
      typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0 ||
      typeof value.unitPrice !== 'number' || !Number.isFinite(value.unitPrice) || value.unitPrice <= 0 ||
      typeof value.grossAmount !== 'number' || !Number.isFinite(value.grossAmount) || value.grossAmount < 0 ||
      (value.type === 'cash-holding.sell'
        ? typeof value.cashHoldingQuantityDelta !== 'number' || !Number.isFinite(value.cashHoldingQuantityDelta)
        : typeof value.positionQuantityDelta !== 'number' || !Number.isFinite(value.positionQuantityDelta)) ||
      typeof value.fees !== 'number' || !Number.isFinite(value.fees) || value.fees < 0 ||
      typeof value.financingCost !== 'number' || !Number.isFinite(value.financingCost) || value.financingCost < 0 ||
      typeof value.realizedPnl !== 'number' || !Number.isFinite(value.realizedPnl)) return false;
    const closeEnough = (left: number, right: number) => Math.abs(left - right) <= 0.011;
    let allocatedQuantity = 0;
    let allocatedFees = 0;
    let allocatedFinancing = 0;
    let allocatedPnl = 0;
    let allocatedGross = 0;
    const stableLotIds = new Set<string>();
    for (const rawAllocation of value.lotAllocations) {
      if (!isPlainRecord(rawAllocation)) return false;
      const allocation = rawAllocation;
      if (allocation.identity !== 'stable' && allocation.identity !== 'legacy-unmapped') return false;
      if (value.type === 'cash-holding.sell' && allocation.identity !== 'stable') return false;
      if (allocation.identity === 'stable') {
        if (typeof allocation.lotId !== 'string' || !allocation.lotId.trim() || allocation.lotId.length > 200 ||
          stableLotIds.has(allocation.lotId)) return false;
        stableLotIds.add(allocation.lotId);
      }
      if (allocation.identity === 'legacy-unmapped' && allocation.lotId !== undefined) return false;
      if (typeof allocation.quantity !== 'number' || !Number.isFinite(allocation.quantity) || allocation.quantity <= 0) return false;
      if (typeof allocation.acquisitionPrice !== 'number' || !Number.isFinite(allocation.acquisitionPrice) || allocation.acquisitionPrice <= 0) return false;
      if (allocation.acquisitionDate !== undefined &&
        (typeof allocation.acquisitionDate !== 'string' || !allocation.acquisitionDate.trim())) return false;
      if (allocation.acquiredAt !== undefined &&
        (typeof allocation.acquiredAt !== 'number' || !Number.isFinite(allocation.acquiredAt) || allocation.acquiredAt <= 0)) return false;
      if (typeof allocation.buyCommissionAllocated !== 'number' ||
        !Number.isFinite(allocation.buyCommissionAllocated) || allocation.buyCommissionAllocated < 0) return false;
      if (typeof allocation.sellPrice !== 'number' || !Number.isFinite(allocation.sellPrice) || allocation.sellPrice <= 0 ||
        !closeEnough(allocation.sellPrice, value.unitPrice)) return false;
      if (typeof allocation.sellCommissionAllocated !== 'number' ||
        !Number.isFinite(allocation.sellCommissionAllocated) || allocation.sellCommissionAllocated < 0) return false;
      if (typeof allocation.financingCostAllocated !== 'number' ||
        !Number.isFinite(allocation.financingCostAllocated) || allocation.financingCostAllocated < 0) return false;
      if (typeof allocation.realizedPnl !== 'number' || !Number.isFinite(allocation.realizedPnl)) return false;
      allocatedQuantity += allocation.quantity;
      allocatedGross += allocation.quantity * allocation.sellPrice;
      allocatedFees += allocation.buyCommissionAllocated + allocation.sellCommissionAllocated;
      allocatedFinancing += allocation.financingCostAllocated;
      allocatedPnl += allocation.realizedPnl;
    }
    if (value.quantity === undefined || !closeEnough(allocatedQuantity, value.quantity)) return false;
    const saleQuantityDelta = value.type === 'cash-holding.sell'
      ? value.cashHoldingQuantityDelta as number
      : value.positionQuantityDelta as number;
    if (!closeEnough(saleQuantityDelta, -value.quantity)) return false;
    if (!closeEnough(allocatedGross, value.grossAmount)) return false;
    if (value.fees === undefined || !closeEnough(allocatedFees, value.fees)) return false;
    if (value.financingCost === undefined || !closeEnough(allocatedFinancing, value.financingCost)) return false;
    if (value.realizedPnl === undefined || !closeEnough(allocatedPnl, value.realizedPnl)) return false;
  }
  if (value.relatedEventId !== undefined && typeof value.relatedEventId !== 'string') return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  return true;
}

export function isPortfolioTransactionEventList(value: unknown): value is PortfolioTransactionEvent[] {
  return Array.isArray(value) && value.every(isPortfolioTransactionEvent);
}

/** Return a detached, deeply frozen journal list for safe exposure through getState(). */
export function freezePortfolioTransactionEventList(
  events: readonly unknown[]
): PortfolioTransactionEvent[] {
  if (!isPortfolioTransactionEventList(events)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }
  return Object.freeze(events.map((event) => Object.freeze({
    ...event,
    actor: Object.freeze({ ...event.actor }),
    ...(event.lotAllocations
      ? { lotAllocations: Object.freeze(event.lotAllocations.map((allocation) => Object.freeze({ ...allocation }))) as unknown as PortfolioTransactionLotAllocation[] }
      : {})
  }))) as unknown as PortfolioTransactionEvent[];
}

export function hasPortfolioTransactionIdempotencyKey(
  events: readonly unknown[],
  idempotencyKey: string
): boolean {
  return events.some((event) =>
    isPortfolioTransactionEvent(event) && event.idempotencyKey === idempotencyKey
  );
}

export function createPortfolioTransactionEvent(
  draft: PortfolioTransactionDraft,
  context: PortfolioTransactionContext = {},
  recordedAt = context.recordedAt ?? Date.now()
): PortfolioTransactionEvent {
  const idempotencyKey = normalizePortfolioTransactionIdempotencyKey(context.idempotencyKey);
  const actorType = context.actor?.type ?? 'user';
  const actorId = context.actor?.id?.trim();
  const source = (context.source ?? 'manual').trim();
  const effectiveAt = context.effectiveAt ?? draft.effectiveAt;

  const event: PortfolioTransactionEvent = {
    id: context.eventId?.trim() || createEventId(),
    schemaVersion: PORTFOLIO_TRANSACTION_EVENT_SCHEMA_VERSION,
    type: draft.type,
    actor: {
      type: actorType,
      ...(actorId ? { id: actorId } : {})
    },
    source,
    effectiveAt,
    recordedAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(context.requestFingerprint ? { requestFingerprint: context.requestFingerprint } : {}),
    ...(draft.lotId ? { lotId: draft.lotId.trim() } : {}),
    ...(draft.acquisitionDate ? { acquisitionDate: draft.acquisitionDate.trim() } : {}),
    ...(draft.lotAllocations ? { lotAllocations: draft.lotAllocations.map((allocation) => ({ ...allocation })) } : {}),
    ...(draft.ticker ? { ticker: draft.ticker.trim().toUpperCase() } : {}),
    ...(draft.currency ? { currency: draft.currency.trim().toUpperCase() } : {}),
    ...(draft.side ? { side: draft.side.trim().toUpperCase() } : {}),
    ...(draft.feeCurrency ? { feeCurrency: draft.feeCurrency.trim().toUpperCase() } : {}),
    ...(draft.quantity !== undefined ? { quantity: draft.quantity } : {}),
    ...(draft.unitPrice !== undefined ? { unitPrice: draft.unitPrice } : {}),
    ...(draft.grossAmount !== undefined ? { grossAmount: draft.grossAmount } : {}),
    ...(draft.fees !== undefined ? { fees: draft.fees } : {}),
    ...(draft.externalCashFlowAmount !== undefined ? { externalCashFlowAmount: draft.externalCashFlowAmount } : {}),
    ...(draft.externalReferenceId ? { externalReferenceId: draft.externalReferenceId } : {}),
    ...(draft.externalOrderReferenceId ? { externalOrderReferenceId: draft.externalOrderReferenceId } : {}),
    ...(draft.positionQuantityDelta !== undefined ? { positionQuantityDelta: draft.positionQuantityDelta } : {}),
    ...(draft.cashHoldingQuantityDelta !== undefined ? { cashHoldingQuantityDelta: draft.cashHoldingQuantityDelta } : {}),
    ...(draft.financingCost !== undefined ? { financingCost: draft.financingCost } : {}),
    ...(draft.realizedMarginChargeDelta !== undefined ? { realizedMarginChargeDelta: draft.realizedMarginChargeDelta } : {}),
    ...(draft.cashDelta !== undefined ? { cashDelta: draft.cashDelta } : {}),
    ...(draft.marginDebtDelta !== undefined ? { marginDebtDelta: draft.marginDebtDelta } : {}),
    ...(draft.netAmount !== undefined ? { netAmount: draft.netAmount } : {}),
    ...(draft.realizedPnl !== undefined ? { realizedPnl: draft.realizedPnl } : {}),
    ...(draft.relatedEventId ? { relatedEventId: draft.relatedEventId } : {}),
    ...(draft.note ? { note: draft.note } : {})
  };

  if (!isPortfolioTransactionEvent(event)) {
    throw new TypeError('Portfolio transaction event is invalid.');
  }
  return event;
}

/**
 * Append one immutable event to the journal. A matching idempotency key is a
 * successful no-op; existing events and the input array are never modified.
 */
function portfolioTransactionCommandFingerprint(event: PortfolioTransactionEvent): string {
  // Do not include generated event IDs or recordedAt: a retry is a new
  // envelope for the same command. Include every financial/business field so
  // callers that omit an explicit requestFingerprint still cannot reuse a key
  // for a different command and accidentally suppress a real mutation.
  return JSON.stringify({
    type: event.type,
    actor: event.actor,
    source: event.source,
    lotId: event.lotId,
    acquisitionDate: event.acquisitionDate,
    lotAllocations: event.lotAllocations,
    effectiveAt: event.effectiveAt,
    ticker: event.ticker,
    currency: event.currency,
    side: event.side,
    feeCurrency: event.feeCurrency,
    quantity: event.quantity,
    unitPrice: event.unitPrice,
    grossAmount: event.grossAmount,
    fees: event.fees,
    externalCashFlowAmount: event.externalCashFlowAmount,
    externalReferenceId: event.externalReferenceId,
    externalOrderReferenceId: event.externalOrderReferenceId,
    positionQuantityDelta: event.positionQuantityDelta,
    cashHoldingQuantityDelta: event.cashHoldingQuantityDelta,
    financingCost: event.financingCost,
    realizedMarginChargeDelta: event.realizedMarginChargeDelta,
    cashDelta: event.cashDelta,
    marginDebtDelta: event.marginDebtDelta,
    netAmount: event.netAmount,
    realizedPnl: event.realizedPnl,
    relatedEventId: event.relatedEventId,
    note: event.note
  });
}

export function appendPortfolioTransactionEvent(
  current: readonly PortfolioTransactionEvent[],
  event: PortfolioTransactionEvent
): AppendPortfolioTransactionResult {
  if (!isPortfolioTransactionEvent(event)) {
    throw new TypeError('Portfolio transaction event is invalid.');
  }
  if (event.idempotencyKey) {
    const duplicate = current.find((existing) =>
      isPortfolioTransactionEvent(existing) && existing.idempotencyKey === event.idempotencyKey
    );
    if (duplicate) {
      const hasExplicitFingerprint = duplicate.requestFingerprint !== undefined || event.requestFingerprint !== undefined;
      const sameCommand = hasExplicitFingerprint
        ? duplicate.requestFingerprint === event.requestFingerprint
        : portfolioTransactionCommandFingerprint(duplicate) === portfolioTransactionCommandFingerprint(event);
      if (duplicate.type !== event.type || !sameCommand) {
        throw new Error(`Portfolio transaction idempotency key "${event.idempotencyKey}" conflicts with a different command.`);
      }
      return { events: freezePortfolioTransactionEventList(current), appended: false, duplicate: true };
    }
  }
  if (current.some((existing) => isPortfolioTransactionEvent(existing) && existing.id === event.id)) {
    throw new Error(`Portfolio transaction event id "${event.id}" already exists.`);
  }
  return {
    events: freezePortfolioTransactionEventList([...current, event]),
    appended: true,
    duplicate: false
  };
}


/**
 * Merge imported audit history without allowing an older backup to erase
 * already-recorded events. Exact duplicate IDs/keys are ignored; conflicting
 * reuse is rejected so the caller can keep the existing committed snapshot.
 */
export function mergePortfolioTransactionEvents(
  existing: readonly unknown[],
  incoming: readonly unknown[]
): PortfolioTransactionEvent[] {
  if (!isPortfolioTransactionEventList(existing) || !isPortfolioTransactionEventList(incoming)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }

  const merged = [...existing] as PortfolioTransactionEvent[];
  const byId = new Map(merged.map((event) => [event.id, event]));
  const byKey = new Map(
    merged
      .filter((event) => event.idempotencyKey)
      .map((event) => [event.idempotencyKey as string, event])
  );

  for (const event of incoming) {
    const sameId = byId.get(event.id);
    if (sameId) {
      if (JSON.stringify(sameId) !== JSON.stringify(event)) {
        throw new Error(`Imported transaction event ID "${event.id}" conflicts with existing history.`);
      }
      continue;
    }

    if (event.idempotencyKey) {
      const sameKey = byKey.get(event.idempotencyKey);
      if (sameKey) {
        if (!event.requestFingerprint ||
          sameKey.requestFingerprint !== event.requestFingerprint ||
          sameKey.type !== event.type) {
          throw new Error(`Imported transaction idempotency key "${event.idempotencyKey}" conflicts with existing history.`);
        }
        continue;
      }
    }

    merged.push(Object.freeze({
      ...event,
      actor: Object.freeze({ ...event.actor })
    }));
    byId.set(event.id, event);
    if (event.idempotencyKey) byKey.set(event.idempotencyKey, event);
  }

  // A backup can contain earlier events than the current local snapshot.
  // Restore recorded-time order so resets and later commands replay after the
  // history they actually followed. Native sort is stable for equal timestamps.
  merged.sort((left, right) => left.recordedAt - right.recordedAt);
  return freezePortfolioTransactionEventList(merged);
}

export interface PortfolioTransactionReplayState {
  positions: Record<string, number>;
  cashHoldings: Record<string, number>;
  freeCash: number;
  marginDebt: number;
  realizedMarginCharged: number;
}
export interface PortfolioTransactionParityResult {
  matches: boolean;
  discrepancies: Array<{
    field: 'position' | 'cash-holding' | 'free-cash' | 'margin-debt' | 'realized-margin-charged';
    ticker?: string;
    replayed: number;
    canonical: number;
    delta: number;
  }>;
}

export function replayPortfolioTransactionJournal(
  events: readonly PortfolioTransactionEvent[]
): PortfolioTransactionReplayState {
  if (!isPortfolioTransactionEventList(events)) throw new TypeError('Portfolio transaction event history is malformed.');
  const out: PortfolioTransactionReplayState = {
    positions: {}, cashHoldings: {}, freeCash: 0, marginDebt: 0, realizedMarginCharged: 0
  };
  const add = (map: Record<string, number>, ticker: string, delta: number) => {
    if (!delta) return;
    const next = (map[ticker] || 0) + delta;
    if (Math.abs(next) < 1e-8) delete map[ticker];
    else map[ticker] = next;
  };
  for (const e of events) {
    if (e.type === 'portfolio.reset') {
      out.positions = {};
      out.cashHoldings = {};
      out.freeCash = out.marginDebt = out.realizedMarginCharged = 0;
      continue;
    }
    const t = e.ticker?.trim().toUpperCase();
    if (t) {
      add(out.positions, t, Number(e.positionQuantityDelta) || 0);
      add(out.cashHoldings, t, Number(e.cashHoldingQuantityDelta) || 0);
    }
    out.freeCash += Number(e.cashDelta) || 0;
    out.marginDebt += Number(e.marginDebtDelta) || 0;
    out.realizedMarginCharged += Number(e.realizedMarginChargeDelta) || 0;
  }
  if (Math.abs(out.freeCash) < 1e-8) out.freeCash = 0;
  if (Math.abs(out.marginDebt) < 1e-8) out.marginDebt = 0;
  if (Math.abs(out.realizedMarginCharged) < 1e-8) out.realizedMarginCharged = 0;
  return out;
}

export function verifyPortfolioTransactionParity(
  events: readonly PortfolioTransactionEvent[],
  canonical: {
    positions?: Record<string, { shares?: number | string }>;
    cashCushion?: { freeCash?: number | string; holdings?: Array<{ ticker: string; shares: number | string }> };
    balance?: number | string;
    realizedMarginCharged?: number | string;
  },
  tolerance = 1e-6
): PortfolioTransactionParityResult {
  const r = replayPortfolioTransactionJournal(events);
  const discrepancies: PortfolioTransactionParityResult['discrepancies'] = [];
  const compare = (field: PortfolioTransactionParityResult['discrepancies'][number]['field'], ticker: string | undefined, replayed: number, value: number) => {
    if (Math.abs(replayed - value) > tolerance) discrepancies.push({ field, ...(ticker ? { ticker } : {}), replayed, canonical: value, delta: value - replayed });
  };
  const p = canonical.positions || {};
  for (const t of new Set([...Object.keys(r.positions), ...Object.keys(p)])) compare('position', t, r.positions[t] || 0, Number(p[t]?.shares) || 0);
  const h: Record<string, number> = {};
  for (const row of canonical.cashCushion?.holdings || []) {
    const t = row.ticker.trim().toUpperCase();
    h[t] = (h[t] || 0) + (Number(row.shares) || 0);
  }
  for (const t of new Set([...Object.keys(r.cashHoldings), ...Object.keys(h)])) compare('cash-holding', t, r.cashHoldings[t] || 0, h[t] || 0);
  compare('free-cash', undefined, r.freeCash, Math.max(0, Number(canonical.cashCushion?.freeCash) || 0));
  compare('margin-debt', undefined, r.marginDebt, Math.abs(Number(canonical.balance) || 0));
  compare('realized-margin-charged', undefined, r.realizedMarginCharged, Number(canonical.realizedMarginCharged) || 0);
  return { matches: !discrepancies.length, discrepancies };
}

type PortfolioTransactionEventDisposition =
  | 'replayable'
  | 'evidence-only'
  | 'audit-only'
  | 'incomplete'
  | 'unsupported';

interface PortfolioTransactionJournalCoverageFinding {
  eventId?: string;
  eventType?: string;
  disposition: PortfolioTransactionEventDisposition;
  reason: string;
}

export interface PortfolioTransactionJournalCoverageReport {
  status: 'complete' | 'incomplete' | 'unsupported';
  eventCount: number;
  replayableCount: number;
  evidenceOnlyCount: number;
  auditOnlyCount: number;
  findings: PortfolioTransactionJournalCoverageFinding[];
  issues: PortfolioTransactionJournalCoverageFinding[];
}

const JOURNAL_DELTA_FIELDS = [
  'positionQuantityDelta',
  'cashHoldingQuantityDelta',
  'cashDelta',
  'marginDebtDelta',
  'realizedMarginChargeDelta'
] as const;

const EXTERNAL_CASHFLOW_TYPES = new Set<PortfolioTransactionEventType>([
  'dividend',
  'fee',
  'margin.interest',
  'cash.deposit',
  'cash.withdrawal',
  'cash.transfer',
  'corporate-action'
]);

function hasJournalDelta(event: PortfolioTransactionEvent): boolean {
  return JOURNAL_DELTA_FIELDS.some((field) => event[field] !== undefined);
}

function hasNonZeroJournalDelta(event: PortfolioTransactionEvent): boolean {
  return JOURNAL_DELTA_FIELDS.some((field) => Number(event[field] || 0) !== 0);
}

/**
 * Inspect which journal events can safely participate in the current shadow
 * replay. This report covers active-position quantities, cash-holding
 * quantities, free cash, margin debt and realized margin charges; it does not
 * claim to reconstruct cost basis, lot identity or closed-trade P&L.
 *
 * Broker rows are evidence-only unless an explicit app-owned posting delta is
 * present. Missing data is never treated as a zero-value financial mutation.
 */
export function inspectPortfolioTransactionJournalReplayCoverage(
  events: readonly unknown[]
): PortfolioTransactionJournalCoverageReport {
  const findings: PortfolioTransactionJournalCoverageFinding[] = [];
  const knownEvents = new Map<string, PortfolioTransactionEvent>();
  for (const candidate of events) {
    if (isPortfolioTransactionEvent(candidate)) knownEvents.set(candidate.id, candidate);
  }

  for (const raw of events) {
    if (!isPortfolioTransactionEvent(raw)) {
      const malformed = isPlainRecord(raw) ? raw : {};
      findings.push({
        ...(typeof malformed.id === 'string' ? { eventId: malformed.id } : {}),
        ...(typeof malformed.type === 'string' ? { eventType: malformed.type } : {}),
        disposition: 'unsupported',
        reason: 'Event is malformed or uses an unsupported transaction schema.'
      });
      continue;
    }

    const event = raw;
    const base = { eventId: event.id, eventType: event.type };
    const hasDeltas = hasJournalDelta(event);
    const hasNonZeroDeltas = hasNonZeroJournalDelta(event);

    if (event.type === 'broker.execution') {
      if (hasDeltas) {
        findings.push({
          ...base,
          disposition: 'unsupported',
          reason: 'Broker execution evidence must not post directly to app-owned portfolio balances.'
        });
      } else if (!event.externalReferenceId || !event.ticker || !event.side || !event.quantity) {
        findings.push({
          ...base,
          disposition: 'incomplete',
          reason: 'Broker execution evidence is missing its source reference, instrument, side or quantity.'
        });
      } else {
        findings.push({
          ...base,
          disposition: 'evidence-only',
          reason: 'External broker execution is retained as source evidence and is not replayed into canonical state.'
        });
      }
      continue;
    }

    if (EXTERNAL_CASHFLOW_TYPES.has(event.type) &&
      event.externalReferenceId &&
      event.externalCashFlowAmount !== undefined &&
      !hasDeltas &&
      (event.actor.type === 'broker' || event.actor.type === 'import')) {
      findings.push({
        ...base,
        disposition: 'evidence-only',
        reason: 'External cashflow is retained as broker/import evidence and is not posted a second time.'
      });
      continue;
    }

    switch (event.type) {
      case 'portfolio.reset':
        findings.push({
          ...base,
          disposition: 'replayable',
          reason: 'Explicit reset marker clears the replayed position, cash-holding, free-cash and debt projection.'
        });
        break;

      case 'history.correction':
        findings.push({
          ...base,
          disposition: hasDeltas
            ? 'unsupported'
            : event.note?.trim()
              ? 'audit-only'
              : 'incomplete',
          reason: hasDeltas
            ? 'Closed-history cleanup must not alter financial replay balances.'
            : event.note?.trim()
              ? 'History-display correction is auditable but does not change financial replay balances.'
              : 'History correction is missing its audit explanation.'
        });
        break;

      case 'trade.buy':
      case 'trade.sell': {
        const expectedSign = event.type === 'trade.buy' ? 1 : -1;
        const validDelta = event.positionQuantityDelta !== undefined &&
          Math.sign(event.positionQuantityDelta) === expectedSign &&
          event.quantity !== undefined &&
          Math.abs(Math.abs(event.positionQuantityDelta) - event.quantity) <= 1e-8;
        findings.push({
          ...base,
          disposition: event.ticker && validDelta ? 'replayable' : 'incomplete',
          reason: event.ticker && validDelta
            ? 'Trade event contains an explicit active-position quantity delta.'
            : 'Trade event requires an instrument, positive quantity and matching signed position delta.'
        });
        break;
      }

      case 'cash-holding.buy': {
        const validDelta = event.cashHoldingQuantityDelta !== undefined &&
          event.cashHoldingQuantityDelta > 0 &&
          event.quantity !== undefined &&
          Math.abs(event.cashHoldingQuantityDelta - event.quantity) <= 1e-8;
        const hasLotCostBasis = Boolean(event.lotId && event.acquisitionDate &&
          event.unitPrice !== undefined && event.grossAmount !== undefined && event.fees !== undefined);
        findings.push({
          ...base,
          disposition: event.ticker && validDelta && hasLotCostBasis ? 'replayable' : 'incomplete',
          reason: event.ticker && validDelta && hasLotCostBasis
            ? 'Cash-holding buy contains a stable acquisition lot and explicit quantity delta.'
            : 'Cash-holding buy is missing a stable lot ID, acquisition date, price, fee evidence or matching quantity delta.'
        });
        break;
      }

      case 'cash-holding.sell': {
        const validDelta = event.cashHoldingQuantityDelta !== undefined &&
          event.cashHoldingQuantityDelta < 0 &&
          event.quantity !== undefined &&
          Math.abs(Math.abs(event.cashHoldingQuantityDelta) - event.quantity) <= 1e-8;
        const hasLotAllocations = Array.isArray(event.lotAllocations) && event.lotAllocations.length > 0;
        findings.push({
          ...base,
          disposition: event.ticker && validDelta && hasLotAllocations ? 'replayable' : 'incomplete',
          reason: event.ticker && validDelta && hasLotAllocations
            ? 'Cash-holding sale contains exact FIFO acquisition-lot allocations.'
            : 'Cash-holding sale is missing exact FIFO lot allocations or a matching negative quantity delta.'
        });
        break;
      }

      case 'cash-holding.adjustment':
        findings.push({
          ...base,
          disposition: 'incomplete',
          reason: 'Cash-holding removal is a tracking correction without sale proceeds or realized-P&L semantics.'
        });
        break;

      case 'position.adjustment':
        findings.push({
          ...base,
          disposition: event.ticker && event.positionQuantityDelta !== undefined
            ? 'replayable'
            : 'incomplete',
          reason: event.ticker && event.positionQuantityDelta !== undefined
            ? 'Position tracking adjustment contains an explicit quantity delta.'
            : 'Position adjustment requires an instrument and an explicit quantity delta.'
        });
        break;

      case 'portfolio.reconciliation': {
        const auditReview = !hasDeltas &&
          event.actor.type === 'user' &&
          event.source === 'broker-reconciliation-review' &&
          Boolean(event.idempotencyKey?.startsWith('reconciliation-review:')) &&
          Boolean(event.requestFingerprint?.trim()) &&
          Boolean(event.note?.trim());
        findings.push({
          ...base,
          disposition: auditReview ? 'audit-only' : hasDeltas ? 'replayable' : 'incomplete',
          reason: auditReview
            ? 'User review note records an audit decision only; it does not change canonical portfolio state.'
            : hasDeltas
              ? 'Snapshot reconciliation records an observed canonical-state delta without inferring a trade.'
              : 'Snapshot reconciliation has no explicit state delta or complete audit-review contract.'
        });
        break;
      }

      case 'cash.adjustment':
        findings.push({
          ...base,
          disposition: event.cashDelta !== undefined || event.marginDebtDelta !== undefined
            ? 'replayable'
            : 'incomplete',
          reason: event.cashDelta !== undefined || event.marginDebtDelta !== undefined
            ? 'Cash/debt adjustment contains explicit balance deltas.'
            : 'Cash adjustment requires an explicit free-cash or margin-debt delta.'
        });
        break;

      case 'margin.adjustment':
        findings.push({
          ...base,
          disposition: event.marginDebtDelta !== undefined ? 'replayable' : 'incomplete',
          reason: event.marginDebtDelta !== undefined
            ? 'Margin adjustment contains an explicit debt delta.'
            : 'Margin adjustment requires an explicit debt delta.'
        });
        break;

      case 'margin.interest': {
        const hasDebtDelta = event.marginDebtDelta !== undefined;
        const hasRealizedChargeDelta = event.realizedMarginChargeDelta !== undefined;
        findings.push({
          ...base,
          disposition: hasDebtDelta && hasRealizedChargeDelta ? 'replayable' : 'incomplete',
          reason: hasDebtDelta && hasRealizedChargeDelta
            ? 'Margin-interest event explicitly separates debt capitalization from realized margin charges.'
            : 'Margin-interest event requires explicit debt and realized-charge deltas; legacy events without the realized-charge delta remain incomplete.'
        });
        break;
      }

      case 'correction': {
        const original = event.relatedEventId ? knownEvents.get(event.relatedEventId) : undefined;
        if (!event.note?.trim() || !event.relatedEventId || !hasNonZeroDeltas) {
          findings.push({
            ...base,
            disposition: 'incomplete',
            reason: 'Financial correction requires an original event reference, reason and non-zero inverse state delta.'
          });
          break;
        }
        if (!original) {
          findings.push({
            ...base,
            disposition: 'incomplete',
            reason: 'Financial correction references an event that is not present in the supplied journal.'
          });
          break;
        }
        if (original.type !== 'cash.adjustment' && original.type !== 'margin.adjustment') {
          findings.push({
            ...base,
            disposition: 'unsupported',
            reason: 'Only cash/debt balance-adjustment reversals are currently supported; trade, lot and corporate-action reversals remain gated.'
          });
          break;
        }
        const exactInverse = JOURNAL_DELTA_FIELDS.every((field) => {
          const originalValue = original[field];
          const correctionValue = event[field];
          if (originalValue === undefined) return correctionValue === undefined;
          return correctionValue !== undefined &&
            Math.abs(correctionValue + originalValue) <= 1e-8;
        });
        findings.push({
          ...base,
          disposition: exactInverse ? 'replayable' : 'incomplete',
          reason: exactInverse
            ? 'Correction is the exact inverse of a linked cash/debt balance adjustment.'
            : 'Correction state deltas must be the exact inverse of the linked original balance adjustment.'
        });
        break;
      }

      case 'cash.deposit':
      case 'cash.withdrawal':
      case 'cash.transfer':
      case 'dividend':
      case 'fee':
      case 'corporate-action':
        findings.push({
          ...base,
          disposition: hasDeltas ? 'replayable' : 'incomplete',
          reason: hasDeltas
            ? 'App-owned posting contains an explicit position, cash-holding, cash or debt delta.'
            : 'Financial posting has neither an app-owned state delta nor a complete external evidence reference.'
        });
        break;

      default:
        findings.push({
          ...base,
          disposition: 'unsupported',
          reason: 'Event type is not supported by the current quantity/cash/debt replay contract.'
        });
    }
  }

  const issues = findings.filter((finding) =>
    finding.disposition === 'incomplete' || finding.disposition === 'unsupported'
  );
  const replayableCount = findings.filter((finding) => finding.disposition === 'replayable').length;
  const evidenceOnlyCount = findings.filter((finding) => finding.disposition === 'evidence-only').length;
  const auditOnlyCount = findings.filter((finding) => finding.disposition === 'audit-only').length;

  return {
    status: issues.some((finding) => finding.disposition === 'unsupported')
      ? 'unsupported'
      : issues.length
        ? 'incomplete'
        : 'complete',
    eventCount: findings.length,
    replayableCount,
    evidenceOnlyCount,
    auditOnlyCount,
    findings,
    issues
  };
}

function hash(value: string): string {
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  if (typeof value === 'string' && value.trim()) {
    const v = value.trim(), parsed = Date.parse(v);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    if (/^\\d{10,13}$/.test(v)) return timestamp(Number(v), fallback);
  }
  return fallback;
}

function sourceId(value: unknown, fallback: string): string {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return (id || fallback).slice(0, 180);
}

/** External broker rows are audit evidence only; no local balances or positions are posted. */
export function appendBrokerHistoryAuditEvents(
  current: readonly PortfolioTransactionEvent[],
  executions: readonly unknown[],
  cashflows: readonly unknown[],
  recordedAt = Date.now(),
  source = 'freedom-tradenet'
): PortfolioTransactionEvent[] {
  if (!isPortfolioTransactionEventList(current)) throw new TypeError('Portfolio transaction event history is malformed.');
  const events = [...current];
  const keys = new Map<string, PortfolioTransactionEvent>();
  const executionRefs = new Map<string, PortfolioTransactionEvent | null>();
  const cashflowRefs = new Map<string, PortfolioTransactionEvent | null>();
  for (const e of current) {
    if (e.idempotencyKey) keys.set(e.idempotencyKey, e);
  }
  // Imported backups can be re-sorted by recordedAt across devices. Resolve
  // broker revision heads from their explicit parent links, not wall-clock order.
  for (const e of resolveLatestBrokerHistoryAuditEvents(current)) {
    if (e.type === 'broker.execution' && e.externalReferenceId) {
      const key = `${e.source}:${e.externalReferenceId}`;
      executionRefs.set(key, executionRefs.has(key) ? null : e);
    }
    if (e.idempotencyKey?.startsWith('broker-cashflow:') && e.externalReferenceId) {
      const key = `${e.source}:${e.externalReferenceId}`;
      cashflowRefs.set(key, cashflowRefs.has(key) ? null : e);
    }
  }
  const append = (event: PortfolioTransactionEvent) => {
    const prior = event.idempotencyKey ? keys.get(event.idempotencyKey) : undefined;
    if (prior) {
      if (prior.type !== event.type || prior.requestFingerprint !== event.requestFingerprint) {
        throw new Error('Broker history idempotency key conflicts with a different source record.');
      }
      return;
    }
    events.push(event);
    if (event.idempotencyKey) keys.set(event.idempotencyKey, event);
  };
  const validCurrency = (v: unknown): string | undefined =>
    typeof v === 'string' && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : undefined;

  for (const raw of executions) {
    if (!isPlainRecord(raw)) continue;
    const ticker = typeof raw.ticker === 'string' ? raw.ticker.trim().toUpperCase() : '';
    const side = typeof raw.side === 'string' ? raw.side.trim().toUpperCase() : '';
    const quantity = Number(raw.quantity ?? raw.shares);
    if (!ticker || !side || !Number.isFinite(quantity) || quantity <= 0) continue;
    const priceValue = Number(raw.price ?? raw.executionPrice);
    const price = Number.isFinite(priceValue) && priceValue > 0 ? priceValue : undefined;
    const currency = validCurrency(raw.currency);
    const feeCurrency = validCurrency(raw.commissionCurrency);
    const rawFee = raw.commission === null || raw.commission === undefined || raw.commission === '' ? NaN : Number(raw.commission);
    const fees = Number.isFinite(rawFee) ? Math.abs(rawFee) : undefined;
    const tradeValue = Number(raw.tradeValue);
    const gross = Number.isFinite(tradeValue) && tradeValue > 0 ? Math.abs(tradeValue) : price ? quantity * price : undefined;
    const at = raw.executedAt ?? raw.date;
    const orderValue = raw.orderId ?? raw.order_id ??
      (isPlainRecord(raw.raw) ? raw.raw.order_id ?? raw.raw.orderId : undefined);
    const orderRef = typeof orderValue === 'string' || typeof orderValue === 'number'
      ? String(orderValue).trim() || undefined
      : undefined;
    const fallback = hash(JSON.stringify([ticker, side, quantity, price, currency, at, orderRef]));
    const ref = sourceId(raw.id ?? raw.executionId ?? raw.tradeId, fallback);
    const facts = JSON.stringify([ticker, side, quantity, price, currency, fees, feeCurrency, at, gross, orderRef]);
    const fingerprint = hash(facts);
    const sourceKey = `${source}:${ref}`;
    const sourceFingerprint = hash(source);
    const previous = executionRefs.get(sourceKey);
    // More than one chain head means concurrent devices corrected the same
    // source record differently. Preserve both branches and do not guess.
    if (previous === null) continue;
    const requestFingerprint = `broker-execution-v1:${sourceFingerprint}:${fingerprint}`;
    // A replay of the latest known facts is a no-op. If the broker reverts to
    // an earlier value after a later correction, link a new revision to the
    // current head rather than reusing the historical revision's old key.
    if (previous?.requestFingerprint === requestFingerprint) continue;
    const revisionParent = previous ? hash(previous.id) : 'initial';
    const event = createPortfolioTransactionEvent({
      type: 'broker.execution', effectiveAt: timestamp(at, recordedAt), ticker, side, currency, feeCurrency,
      quantity, ...(price ? { unitPrice: price } : {}), ...(gross !== undefined ? { grossAmount: gross } : {}),
      ...(orderRef ? { externalOrderReferenceId: orderRef } : {}),
      ...(fees !== undefined ? { fees } : {}), externalReferenceId: ref,
      ...(previous ? { relatedEventId: previous.id } : {})
    }, {
      actor: { type: 'broker' }, source,
      idempotencyKey: `broker-execution:${sourceFingerprint}:${hash(ref)}:${revisionParent}:${fingerprint}`,
      requestFingerprint,
      eventId: `broker-execution-${sourceFingerprint}-${hash(ref)}-${revisionParent}-${fingerprint}`, recordedAt
    });
    append(event);
    executionRefs.set(sourceKey, event);
  }

  for (const raw of cashflows) {
    if (!isPlainRecord(raw)) continue;
    const amountValue = raw.amount ?? raw.value;
    if (amountValue === null || amountValue === undefined || amountValue === '') continue;
    const amount = Number(amountValue);
    if (!Number.isFinite(amount)) continue;
    const text = [raw.type, raw.description, raw.category].filter((v) => typeof v === 'string').join(' ').toLowerCase();
    const isCorporateAction = ['stock split', 'reverse split', 'merger', 'spin-off', 'spin off', 'reorganization', 'reorganisation', 'corporate action', 'symbol change', 'cash in lieu'].some((keyword) => text.includes(keyword));
    const type: PortfolioTransactionEventType = text.includes('dividend') || text.includes('distribution') || text.includes('coupon')
      ? 'dividend'
      : isCorporateAction
        ? 'corporate-action'
        : text.includes('margin') || text.includes('interest') || text.includes('financing') || text.includes('borrow fee')
          ? 'margin.interest'
          : text.includes('fee') || text.includes('commission') || text.includes('charge') || text.includes('tax')
            ? 'fee'
            : text.includes('transfer') ? 'cash.transfer'
              : text.includes('withdraw') || text.includes('debit') || amount < 0 && text.includes('outflow')
                ? 'cash.withdrawal'
                : text.includes('deposit') || text.includes('funding') || text.includes('credit')
                  ? 'cash.deposit' : 'cash.adjustment';
    const isRefund = /refund|rebate|reversal|reversed/.test(text);
    const signedAmount = type === 'cash.deposit'
      ? Math.abs(amount)
      : ['cash.withdrawal', 'fee', 'margin.interest'].includes(type)
        ? isRefund ? Math.abs(amount) : -Math.abs(amount)
        : amount;
    const date = raw.date;
    const currency = validCurrency(raw.currency);
    const fallback = hash(JSON.stringify([date, type, signedAmount, currency, raw.description]));
    const ref = sourceId(raw.id, fallback);
    const facts = JSON.stringify([type, date, signedAmount, currency, raw.description]);
    const fingerprint = hash(facts);
    const cashflowSource = `${source}-cashflow`;
    const sourceKey = `${cashflowSource}:${ref}`;
    const sourceFingerprint = hash(cashflowSource);
    const previous = cashflowRefs.get(sourceKey);
    if (previous === null) continue;
    const requestFingerprint = `broker-cashflow-v1:${sourceFingerprint}:${fingerprint}`;
    if (previous?.requestFingerprint === requestFingerprint) continue;
    const revisionParent = previous ? hash(previous.id) : 'initial';
    const event = createPortfolioTransactionEvent({
      type, effectiveAt: timestamp(date, recordedAt), currency, externalReferenceId: ref,
      externalCashFlowAmount: signedAmount, grossAmount: Math.abs(signedAmount),
      ...(type === 'fee' ? { fees: Math.abs(signedAmount) } : {}),
      ...(type === 'margin.interest' ? { financingCost: Math.abs(signedAmount) } : {}),
      ...(previous ? { relatedEventId: previous.id } : {})
    }, {
      actor: { type: 'broker' }, source: `${source}-cashflow`,
      idempotencyKey: `broker-cashflow:${sourceFingerprint}:${hash(ref)}:${revisionParent}:${fingerprint}`,
      requestFingerprint,
      eventId: `broker-cashflow-${sourceFingerprint}-${hash(ref)}-${revisionParent}-${fingerprint}`, recordedAt
    });
    append(event);
    cashflowRefs.set(sourceKey, event);
  }
  return freezePortfolioTransactionEventList(events);
}

/**
 * Resolve the current broker-audit observation for each provider reference.
 * Older revisions remain in the append-only journal and are linked through
 * relatedEventId. Competing correction branches are all returned so a caller
 * can surface ambiguity; they must not be counted as separate active trades.
 */
export function resolveLatestBrokerHistoryAuditEvents(
  events: readonly PortfolioTransactionEvent[]
): PortfolioTransactionEvent[] {
  if (!isPortfolioTransactionEventList(events)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }
  const groups = new Map<string, PortfolioTransactionEvent[]>();
  for (const event of events) {
    if (event.actor.type !== 'broker' || !event.externalReferenceId) continue;
    const family = event.type === 'broker.execution'
      ? 'execution'
      : event.idempotencyKey?.startsWith('broker-cashflow:')
        ? 'cashflow'
        : null;
    if (!family) continue;
    const key = `${family}:${event.source}:${event.externalReferenceId}`;
    const group = groups.get(key) || [];
    group.push(event);
    groups.set(key, group);
  }

  const latest: PortfolioTransactionEvent[] = [];
  for (const group of groups.values()) {
    const ids = new Set(group.map(event => event.id));
    const supersededIds = new Set(
      group
        .map(event => event.relatedEventId)
        .filter((id): id is string => Boolean(id) && ids.has(id as string))
    );
    const heads = group.filter(event => !supersededIds.has(event.id));
    // A single leaf is the latest revision. Multiple leaves represent a
    // concurrent correction fork; zero leaves indicate a malformed cycle.
    // Return all competing records so callers can detect ambiguity, never pick
    // an arbitrary branch based on the local device clock or array order.
    latest.push(...(heads.length ? heads : group));
  }

  return freezePortfolioTransactionEventList(
    latest.sort((left, right) =>
      left.effectiveAt - right.effectiveAt || left.recordedAt - right.recordedAt
    )
  );
}
