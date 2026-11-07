export type ExchangeSession = 'PRE' | 'REGULAR' | 'BREAK' | 'POST' | 'CLOSED' | 'UNKNOWN';
type ExchangeCalendarQuality = 'complete' | 'partial';
interface ExchangeCalendarDefinition { exchange: string; timeZone: string; regularSegments: readonly { startMinute: number; endMinute: number }[]; preMarketStartMinute?: number; postMarketEndOffsetMinutes?: number; }
interface ExchangeCalendarCoverage { from: string; to: string; source: string; }
export interface VerifiedExchangeMarketStatus {
  isOpen: boolean;
  session: ExchangeSession | null;
  holiday: string | null;
  timeZone: string;
  observedAt: number;
  receivedAt: number;
}
export interface ExchangeCalendarInput { exchange: string; at: number | Date; holidays?: readonly string[]; earlyCloses?: Readonly<Record<string, number>>; coverage?: ExchangeCalendarCoverage; verifiedEventDates?: readonly string[]; verifiedEventSource?: string; marketStatus?: VerifiedExchangeMarketStatus; }
export interface ExchangeSessionResult { exchange: string; timeZone: string; localDate: string; localMinute: number; session: ExchangeSession; calendarQuality: ExchangeCalendarQuality; holidayCoverageSource: string | null; nextSessionStartLocalMinute: number | null; }

const DEFINITIONS: readonly ExchangeCalendarDefinition[] = [
  { exchange: 'NASDAQ', timeZone: 'America/New_York', regularSegments: [{ startMinute: 570, endMinute: 960 }], preMarketStartMinute: 240, postMarketEndOffsetMinutes: 240 },
  { exchange: 'NYSE', timeZone: 'America/New_York', regularSegments: [{ startMinute: 570, endMinute: 960 }], preMarketStartMinute: 240, postMarketEndOffsetMinutes: 240 },
  { exchange: 'US', timeZone: 'America/New_York', regularSegments: [{ startMinute: 570, endMinute: 960 }], preMarketStartMinute: 240, postMarketEndOffsetMinutes: 240 },
  { exchange: 'TSX', timeZone: 'America/Toronto', regularSegments: [{ startMinute: 570, endMinute: 960 }], preMarketStartMinute: 240, postMarketEndOffsetMinutes: 240 },
  { exchange: 'LSE', timeZone: 'Europe/London', regularSegments: [{ startMinute: 480, endMinute: 990 }], preMarketStartMinute: 420, postMarketEndOffsetMinutes: 60 },
  { exchange: 'XETRA', timeZone: 'Europe/Berlin', regularSegments: [{ startMinute: 540, endMinute: 1050 }], preMarketStartMinute: 480, postMarketEndOffsetMinutes: 90 },
  { exchange: 'TSE', timeZone: 'Asia/Tokyo', regularSegments: [{ startMinute: 540, endMinute: 690 }, { startMinute: 750, endMinute: 930 }] },
  { exchange: 'HKEX', timeZone: 'Asia/Hong_Kong', regularSegments: [{ startMinute: 570, endMinute: 720 }, { startMinute: 780, endMinute: 960 }] }
];
function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function partsAt(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === key)?.value ?? '';
  return { year: Number(get('year')), month: Number(get('month')), day: Number(get('day')), weekday: get('weekday'), hour: Number(get('hour')), minute: Number(get('minute')) };
}
const EXCHANGE_ALIASES: Readonly<Record<string, string>> = {
  NASDAQ: 'NASDAQ', NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ',
  NYSE: 'NYSE', NYQ: 'NYSE',
  US: 'US', AMEX: 'US', ASE: 'US',
  TSX: 'TSX', TOR: 'TSX',
  LSE: 'LSE', L: 'LSE',
  XETRA: 'XETRA', XETR: 'XETRA', DE: 'XETRA',
  TSE: 'TSE', TYO: 'TSE', T: 'TSE',
  HKEX: 'HKEX', HKG: 'HKEX', HK: 'HKEX'
};

export function normalizeExchangeCalendarId(exchange: string): string | null {
  return EXCHANGE_ALIASES[exchange.trim().toUpperCase()] ?? null;
}

