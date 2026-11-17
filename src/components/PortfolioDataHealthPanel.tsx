import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CloudStatus } from '../ui/uiStateStore';
import { usePortfolioSelector } from '../store/portfolioStore';
import { emitUiEvent } from '../ui/uiEventBus';
import { getAppLanguage, translateText } from '../services/i18n';
import { useQuoteRefreshInterval } from '../ui/useQuoteRefreshInterval';
import { DEFAULT_ADMIN_REFRESH_INTERVAL_MS, DEFAULT_GUEST_REFRESH_INTERVAL_MS } from '../services/portfolioAutoRefresh';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';
import { formatQuoteFreshnessSummary } from '../utils/formatters';
import { useDialogFocus } from '../ui/dialogFocus';
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
} from '../ui/cloudSyncStatus';
import { ModalFrame } from './ModalFrame';

interface PortfolioDataHealthPanelProps {
  isAdmin: boolean;
  cloudStatus: CloudStatus;
  cloudSyncStatus: CloudStatus;
}

function formatSnapshotTime(
  timestamp: number | null | undefined,
  language: ReturnType<typeof getAppLanguage>,
  now: number
): string {
  const relative = formatRelativeSyncTime(timestamp, now, language);
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
      {detail && <dd class="portfolio-data-health__detail">{detail}</dd>}
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  const syncPromise = useRef<Promise<ManualPortfolioSyncResult> | null>(null);
  const requestClose = () => closeRef.current?.();

  useDialogFocus(dialogRef, {
    active: dialogOpen,
    initialFocusRef: closeButtonRef,
    restoreFocusRef: triggerRef,
    onEscape: requestClose
  });

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const brokerSnapshot = source.role === 'admin' ? source.brokerAccountInfo : undefined;
  const guestSnapshot = source.role === 'guest' ? source.guestSnapshot : undefined;
  const brokerHealth = source.role === 'admin' ? getBrokerSnapshotHealth(brokerSnapshot) : null;
  const quoteSummary = source.role === 'admin'
    ? summarizeAdminPortfolioQuoteFreshness({
        positions: source.positions,
        cashHoldings: source.cashHoldings
      }, now, refreshIntervalMs)
    : summarizeGuestPortfolioQuoteFreshness(guestSnapshot, now, refreshIntervalMs);
  const quoteHealth = getQuoteFreshnessHealth(quoteSummary);
  const cloudTone = resolveCloudSyncTone(cloudStatus, cloudSyncStatus);
  const hasCloudConflict = isAdmin && cloudSyncStatus.status === 'conflict';
  const guestSnapshotAvailable = Boolean(guestSnapshot && Number.isSafeInteger(guestSnapshot.updatedAt) && guestSnapshot.updatedAt > 0);
  const overallTone = resolvePortfolioDataHealthTone({
    role: isAdmin ? 'admin' : 'guest',
    brokerHealth: brokerHealth || undefined,
    quoteHealth,
    cloudTone,
    assignedSnapshotAvailable: guestSnapshotAvailable,
    assignedRefreshStatus: cloudSyncStatus.status
  });
  const isSyncPending = syncing || (isAdmin
    ? cloudTone === 'pending'
    : cloudSyncStatus.status === 'syncing' || cloudSyncStatus.status === 'pending');
  const overallLabel = translateText(
    overallTone === 'warning'
      ? 'Needs review'
      : isSyncPending
        ? 'Syncing…'
        : overallTone === 'healthy'
          ? 'Up to date'
          : 'Status',
    language
  );
  const triggerTone = isSyncPending && overallTone !== 'warning' ? 'pending' : overallTone;

  const quoteLabel = quoteSummary.total > 0
    ? formatQuoteFreshnessSummary(quoteSummary)
    : translateText(isAdmin ? 'No tracked quotes' : 'No assigned holdings', language);
  const cloudLabel = isAdmin
    ? resolveCloudSyncLabel(cloudStatus, cloudTone, language)
    : getGuestRefreshLabel(cloudSyncStatus.status, language);
  const lastSuccessfulSync = formatSnapshotTime(cloudSyncStatus.lastSyncedAt, language, now);
  const observedAt = brokerSnapshot?.observedAt;
  const brokerDetail = [
    brokerSnapshot?.provider,
    brokerSnapshot?.source
  ].filter((value): value is string => Boolean(value)).join(' · ');
  const brokerTimestamp = formatSnapshotTime(observedAt, language, now);
  const guestSnapshotTime = formatSnapshotTime(guestSnapshot?.updatedAt, language, now);

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
    requestClose();
    emitUiEvent('portfolio:set-active-view', { view: 'SETTINGS' });
    emitUiEvent('app:scroll-workspace');
  };

  const modal = dialogOpen && typeof document !== 'undefined'
    ? createPortal(
        <ModalFrame
          backdropClassName="portfolio-data-health-modal-backdrop"
          dialogClassName="portfolio-data-health-modal"
          dialogRef={dialogRef}
          dialogId="portfolioDataHealthDialog"
          ariaLabelledBy="portfolioDataHealthTitle"
          closeRef={closeRef}
          onClose={() => setDialogOpen(false)}
        >
          <header class="portfolio-data-health-modal__header">
            <div class="portfolio-data-health-modal__heading">
              <p class="portfolio-data-health-modal__eyebrow">{translateText('Data & sync', language)}</p>
              <h2 id="portfolioDataHealthTitle">{translateText('Portfolio status', language)}</h2>
              <p class="portfolio-data-health-modal__subtitle">{overallLabel}</p>
            </div>
            <button
              id="portfolioDataHealthClose"
              ref={closeButtonRef}
              type="button"
              class="portfolio-data-health-modal__close"
              aria-label={translateText('Close', language)}
              onClick={requestClose}
            >
              ×
            </button>
          </header>
          <div id="portfolioDataHealthDetails" class="portfolio-data-health__details">
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
          </div>
        </ModalFrame>,
        document.body
      )
    : null;

  return (
    <div id="portfolioDataHealth" class={'portfolio-data-health portfolio-data-health--' + triggerTone}>
      <button
        id="portfolioDataHealthToggle"
        ref={triggerRef}
        type="button"
        class="portfolio-data-health__trigger"
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        aria-controls="portfolioDataHealthDialog"
        aria-label={translateText('Portfolio status', language) + ': ' + overallLabel}
        onClick={() => setDialogOpen(true)}
      >
        <span class="portfolio-data-health__dot" aria-hidden="true" />
        <span class="portfolio-data-health__label">{translateText('Data & sync', language)}</span>
        <strong class="portfolio-data-health__state" aria-live="polite">{overallLabel}</strong>
        <span class="portfolio-data-health__chevron" aria-hidden="true">{dialogOpen ? '⌃' : '⌄'}</span>
      </button>
      {modal}
    </div>
  );
}
