import type { PositionRecord } from '../types/portfolio';
import type {
  CorporateActionEvent,
  CorporateActionFeedQuality,
  CorporateActionFeedResult,
  CorporateActionKind,
  PortfolioCorporateActionEvent,
  PortfolioCorporateActionStatus
} from '../types/corporateAction';
export type {
  CorporateActionEvent,
  CorporateActionFeedQuality,
  CorporateActionFeedResult,
  CorporateActionKind,
  PortfolioCorporateActionEvent,
  PortfolioCorporateActionStatus
} from '../types/corporateAction';


export interface CorporateActionAdjustmentInput {
  kind: CorporateActionKind;
  quantity: number;
  direction: 'long' | 'short';
  totalCostBasis: number;
  unitPrice?: number;
  sharesAfterPerShareBefore?: number;
  amountPerShare?: number;
  currency?: string | null;
  newSymbol?: string | null;
}

export type CorporateActionAdjustmentPreview =
  | {
      status: 'ready';
      kind: CorporateActionKind;
      quantityAfter: number;
      totalCostBasisAfter: number;
      unitCostAfter: number | null;
      referencePriceAfter: number | null;
      /** Expected distribution only; this is not a broker cash receipt. */
      cashEntitlement: number;
      cashCurrency: string | null;
      symbolAfter: string | null;
    }
  | {
      status: 'review_required';
      kind: CorporateActionKind;
      reason: string;
    }
  | {
      status: 'invalid';
      kind: CorporateActionKind;
      reason: string;
    };

export type SplitPositionAdjustment =
  | { status: 'applied'; position: PositionRecord; sharesBefore: number; sharesAfter: number; costBasisBefore: number; costBasisAfter: number }
  | { status: 'review_required' | 'not_applicable'; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

function positiveFinite(value: unknown): number | null {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function normalizeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizedProvider(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= 64
    ? value.trim().toUpperCase()
    : null;
}

function normalizedReceipt(value: unknown): number | null {
  const numeric = finiteNumber(value);
  if (numeric !== null && numeric > 0) return numeric < 1e12 ? numeric * 1000 : numeric;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function isDateField(value: unknown): value is string | null {
  return value === null || dateOnly(value) === value;
}

/**
 * Normalize split evidence. Identical duplicate rows collapse to one event;
 * conflicting records for the same instrument/effective date are withheld.
 */
export function normalizeFinnhubStockSplits(
  input: unknown,
  options: { symbol: string; provider?: unknown; receivedAt?: unknown; available?: boolean }
): CorporateActionFeedResult {
  const expectedSymbol = normalizeSymbol(options.symbol);
  const provider = normalizedProvider(options.provider);
  const receivedAt = normalizedReceipt(options.receivedAt);
  const issues: string[] = [];
  if (!expectedSymbol || !/^[A-Z0-9.^=-]{1,20}$/.test(expectedSymbol)) {
    return { events: [], quality: 'unavailable', issues: ['Corporate-action symbol is invalid.'] };
  }
  if (!provider || receivedAt === null) {
    return { events: [], quality: 'unavailable', issues: ['Corporate-action source provenance is incomplete.'] };
  }
  if (options.available === false) {
    return { events: [], quality: 'unavailable', issues: ['Corporate-action split feed is unavailable.'] };
  }
  if (!Array.isArray(input)) {
    return { events: [], quality: 'unavailable', issues: ['Corporate-action split feed is not an array.'] };
  }

  const byActionDate = new Map<string, CorporateActionEvent>();
  const conflictedDates = new Set<string>();
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) {
      issues.push('Corporate-action row ' + (index + 1) + ' is malformed.');
      continue;
    }
    const rowSymbol = normalizeSymbol(raw.symbol);
    const effectiveDate = dateOnly(raw.date);
    const fromFactor = positiveFinite(raw.fromFactor);
    const toFactor = positiveFinite(raw.toFactor);
    if (rowSymbol !== expectedSymbol) {
      issues.push('Corporate-action row ' + (index + 1) + ' has a different or missing symbol and was ignored.');
      continue;
    }
    if (!effectiveDate || fromFactor === null || toFactor === null || fromFactor === toFactor) {
      issues.push('Corporate-action row ' + (index + 1) + ' has an invalid date or split factor.');
      continue;
    }
    const sharesAfterPerShareBefore = toFactor / fromFactor;
    if (!Number.isFinite(sharesAfterPerShareBefore) ||
        sharesAfterPerShareBefore < 1e-6 || sharesAfterPerShareBefore > 1e6) {
      issues.push('Corporate-action row ' + (index + 1) + ' has an unsupported split ratio.');
      continue;
    }

    const actionDateKey = expectedSymbol + ':' + effectiveDate;
    if (conflictedDates.has(actionDateKey)) continue;
    const event: CorporateActionEvent = {
      id: [provider, expectedSymbol, effectiveDate, fromFactor, toFactor].join(':'),
      sourceId: [provider.toLowerCase(), expectedSymbol, effectiveDate, fromFactor, toFactor].join(':'),
      symbol: expectedSymbol,
      kind: sharesAfterPerShareBefore > 1 ? 'stock_split' : 'reverse_split',
      effectiveDate,
      fromFactor,
      toFactor,
      sharesAfterPerShareBefore,
      provider,
      receivedAt
    };
    const previous = byActionDate.get(actionDateKey);
    if (previous) {
      if (previous.fromFactor === fromFactor && previous.toFactor === toFactor) continue;
      byActionDate.delete(actionDateKey);
      conflictedDates.add(actionDateKey);
      issues.push('Conflicting corporate-action revisions exist for ' + expectedSymbol + ' on ' + effectiveDate + '; the event was withheld.');
      continue;
    }
    byActionDate.set(actionDateKey, event);
  }

  const events = [...byActionDate.values()].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id)
  );
  const quality: CorporateActionFeedQuality = events.length === 0
    ? input.length === 0 && issues.length === 0 ? 'complete' : 'unavailable'
    : issues.length > 0 ? 'partial' : 'complete';
  return { events, quality, issues };
}

