import { useEffect, useState } from 'preact/hooks';
import { fetchFreedomMarketStatus, type FreedomMarketStatusResponse } from '../services/api';
import { getAppLanguage, translateText } from '../services/i18n';
import { addUiEventListener, removeUiEventListener, type UiEvent } from '../ui/uiEventBus';
import type { AuthUser } from '../services/api';

const MARKET_STATUS_REFRESH_MS = 5 * 60 * 1000;

export type MarketSessionStatus = 'PREMARKET' | 'MARKET' | 'POSTMARKET' | 'CLOSED';

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
    case 'CLOSED': return translateText('Market closed status');
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

/** Role-visible market phase; it listens for auth changes so guests don't depend on App's initial user render. */
export function MarketStatusBadge({ isAdmin }: { isAdmin: boolean }) {
  const [snapshot, setSnapshot] = useState<FreedomMarketStatusResponse | null>(null);
  const [hasAuthenticatedSession, setHasAuthenticatedSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let refreshPending = false;
    let authenticated = false;
    let hasLoaded = false;

    const refresh = async () => {
      if (!active || document.visibilityState === 'hidden') return;
      if (inFlight) {
        refreshPending = true;
        return;
      }
      inFlight = true;
      if (!hasLoaded) setLoading(true);
      try {
        const result = await fetchFreedomMarketStatus();
        if (!active) return;
        authenticated = true;
        hasLoaded = true;
        setHasAuthenticatedSession(true);
        setSnapshot(result);
        setFailed(false);
      } catch {
        if (active && authenticated) setFailed(true);
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
      authenticated = Boolean(event.detail.user);
      setHasAuthenticatedSession(authenticated);
      if (!authenticated) {
        hasLoaded = false;
        setSnapshot(null);
        setFailed(false);
        setLoading(false);
        refreshPending = false;
        return;
      }
      setFailed(false);
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    addUiEventListener('auth:user-changed', handleUserChanged);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    void refresh();
    const intervalId = window.setInterval(() => void refresh(), MARKET_STATUS_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      removeUiEventListener('auth:user-changed', handleUserChanged);
    };
  }, []);

  if (!hasAuthenticatedSession) return null;

  const status = snapshot?.marketStatus.status;
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
      class="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1 text-[10px] leading-tight"
      role="status"
      aria-label={`${roleLabel}: ${statusLabel}`}
      data-market-status-role={isAdmin ? 'admin' : 'guest'}
      title={updatedTitle}
    >
      <span class="font-semibold text-slate-400">{roleLabel}</span>
      <span class={`rounded border px-1.5 py-0.5 font-bold ${toneClass}`}>{statusLabel}</span>
    </div>
  );
}
