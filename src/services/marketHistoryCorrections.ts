import type { MarketPricePoint } from './marketDataContracts';
import type { MarketHistoryCorrectionEvent } from '../types/marketHistory';
export type { MarketHistoryCorrectionEvent } from '../types/marketHistory';

export interface MarketHistoryCorrectionDraft {
  symbol: string;
  interval: string;
  timestamp: number;
  provider: string;
  receivedAt: number;
  recordedAt?: number;
  previous: MarketPricePoint | null;
  corrected: MarketPricePoint | null;
  reason: string;
  sourceId?: string;
}

export interface MarketHistoryCorrectionReplayResult {
  status: 'complete' | 'review_required';
  points: MarketPricePoint[];
  appliedCount: number;
  issues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPoint(value: unknown, timestamp: number): value is MarketPricePoint {
  if (!isRecord(value) || value.timestamp !== timestamp ||
      typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price <= 0) return false;
  for (const field of ['open', 'high', 'low'] as const) {
    const optional = value[field];
    if (optional !== undefined && (typeof optional !== 'number' || !Number.isFinite(optional) || optional <= 0)) return false;
  }
  if (value.volume !== undefined && (typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume < 0)) return false;
  if (typeof value.high === 'number' && typeof value.low === 'number' && value.high < value.low) return false;
  return true;
}

function normalizePoint(value: MarketPricePoint | null, timestamp: number): MarketPricePoint | null {
  if (value === null) return null;
  if (!validPoint(value, timestamp)) throw new TypeError('History correction contains an invalid before/after candle.');
  return {
    timestamp: value.timestamp,
    price: value.price,
    ...(value.open !== undefined ? { open: value.open } : {}),
    ...(value.high !== undefined ? { high: value.high } : {}),
    ...(value.low !== undefined ? { low: value.low } : {}),
    ...(value.volume !== undefined ? { volume: value.volume } : {})
  };
}

function canonicalPoint(point: MarketPricePoint | null): string {
  return point === null ? 'null' : JSON.stringify({
    timestamp: point.timestamp,
    price: point.price,
    open: point.open ?? null,
    high: point.high ?? null,
    low: point.low ?? null,
    volume: point.volume ?? null
  });
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createMarketHistoryCorrectionEvent(
  draft: MarketHistoryCorrectionDraft
): MarketHistoryCorrectionEvent {
  const symbol = draft.symbol.trim().toUpperCase();
  const interval = draft.interval.trim().toUpperCase();
  const provider = draft.provider.trim().toUpperCase();
  const reason = draft.reason.trim();
  if (!/^[A-Z0-9.^=-]{1,32}$/.test(symbol) ||
      !/^[A-Z0-9]{1,8}$/.test(interval) ||
      !provider || provider.length > 64 ||
      !Number.isSafeInteger(draft.timestamp) || draft.timestamp <= 0 ||
      !Number.isSafeInteger(draft.receivedAt) || draft.receivedAt <= 0 ||
      !Number.isSafeInteger(draft.recordedAt ?? Date.now()) || (draft.recordedAt ?? Date.now()) <= 0 ||
      !reason || reason.length > 1000) {
    throw new TypeError('History correction requires a valid instrument, interval, timestamps, provider and reason.');
  }
  if (draft.previous === null && draft.corrected === null) {
    throw new TypeError('History correction must retain a previous or corrected candle.');
  }
  if (canonicalPoint(draft.previous) === canonicalPoint(draft.corrected)) {
    throw new TypeError('History correction before/after values must differ.');
  }
  const previous = normalizePoint(draft.previous, draft.timestamp);
  const corrected = normalizePoint(draft.corrected, draft.timestamp);
  const evidence = [
    provider, symbol, interval, draft.timestamp,
    canonicalPoint(previous), canonicalPoint(corrected), reason
  ].join('|');
  const sourceId = draft.sourceId?.trim() || [
    provider.toLowerCase(), symbol, interval, draft.timestamp, stableHash(evidence)
  ].join(':');
  if (sourceId.length > 200) throw new RangeError('History correction source ID is too long.');
  const recordedAt = draft.recordedAt ?? Date.now();
  return {
    schemaVersion: 1,
    id: sourceId,
    sourceId,
    symbol,
    interval,
    timestamp: draft.timestamp,
    provider,
    receivedAt: draft.receivedAt,
    recordedAt,
    previous,
    corrected,
    reason
  };
}

export function isMarketHistoryCorrectionEvent(value: unknown): value is MarketHistoryCorrectionEvent {
  if (!isRecord(value) || value.schemaVersion !== 1 ||
      typeof value.id !== 'string' || !value.id.trim() || value.id.length > 200 ||
      typeof value.sourceId !== 'string' || !value.sourceId.trim() || value.sourceId.length > 200 ||
      typeof value.symbol !== 'string' || !/^[A-Z0-9.^=-]{1,32}$/.test(value.symbol) ||
      typeof value.interval !== 'string' || !/^[A-Z0-9]{1,8}$/.test(value.interval) ||
      !Number.isSafeInteger(value.timestamp) || Number(value.timestamp) <= 0 ||
      typeof value.provider !== 'string' || !value.provider.trim() || value.provider.length > 64 ||
      !Number.isSafeInteger(value.receivedAt) || Number(value.receivedAt) <= 0 ||
      !Number.isSafeInteger(value.recordedAt) || Number(value.recordedAt) <= 0 ||
      typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000 ||
      (value.previous === null && value.corrected === null)) return false;
  if (value.previous !== null && !validPoint(value.previous, Number(value.timestamp))) return false;
  if (value.corrected !== null && !validPoint(value.corrected, Number(value.timestamp))) return false;
  return canonicalPoint(value.previous as MarketPricePoint | null) !==
    canonicalPoint(value.corrected as MarketPricePoint | null);
}

export function isMarketHistoryCorrectionEventList(value: unknown): value is MarketHistoryCorrectionEvent[] {
  return Array.isArray(value) && value.every(isMarketHistoryCorrectionEvent);
}

/** Merge immutable correction evidence; a reused source ID cannot change its before/after values. */
export function mergeMarketHistoryCorrectionEvents(
  current: readonly MarketHistoryCorrectionEvent[],
  incoming: readonly MarketHistoryCorrectionEvent[]
): MarketHistoryCorrectionEvent[] {
  if (!isMarketHistoryCorrectionEventList(current) || !isMarketHistoryCorrectionEventList(incoming)) {
    throw new TypeError('Historical correction journal is malformed.');
  }
  const merged = new Map<string, MarketHistoryCorrectionEvent>();
  for (const event of [...current, ...incoming]) {
    const previous = merged.get(event.sourceId);
    if (previous) {
      const same = previous.symbol === event.symbol &&
        previous.interval === event.interval &&
        previous.timestamp === event.timestamp &&
        previous.provider === event.provider &&
        canonicalPoint(previous.previous) === canonicalPoint(event.previous) &&
        canonicalPoint(previous.corrected) === canonicalPoint(event.corrected) &&
        previous.reason === event.reason;
      if (!same) throw new Error('A history correction source ID was reused for different evidence.');
      continue;
    }
    merged.set(event.sourceId, event);
  }
  return [...merged.values()].sort((a, b) =>
    a.recordedAt - b.recordedAt || a.sourceId.localeCompare(b.sourceId)
  );
}

/**
 * Replay correction evidence against a series. A correction is applied only if
 * the current point equals its recorded 'previous' value. A point already equal
 * to the correction's 'corrected' value is treated as an idempotent replay.
 */
export function replayMarketHistoryCorrections(
  sourcePoints: readonly MarketPricePoint[],
  events: readonly MarketHistoryCorrectionEvent[]
): MarketHistoryCorrectionReplayResult {
  if (!isMarketHistoryCorrectionEventList(events)) {
    return { status: 'review_required', points: [...sourcePoints], appliedCount: 0, issues: ['Historical correction journal is malformed.'] };
  }
  const points = new Map<number, MarketPricePoint>();
  for (const point of sourcePoints) {
    if (!validPoint(point, point.timestamp)) {
      return { status: 'review_required', points: [...sourcePoints], appliedCount: 0, issues: ['Original historical series contains an invalid candle.'] };
    }
    points.set(point.timestamp, { ...point });
  }
  let appliedCount = 0;
  const issues: string[] = [];
  const ordered = [...events].sort((a, b) =>
    a.recordedAt - b.recordedAt || a.sourceId.localeCompare(b.sourceId)
  );
  for (const event of ordered) {
    if (event.symbol !== ordered[0]?.symbol || event.interval !== ordered[0]?.interval) {
      issues.push('Historical correction journal mixes instruments or intervals.');
      return { status: 'review_required', points: [...points.values()].sort((a, b) => a.timestamp - b.timestamp), appliedCount, issues };
    }
    const current = points.get(event.timestamp) ?? null;
    if (canonicalPoint(current) === canonicalPoint(event.corrected)) continue;
    if (canonicalPoint(current) !== canonicalPoint(event.previous)) {
      issues.push('History correction ' + event.sourceId + ' no longer matches its recorded before-value; manual review is required.');
      return { status: 'review_required', points: [...points.values()].sort((a, b) => a.timestamp - b.timestamp), appliedCount, issues };
    }
    if (event.corrected === null) points.delete(event.timestamp);
    else points.set(event.timestamp, { ...event.corrected });
    appliedCount += 1;
  }
  return {
    status: 'complete',
    points: [...points.values()].sort((a, b) => a.timestamp - b.timestamp),
    appliedCount,
    issues
  };
}