/** Converts the dividend feed to a corporate-action evidence shape, not a cash posting. */
export function normalizeFinnhubDividendActions(
  input: unknown,
  options: { symbol: string; provider?: unknown; receivedAt?: unknown; available?: boolean }
): CorporateActionFeedResult {
  const expectedSymbol = normalizeSymbol(options.symbol);
  const provider = normalizedProvider(options.provider);
  const receivedAt = normalizedReceipt(options.receivedAt);
  const issues: string[] = [];
  if (!expectedSymbol || !/^[A-Z0-9.^=-]{1,20}$/.test(expectedSymbol) || !provider || receivedAt === null) {
    return { events: [], quality: 'unavailable', issues: ['Dividend action provenance is incomplete.'] };
  }
  if (options.available === false) {
    return { events: [], quality: 'unavailable', issues: ['Dividend action feed is unavailable.'] };
  }
  if (!Array.isArray(input)) {
    return { events: [], quality: 'unavailable', issues: ['Dividend action feed is not an array.'] };
  }

  const bySource = new Map<string, CorporateActionEvent>();
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) {
      issues.push('Dividend action row ' + (index + 1) + ' is malformed.');
      continue;
    }
    const symbol = normalizeSymbol(raw.symbol);
    const effectiveDate = dateOnly(raw.date);
    const amountPerShare = finiteNumber(raw.amount);
    const currency = currencyCode(raw.currency);
    const payDate = raw.payDate == null ? null : dateOnly(raw.payDate);
    const recordDate = raw.recordDate == null ? null : dateOnly(raw.recordDate);
    const declarationDate = raw.declarationDate == null ? null : dateOnly(raw.declarationDate);
    if (symbol !== expectedSymbol || !effectiveDate) {
      issues.push('Dividend action row ' + (index + 1) + ' has an invalid symbol or ex-date and was ignored.');
      continue;
    }
    if (amountPerShare !== null && amountPerShare < 0) {
      issues.push('Dividend action row ' + (index + 1) + ' has a negative amount and was ignored.');
      continue;
    }
    const rowIssues = [
      ...(amountPerShare === null ? ['Dividend amount is unavailable.'] : []),
      ...(!currency ? ['Dividend currency is unknown; no conversion was applied.'] : []),
      ...((raw.payDate != null && !payDate) ? ['Dividend pay date is invalid.'] : []),
      ...((raw.recordDate != null && !recordDate) ? ['Dividend record date is invalid.'] : []),
      ...((raw.declarationDate != null && !declarationDate) ? ['Dividend declaration date is invalid.'] : [])
    ];
    issues.push(...rowIssues.map(issue => 'Dividend action row ' + (index + 1) + ': ' + issue));
    const sourceId = [provider.toLowerCase(), symbol, effectiveDate, amountPerShare ?? 'unknown', currency ?? 'unknown',
      declarationDate ?? '', recordDate ?? '', payDate ?? ''].join(':');
    const event: CorporateActionEvent = {
      id: sourceId,
      sourceId,
      symbol,
      kind: 'cash_dividend',
      effectiveDate,
      amountPerShare,
      currency,
      ...(payDate ? { payDate } : {}),
      ...(recordDate ? { recordDate } : {}),
      ...(declarationDate ? { declarationDate } : {}),
      provider,
      receivedAt
    };
    bySource.set(sourceId, event);
  }

  const events = [...bySource.values()].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate) || a.id.localeCompare(b.id)
  );
  const quality: CorporateActionFeedQuality = events.length === 0
    ? input.length === 0 && issues.length === 0 ? 'complete' : 'unavailable'
    : issues.length > 0 ? 'partial' : 'complete';
  return { events, quality, issues };
}

