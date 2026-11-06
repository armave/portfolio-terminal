import {
  PORTFOLIO_TRANSACTION_EVENT_SCHEMA_VERSION,
  type PortfolioTransactionActorType,
  type PortfolioTransactionContext,
  type PortfolioTransactionDraft,
  type PortfolioTransactionEvent,
  type PortfolioTransactionEventType
} from '../types/portfolioTransaction';

const EVENT_TYPES = new Set<PortfolioTransactionEventType>([
  'trade.buy',
  'trade.sell',
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
  if (value.currency !== undefined && !/^[A-Z]{3}$/.test(String(value.currency))) return false;
  if (![
    value.quantity,
    value.unitPrice,
    value.grossAmount,
    value.fees,
    value.cashDelta,
    value.marginDebtDelta,
    value.netAmount,
    value.realizedPnl
  ].every(isFiniteOptional)) return false;
  if (value.quantity !== undefined && Number(value.quantity) <= 0) return false;
  if (value.fees !== undefined && Number(value.fees) < 0) return false;
  if (value.relatedEventId !== undefined && typeof value.relatedEventId !== 'string') return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  return true;
}

export function isPortfolioTransactionEventList(value: unknown): value is PortfolioTransactionEvent[] {
  return Array.isArray(value) && value.every(isPortfolioTransactionEvent);
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
    ...(draft.ticker ? { ticker: draft.ticker.trim().toUpperCase() } : {}),
    ...(draft.currency ? { currency: draft.currency.trim().toUpperCase() } : {}),
    ...(draft.quantity !== undefined ? { quantity: draft.quantity } : {}),
    ...(draft.unitPrice !== undefined ? { unitPrice: draft.unitPrice } : {}),
    ...(draft.grossAmount !== undefined ? { grossAmount: draft.grossAmount } : {}),
    ...(draft.fees !== undefined ? { fees: draft.fees } : {}),
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
export function appendPortfolioTransactionEvent(
  current: readonly PortfolioTransactionEvent[],
  event: PortfolioTransactionEvent
): AppendPortfolioTransactionResult {
  if (!isPortfolioTransactionEvent(event)) {
    throw new TypeError('Portfolio transaction event is invalid.');
  }
  if (current.some((existing) => isPortfolioTransactionEvent(existing) && existing.id === event.id)) {
    throw new Error(`Portfolio transaction event id "${event.id}" already exists.`);
  }
  if (event.idempotencyKey && hasPortfolioTransactionIdempotencyKey(current, event.idempotencyKey)) {
    return { events: current as PortfolioTransactionEvent[], appended: false, duplicate: true };
  }
  return {
    events: [...current, Object.freeze({ ...event, actor: Object.freeze({ ...event.actor }) })],
    appended: true,
    duplicate: false
  };
}
