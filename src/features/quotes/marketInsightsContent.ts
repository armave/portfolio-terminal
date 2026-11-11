import { formatRelativeTime } from '../../utils/relativeTime';

export function formatNewsRelativeTime(datetime: unknown, now = Date.now()): string {
  if ((typeof datetime !== 'number' && typeof datetime !== 'string') ||
      (typeof datetime === 'string' && !datetime.trim())) {
    return formatRelativeTime(Number.NaN, now);
  }

  const seconds = Number(datetime);
  if (!Number.isFinite(seconds) || seconds <= 0) return formatRelativeTime(Number.NaN, now);
  return formatRelativeTime(seconds * 1000, now);
}

/** Selects events closest to today, then returns them in chronological display order. */
export function getClosestDatedMarketEvents<T>(
  events: readonly T[],
  getDate: (event: T) => string,
  now = Date.now(),
  limit = 5
): T[] {
  const today = new Date(now);
  const todayAtUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const ranked = events.flatMap((event, index) => {
    const value = getDate(event);
    const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? Date.parse(value + 'T00:00:00.000Z')
      : Number.NaN;
    return Number.isFinite(parsed)
      ? [{ event, index, date: parsed, distance: Math.abs(parsed - todayAtUtc) }]
      : [];
  }).sort((a, b) => a.distance - b.distance || a.date - b.date || a.index - b.index);

  return ranked.slice(0, Math.max(0, Math.floor(limit)))
    .sort((a, b) => a.date - b.date || a.index - b.index)
    .map(item => item.event);
}

const STOCKTWITS_CASHTAG_PATTERN = /\$([A-Z][A-Z0-9.-]{0,9})\b/gi;

export function isStandaloneStocktwitsMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const value = message as {
    conversation?: { parent_message_id?: number | string | null } | null;
    in_reply_to?: unknown;
    reply_to?: unknown;
  };
  return value.conversation?.parent_message_id == null &&
    value.in_reply_to == null &&
    value.reply_to == null;
}

function getStocktwitsSentiment(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null;
  const value = message as {
    sentiment?: { basic?: string | null } | null;
    entities?: { sentiment?: { basic?: string | null } | null } | null;
  };
  const sentiment = value.sentiment?.basic ?? value.entities?.sentiment?.basic;
  return typeof sentiment === 'string' ? sentiment.trim() : null;
}

export function isBearishStocktwitsMessage(message: unknown): boolean {
  return getStocktwitsSentiment(message)?.toLowerCase() === 'bearish';
}

export function getStocktwitsCashtags(body: unknown): string[] {
  if (typeof body !== 'string') return [];
  return Array.from(new Set(
    Array.from(body.matchAll(STOCKTWITS_CASHTAG_PATTERN), (match) => match[1].toUpperCase())
  ));
}

export function hasStocktwitsCommentary(body: unknown): boolean {
  if (typeof body !== 'string') return false;
  return body
    .replace(STOCKTWITS_CASHTAG_PATTERN, '')
    .replace(/[\s.,!?;:\(\)\[\]{}|\/\\-]+/g, '')
    .length > 0;
}

export function getVisibleStocktwitsMessages<T>(messages: T[], limit = 10): T[] {
  return messages
    .filter(isStandaloneStocktwitsMessage)
    .filter((message) => !isBearishStocktwitsMessage(message))
    .slice(0, Math.max(0, Math.floor(limit)));
}