/** Map verified provider evidence into a versioned, portable portfolio action. */
export function toPortfolioCorporateActionEvent(
  event: CorporateActionEvent,
  status: PortfolioCorporateActionStatus,
  recordedAt = Date.now(),
  note?: string
): PortfolioCorporateActionEvent {
  if (!isCorporateActionFeedEvent(event)) throw new TypeError('Corporate-action evidence is invalid.');
  if (!Number.isSafeInteger(recordedAt) || recordedAt <= 0) throw new TypeError('Corporate-action recorded time is invalid.');
  const effectiveAt = Date.parse(event.effectiveDate + 'T00:00:00.000Z');
  return {
    schemaVersion: 1,
    id: event.sourceId,
    sourceId: event.sourceId,
    ticker: event.symbol,
    kind: event.kind,
    effectiveAt,
    recordedAt,
    provider: event.provider,
    receivedAt: event.receivedAt,
    status,
    ...(event.fromFactor !== undefined ? { fromFactor: event.fromFactor } : {}),
    ...(event.toFactor !== undefined ? { toFactor: event.toFactor } : {}),
    ...(event.sharesAfterPerShareBefore !== undefined ? { sharesAfterPerShareBefore: event.sharesAfterPerShareBefore } : {}),
    ...(event.amountPerShare !== undefined ? { amountPerShare: event.amountPerShare } : {}),
    ...(event.currency !== undefined ? { currency: event.currency } : {}),
    ...(event.payDate ? { payDate: event.payDate } : {}),
    ...(event.recordDate ? { recordDate: event.recordDate } : {}),
    ...(event.declarationDate ? { declarationDate: event.declarationDate } : {}),
    ...(note ? { note } : {})
  };
}

