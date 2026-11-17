import { useRef, useState } from 'preact/hooks';
import { getBrokerSnapshotHealth } from '../ui/portfolioDataHealth';
import { usePortfolioSelector } from '../store/portfolioStore';
import { useCloudSyncStatus } from '../ui/uiStateStore';
import { emitUiEvent } from '../ui/uiEventBus';
import type { ManualPortfolioSyncResult } from '../services/manualPortfolioSync';
import { getAppLanguage, translateText } from '../services/i18n';

export function EmptyStatePanel() {
  const brokerSnapshot = usePortfolioSelector((state) => state.brokerAccountInfo);
  const cloudSyncStatus = useCloudSyncStatus();
  const brokerHealth = getBrokerSnapshotHealth(brokerSnapshot);
  const cloudConflict = cloudSyncStatus.status === 'conflict';
  const [syncing, setSyncing] = useState(false);
  const syncPromise = useRef<Promise<ManualPortfolioSyncResult> | null>(null);

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

  const copy = brokerHealth === 'current'
    ? {
        title: 'No active margin positions',
        description: 'No active margin positions are currently tracked. The latest complete broker snapshot is available.'
      }
    : brokerHealth === 'stale'
      ? {
          title: 'Broker information needs refreshing',
          description: 'No active margin positions are currently tracked locally. The last broker snapshot is stale, so current broker positions cannot be confirmed.'
        }
      : brokerHealth === 'partial' || brokerHealth === 'empty'
        ? {
            title: 'Broker snapshot is incomplete',
            description: 'No active margin positions are currently tracked locally. The latest broker snapshot does not provide complete position coverage.'
          }
        : brokerHealth === 'unavailable'
          ? {
              title: 'Broker information unavailable',
              description: 'No active margin positions are currently tracked locally. Current broker positions could not be confirmed; your saved portfolio remains available.'
            }
          : {
              title: 'Broker information not confirmed',
              description: 'No active margin positions are currently tracked locally. Broker snapshot completeness or observation time has not been verified.'
            };

  return (
    <section class="empty-state-panel" aria-labelledby="emptyStateTitle">
      <div class="empty-state-panel__copy">
        <h1 id="emptyStateTitle">{translateText(copy.title, getAppLanguage())}</h1>
        <p>{translateText(copy.description, getAppLanguage())}</p>
        {cloudConflict && <p role="alert">{translateText('Resolve the cloud conflict before syncing', getAppLanguage())}</p>}
      </div>
      <div class="empty-state-panel__actions">
        {cloudConflict ? (
          <button
            type="button"
            onClick={() => {
              emitUiEvent('portfolio:set-active-view', { view: 'SETTINGS' });
              emitUiEvent('app:scroll-workspace');
            }}
            class="empty-state-panel__primary min-h-11 focus-visible:ring-2 focus-visible:ring-cyan-300"
          >{translateText('Review in Settings', getAppLanguage())}</button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            aria-busy={syncing}
            class="empty-state-panel__primary"
          >{translateText(syncing ? 'Syncing…' : 'Sync portfolio', getAppLanguage())}</button>
        )}
        <button
          type="button"
          onClick={() => emitUiEvent('settings:backup-import-request')}
          class="empty-state-panel__secondary min-h-11 focus-visible:ring-2 focus-visible:ring-cyan-300"
        >{translateText('Import Backup', getAppLanguage())}</button>
        <button
          type="button"
          onClick={() => emitUiEvent('portfolio:set-active-view', { view: 'BALANCE' })}
          class="empty-state-panel__secondary"
        >{translateText('Open Balance', getAppLanguage())}</button>
      </div>
    </section>
  );
}
