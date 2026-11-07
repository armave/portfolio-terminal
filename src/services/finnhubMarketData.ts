import { proxyFetch } from './api';
import {
  normalizeMarketHistoryResponse,
  type InstrumentIdentity,
  type MarketHistoryRequest,
  type MarketHistoryResult
} from './marketDataContracts';
import { normalizeMarketEventsResponse, type MarketEventsResult } from './marketEvents';
import { classifyMarketHistoryFreshness, normalizeExchangeCalendarId, resolveExchangeSession, type ExchangeSession, type VerifiedExchangeMarketStatus } from './exchangeCalendar';

function providerSymbol(instrument: InstrumentIdentity): string {
  const mapped = instrument.providerSymbols.FINNHUB;
  if (mapped) return mapped;
  return instrument.symbol;
}

function resolutionFromInterval(interval: string): string {
  const token = interval.trim().toUpperCase();
  if (['1', '5', '15', '30', '60', 'D', 'W', 'M'].includes(token)) return token;
  if (token === '1M') return '1';
  if (token === '5M') return '5';
  if (token === '15M') return '15';
  if (token === '30M') return '30';
  if (token === '1H' || token === '60M') return '60';
  if (token === '1D') return 'D';
  if (token === '1W') return 'W';
  if (token === '1MO' || token === '1MON') return 'M';
  throw new Error('Unsupported Finnhub history interval.');
}

export interface MarketCalendarSnapshot {
  exchange: string;
  providerExchange: string;
  timeZone: string;
  receivedAt: number;
  holidays: string[];
  earlyCloses: Record<string, number>;
  events: Array<{ date: string; name: string | null; kind: 'CLOSED' | 'EARLY_CLOSE'; earlyCloseMinute: number | null }>;
  marketStatus: VerifiedExchangeMarketStatus;
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeExchangeSession(value: unknown): ExchangeSession | null {
  const session = typeof value === 'string' ? value.trim().toLowerCase().replace(/[ _]/g, '-') : '';
  if (['pre', 'pre-market', 'premarket'].includes(session)) return 'PRE';
  if (['regular', 'open', 'market'].includes(session)) return 'REGULAR';
  if (['break', 'lunch-break', 'intermission'].includes(session)) return 'BREAK';
  if (['post', 'post-market', 'postmarket'].includes(session)) return 'POST';
  if (['closed', 'close', 'after-hours'].includes(session)) return 'CLOSED';
  return null;
}

export async function fetchFinnhubMarketCalendar(
  exchange: string,
  options: { signal?: AbortSignal } = {}
): Promise<MarketCalendarSnapshot> {
  const normalizedExchange = normalizeExchangeCalendarId(exchange);
  if (!normalizedExchange) throw new Error('Unsupported exchange for market calendar lookup.');
  const payload = await proxyFetch('market-calendar', { exchange: normalizedExchange }, {
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!payload || payload.ok !== true || payload.provider !== 'Finnhub' ||
      String(payload.exchange || '').toUpperCase() !== normalizedExchange ||
      typeof payload.providerExchange !== 'string' || !payload.providerExchange ||
      typeof payload.timeZone !== 'string' || !payload.timeZone.trim()) {
    throw new Error('Finnhub returned an unverified exchange calendar.');
  }
  const receivedAt = typeof payload.receivedAt === 'number' ? payload.receivedAt : Number(payload.receivedAt);
  const market = payload.marketStatus && typeof payload.marketStatus === 'object' ? payload.marketStatus : null;
  const observedAt = market ? (typeof market.timestamp === 'number' ? market.timestamp : Number(market.timestamp)) : Number.NaN;
  const statusTimeZone = market && typeof market.timeZone === 'string' ? market.timeZone : '';
  const statusReceivedAt = receivedAt;
  if (!Number.isFinite(receivedAt) || receivedAt <= 0 ||
      !market || !Number.isFinite(observedAt) || observedAt <= 0 ||
      statusTimeZone !== payload.timeZone) {
    throw new Error('Finnhub exchange calendar is missing a verifiable market-status timestamp or timezone.');
  }
  const holidays = Array.isArray(payload.holidays)
    ? payload.holidays.filter(isCalendarDate) : [];
  const earlyCloses: Record<string, number> = {};
  if (payload.earlyCloses && typeof payload.earlyCloses === 'object' && !Array.isArray(payload.earlyCloses)) {
    for (const [date, minuteValue] of Object.entries(payload.earlyCloses as Record<string, unknown>)) {
      const minute = typeof minuteValue === 'number' ? minuteValue : Number(minuteValue);
      if (isCalendarDate(date) && Number.isInteger(minute) && minute > 0 && minute < 1440) earlyCloses[date] = minute;
    }
  }
  const events = Array.isArray(payload.events) ? payload.events.flatMap((event: unknown) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) return [];
    const row = event as Record<string, unknown>;
    if (!isCalendarDate(row.date)) return [];
    if (row.kind === 'EARLY_CLOSE') {
      const minute = Number(row.earlyCloseMinute);
      if (!Number.isInteger(minute) || minute <= 0 || minute >= 1440) return [];
      return [{ date: row.date, name: typeof row.name === 'string' ? row.name : null, kind: 'EARLY_CLOSE' as const, earlyCloseMinute: minute }];
    }
    if (row.kind === 'CLOSED') return [{ date: row.date, name: typeof row.name === 'string' ? row.name : null, kind: 'CLOSED' as const, earlyCloseMinute: null }];
    return [];
  }) : [];
  const isOpen = market.isOpen === true;
  const holiday = typeof market.holiday === 'string' && market.holiday.trim() ? market.holiday.trim() : null;
  const session = normalizeExchangeSession(market.session);
  return {
    exchange: normalizedExchange,
    providerExchange: payload.providerExchange,
    timeZone: payload.timeZone,
    receivedAt,
    holidays,
    earlyCloses,
    events,
    marketStatus: { isOpen, session, holiday, timeZone: statusTimeZone, observedAt, receivedAt: statusReceivedAt }
  };
}