function isCorporateActionFeedEvent(value: unknown): value is CorporateActionEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string' && !!value.id &&
    typeof value.sourceId === 'string' && !!value.sourceId &&
    typeof value.symbol === 'string' && /^[A-Z0-9.^=-]{1,20}$/.test(value.symbol) &&
    ['stock_split', 'reverse_split', 'cash_dividend'].includes(String(value.kind)) &&
    dateOnly(value.effectiveDate) !== null &&
    typeof value.provider === 'string' && !!value.provider &&
    Number.isFinite(value.receivedAt) && Number(value.receivedAt) > 0 &&
    (value.kind !== 'cash_dividend' ||
      ((value.amountPerShare == null || (finiteNumber(value.amountPerShare) !== null && Number(value.amountPerShare) >= 0)) &&
       (value.currency == null || currencyCode(value.currency) !== null) &&
       (value.payDate == null || dateOnly(value.payDate) !== null) &&
       (value.recordDate == null || dateOnly(value.recordDate) !== null) &&
       (value.declarationDate == null || dateOnly(value.declarationDate) !== null))) &&
    (value.kind === 'cash_dividend' ||
      (positiveFinite(value.fromFactor) !== null && positiveFinite(value.toFactor) !== null &&
       positiveFinite(value.sharesAfterPerShareBefore) !== null));
}

export function isPortfolioCorporateActionEvent(value: unknown): value is PortfolioCorporateActionEvent {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      typeof value.id !== 'string' || !value.id.trim() ||
      typeof value.sourceId !== 'string' || !value.sourceId.trim() ||
      typeof value.ticker !== 'string' || !/^[A-Z0-9.^=-]{1,20}$/.test(value.ticker) ||
      !['stock_split', 'reverse_split', 'cash_dividend', 'symbol_change', 'merger', 'spin_off'].includes(String(value.kind)) ||
      !Number.isSafeInteger(value.effectiveAt) || Number(value.effectiveAt) <= 0 ||
      !Number.isSafeInteger(value.recordedAt) || Number(value.recordedAt) <= 0 ||
      typeof value.provider !== 'string' || !value.provider.trim() ||
      !Number.isFinite(value.receivedAt) || Number(value.receivedAt) <= 0 ||
      !['applied', 'review_required', 'not_applicable'].includes(String(value.status))) return false;
  if (value.fromFactor !== undefined && positiveFinite(value.fromFactor) === null) return false;
  if (value.toFactor !== undefined && positiveFinite(value.toFactor) === null) return false;
  if (value.sharesAfterPerShareBefore !== undefined && positiveFinite(value.sharesAfterPerShareBefore) === null) return false;
  if (value.amountPerShare !== undefined && value.amountPerShare !== null &&
      (finiteNumber(value.amountPerShare) === null || Number(value.amountPerShare) < 0)) return false;
  if (value.currency !== undefined && value.currency !== null && currencyCode(value.currency) === null) return false;
  if (value.payDate !== undefined && !isDateField(value.payDate)) return false;
  if (value.recordDate !== undefined && !isDateField(value.recordDate)) return false;
  if (value.declarationDate !== undefined && !isDateField(value.declarationDate)) return false;
  if (value.newSymbol !== undefined && !/^[A-Z0-9.^=-]{1,32}$/.test(String(value.newSymbol))) return false;
  if (value.note !== undefined && typeof value.note !== 'string') return false;
  return true;
}

export function isPortfolioCorporateActionEventList(value: unknown): value is PortfolioCorporateActionEvent[] {
  return Array.isArray(value) && value.every(isPortfolioCorporateActionEvent);
}

/**
 * Idempotently merges imported action history. Conflicting source IDs or a
 * second different split for one ticker/effective date are rejected; automatic
 * last-write-wins would make replays order-dependent.
 */
