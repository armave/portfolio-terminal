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
    value.cashDelta,
    value.marginDebtDelta,
    value.netAmount,
    value.realizedPnl
  ].every(isFiniteOptional)) return false;
  if (value.quantity !== undefined && Number(value.quantity) <= 0) return false;
  if (value.fees !== undefined && Number(value.fees) < 0) return false;
  if (value.financingCost !== undefined && Number(value.financingCost) < 0) return false;
  if (value.externalReferenceId !== undefined && (typeof value.externalReferenceId !== 'string' || !value.externalReferenceId.trim())) return false;
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
    actor: Object.freeze({ ...event.actor })
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
    ...(draft.ticker ? { ticker: draft.ticker.trim().toUpperCase() } : {}),
    ...(draft.currency ? { currency: draft.currency.trim().toUpperCase() } : {}),
    ...(draft.quantity !== undefined ? { quantity: draft.quantity } : {}),
    ...(draft.unitPrice !== undefined ? { unitPrice: draft.unitPrice } : {}),
    ...(draft.grossAmount !== undefined ? { grossAmount: draft.grossAmount } : {}),
    ...(draft.fees !== undefined ? { fees: draft.fees } : {}),
    ...(draft.externalCashFlowAmount !== undefined ? { externalCashFlowAmount: draft.externalCashFlowAmount } : {}),
    ...(draft.externalReferenceId ? { externalReferenceId: draft.externalReferenceId } : {}),
    ...(draft.positionQuantityDelta !== undefined ? { positionQuantityDelta: draft.positionQuantityDelta } : {}),
    ...(draft.cashHoldingQuantityDelta !== undefined ? { cashHoldingQuantityDelta: draft.cashHoldingQuantityDelta } : {}),
    ...(draft.financingCost !== undefined ? { financingCost: draft.financingCost } : {}),
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
  if (event.idempotencyKey) {
    const duplicate = current.find((existing) =>
      isPortfolioTransactionEvent(existing) && existing.idempotencyKey === event.idempotencyKey
    );
    if (duplicate) {
      if (duplicate.type !== event.type ||
        duplicate.requestFingerprint !== event.requestFingerprint) {
        throw new Error(`Portfolio transaction idempotency key "${event.idempotencyKey}" conflicts with a different command.`);
      }
      return { events: freezePortfolioTransactionEventList(current), appended: false, duplicate: true };
    }
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

  return freezePortfolioTransactionEventList(merged);
}

export interface PortfolioTransactionReplayState {
  positions: Record<string, number>;
  cashHoldings: Record<string, number>;
  freeCash: number;
  marginDebt: number;
}

export interface PortfolioTransactionParityResult {
  matches: boolean;
  discrepancies: Array<{
    field: 'position' | 'cash-holding' | 'free-cash' | 'margin-debt';
    ticker?: string;
    replayed: number;
    canonical: number;
    delta: number;
  }>;
}

