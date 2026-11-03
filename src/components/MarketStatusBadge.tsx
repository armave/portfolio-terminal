import { useEffect, useState } from 'preact/hooks';
import { fetchFreedomMarketStatus, type FreedomMarketStatusResponse } from '../services/api';
import { getAppLanguage, translateText } from '../services/i18n';

const MARKET_STATUS_REFRESH_MS = 5 * 60 * 1000;

type MarketStatusTone = 'open' | 'closed' | 'transition' | 'unknown';

export function getMarketStatusLabel(status: string | null | undefined): string {
  const normalized = String(status || '').trim().toUpperCase();
  switch (normalized) {
    case 'OPEN': return translateText('Open');
    case 'CLOSE':
    case 'CLOSED': return translateText('Closed');
    case 'PRE': return translateText('Pre-market');
    case 'POST': return translateText('After-hours');
    case 'MIXED': return translateText('Mixed');
    default: return normalized || translateText('Unavailable');
  }
}

export function getMarketStatusTone(status: string | null | undefined): MarketStatusTone {
  switch (String(status || '').trim().toUpperCase()) {
    case 'OPEN': return 'open';
    case 'CLOSE':
    case 'CLOSED': return 'closed';
    case 'PRE':
    case 'POST':
    case 'MIXED': return 'transition';
    default: return 'unknown';
  }
}

/** A small role-labelled US-equities status, refreshed independently of portfolio data. */
export function MarketStatusBadge({ isAdmin }: { isAdmin: boolean }) {
  const [snapshot, setSnapshot] = useState<FreedomMarketStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let hasLoaded = false;

    const refresh = async () => {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      if (!hasLoaded) setLoading(true);
      try {
        const result = await fetchFreedomMarketStatus();
        if (!active) return;
        setSnapshot(result);
        setFailed(false);
        hasLoaded = true;
      } catch {
        if (active) setFailed(true);
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refresh();
    };

    void refresh();
    const intervalId = window.setInterval(() => void refresh(), MARKET_STATUS_REFRESH_MS);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const status = snapshot?.marketStatus.status;
  const tone = getMarketStatusTone(status);
  const statusLabel = loading && !snapshot
    ? translateText('Unavailable')
    : getMarketStatusLabel(status);
  const toneClass = tone === 'open'
    ? 'border-emerald-800/70 bg-emerald-950/40 text-emerald-300'
    : tone === 'transition'
      ? 'border-amber-800/70 bg-amber-950/30 text-amber-200'
      : tone === 'closed'
        ? 'border-slate-700 bg-slate-900/80 text-slate-300'
        : 'border-slate-800 bg-slate-950/70 text-slate-500';
  const updatedAt = snapshot
    ? new Date(snapshot.updatedAt).toLocaleTimeString(getAppLanguage() === 'ru' ? 'ru-RU' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit'
    })
    : '';
  const roleLabel = translateText(isAdmin ? 'Portfolio market' : 'Your market');
  const updatedTitle = updatedAt
    ? `${translateText('Updated at')} ${updatedAt}${failed ? ' · refresh failed' : ''}`
    : failed ? 'Market status unavailable' : 'Loading market status';

  return (
    <div
      class="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 px-2 py-1 text-[10px] leading-tight"
      role="status"
      aria-label={`${roleLabel}: ${translateText('US equities')}: ${statusLabel}`}
      data-market-status-role={isAdmin ? 'admin' : 'guest'}
      title={updatedTitle}
    >
      <span class="font-semibold text-slate-400">{roleLabel}</span>
      <span class="text-slate-600">·</span>
      <span class="text-slate-300">{translateText('US equities')}</span>
      <span class={`rounded border px-1.5 py-0.5 font-bold ${toneClass}`}>{statusLabel}</span>
    </div>
  );
}
