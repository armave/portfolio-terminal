import { getAppLanguage, translateText } from '../services/i18n';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function currentNumberLocale(): string {
  return getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
}

function formatRussianMonth(monthIndex: number): string {
  return new Intl.DateTimeFormat('ru-RU', { month: 'short' }).format(new Date(2000, monthIndex, 1));
}

export function formatTrancheDate(dateStr?: string | number | null): string {
  if (!dateStr || typeof dateStr !== 'string') return translateText('New');
  const trimmed = dateStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new') return translateText('New');
  const isRussian = getAppLanguage() === 'ru';

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      if (!isRussian) return `${String(day).padStart(2, '0')} ${MONTH_NAMES[month]}`;
      const date = new Date(year, month, day);
      return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(date);
    }
  }

  const shortMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3,})/i) ||
    trimmed.match(/^([A-Za-z]{3,})\s+(\d{1,2})/i);
  if (shortMatch) {
    const firstIsDay = /^\d+$/.test(shortMatch[1]);
    const day = Number(firstIsDay ? shortMatch[1] : shortMatch[2]);
    const monthText = (firstIsDay ? shortMatch[2] : shortMatch[1]).slice(0, 3).toLowerCase();
    const monthIndex = MONTH_NAMES.findIndex((month) => month.toLowerCase() === monthText);
    if (monthIndex >= 0 && day >= 1 && day <= 31) {
      const dayText = String(day).padStart(2, '0');
      return isRussian ? dayText + ' ' + formatRussianMonth(monthIndex) : dayText + MONTH_NAMES[monthIndex];
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    if (!isRussian) return `${String(parsed.getDate()).padStart(2, '0')} ${MONTH_NAMES[parsed.getMonth()]}`;
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short' }).format(parsed);
  }
  return trimmed;
}

export function formatUSD(val: unknown): string {
  const num = Number(val) || 0;
  return num.toLocaleString(currentNumberLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  if (freshness === 'unavailable') return holding.quoteSource || translateText('Not fetched');
  const source = holding.quoteSource ? `${holding.quoteSource} · ` : '';
  if (freshness === 'unknown') return `${holding.quoteSource || translateText('Source unavailable')}`;

  const sourceTimestamp = Number(holding.sourceTimestamp ?? holding.quoteDetails?.sourceTimestamp);
  const locale = getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US';
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(sourceTimestamp);
  const freshnessLabel = freshness === 'stale'
    ? `${translateText('Stale')} · `
    : freshness === 'delayed' ? `${translateText('Delayed')} · ` : '';
  return `${freshnessLabel}${source}${time}`;
}

export function formatRiskTrigger(triggerValue: number, currentValue: number): string {
  if (currentValue <= 0) return `Position value ${formatUSD(triggerValue)}`;

  const bufferPct = ((currentValue - triggerValue) / currentValue) * 100;
  if (bufferPct < 0) {
    return `Position value ${formatUSD(triggerValue)} (already${Math.abs(bufferPct).toFixed(1)}% below trigger)`;
  }
  return `Position value ${formatUSD(triggerValue)}`;
}


/**
 * Decode HTML character references in plain text without parsing HTML.
 * Unknown entities are preserved, and decoding happens only once.
 */
export function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&', apos: "'", quot: '"', lt: '<', gt: '>',
    nbsp: '\u00a0', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
    hellip: '\u2026', ndash: '\u2013', mdash: '\u2014',
    lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
    bull: '\u2022', euro: '\u20ac', pound: '\u00a3', yen: '\u00a5',
    cent: '\u00a2', deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7',
    divide: '\u00f7', acute: '\u00b4', laquo: '\u00ab', raquo: '\u00bb',
    sect: '\u00a7', para: '\u00b6', middot: '\u00b7',
  };

  return text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z\d]+);/gi, (entity, reference: string) => {
    if (reference[0] !== '#') return namedEntities[reference.toLowerCase()] ?? entity;

    const isHex = reference[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(reference.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    if (
      !Number.isInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return '\ufffd';
    }

    return String.fromCodePoint(codePoint);
  });
}
