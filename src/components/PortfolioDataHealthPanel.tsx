import { useRef, useState } from 'preact/hooks';
import type { CloudStatus } from '../ui/uiStateStore';
import { usePortfolioSelector } from '../store/portfolioStore';
import { emitUiEvent } from '../ui/uiEventBus';
import { getAppLanguage, translateText } from '../services/i18n';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { DEFAULT_ADMIN_REFRESH_INTERVAL_MS, DEFAULT_GUEST_REFRESH_INTERVAL_MS } from '../services/portfolioAutoRefresh';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';
import { formatQuoteFreshnessSummary } from '../utils/formatters';
import {
  arePortfolioDataHealthSourcesEqual,
  getBrokerSnapshotHealth,
  getQuoteFreshnessHealth,
  selectPortfolioDataHealthSource,
  summarizeAdminPortfolioQuoteFreshness,
  summarizeGuestPortfolioQuoteFreshness,
  resolvePortfolioDataHealthTone
} from '../ui/portfolioDataHealth';
import {
  formatExactSyncTimestamp,
  formatRelativeSyncTime,
  resolveCloudSyncLabel,
  resolveCloudSyncTone
} from './CloudSyncIndicator';

interface PortfolioDataHealthPanelProps {
  isAdmin: boolean;
  cloudStatus: CloudStatus;
  cloudSyncStatus: CloudStatus;
}

function formatSnapshotTime(timestamp: number | null | undefined, language: ReturnType<typeof getAppLanguage>): string {
  const relative = formatRelativeSyncTime(timestamp, Date.now(), language);
  const exact = formatExactSyncTimestamp(timestamp, language);
  if (!relative) return translateText('Observation time unavailable', language);
  return exact ? relative + ' · ' + exact : relative;
}

function getGuestRefreshLabel(status: string, language: ReturnType<typeof getAppLanguage>): string {
  if (status === 'synced') return translateText('Assigned data refresh confirmed', language);
  if (status === 'syncing' || status === 'pending') return translateText('Assigned data refresh in progress', language);
  if (status === 'error') return translateText('Assigned data refresh failed', language);
  return translateText('Assigned data refresh status not checked', language);
}

function getBrokerHealthLabel(status: ReturnType<typeof getBrokerSnapshotHealth>, language: ReturnType<typeof getAppLanguage>): string {
  switch (status) {
    case 'current': return translateText('Current', language);
    case 'partial': return translateText('Partial snapshot', language);
    case 'empty': return translateText('Empty snapshot', language);
    case 'stale': return translateText('Stale snapshot', language);
    case 'unavailable': return translateText('Unavailable', language);
    default: return translateText('Status unknown', language);
  }
}

function HealthRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div class="portfolio-data-health__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
      {detail && <span class="portfolio-data-health__detail">{detail}</span>}
    </div>
  );
}