export function mergePortfolioCorporateActionEvents(
  current: readonly PortfolioCorporateActionEvent[],
  incoming: readonly PortfolioCorporateActionEvent[]
): PortfolioCorporateActionEvent[] {
  if (!isPortfolioCorporateActionEventList(current) || !isPortfolioCorporateActionEventList(incoming)) {
    throw new TypeError('Portfolio corporate-action history is malformed.');
  }
  const bySourceId = new Map<string, PortfolioCorporateActionEvent>();
  for (const event of [...current, ...incoming]) {
    const previous = bySourceId.get(event.sourceId);
    if (previous) {
      const sameEvidence = previous.ticker === event.ticker &&
        previous.kind === event.kind && previous.effectiveAt === event.effectiveAt &&
        previous.provider === event.provider &&
        previous.fromFactor === event.fromFactor && previous.toFactor === event.toFactor &&
        previous.sharesAfterPerShareBefore === event.sharesAfterPerShareBefore &&
        previous.amountPerShare === event.amountPerShare &&
        previous.currency === event.currency &&
        previous.payDate === event.payDate &&
        previous.recordDate === event.recordDate &&
        previous.declarationDate === event.declarationDate;
      if (!sameEvidence) throw new Error('A corporate-action source ID was reused for different evidence.');
      const priority: Record<PortfolioCorporateActionStatus, number> = {
        review_required: 0, not_applicable: 1, applied: 2
      };
      bySourceId.set(event.sourceId, priority[event.status] > priority[previous.status] ? event : previous);
      continue;
    }
    bySourceId.set(event.sourceId, event);
  }

  const byInstrumentDate = new Map<string, PortfolioCorporateActionEvent>();
  for (const event of bySourceId.values()) {
    if (event.kind !== 'stock_split' && event.kind !== 'reverse_split') continue;
    const key = event.ticker + ':' + event.effectiveAt;
    const previous = byInstrumentDate.get(key);
    if (previous && previous.sourceId !== event.sourceId) {
      throw new Error('Conflicting split events exist for the same instrument and effective date.');
    }
    byInstrumentDate.set(key, event);
  }
  return [...bySourceId.values()].sort((a, b) =>
    a.effectiveAt - b.effectiveAt || a.sourceId.localeCompare(b.sourceId)
  );
}

function acquiredAtForTranche(
  tranche: Record<string, unknown>,
  positionStartDate?: string
): number | null {
  const timestamp = finiteNumber(tranche.acquiredAt);
  if (timestamp !== null && timestamp > 0) {
    const isoDate = new Date(timestamp).toISOString().slice(0, 10);
    return dateOnly(isoDate) ? Date.parse(isoDate + 'T00:00:00.000Z') : null;
  }
  const date = typeof tranche.date === 'string' && tranche.date.trim()
    ? tranche.date.trim()
    : positionStartDate;
  if (!dateOnly(date)) return null;
  return Date.parse(date + 'T00:00:00.000Z');
}

/**
 * Apply a split only when every open lot's acquisition date is known and all
 * lots predate the effective date. Mixed pre/post-action lots require review.
 * Current market quotes are not synthetically made live by this adjustment.
 */