function getExchangeCalendarDefinition(exchange: string): ExchangeCalendarDefinition | null {
  const canonical = normalizeExchangeCalendarId(exchange);
  return canonical ? DEFINITIONS.find(item => item.exchange === canonical) ?? null : null;
}
export function resolveExchangeSession(input: ExchangeCalendarInput): ExchangeSessionResult {
  const definition = getExchangeCalendarDefinition(input.exchange);
  if (!definition) return { exchange: input.exchange.trim().toUpperCase(), timeZone: '', localDate: '', localMinute: 0, session: 'UNKNOWN', calendarQuality: 'partial', holidayCoverageSource: null, nextSessionStartLocalMinute: null };
  const at = input.at instanceof Date ? input.at : new Date(input.at);
  if (!Number.isFinite(at.getTime())) throw new Error('A valid exchange session timestamp is required.');
  const p = partsAt(at, definition.timeZone);
  const localDate = String(p.year).padStart(4, '0') + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  const localMinute = p.hour * 60 + p.minute;
  const weekend = p.weekday === 'Sat' || p.weekday === 'Sun';
  const coverage = input.coverage;
  const covered = Boolean(coverage && isDateOnly(coverage.from) && isDateOnly(coverage.to) &&
    coverage.from <= coverage.to && coverage.from <= localDate && localDate <= coverage.to && coverage.source.trim());
  const explicitHoliday = (input.holidays ?? []).includes(localDate);
  const verifiedEventDate = Boolean(input.verifiedEventSource?.trim()) && (input.verifiedEventDates ?? []).includes(localDate);
  const earlyClose = input.earlyCloses?.[localDate];
  const segments = definition.regularSegments.map((segment, index) => ({
    startMinute: segment.startMinute,
    endMinute: earlyClose !== undefined && index === definition.regularSegments.length - 1
      ? Math.min(segment.endMinute, earlyClose) : segment.endMinute
  }));
  let session: ExchangeSession = 'CLOSED';
  let nextSessionStartLocalMinute: number | null = null;
  if (!weekend && !explicitHoliday) {
    const current = segments.find(segment => localMinute >= segment.startMinute && localMinute < segment.endMinute);
    if (current) { session = 'REGULAR'; nextSessionStartLocalMinute = current.endMinute; }
    else {
      const previous = [...segments].reverse().find(segment => localMinute >= segment.endMinute);
      const upcoming = segments.find(segment => localMinute < segment.startMinute);
      if (previous && upcoming && localMinute >= previous.endMinute && localMinute < upcoming.startMinute) {
        session = 'BREAK'; nextSessionStartLocalMinute = upcoming.startMinute;
      } else if (definition.preMarketStartMinute !== undefined && localMinute >= definition.preMarketStartMinute && localMinute < segments[0].startMinute) {
        session = 'PRE'; nextSessionStartLocalMinute = segments[0].startMinute;
      } else if (definition.postMarketEndOffsetMinutes !== undefined &&
        localMinute >= segments[segments.length - 1].endMinute &&
        localMinute < segments[segments.length - 1].endMinute + definition.postMarketEndOffsetMinutes) session = 'POST';
    }
  }
  const marketStatus = input.marketStatus;
  const statusAt = Number.isFinite(marketStatus?.observedAt) ? marketStatus!.observedAt : null;
  const statusReceivedAt = Number.isFinite(marketStatus?.receivedAt) ? marketStatus!.receivedAt : null;
  const statusLocal = statusAt === null ? null : partsAt(new Date(statusAt), definition.timeZone);
  const statusLocalDate = statusLocal
    ? String(statusLocal.year).padStart(4, '0') + '-' + String(statusLocal.month).padStart(2, '0') + '-' + String(statusLocal.day).padStart(2, '0')
    : null;
  const verifiedStatus = Boolean(marketStatus &&
    marketStatus.timeZone === definition.timeZone &&
    statusAt !== null && statusReceivedAt !== null &&
    statusAt <= at.getTime() + 60_000 && statusAt >= at.getTime() - 5 * 60_000 &&
    statusReceivedAt <= at.getTime() + 60_000 && statusReceivedAt >= at.getTime() - 5 * 60_000 &&
    statusLocalDate === localDate);
  if (verifiedStatus) {
    if (marketStatus!.holiday) session = 'CLOSED';
    else if (marketStatus!.session) session = marketStatus!.session;
    else if (marketStatus!.isOpen) session = 'REGULAR';
  }
  const calendarQuality: ExchangeCalendarQuality = weekend || covered || verifiedEventDate || verifiedStatus ? 'complete' : 'partial';
  if (calendarQuality === 'partial' && session === 'CLOSED' && !weekend) session = 'UNKNOWN';
  return { exchange: definition.exchange, timeZone: definition.timeZone, localDate, localMinute, session, calendarQuality, holidayCoverageSource: covered ? coverage!.source : verifiedEventDate ? input.verifiedEventSource!.trim() : verifiedStatus ? 'Finnhub market-status' : null, nextSessionStartLocalMinute };
}

export type IntervalFreshness = 'fresh' | 'delayed' | 'stale' | 'unknown';
export function classifyMarketHistoryFreshness(input: { observedAt: number | null; now: number; interval: string; session: ExchangeSessionResult }): IntervalFreshness {
  if (input.observedAt === null || !Number.isFinite(input.observedAt) || !Number.isFinite(input.now) ||
    input.observedAt > input.now || input.session.calendarQuality !== 'complete' || input.session.session === 'UNKNOWN') return 'unknown';
  const age = input.now - input.observedAt;
  const interval = input.interval.trim().toUpperCase();
  const intraday = /^(\d+)(M)?$/.exec(interval);
  if (intraday) {
    const expectedMs = Number(intraday[1]) * 60_000;
    if (input.session.session === 'REGULAR' && age <= expectedMs * 2.5) return 'fresh';
    return age <= Math.max(expectedMs * 4, 15 * 60_000) ? 'delayed' : 'stale';
  }
  if (['1H', '60M'].includes(interval)) {
    if (input.session.session === 'REGULAR' && age <= 150 * 60_000) return 'fresh';
    return age <= 5 * 60 * 60_000 ? 'delayed' : 'stale';
  }
  if (['D', '1D'].includes(interval)) {
    if (input.session.session === 'REGULAR') return age <= 36 * 60 * 60_000 ? 'delayed' : 'stale';
    return age <= 36 * 60 * 60_000 ? 'fresh' : age <= 72 * 60 * 60_000 ? 'delayed' : 'stale';
  }
  if (['W', '1W'].includes(interval)) return age <= 9 * 86400000 ? 'fresh' : age <= 14 * 86400000 ? 'delayed' : 'stale';
  if (['M', '1MO', '1MON'].includes(interval)) return age <= 45 * 86400000 ? 'fresh' : age <= 60 * 86400000 ? 'delayed' : 'stale';
  return 'unknown';
}
