import { useEffect, useState } from 'preact/hooks';
import { fetchFreedomMarketStatus, type FreedomMarketStatusResponse } from '../services/api';
import { getAppLanguage, translateText } from '../services/i18n';
import { addUiEventListener, removeUiEventListener, type UiEvent } from '../ui/uiEventBus';
import type { AuthUser } from '../services/api';
import {
  getUsEquityMarketSession,
  getUsEquityNextTransitionAt,
  type UsEquityMarketSession
} from '../services/marketSession';

const MARKET_STATUS_REFRESH_MS = 5 * 60 * 1000;

export type MarketSessionStatus = 'PREMARKET' | 'MARKET' | 'POSTMARKET' | 'CLOSED' | 'MIXED';

/** Prevents a response started under an older session from updating the current UI. */
export function isCurrentMarketStatusRequest(
  active: boolean,
  requestGeneration: number,
  currentGeneration: number
): boolean {
  return active && requestGeneration === currentGeneration;
}


export function normalizeMarketSessionStatus(status: string | null | undefined): MarketSessionStatus | null {
  const normalized = String(status || '').trim().toUpperCase().replaceAll(' ', '').replaceAll('_', '').replaceAll('-', '');
  switch (normalized) {
    case 'PREV':
    case 'PRE':
    case 'PREPRE':
    case 'PREMARKET':
      return 'PREMARKET';
    case 'OPEN':
    case 'REGULAR':
    case 'TRADING':
    case 'MARKET':
      return 'MARKET';
    case 'POST':
    case 'POSTPOST':
    case 'POSTMARKET':
    case 'AFTER':
    case 'AFTERHOURS':
      return 'POSTMARKET';
    case 'CLOSE':
    case 'CLOSED':
      return 'CLOSED';
    case 'MIXED':
      return 'MIXED';
    default:
      return null;
  }
}

export function getMarketStatusRoleLabel(isAdmin: boolean): string {
  return translateText(isAdmin ? 'Portfolio market' : 'Your market');
}

export function getMarketStatusLabel(status: string | null | undefined, isAdmin = true): string {
  const normalized = normalizeMarketSessionStatus(status);
  switch (normalized) {
    case 'PREMARKET': return translateText(isAdmin ? 'Premarket' : 'Market Pre-market');
    case 'MARKET': return translateText(isAdmin ? 'Market' : 'Market Open');
    case 'POSTMARKET': return translateText(isAdmin ? 'Postmarket' : 'Market After-hours');
    case 'CLOSED': return translateText(isAdmin ? 'Closed' : 'Market Closed');
    case 'MIXED': return translateText(isAdmin ? 'Mixed exchange status' : 'Exchanges report different states');
    default: return translateText(isAdmin ? 'Unavailable' : 'Market Unavailable');
  }
}

export function getMarketStatusTone(status: string | null | undefined): 'open' | 'premarket' | 'postmarket' | 'closed' | 'unknown' {
  switch (normalizeMarketSessionStatus(status)) {
    case 'MARKET': return 'open';
    case 'PREMARKET': return 'premarket';
    case 'POSTMARKET': return 'postmarket';
    case 'CLOSED': return 'closed';
    default: return 'unknown';
  }
}

export function reconcileMarketStatusWithCalendar(
  providerStatus: string | null | undefined,
  now = new Date()
): MarketSessionStatus | null {
  const normalized = normalizeMarketSessionStatus(providerStatus);
  if (!normalized) return null;

  const session = getUsEquityMarketSession(now);
  const calendarStatus: MarketSessionStatus = session === 'PRE'
    ? 'PREMARKET'
    : session === 'REGULAR'
      ? 'MARKET'
      : session === 'POST'
        ? 'POSTMARKET'
        : 'CLOSED';
  return normalized === calendarStatus ? normalized : calendarStatus;
}

const MARKET_STATUS_MAX_AGE_MS = 15 * 60 * 1000;
const MARKET_STATUS_FUTURE_TOLERANCE_MS = 60 * 1000;

export function getCalendarMarketStatus(now = new Date()): MarketSessionStatus {
  const session = getUsEquityMarketSession(now);
  return session === 'PRE'
    ? 'PREMARKET'
    : session === 'REGULAR'
      ? 'MARKET'
      : session === 'POST'
        ? 'POSTMARKET'
        : 'CLOSED';
}

/** Prefer a fresh TradeNet exchange state; the local New York calendar is fallback only. */
export function resolveEffectiveMarketStatus(
  providerStatus: string | null | undefined,
  updatedAt: number | null | undefined,
  now = new Date()
): MarketSessionStatus {
  const normalized = normalizeMarketSessionStatus(providerStatus);
  const age = Number.isFinite(updatedAt) ? now.getTime() - Number(updatedAt) : Number.POSITIVE_INFINITY;
  if (normalized && age >= -MARKET_STATUS_FUTURE_TOLERANCE_MS && age <= MARKET_STATUS_MAX_AGE_MS) {
    return normalized;
  }
  return getCalendarMarketStatus(now);
}