export function adjustPositionForSplit(
  position: PositionRecord,
  event: CorporateActionEvent
): SplitPositionAdjustment {
  if (event.kind !== 'stock_split' && event.kind !== 'reverse_split') {
    return { status: 'review_required', reason: 'This corporate action is evidence-only and needs an explicit settlement/basis policy.' };
  }
  const multiplier = positiveFinite(event.sharesAfterPerShareBefore);
  if (multiplier === null || (event.kind === 'stock_split' && multiplier <= 1) ||
      (event.kind === 'reverse_split' && multiplier >= 1)) {
    return { status: 'review_required', reason: 'The corporate-action split ratio is invalid.' };
  }
  const effectiveAt = Date.parse(event.effectiveDate + 'T00:00:00.000Z');
  if (!Number.isFinite(effectiveAt) || effectiveAt > Date.now()) {
    return { status: 'review_required', reason: 'The corporate-action effective date is invalid or is still in the future.' };
  }
  if (!Array.isArray(position.tranches) || position.tranches.length === 0 ||
      !Number.isFinite(position.shares) || position.shares <= 0) {
    return { status: 'review_required', reason: 'Position lots and a positive open quantity are required to preserve cost basis.' };
  }

  const tranches = position.tranches as Array<Record<string, unknown>>;
  const trancheQuantities = tranches.map(item => finiteNumber(item.qty));
  const tranchePrices = tranches.map(item => finiteNumber(item.price));
  if (trancheQuantities.some(value => value === null || value <= 0) ||
      tranchePrices.some(value => value === null || value <= 0)) {
    return { status: 'review_required', reason: 'One or more position lots have an invalid quantity or entry price.' };
  }
  const sharesBefore = trancheQuantities.reduce((total, value) => total + Number(value), 0);
  if (Math.abs(sharesBefore - position.shares) > Math.max(1e-6, position.shares * 1e-8)) {
    return { status: 'review_required', reason: 'Position quantity does not reconcile to its open lots.' };
  }
  const acquisitionDates = tranches.map(item => acquiredAtForTranche(item, position.startDate));
  if (acquisitionDates.some(value => value === null)) {
    return { status: 'review_required', reason: 'An open lot has no verifiable acquisition date.' };
  }
  if (acquisitionDates.some(value => Number(value) === effectiveAt)) {
    return { status: 'review_required', reason: 'One or more lots share the corporate-action effective date; the intraday acquisition sequence cannot be verified.' };
  }
  if (acquisitionDates.every(value => Number(value) > effectiveAt)) {
    return { status: 'not_applicable', reason: 'All open lots were acquired after the corporate-action effective date.' };
  }
  if (acquisitionDates.some(value => Number(value) > effectiveAt)) {
    return { status: 'review_required', reason: 'The position contains both pre-action and post-action lots; its aggregate price/target basis needs manual review.' };
  }

  const costBasisBefore = tranches.reduce((total, item, index) =>
    total + Number(trancheQuantities[index]) * Number(tranchePrices[index]), 0);
  const updatedTranches = tranches.map((item, index) => {
    const quantity = Number(trancheQuantities[index]) * multiplier;
    const entryPrice = Number(tranchePrices[index]) / multiplier;
    return {
      ...item,
      qty: quantity,
      price: entryPrice,
      ...(Object.prototype.hasOwnProperty.call(item, 'shares') ? { shares: quantity } : {}),
      ...(Object.prototype.hasOwnProperty.call(item, 'entryPrice') ? { entryPrice } : {})
    };
  });
  const sharesAfter = sharesBefore * multiplier;
  const costBasisAfter = updatedTranches.reduce((total, item) =>
    total + Number(item.qty) * Number(item.price), 0);
  const tolerance = Math.max(1e-6, Math.abs(costBasisBefore) * 1e-8);
  if (!Number.isFinite(sharesAfter) || sharesAfter <= 0 ||
      !Number.isFinite(costBasisAfter) || Math.abs(costBasisAfter - costBasisBefore) > tolerance) {
    return { status: 'review_required', reason: 'Split adjustment failed the quantity or cost-basis conservation check.' };
  }

  let currentPrice = position.currentPrice;
  let quoteDetails = position.quoteDetails;
  const quoteObservedAt = finiteNumber(quoteDetails?.sourceTimestamp);
  if (quoteObservedAt !== null && quoteObservedAt < effectiveAt) {
    currentPrice = position.currentPrice > 0 ? position.currentPrice / multiplier : position.currentPrice;
    quoteDetails = {
      ...quoteDetails,
      ...(finiteNumber(quoteDetails.price) !== null ? { price: Number(quoteDetails.price) / multiplier } : {}),
      freshness: 'stale',
      dataQuality: 'partial'
    };
  } else if (quoteObservedAt === null && quoteDetails) {
    quoteDetails = {
      ...quoteDetails,
      freshness: 'unknown',
      dataQuality: 'partial',
      delayClass: 'unknown',
      marketSession: 'UNKNOWN'
    };
  }

  const positionAfter: PositionRecord = {
    ...position,
    shares: sharesAfter,
    currentPrice,
    pt: Number.isFinite(position.pt) && position.pt > 0 ? position.pt / multiplier : position.pt,
    tranches: updatedTranches as PositionRecord['tranches'],
    ...(quoteDetails ? { quoteDetails } : {})
  };
  return {
    status: 'applied',
    position: positionAfter,
    sharesBefore,
    sharesAfter,
    costBasisBefore,
    costBasisAfter
  };
}

