const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatTrancheDate(dateStr?: string | number | null): string {
  if (!dateStr || typeof dateStr !== 'string') return 'New';
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new') return 'New';

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
    }
  }

  const shortMatch =
    trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})/i) ||
    trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2})/i);
  if (shortMatch) {
    const isFirstNum = /^\d+$/.test(shortMatch[1]);
    const day = parseInt(isFirstNum ? shortMatch[1] : shortMatch[2], 10);
    const monStr = (isFirstNum ? shortMatch[2] : shortMatch[1]).slice(0, 3).toLowerCase();
    const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === monStr);
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return `${String(day).padStart(2, '0')}${MONTH_NAMES[monthIdx]}`;
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const day = parsed.getDate();
    const month = parsed.getMonth();
    return `${String(day).padStart(2, '0')}${MONTH_NAMES[month]}`;
  }

  return trimmed;
}

export function formatUSD(val: unknown): string {
  const num = Number(val) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type QuoteFreshness = 'fresh' | 'stale' | 'delayed' | 'unknown' | 'unavailable';

interface QuoteFreshnessInput {
  quoteUpdatedAt?: number;
  quoteSource?: string;
  sourceTimestamp?: number;
  marketState?: string;
  quoteDetails?: {
    sourceTimestamp?: number;
    marketState?: string;
  };
}

export function getQuoteFreshness(
  holding: QuoteFreshnessInput,
  now = Date.now(),
  refreshIntervalMs = 60000
): QuoteFreshness {
  if (holding.quoteSource === 'Manual' || holding.quoteSource === 'Trade input') return 'unavailable';
  const sourceTimestamp = Number(holding.sourceTimestamp ?? holding.quoteDetails?.sourceTimestamp);
  if (!Number.isFinite(sourceTimestamp) || sourceTimestamp <= 0) {
    return holding.quoteUpdatedAt ? 'unknown' : 'unavailable';
  }

  const staleAfterMs = Math.max(5 * 60 * 1000, refreshIntervalMs * 2);
  const ageMs = now - sourceTimestamp;
  if (ageMs < 0) return 'stale';
  const marketState = holding.marketState ?? holding.quoteDetails?.marketState;
  if (ageMs > staleAfterMs) return marketState === 'CLOSED' ? 'delayed' : 'stale';
  return 'fresh';
}

export function formatQuoteMetadata(
  holding: QuoteFreshnessInput,
  refreshIntervalMs = 60000
): string {
  const freshness = getQuoteFreshness(holding, Date.now(), refreshIntervalMs);
  if (freshness === 'unavailable') return holding.quoteSource || 'Not fetched';
  const source = holding.quoteSource ? `${holding.quoteSource} · ` : '';
  if (freshness === 'unknown') return `Quote time unknown · ${holding.quoteSource || 'source unavailable'}`;

  const sourceTimestamp = Number(holding.sourceTimestamp ?? holding.quoteDetails?.sourceTimestamp);
  const time = new Date(sourceTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const freshnessLabel = freshness === 'stale' ? 'Stale · ' : freshness === 'delayed' ? 'Delayed · ' : '';
  return `${freshnessLabel}${source}${time}`;
}

export function formatRiskTrigger(triggerValue: number, currentValue: number): string {
  if (currentValue <= 0) return `Position value ${formatUSD(triggerValue)}`;

  const bufferPct = ((currentValue - triggerValue) / currentValue) * 100;
  if (bufferPct < 0) {
    return `Position value ${formatUSD(triggerValue)} (already${Math.abs(bufferPct).toFixed(1)}% below trigger)`;
  }
  return `Position value ${formatUSD(triggerValue)} (${bufferPct.toFixed(1)}% buffer)`;
}