/** Do not show a calendar-derived countdown when a fresh broker state disagrees with the local calendar. */
export function getEffectiveMarketStatusCountdown(
  providerStatus: string | null | undefined,
  updatedAt: number | null | undefined,
  now = new Date()
): string | null {
  const effective = resolveEffectiveMarketStatus(providerStatus, updatedAt, now);
  if (effective === 'MIXED' || effective !== getCalendarMarketStatus(now)) return null;
  return getMarketStatusCountdown(effective, now);
}

export function formatMarketCountdown(remainingMs: number): string {
  const totalMinutes = Math.ceil(Math.max(0, remainingMs) / 60_000);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const hasDays = totalMinutes > 24 * 60;
  const days = hasDays ? Math.floor(hours / 24) : 0;
  const remainingHours = hours % 24;
  const template = hasDays
    ? minutes > 0
      ? '{days}d {hours}h {minutes}m'
      : remainingHours > 0
        ? '{days}d {hours}h'
        : '{days}d'
    : hours > 0
      ? minutes > 0 ? '{hours}h {minutes}m' : '{hours}h'
      : '{minutes}m';

  return translateText(template)
    .replace('{days}', String(days))
    .replace('{hours}', String(hasDays ? remainingHours : hours))
    .replace('{minutes}', String(minutes));
}

export function getMarketStatusTransitionAt(status: string | null | undefined, now = new Date()): Date | null {
  const normalized = normalizeMarketSessionStatus(status);
  if (!normalized || normalized === 'MIXED') return null;

  const session: UsEquityMarketSession = normalized === 'PREMARKET'
    ? 'PRE'
    : normalized === 'MARKET'
      ? 'REGULAR'
      : normalized === 'POSTMARKET'
        ? 'POST'
        : 'CLOSED';
  return getUsEquityNextTransitionAt(session, now);
}

export function getMarketStatusCountdown(status: string | null | undefined, now = new Date()): string | null {
  const normalized = normalizeMarketSessionStatus(status);
  const transitionAt = getMarketStatusTransitionAt(status, now);
  if (!normalized || !transitionAt) return null;
  const time = formatMarketCountdown(transitionAt.getTime() - now.getTime());
  const template = normalized === 'CLOSED'
    ? 'Premarket in {time}'
    : normalized === 'PREMARKET'
      ? 'Opens in {time}'
      : 'Closes in {time}';
  return translateText(template).replace('{time}', time);
}

