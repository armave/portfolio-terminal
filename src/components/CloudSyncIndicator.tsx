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
  if (cloudState === 'syncing' || syncState === 'syncing') return 'pending';
  if (cloudState === 'synced' || syncState === 'synced') return 'success';
  if (cloudText.includes('secret') || cloudText.includes('fail')) return 'warning';
  return 'neutral';
}

function resolveSyncMessage(message: string, language: ReturnType<typeof getAppLanguage>): string {
  if (!message) return '';
  if (message.startsWith('Synced: ')) {
    return translateText('Synced', language) + message.slice('Synced'.length);
  }
  return translateText(message, language);
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
  const primaryText = translateText(cloudStatus.text || 'OFFLINE', language);
  const detailText = resolveSyncMessage(cloudSyncStatus.text, language);
  const accessibleText = [
    translateText('Cloud storage', language),
    primaryText,
    detailText
  ].filter(Boolean).join('. ');

  return (
    <div
      id="cloudStatus"
      class={`cloud-sync-indicator cloud-sync-indicator--${tone}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={accessibleText}
      title={accessibleText}
    >
      <span class="cloud-sync-indicator__dot" aria-hidden="true" />
      <span class="cloud-sync-indicator__primary">KV: {primaryText}</span>
      {detailText && <span class="cloud-sync-indicator__detail">{detailText}</span>}
    </div>
  );
}
