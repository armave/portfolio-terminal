export type CorporateActionKind =
  | 'stock_split'
  | 'reverse_split'
  | 'cash_dividend'
  | 'symbol_change'
  | 'merger'
  | 'spin_off';

export interface CorporateActionEvent {
  id: string;
  sourceId: string;
  symbol: string;
  kind: 'stock_split' | 'reverse_split';
  effectiveDate: string;
  fromFactor: number;
  toFactor: number;
  /** New shares received per old share. Finnhub reports AAPL's 2014 7-for-1 as 1 -> 7. */
  sharesAfterPerShareBefore: number;
  provider: string;
  receivedAt: number;
}

export type CorporateActionFeedQuality = 'complete' | 'partial' | 'unavailable';

export interface CorporateActionFeedResult {
  events: CorporateActionEvent[];
  quality: CorporateActionFeedQuality;
  issues: string[];
}

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

function normalizeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function currencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/**
 * Normalize the provider's split evidence without posting it to the portfolio.
 * Conflicting actions for one symbol/date are withheld instead of picking the
 * last returned row. Replaying identical rows is idempotent.
 */
export function normalizeFinnhubStockSplits(
  input: unknown,
  options: { symbol: string; provider?: unknown; receivedAt?: unknown; available?: boolean }
): CorporateActionFeedResult {
  const expectedSymbol = normalizeSymbol(options.symbol);
  const provider = typeof options.provider === 'string' ? options.provider.trim().toUpperCase() : '';
  const receivedAt = Number(options.receivedAt);
  const issues: string[] = [];
  if (!expectedSymbol || !/^[A-Z0-9.^=-]{1,20}$/.test(expectedSymbol)) {
    return { events: [], quality: 'unavailable', issues: ['Corporate-action symbol is invalid.'] };
  }
  if (!provider || !Number.isFinite(receivedAt) || receivedAt <= 0) {
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

/**
 * Calculates a preview only. Callers must persist/execute a user-approved event
 * separately; this helper never mutates positions, cash, or transaction history.
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
      unitCostAfter: quantity > 0 ? totalCostBasis / quantity : null,
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
      unitCostAfter: quantity > 0 ? totalCostBasis / quantity : null,
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