export function PortfolioDataHealthPanel({
  isAdmin,
  cloudStatus,
  cloudSyncStatus
}: PortfolioDataHealthPanelProps) {
  const language = getAppLanguage();
  const refreshIntervalMs = useQuoteRefreshInterval(
    isAdmin ? DEFAULT_ADMIN_REFRESH_INTERVAL_MS : DEFAULT_GUEST_REFRESH_INTERVAL_MS,
    isAdmin ? 'admin' : 'guest'
  );
  const source = usePortfolioSelector(
    (state) => selectPortfolioDataHealthSource(state, isAdmin),
    arePortfolioDataHealthSourcesEqual
  );
  const [expanded, setExpanded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncPromise = useRef<Promise<ManualPortfolioSyncResult> | null>(null);

  const brokerSnapshot = source.role === 'admin' ? source.brokerAccountInfo : undefined;
  const guestSnapshot = source.role === 'guest' ? source.guestSnapshot : undefined;
  const brokerHealth = source.role === 'admin' ? getBrokerSnapshotHealth(brokerSnapshot) : null;
  const quoteSummary = source.role === 'admin'
    ? summarizeAdminPortfolioQuoteFreshness({
        positions: source.positions,
        cashHoldings: source.cashHoldings
      }, Date.now(), refreshIntervalMs)
    : summarizeGuestPortfolioQuoteFreshness(guestSnapshot, Date.now(), refreshIntervalMs);
  const quoteHealth = getQuoteFreshnessHealth(quoteSummary);
  const cloudTone = resolveCloudSyncTone(cloudStatus, cloudSyncStatus);
  const hasCloudConflict = isAdmin && (cloudStatus.status === 'conflict' || cloudSyncStatus.status === 'conflict');
  const overallTone = resolvePortfolioDataHealthTone({
    role: isAdmin ? 'admin' : 'guest',
    brokerHealth: brokerHealth || undefined,
    quoteHealth,
    cloudTone,
    assignedSnapshotAvailable: guestSnapshotAvailable,
    assignedRefreshStatus: cloudSyncStatus.status
  });
  const overallLabel = translateText(
    overallTone === 'warning' ? 'Needs review' : overallTone === 'healthy' ? 'Data current' : 'Checking data status',
    language
  );

  const overallLabel = translateText(
    needsReview ? 'Needs review' : isCurrent ? 'Data current' : 'Checking data status',
    language
  );

  const quoteLabel = quoteSummary.total > 0
    ? formatQuoteFreshnessSummary(quoteSummary)
    : translateText(isAdmin ? 'No tracked quotes' : 'No assigned holdings', language);
  const cloudLabel = isAdmin
    ? resolveCloudSyncLabel(cloudStatus, cloudTone, language)
    : getGuestRefreshLabel(cloudSyncStatus.status, language);
  const lastSuccessfulSync = formatSnapshotTime(cloudSyncStatus.lastSyncedAt, language);
  const observedAt = brokerSnapshot?.observedAt;
  const brokerDetail = [
    brokerSnapshot?.provider,
    brokerSnapshot?.source
  ].filter((value): value is string => Boolean(value)).join(' · ');
  const brokerTimestamp = formatSnapshotTime(observedAt, language);
  const guestSnapshotTime = formatSnapshotTime(guestSnapshot?.updatedAt, language);

  const handleSync = async (): Promise<void> => {
    if (syncPromise.current) {
      await syncPromise.current;
      return;
    }
    setSyncing(true);
    const request = new Promise<ManualPortfolioSyncResult>((resolve) => {
      emitUiEvent('portfolio:sync-request', { resolve });
    });
    syncPromise.current = request;
    try {
      await request;
    } finally {
      if (syncPromise.current === request) syncPromise.current = null;
      setSyncing(false);
    }
  };

  const openRecoverySettings = () => {
    emitUiEvent('portfolio:set-active-view', { view: 'SETTINGS' });
    emitUiEvent('app:scroll-workspace');
  };

  return (
    <div class={'portfolio-data-health portfolio-data-health--' + overallTone}>
      <button
        type="button"
        class="portfolio-data-health__trigger"
        aria-expanded={expanded}
        aria-controls="portfolioDataHealthDetails"
        aria-label={translateText('Data health', language) + ': ' + overallLabel}
        onClick={() => setExpanded((value) => !value)}
      >
        <span class="portfolio-data-health__dot" aria-hidden="true" />
        <span>{translateText('Data health', language)}</span>
        <strong>{overallLabel}</strong>
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <section
          id="portfolioDataHealthDetails"
          class="portfolio-data-health__details"
          role="region"
          aria-label={translateText('Data health', language)}
        >
          <dl class="portfolio-data-health__rows">
            {isAdmin ? (
              <HealthRow
                label={translateText('Broker snapshot', language)}
                value={getBrokerHealthLabel(brokerHealth || 'unknown', language)}
                detail={[brokerDetail, brokerTimestamp].filter(Boolean).join(' · ') || undefined}
              />
            ) : (
              <HealthRow
                label={translateText('Assigned snapshot', language)}
                value={guestSnapshotAvailable ? translateText('Current', language) : translateText('Status unknown', language)}
                detail={guestSnapshot ? guestSnapshotTime : translateText('Observation time unavailable', language)}
              />
            )}
            <HealthRow
              label={translateText('Quote freshness', language)}
              value={quoteLabel}
            />
            <HealthRow
              label={translateText(isAdmin ? 'Cloud synchronization' : 'Assigned data refresh', language)}
              value={cloudLabel}
              detail={lastSuccessfulSync}
            />
            {isAdmin && (brokerSnapshot?.positionIntegrityIssues?.length || 0) > 0 && (
              <HealthRow
                label={translateText('Position integrity issues', language)}
                value={String(brokerSnapshot?.positionIntegrityIssues?.length || 0)}
              />
            )}
          </dl>
          <div class="portfolio-data-health__actions">
            {!hasCloudConflict && (
              <button
                type="button"
                class="portfolio-data-health__action portfolio-data-health__action--primary"
                onClick={() => void handleSync()}
                disabled={syncing}
                aria-busy={syncing}
              >{translateText(syncing ? 'Syncing…' : 'Sync portfolio', language)}</button>
            )}
            {hasCloudConflict && (
              <button
                type="button"
                class="portfolio-data-health__action"
                onClick={openRecoverySettings}
              >{translateText('Review in Settings', language)}</button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