/** Role-visible market phase; it listens for auth changes so guests don't depend on App's initial user render. */
export function MarketStatusBadge({ isAdmin }: { isAdmin: boolean }) {
  const [snapshot, setSnapshot] = useState<FreedomMarketStatusResponse | null>(null);
  const [hasAuthenticatedSession, setHasAuthenticatedSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const status = resolveEffectiveMarketStatus(snapshot?.marketStatus.status, snapshot?.updatedAt, now);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let refreshPending = false;
    let authenticated = false;
    let hasLoaded = false;
    let authGeneration = 0;
    let activeIdentity: string | null = null;
    let transitionTimeoutId: number | undefined;

    const scheduleNextTransition = (providerStatus: string) => {
      if (transitionTimeoutId !== undefined) window.clearTimeout(transitionTimeoutId);
      const currentTime = new Date();
      const effectiveStatus = resolveEffectiveMarketStatus(providerStatus, Date.now(), currentTime);
      const transitionAt = getMarketStatusTransitionAt(effectiveStatus, currentTime);
      if (!transitionAt) {
        transitionTimeoutId = undefined;
        return;
      }
      const delay = transitionAt.getTime() - currentTime.getTime();
      transitionTimeoutId = delay > 0
        ? window.setTimeout(() => void refresh(), delay + 1000)
        : undefined;
    };

    const refresh = async () => {
      // Wait for the authenticated identity event. An eager public request here
      // races the startup auth event and used to fetch the same status twice.
      if (!active || !authenticated || document.visibilityState === 'hidden') return;
      if (inFlight) {
        refreshPending = true;
        return;
      }
      inFlight = true;
      const requestGeneration = authGeneration;
      if (!hasLoaded) setLoading(true);
      try {
        const result = await fetchFreedomMarketStatus();
        if (!isCurrentMarketStatusRequest(active, requestGeneration, authGeneration)) return;
        authenticated = true;
        hasLoaded = true;
        setHasAuthenticatedSession(true);
        setSnapshot(result);
        setFailed(false);
        scheduleNextTransition(result.marketStatus.status);
      } catch {
        if (isCurrentMarketStatusRequest(active, requestGeneration, authGeneration) && authenticated) {
          setFailed(true);
        }
      } finally {
        inFlight = false;
        if (active) setLoading(false);
        if (active && refreshPending) {
          refreshPending = false;
          void refresh();
        }
      }
    };

    const handleUserChanged = (event: UiEvent<{ user: AuthUser | null }>) => {
      const nextIdentity = event.detail.user
        ? `${event.detail.user.role}:${event.detail.user.id}`
        : null;
      // Startup can publish the same identity more than once (credential
      // validation followed by workspace hydration). Ignore those repeats.
      if (nextIdentity === activeIdentity) return;
      activeIdentity = nextIdentity;
      authGeneration += 1;
      authenticated = Boolean(event.detail.user);
      setHasAuthenticatedSession(authenticated);
      hasLoaded = false;
      setSnapshot(null);
      setFailed(false);

      if (!authenticated) {
        setLoading(false);
        refreshPending = false;
        return;
      }

      setLoading(true);
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    addUiEventListener('auth:user-changed', handleUserChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    // The first authenticated user event starts the initial request. Do not
    // fetch before identity resolution; that request would race the auth event.
    const intervalId = window.setInterval(() => void refresh(), MARKET_STATUS_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (transitionTimeoutId !== undefined) window.clearTimeout(transitionTimeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      removeUiEventListener('auth:user-changed', handleUserChanged);
    };
  }, []);

  useEffect(() => {
    if (!hasAuthenticatedSession) return;
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, [hasAuthenticatedSession]);

  if (!hasAuthenticatedSession) return null;

  const countdown = getEffectiveMarketStatusCountdown(snapshot?.marketStatus.status, snapshot?.updatedAt, now);
  const tone = getMarketStatusTone(status);
  const statusLabel = loading && !snapshot
    ? translateText(isAdmin ? 'Unavailable' : 'Market Unavailable')
    : getMarketStatusLabel(status, isAdmin);
  const toneClass = tone === 'open'
    ? 'text-emerald-300'
    : tone === 'premarket'
      ? 'text-amber-200'
      : tone === 'postmarket'
        ? 'text-sky-200'
        : tone === 'closed'
          ? 'text-slate-300'
          : 'text-slate-500';
  const dotToneClass = tone === 'open'
    ? 'bg-emerald-400 ring-emerald-400/20'
    : tone === 'premarket'
      ? 'bg-amber-300 ring-amber-300/20'
      : tone === 'postmarket'
        ? 'bg-sky-300 ring-sky-300/20'
        : tone === 'closed'
          ? 'bg-slate-400 ring-slate-400/20'
          : 'bg-slate-600 ring-slate-600/20';
  const updatedAt = snapshot
    ? new Date(snapshot.updatedAt).toLocaleTimeString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
    : '';
  const roleLabel = getMarketStatusRoleLabel(isAdmin);
  const scheduleTooltip = snapshot?.marketStatus
    ? [
        snapshot.marketStatus.source,
        snapshot.marketStatus.code,
        snapshot.marketStatus.openTime !== null ? `open: ${snapshot.marketStatus.openTime}` : null,
        snapshot.marketStatus.closeTime !== null ? `close: ${snapshot.marketStatus.closeTime}` : null,
        snapshot.marketStatus.timezoneOffset !== null ? `offset: ${snapshot.marketStatus.timezoneOffset}` : null,
        snapshot.marketStatus.providerTime ? `provider time: ${snapshot.marketStatus.providerTime}` : null,
        ...(snapshot.marketStatus.exchanges.length > 0
          ? [snapshot.marketStatus.exchanges.map(exchange => [
              exchange.code || exchange.name,
              exchange.providerStatus,
              exchange.openTime !== null ? `open ${exchange.openTime}` : null,
              exchange.closeTime !== null ? `close ${exchange.closeTime}` : null
            ].filter(Boolean).join(' ')).join(' / ')]
          : [])
      ].filter(Boolean).join(' · ')
    : null;
  const updatedTitle = updatedAt
    ? `${translateText('Updated at')} ${updatedAt}${scheduleTooltip ? ` · ${scheduleTooltip}` : ''}${failed ? ' · ' + translateText('Refresh failed') : ''}`
    : failed ? translateText('Market status unavailable') : translateText('Loading market status');

  return (
    <div
      class="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-800/90 bg-slate-950/75 px-2.5 py-1.5 shadow-sm shadow-black/10"
      role="status"
      aria-label={`${roleLabel}: ${statusLabel}${countdown ? `, ${countdown}` : ''}`}
      data-market-status-role={isAdmin ? 'admin' : 'guest'}
      title={updatedTitle}
    >
      <span
        class={`h-2 w-2 shrink-0 rounded-full ring-2 ${dotToneClass}`}
        aria-hidden="true"
      />
      <span class={`text-[11px] font-bold leading-none tracking-wide ${toneClass}`}>
        {statusLabel}
      </span>
      {countdown && (
        <span class="inline-flex shrink-0 items-center rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 font-mono text-[10px] font-semibold leading-none tabular-nums text-slate-300">
          {countdown}
        </span>
      )}
    </div>
  );
}