/**
 * Calculates a preview only. Cash distributions are expectations until a broker
 * cashflow confirms settlement; this helper does not post cash or P&L.
 */
export function previewCorporateActionAdjustment(
  input: CorporateActionAdjustmentInput
): CorporateActionAdjustmentPreview {
  const { kind, quantity, direction, totalCostBasis } = input;
  if (!Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isFinite(totalCostBasis) || totalCostBasis < 0) {
    return { status: 'invalid', kind, reason: 'Position quantity and total cost basis must be valid non-negative values.' };
  }
  if (direction !== 'long' && direction !== 'short') {
    return { status: 'invalid', kind, reason: 'Position direction is unsupported.' };
  }

  if (kind === 'stock_split' || kind === 'reverse_split') {
    const multiplier = positiveFinite(input.sharesAfterPerShareBefore);
    if (multiplier === null || (kind === 'stock_split' && multiplier <= 1) ||
        (kind === 'reverse_split' && multiplier >= 1)) {
      return { status: 'invalid', kind, reason: 'A verified split multiplier is required.' };
    }
    const quantityAfter = quantity * multiplier;
    if (!Number.isFinite(quantityAfter) || quantityAfter <= 0) {
      return { status: 'invalid', kind, reason: 'Split adjustment exceeds supported quantity bounds.' };
    }
    return {
      status: 'ready',
      kind,
      quantityAfter,
      totalCostBasisAfter: totalCostBasis,
      unitCostAfter: totalCostBasis / quantityAfter,
      referencePriceAfter: input.unitPrice !== undefined && Number.isFinite(input.unitPrice) && input.unitPrice > 0
        ? input.unitPrice / multiplier
        : null,
      cashEntitlement: 0,
      cashCurrency: null,
      symbolAfter: null
    };
  }

  if (kind === 'cash_dividend') {
    const amount = input.amountPerShare;
    const currency = currencyCode(input.currency);
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || !currency) {
      return { status: 'review_required', kind, reason: 'Dividend amount and currency must be verified before calculating cash entitlement.' };
    }
    return {
      status: 'ready',
      kind,
      quantityAfter: quantity,
      totalCostBasisAfter: totalCostBasis,
      unitCostAfter: totalCostBasis / quantity,
      referencePriceAfter: null,
      cashEntitlement: quantity * amount * (direction === 'long' ? 1 : -1),
      cashCurrency: currency,
      symbolAfter: null
    };
  }

  if (kind === 'symbol_change') {
    const symbol = normalizeSymbol(input.newSymbol);
    if (!symbol || !/^[A-Z0-9.^=-]{1,32}$/.test(symbol)) {
      return { status: 'review_required', kind, reason: 'A verified replacement symbol and effective date are required.' };
    }
    return {
      status: 'ready',
      kind,
      quantityAfter: quantity,
      totalCostBasisAfter: totalCostBasis,
      unitCostAfter: totalCostBasis / quantity,
      referencePriceAfter: input.unitPrice ?? null,
      cashEntitlement: 0,
      cashCurrency: null,
      symbolAfter: symbol
    };
  }

  return {
    status: 'review_required',
    kind,
    reason: kind === 'merger'
      ? 'Merger consideration and cost-basis allocation are not modeled; retain evidence for manual review.'
      : 'Spin-off share entitlement and cost-basis allocation are not modeled; retain evidence for manual review.'
  };
}