export function replayPortfolioTransactionJournal(
  events: readonly PortfolioTransactionEvent[]
): PortfolioTransactionReplayState {
  if (!isPortfolioTransactionEventList(events)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }
  const replay: PortfolioTransactionReplayState = {
    positions: {},
    cashHoldings: {},
    freeCash: 0,
    marginDebt: 0
  };

  for (const event of events) {
    if (event.type === 'portfolio.reset') {
      replay.positions = {};
      replay.cashHoldings = {};
      replay.freeCash = 0;
      replay.marginDebt = 0;
      continue;
    }

    const ticker = event.ticker?.trim().toUpperCase();
    const positionDelta = event.positionQuantityDelta ??
      (event.type === 'trade.buy' ? Number(event.quantity) || 0 :
        event.type === 'trade.sell' || event.type === 'position.adjustment'
          ? -(Number(event.quantity) || 0) : 0);
    const cashHoldingDelta = event.cashHoldingQuantityDelta ??
      (event.type === 'cash-holding.buy' ? Number(event.quantity) || 0 :
        event.type === 'cash-holding.sell' || event.type === 'cash-holding.adjustment'
          ? -(Number(event.quantity) || 0) : 0);

    if (ticker && positionDelta !== 0) {
      const next = (replay.positions[ticker] || 0) + positionDelta;
      if (Math.abs(next) < 1e-8) delete replay.positions[ticker];
      else replay.positions[ticker] = next;
    }
    if (ticker && cashHoldingDelta !== 0) {
      const next = (replay.cashHoldings[ticker] || 0) + cashHoldingDelta;
      if (Math.abs(next) < 1e-8) delete replay.cashHoldings[ticker];
      else replay.cashHoldings[ticker] = next;
    }
    // External broker cashflows and executions are evidence only. They do not
    // post to local free cash/debt or manufacture app-owned position lots.
    if (event.type !== 'broker.execution' &&
      event.type !== 'cash.deposit' &&
      event.type !== 'cash.withdrawal' &&
      event.type !== 'dividend' &&
      event.type !== 'fee' &&
      event.type !== 'cash.transfer') {
      replay.freeCash += Number(event.cashDelta) || 0;
      replay.marginDebt += Number(event.marginDebtDelta) || 0;
    }
  }

  Object.keys(replay.positions).forEach((ticker) => {
    if (Math.abs(replay.positions[ticker]) < 1e-8) delete replay.positions[ticker];
  });
  Object.keys(replay.cashHoldings).forEach((ticker) => {
    if (Math.abs(replay.cashHoldings[ticker]) < 1e-8) delete replay.cashHoldings[ticker];
  });
  replay.freeCash = Math.abs(replay.freeCash) < 1e-8 ? 0 : replay.freeCash;
  replay.marginDebt = Math.abs(replay.marginDebt) < 1e-8 ? 0 : replay.marginDebt;
  return replay;
}

export function verifyPortfolioTransactionParity(
  events: readonly PortfolioTransactionEvent[],
  canonical: {
    positions?: Record<string, { shares?: number }>;
    cashCushion?: { freeCash?: number; holdings?: Array<{ ticker: string; shares: number }> };
    balance?: number;
  },
  tolerance = 1e-6
): PortfolioTransactionParityResult {
  const replay = replayPortfolioTransactionJournal(events);
  const discrepancies: PortfolioTransactionParityResult['discrepancies'] = [];
  const positionTickers = new Set([
    ...Object.keys(replay.positions),
    ...Object.keys(canonical.positions || {})
  ]);
  for (const rawTicker of positionTickers) {
    const ticker = rawTicker.toUpperCase();
    const replayed = Number(replay.positions[ticker]) || 0;
    const canonicalValue = Number(canonical.positions?.[ticker]?.shares) || 0;
    if (Math.abs(replayed - canonicalValue) > tolerance) {
      discrepancies.push({ field: 'position', ticker, replayed, canonical: canonicalValue, delta: canonicalValue - replayed });
    }
  }

  const canonicalCashHoldings = new Map<string, number>();
  for (const holding of canonical.cashCushion?.holdings || []) {
    const ticker = holding.ticker.trim().toUpperCase();
    canonicalCashHoldings.set(ticker, (canonicalCashHoldings.get(ticker) || 0) + (Number(holding.shares) || 0));
  }
  const holdingTickers = new Set([...Object.keys(replay.cashHoldings), ...canonicalCashHoldings.keys()]);
  for (const ticker of holdingTickers) {
    const replayed = Number(replay.cashHoldings[ticker]) || 0;
    const canonicalValue = Number(canonicalCashHoldings.get(ticker)) || 0;
    if (Math.abs(replayed - canonicalValue) > tolerance) {
      discrepancies.push({ field: 'cash-holding', ticker, replayed, canonical: canonicalValue, delta: canonicalValue - replayed });
    }
  }

  const canonicalCash = Math.max(0, Number(canonical.cashCushion?.freeCash) || 0);
  if (Math.abs(replay.freeCash - canonicalCash) > tolerance) {
    discrepancies.push({ field: 'free-cash', replayed: replay.freeCash, canonical: canonicalCash, delta: canonicalCash - replay.freeCash });
  }

  const canonicalDebt = Math.abs(Number(canonical.balance) || 0);
  if (Math.abs(replay.marginDebt - canonicalDebt) > tolerance) {
    discrepancies.push({ field: 'margin-debt', replayed: replay.marginDebt, canonical: canonicalDebt, delta: canonicalDebt - replay.marginDebt });
  }
  return { matches: discrepancies.length === 0, discrepancies };
}


function stableShortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function recordTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    if (/^\\d{10,13}$/.test(value.trim())) return recordTimestamp(Number(value), fallback);
  }
  return fallback;
}

function externalReference(value: unknown, fallback: string): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim();
    if (normalized) return normalized.slice(0, 180);
  }
  return fallback;
}

/**
 * Append read-only broker execution and cashflow evidence into the portfolio
 * journal. These records never post to local positions/cash; they preserve
 * source provenance and remain separate from app-owned trade commands.
 */
export function appendBrokerHistoryAuditEvents(
  current: readonly PortfolioTransactionEvent[],
  brokerExecutions: readonly unknown[],
  cashflows: readonly unknown[],
  recordedAt = Date.now(),
  source = 'freedom-tradenet'
): PortfolioTransactionEvent[] {
  if (!isPortfolioTransactionEventList(current)) {
    throw new TypeError('Portfolio transaction event history is malformed.');
  }
  let events = freezePortfolioTransactionEventList(current);

  for (const input of brokerExecutions) {
    if (!isPlainRecord(input)) continue;
    const ticker = typeof input.ticker === 'string' ? input.ticker.trim().toUpperCase() : '';
    const side = typeof input.side === 'string' ? input.side.trim().toUpperCase() : '';
    const quantity = Number(input.quantity ?? input.shares);
    const price = Number(input.price ?? input.executionPrice);
    if (!ticker || !side || !Number.isFinite(quantity) || quantity <= 0) continue;

    const rawReference = input.id ?? input.executionId ?? input.tradeId;
    const provisional = JSON.stringify([ticker, side, quantity, Number.isFinite(price) ? price : null, input.currency, input.executedAt ?? input.date]);
    const referenceId = externalReference(rawReference, stableShortHash(provisional));
    const currency = typeof input.currency === 'string' && /^[A-Za-z]{3}$/.test(input.currency.trim())
      ? input.currency.trim().toUpperCase()
      : undefined;
    const commissionValue = Number(input.commission);
    const fees = Number.isFinite(commissionValue) ? Math.abs(commissionValue) : undefined;
    const facts = JSON.stringify({
      referenceId, ticker, side, quantity,
      price: Number.isFinite(price) ? price : null,
      currency: currency ?? null,
      commission: fees ?? null,
      commissionCurrency: typeof input.commissionCurrency === 'string' ? input.commissionCurrency.trim().toUpperCase() : null,
      executedAt: input.executedAt ?? input.date ?? null,
      tradeValue: Number.isFinite(Number(input.tradeValue)) ? Number(input.tradeValue) : null
    });
    const fingerprint = `broker-execution-v1:${stableShortHash(facts)}`;
    const idempotencyKey = `broker-execution:${stableShortHash(referenceId)}:${stableShortHash(facts)}`;
    const previous = [...events].reverse().find((event) =>
      event.type === 'broker.execution' && event.externalReferenceId === referenceId
    );
    const event = createPortfolioTransactionEvent({
      type: 'broker.execution',
      effectiveAt: recordTimestamp(input.executedAt ?? input.date, recordedAt),
      ticker,
      currency,
      quantity,
      ...(Number.isFinite(price) && price > 0 ? { unitPrice: price } : {}),
      ...(Number.isFinite(Number(input.tradeValue)) && Number(input.tradeValue) > 0
        ? { grossAmount: Math.abs(Number(input.tradeValue)) }
        : Number.isFinite(price) && price > 0 ? { grossAmount: quantity * price } : {}),
      ...(fees !== undefined ? { fees } : {}),
      externalReferenceId: referenceId,
      ...(previous ? { relatedEventId: previous.id } : {}),
      note: `Read-only broker execution (${side}); does not post or replace app-owned positions.`
    }, {
      actor: { type: 'broker' },
      source,
      idempotencyKey,
      requestFingerprint: fingerprint,
      eventId: `broker-execution-${stableShortHash(referenceId)}-${stableShortHash(facts)}`,
      recordedAt
    });
    const appended = appendPortfolioTransactionEvent(events, event);
    events = appended.events;
  }

  for (const input of cashflows) {
    if (!isPlainRecord(input)) continue;
    const amount = Number(input.amount ?? input.value);
    if (!Number.isFinite(amount)) continue;
    const typeText = [input.type, input.description, input.category]
      .filter((part) => typeof part === 'string')
      .join(' ')
      .toLowerCase();
    let type: PortfolioTransactionEventType = 'cash.adjustment';
    if (/dividend|distribution|coupon/.test(typeText)) type = 'dividend';
    else if (/margin|interest|financing|borrow fee|funding fee/.test(typeText)) type = 'margin.interest';
    else if (/commission|fee|charge|tax/.test(typeText)) type = 'fee';
    else if (/transfer|internal move/.test(typeText)) type = 'cash.transfer';
    else if (/withdraw|debit|outflow/.test(typeText) || amount < 0 && /payment|cash out/.test(typeText)) type = 'cash.withdrawal';
    else if (/deposit|funding|credit|inflow/.test(typeText)) type = 'cash.deposit';

    const provisional = JSON.stringify([input.date, input.type, amount, input.currency, input.description]);
    const referenceId = externalReference(input.id, stableShortHash(provisional));
    const currency = typeof input.currency === 'string' && /^[A-Za-z]{3}$/.test(input.currency.trim())
      ? input.currency.trim().toUpperCase()
      : undefined;
    const facts = JSON.stringify({
      referenceId, type, date: input.date ?? null, amount,
      currency: currency ?? null, description: typeof input.description === 'string' ? input.description : null
    });
    const fingerprint = `broker-cashflow-v1:${stableShortHash(facts)}`;
    const idempotencyKey = `broker-cashflow:${stableShortHash(referenceId)}:${stableShortHash(facts)}`;
    const previous = [...events].reverse().find((event) =>
      event.externalReferenceId === referenceId && event.idempotencyKey?.startsWith('broker-cashflow:')
    );
    const noteText = typeof input.description === 'string' && input.description.trim()
      ? input.description.trim()
      : typeof input.type === 'string' ? input.type.trim() : 'Broker cashflow';
    const event = createPortfolioTransactionEvent({
      type,
      effectiveAt: recordTimestamp(input.date, recordedAt),
      currency,
      externalReferenceId: referenceId,
      externalCashFlowAmount: amount,
      grossAmount: Math.abs(amount),
      ...(type === 'fee' ? { fees: Math.abs(amount) } : {}),
      ...(type === 'margin.interest' ? { financingCost: Math.abs(amount) } : {}),
      ...(previous ? { relatedEventId: previous.id } : {}),
      note: `Read-only broker cashflow: ${noteText.slice(0, 220)}. No local cash/debt posting was applied.`
    }, {
      actor: { type: 'broker' },
      source: `${source}-cashflow`,
      idempotencyKey,
      requestFingerprint: fingerprint,
      eventId: `broker-cashflow-${stableShortHash(referenceId)}-${stableShortHash(facts)}`,
      recordedAt
    });
    const appended = appendPortfolioTransactionEvent(events, event);
    events = appended.events;
  }

  return events;
}
