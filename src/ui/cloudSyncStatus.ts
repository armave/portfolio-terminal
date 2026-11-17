import { getAppLanguage, translateText } from '../services/i18n';
import type { CloudStatus } from './uiStateStore';

export type CloudSyncTone = 'neutral' | 'success' | 'pending' | 'warning' | 'conflict' | 'error';

export function resolveCloudSyncTone(cloudStatus: CloudStatus, cloudSyncStatus: CloudStatus): CloudSyncTone {
  const cloudState = String(cloudStatus.status || '').toLowerCase();
  const syncState = String(cloudSyncStatus.status || '').toLowerCase();
  const cloudText = String(cloudStatus.text || '').toLowerCase();
  if (cloudState === 'conflict' || syncState === 'conflict') return 'conflict';
  if (cloudState === 'error' || syncState === 'error') return 'error';
  if (['syncing', 'pending'].includes(cloudState) || ['syncing', 'pending'].includes(syncState)) return 'pending';
  if (cloudState === 'synced' || syncState === 'synced') return 'success';
  if (cloudText.includes('secret') || cloudText.includes('fail')) return 'warning';
  return 'neutral';
}

export function resolveCloudSyncLabel(cloudStatus: CloudStatus, tone: CloudSyncTone, language: ReturnType<typeof getAppLanguage>): string {
  if (tone === 'success') return translateText('Synced', language);
  if (tone === 'conflict') return translateText('Conflict', language);
  if (tone === 'pending') {
    const isPending = String(cloudStatus.status || '').toLowerCase() === 'pending';
    return translateText(isPending ? 'Pending' : 'Syncing…', language);
  }
  if (tone === 'warning') return translateText('Setup needed', language);
  if (tone === 'error') return translateText('Failed', language);
  const cloudState = String(cloudStatus.status || '').toLowerCase();
  const cloudText = String(cloudStatus.text || '').toLowerCase();
  if (cloudState === 'online' || cloudText.includes('connected')) return translateText('Connected', language);
  return translateText('Offline', language);
}

export function formatRelativeSyncTime(timestamp: number | null | undefined, now = Date.now(), language: ReturnType<typeof getAppLanguage> = getAppLanguage()): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return translateText('Just now', language);
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}${translateText('m ago', language)}`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}${translateText('h ago', language)}`;
  return `${Math.floor(elapsed / (24 * 60 * 60_000))}${translateText('d ago', language)}`;
}

export function formatExactSyncTimestamp(timestamp: number | null | undefined, language: ReturnType<typeof getAppLanguage> = getAppLanguage()): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return '';
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(timestamp));
}