export async function fetchFinnhubHistory(
  request: MarketHistoryRequest,
  options: { force?: boolean } = {}
): Promise<MarketHistoryResult> {
  const symbol = providerSymbol(request.instrument);
  if (!symbol || !/^[A-Z0-9.^=-]{1,20}$/i.test(symbol)) {
    throw new Error('The instrument has no valid Finnhub symbol mapping.');
  }
  if (!Number.isFinite(request.startAt) || !Number.isFinite(request.endAt) ||
      request.startAt <= 0 || request.endAt <= request.startAt) {
    throw new Error('A valid historical date range is required.');
  }
  const resolution = resolutionFromInterval(request.interval);
  const payload = await proxyFetch('provider-history', {
    symbol,
    resolution,
    from: Math.floor(request.startAt / 1000),
    to: Math.floor(request.endAt / 1000)
  }, {
    ...(options.force ? { cache: 'no-store' as RequestCache } : {}),
    ...(request.signal ? { signal: request.signal } : {})
  });
  if (!payload || payload.ok !== true || payload.provider !== 'Finnhub' ||
      typeof payload.symbol !== 'string' || payload.symbol.toUpperCase() !== symbol.toUpperCase()) {
    throw new Error(typeof payload?.error === 'string'
      ? payload.error
      : 'Finnhub returned an unverified historical response.');
  }
  const normalized = normalizeMarketHistoryResponse({
    symbol: request.instrument.symbol,
    provider: 'Finnhub',
    receivedAt: payload.receivedAt,
    interval: resolution,
    exchange: request.instrument.exchange,
    assetType: request.instrument.assetType,
    currency: request.instrument.quoteCurrency,
    points: payload.points
  });
  if (!request.instrument.exchange) return normalized;
  const now = Date.now();
  let calendar: MarketCalendarSnapshot | null = null;
  let calendarIssue: string | null = null;
  try {
    calendar = await fetchFinnhubMarketCalendar(request.instrument.exchange, { signal: request.signal });
  } catch (error) {
    if (request.signal?.aborted) throw error;
    calendarIssue = error instanceof Error ? error.message : 'Exchange calendar unavailable; history freshness remains unknown.';
  }
  const session = resolveExchangeSession({
    exchange: request.instrument.exchange,
    at: now,
    ...(calendar ? {
      holidays: calendar.holidays,
      earlyCloses: calendar.earlyCloses,
      marketStatus: calendar.marketStatus
    } : {})
  });
  const freshness = classifyMarketHistoryFreshness({
    observedAt: normalized.observedAt,
    now,
    interval: resolution,
    session
  });
  const normalizedSession = session.session === 'BREAK' ? 'UNKNOWN'
    : session.session === 'PRE' || session.session === 'REGULAR' ||
      session.session === 'POST' || session.session === 'CLOSED'
      ? session.session : 'UNKNOWN';
  if (!calendarIssue && session.calendarQuality !== 'complete') {
    calendarIssue = 'Exchange calendar coverage is incomplete; history freshness remains unknown.';
  }
  return {
    ...normalized,
    session: normalizedSession,
    freshness,
    ...(calendarIssue ? { issues: [...normalized.issues, calendarIssue] } : {})
  };
}

export async function fetchFinnhubMarketEvents(
  symbol: string,
  from: string,
  to: string,
  options: { signal?: AbortSignal } = {}
): Promise<MarketEventsResult> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9.^=-]{1,20}$/.test(normalized)) {
    throw new Error('A valid instrument symbol is required.');
  }
  const payload = await proxyFetch('market-events', { symbol: normalized, from, to }, {
    ...(options.signal ? { signal: options.signal } : {})
  });
  const result = normalizeMarketEventsResponse(payload);
  if (result.symbol !== normalized || result.quality === 'unavailable') {
    throw new Error('Finnhub market events could not be verified.');
  }
  return result;
}
