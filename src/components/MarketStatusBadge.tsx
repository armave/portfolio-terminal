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

export type MarketSessionStatus = 'PREMARKET' | 'MARKET' | 'POSTMARKET' | 'CLOSED';

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
    default:
      return null;
  }
}

export function getMarketStatusRoleLabel(isAdmin: boolean): string {
  return translateText(isAdmin ? 'Portfolio market' : 'Your market');
}

export function getMarketStatusLabel(status: string | null | undefined): string {
  const normalized = normalizeMarketSessionStatus(status);
  switch (normalized) {
    case 'PREMARKET': return translateText('Premarket');
    case 'MARKET': return translateText('Market');
    case 'POSTMARKET': return translateText('Postmarket');
    case 'CLOSED': return translateText('Closed');
    default: return translateText('Unavailable');
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
  if (!normalized) return null;

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
      : normalized === 'MARKET'
        ? 'Postmarket in {time}'
        : 'Market closes in {time}';
  return translateText(template).replace('{time}', time);
}

/** Role-visible market phase; it listens for auth changes so guests don't depend on App's initial user render. */
export function MarketStatusBadge({ isAdmin }: { isAdmin: boolean }) {
  const [snapshot, setSnapshot] = useState<FreedomMarketStatusResponse | null>(null);
  const [hasAuthenticatedSession, setHasAuthenticatedSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const status = reconcileMarketStatusWithCalendar(snapshot?.marketStatus.status, now);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let refreshPending = false;
    let authenticated = false;
    let hasLoaded = false;
    let authGeneration = 0;
    let transitionTimeoutId: number | undefined;

    const refresh = async () => {
      if (!active || document.visibilityState === 'hidden') return;
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
    const transitionAt = getMarketStatusTransitionAt(status, now);
    if (transitionAt) {
      const delay = transitionAt.getTime() - Date.now();
      if (delay > 0) {
        transitionTimeoutId = window.setTimeout(() => void refresh(), delay + 1000);
      }
    }

    addUiEventListener('auth:user-changed', handleUserChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), MARKET_STATUS_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      if (transitionTimeoutId !== undefined) window.clearTimeout(transitionTimeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      removeUiEventListener('auth:user-changed', handleUserChanged);
    };
  }, [snapshot?.marketStatus.status, status]);

  useEffect(() => {
    if (!hasAuthenticatedSession) return;
    const intervalId = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(intervalId);
  }, [hasAuthenticatedSession]);

  if (!hasAuthenticatedSession) return null;

  const countdown = getMarketStatusCountdown(status, now);
  const tone = getMarketStatusTone(status);
  const statusLabel = loading && !snapshot
    ? translateText('Unavailable')
    : getMarketStatusLabel(status);
  const toneClass = tone === 'open'
    ? 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300'
    : tone === 'premarket'
      ? 'border-amber-800/70 bg-amber-950/30 text-amber-200'
      : tone === 'postmarket'
        ? 'border-sky-800/70 bg-sky-950/30 text-sky-200'
        : tone === 'closed'
          ? 'border-slate-700 bg-slate-900/80 text-slate-300'
          : 'border-slate-800 bg-slate-950/70 text-slate-500';
  const updatedAt = snapshot
    ? new Date(snapshot.updatedAt).toLocaleTimeString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
    : '';
  const roleLabel = getMarketStatusRoleLabel(isAdmin);
  const updatedTitle = updatedAt
    ? `${translateText('Updated at')} ${updatedAt}${failed ? ' · ' + translateText('Refresh failed') : ''}`
    : failed ? translateText('Market status unavailable') : translateText('Loading market status');

  return (
    <div
      class="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 text-[10px] leading-tight"
      role="status"
      aria-label={`${roleLabel}: ${statusLabel}${countdown ? `, ${countdown}` : ''}`}
      data-market-status-role={isAdmin ? 'admin' : 'guest'}
      title={updatedTitle}
    >
      <span class={`rounded border px-1.5 py-0.5 font-bold ${toneClass}`}>{statusLabel}</span>
      {countdown && <span class="px-1 text-slate-400">{countdown}</span>}
    </div>
  );
}
