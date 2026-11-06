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
    ...(draft.side ? { side: draft.side.trim().toUpperCase() } : {}),
    ...(draft.feeCurrency ? { feeCurrency: draft.feeCurrency.trim().toUpperCase() } : {}),
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
  if (!isPortfolioTransactionEventList(events)) throw new TypeError('Portfolio transaction event history is malformed.');
  const out: PortfolioTransactionReplayState = { positions: {}, cashHoldings: {}, freeCash: 0, marginDebt: 0 };
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
      out.freeCash = out.marginDebt = 0;
      continue;
    }
    const t = e.ticker?.trim().toUpperCase();
    if (t) {
      add(out.positions, t, Number(e.positionQuantityDelta) || 0);
      add(out.cashHoldings, t, Number(e.cashHoldingQuantityDelta) || 0);
    }
    out.freeCash += Number(e.cashDelta) || 0;
    out.marginDebt += Number(e.marginDebtDelta) || 0;
  }
  if (Math.abs(out.freeCash) < 1e-8) out.freeCash = 0;
  if (Math.abs(out.marginDebt) < 1e-8) out.marginDebt = 0;
  return out;
}

export function verifyPortfolioTransactionParity(
  events: readonly PortfolioTransactionEvent[],
  canonical: {
    positions?: Record<string, { shares?: number | string }>;
    cashCushion?: { freeCash?: number | string; holdings?: Array<{ ticker: string; shares: number | string }> };
    balance?: number | string;
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
  return { matches: !discrepancies.length, discrepancies };
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
  const executionRefs = new Map<string, PortfolioTransactionEvent>();
  const cashflowRefs = new Map<string, PortfolioTransactionEvent>();
  for (const e of current) {
    if (e.idempotencyKey) keys.set(e.idempotencyKey, e);
    if (e.type === 'broker.execution' && e.externalReferenceId) executionRefs.set(e.externalReferenceId, e);
    if (e.idempotencyKey?.startsWith('broker-cashflow:') && e.externalReferenceId) cashflowRefs.set(e.externalReferenceId, e);
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
    const fallback = hash(JSON.stringify([ticker, side, quantity, price, currency, at]));
    const ref = sourceId(raw.id ?? raw.executionId ?? raw.tradeId, fallback);
    const facts = JSON.stringify([ticker, side, quantity, price, currency, fees, feeCurrency, at, gross]);
    const fingerprint = hash(facts);
    const previous = executionRefs.get(ref);
    const event = createPortfolioTransactionEvent({
      type: 'broker.execution', effectiveAt: timestamp(at, recordedAt), ticker, side, currency, feeCurrency,
      quantity, ...(price ? { unitPrice: price } : {}), ...(gross !== undefined ? { grossAmount: gross } : {}),
      ...(fees !== undefined ? { fees } : {}), externalReferenceId: ref,
      ...(previous ? { relatedEventId: previous.id } : {})
    }, {
      actor: { type: 'broker' }, source,
      idempotencyKey: `broker-execution:${hash(ref)}:${fingerprint}`,
      requestFingerprint: `broker-execution-v1:${fingerprint}`,
      eventId: `broker-execution-${hash(ref)}-${fingerprint}`, recordedAt
    });
    append(event);
    executionRefs.set(ref, event);
  }

  for (const raw of cashflows) {
    if (!isPlainRecord(raw)) continue;
    const amountValue = raw.amount ?? raw.value;
    if (amountValue === null || amountValue === undefined || amountValue === '') continue;
    const amount = Number(amountValue);
    if (!Number.isFinite(amount)) continue;
    const text = [raw.type, raw.description, raw.category].filter((v) => typeof v === 'string').join(' ').toLowerCase();
    const type: PortfolioTransactionEventType = text.includes('dividend') || text.includes('distribution') || text.includes('coupon')
      ? 'dividend'
      : text.includes('margin') || text.includes('interest') || text.includes('financing') || text.includes('borrow fee')
        ? 'margin.interest'
        : text.includes('fee') || text.includes('commission') || text.includes('charge') || text.includes('tax')
          ? 'fee'
          : text.includes('transfer') ? 'cash.transfer'
            : text.includes('withdraw') || text.includes('debit') || amount < 0 && text.includes('outflow')
              ? 'cash.withdrawal'
              : text.includes('deposit') || text.includes('funding') || text.includes('credit')
                ? 'cash.deposit' : 'cash.adjustment';
    const date = raw.date;
    const currency = validCurrency(raw.currency);
    const fallback = hash(JSON.stringify([date, type, amount, currency, raw.description]));
    const ref = sourceId(raw.id, fallback);
    const facts = JSON.stringify([type, date, amount, currency, raw.description]);
    const fingerprint = hash(facts);
    const previous = cashflowRefs.get(ref);
    const event = createPortfolioTransactionEvent({
      type, effectiveAt: timestamp(date, recordedAt), currency, externalReferenceId: ref,
      externalCashFlowAmount: amount, grossAmount: Math.abs(amount),
      ...(type === 'fee' ? { fees: Math.abs(amount) } : {}),
      ...(type === 'margin.interest' ? { financingCost: Math.abs(amount) } : {}),
      ...(previous ? { relatedEventId: previous.id } : {})
    }, {
      actor: { type: 'broker' }, source: `${source}-cashflow`,
      idempotencyKey: `broker-cashflow:${hash(ref)}:${fingerprint}`,
      requestFingerprint: `broker-cashflow-v1:${fingerprint}`,
      eventId: `broker-cashflow-${hash(ref)}-${fingerprint}`, recordedAt
    });
    append(event);
    cashflowRefs.set(ref, event);
  }
  return freezePortfolioTransactionEventList(events);
}
