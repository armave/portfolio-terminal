import { useEffect, useState } from 'preact/hooks';
import { getAppLanguage, translateText } from '../services/i18n';
import type { CloudStatus } from '../ui/uiStateStore';

export type CloudSyncTone = 'neutral' | 'success' | 'pending' | 'warning' | 'error';

export function resolveCloudSyncTone(
  cloudStatus: CloudStatus,
  cloudSyncStatus: CloudStatus
): CloudSyncTone {
  const cloudState = String(cloudStatus.status || '').toLowerCase();
  const syncState = String(cloudSyncStatus.status || '').toLowerCase();
  const cloudText = String(cloudStatus.text || '').toLowerCase();

  if (cloudState === 'error' || syncState === 'error') return 'error';
  if (['syncing', 'pending'].includes(cloudState) || ['syncing', 'pending'].includes(syncState)) return 'pending';
  if (cloudState === 'synced' || syncState === 'synced') return 'success';
  if (cloudText.includes('secret') || cloudText.includes('fail')) return 'warning';
  return 'neutral';
}

export function resolveCloudSyncLabel(
  cloudStatus: CloudStatus,
  tone: CloudSyncTone,
  language: ReturnType<typeof getAppLanguage>
): string {
  if (tone === 'success') return translateText('Synced', language);
  if (tone === 'pending') {
    const isPending = String(cloudStatus.status || '').toLowerCase() === 'pending';
    return translateText(isPending ? 'Pending' : 'Syncing…', language);
  }
  if (tone === 'warning') return translateText('Setup needed', language);
  if (tone === 'error') return translateText('Failed', language);

  const cloudState = String(cloudStatus.status || '').toLowerCase();
  const cloudText = String(cloudStatus.text || '').toLowerCase();
  if (cloudState === 'online' || cloudText.includes('connected')) {
    return translateText('Connected', language);
  }
  return translateText('Offline', language);
}

/** Format the last successful sync as a short, automatically aging relative time. */
export function formatRelativeSyncTime(
  timestamp: number | null | undefined,
  now = Date.now(),
  language: ReturnType<typeof getAppLanguage> = getAppLanguage()
): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return translateText('Just now', language);
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}${translateText('m ago', language)}`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}${translateText('h ago', language)}`;
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}${translateText('d ago', language)}`;
}

export function formatExactSyncTimestamp(
  timestamp: number | null | undefined,
  language: ReturnType<typeof getAppLanguage> = getAppLanguage()
): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(timestamp));
}

export function CloudSyncIndicator({
  cloudStatus,
  cloudSyncStatus
}: {
  cloudStatus: CloudStatus;
  cloudSyncStatus: CloudStatus;
}) {
  const language = getAppLanguage();
  const tone = resolveCloudSyncTone(cloudStatus, cloudSyncStatus);
  const statusLabel = resolveCloudSyncLabel(cloudStatus, tone, language);
  const lastSyncedAt = cloudSyncStatus.lastSyncedAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const relativeTime = tone === 'success' || lastSyncedAt
    ? formatRelativeSyncTime(lastSyncedAt, now, language)
    : '';
  const exactTime = formatExactSyncTimestamp(lastSyncedAt, language);
  const detailsText = exactTime
    ? `${translateText('Last synced', language)}: ${exactTime}`
    : translateText(cloudSyncStatus.text || cloudStatus.text || 'Offline', language);
  const accessibleText = [
    'KV',
    statusLabel,
    relativeTime,
    exactTime ? `${translateText('Last synced', language)}: ${exactTime}` : ''
  ].filter(Boolean).join('. ');

  return (
    <div
      id="cloudStatus"
      class={`cloud-sync-indicator cloud-sync-indicator--${tone}${detailsOpen ? ' cloud-sync-indicator--details-open' : ''}`}
      aria-live="polite"
      aria-atomic="true"
    >
      <button
        type="button"
        class="cloud-sync-indicator__trigger"
        aria-label={accessibleText}
        aria-expanded={detailsOpen}
        aria-describedby={exactTime ? 'cloudStatusExactTime' : undefined}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        <span class="cloud-sync-indicator__dot" aria-hidden="true" />
        <span class="cloud-sync-indicator__primary">KV</span>
        <span class="cloud-sync-indicator__state">{statusLabel}</span>
        {relativeTime && <span class="cloud-sync-indicator__time">{relativeTime}</span>}
      </button>
      {detailsText && (
        <span id="cloudStatusExactTime" class="cloud-sync-indicator__timestamp" role="tooltip">
          {detailsText}
        </span>
      )}
    </div>
  );
}
