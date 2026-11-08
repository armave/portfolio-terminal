import { useEffect, useState } from 'preact/hooks';
import {
  fetchMarginDigestMigrationInventory,
  migrateMarginDigestBatch,
  type MarginDigestMigrationInventory
} from '../services/api';
import { translateText } from '../services/i18n';

interface MarginDigestSecurityPanelProps {
  currentUserId: string;
}

const MIGRATION_BATCH_SIZE = 25;
const MAX_MIGRATION_BATCHES_PER_RUN = 20;

export function MarginDigestSecurityPanel({ currentUserId }: MarginDigestSecurityPanelProps) {
  const [inventory, setInventory] = useState<MarginDigestMigrationInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [migratedCount, setMigratedCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [migrationCursor, setMigrationCursor] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchMarginDigestMigrationInventory();
      setInventory(next);
      if (next.plaintextRecords === 0) setMigrationCursor(null);
      setStatus(translateText('Inventory scan complete.'));
    } catch {
      setError(translateText('Encryption migration failed. No source records were deleted.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setInventory(null);
    setMigrationCursor(null);
    setMigratedCount(0);
    setLoading(true);
    setError('');
    void fetchMarginDigestMigrationInventory().then((next) => {
      if (!cancelled) {
        setInventory(next);
        setStatus(translateText('Inventory scan complete.'));
      }
    }).catch(() => {
      if (!cancelled) setError(translateText('Encryption migration failed. No source records were deleted.'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentUserId]);

  const migrate = async () => {
    if (migrating || !inventory || inventory.plaintextRecords === 0) return;
    setMigrating(true);
    setError('');
    setStatus(translateText('Migrating saved digest records…'));
    setConflictCount(0);

    let cursor = migrationCursor;
    let totalMigrated = migratedCount;
    let totalConflicts = 0;
    let batches = 0;
    try {
      while (batches < MAX_MIGRATION_BATCHES_PER_RUN) {
        const result = await migrateMarginDigestBatch({ cursor, limit: MIGRATION_BATCH_SIZE });
        totalMigrated += result.migrated;
        totalConflicts += result.conflicts;
        setConflictCount(totalConflicts);
        batches += 1;
        cursor = result.nextCursor;
        setMigratedCount(totalMigrated);

        if (result.done) {
          cursor = null;
          break;
        }
        if (!cursor || result.scanned === 0) {
          throw new Error('Migration cursor did not advance.');
        }
      }

      // A CAS conflict can refer to a key before the current cursor. Restart
      // from the first page so the next run retries that record; encrypted
      // records are skipped idempotently.
      if (totalConflicts > 0) cursor = null;
      setMigrationCursor(cursor);
      const next = await fetchMarginDigestMigrationInventory();
      setInventory(next);
      if (next.plaintextRecords === 0) setMigrationCursor(null);

      if (cursor && next.plaintextRecords > 0) {
        setStatus(translateText('Migration paused safely. Select Continue migration to resume from the last completed batch.'));
      } else if (next.plaintextRecords > 0 || totalConflicts > 0) {
        setStatus(translateText('Some records changed during migration. Run the migration again to retry remaining plaintext records.'));
      } else {
        setStatus(translateText('Migration complete. Re-scan to verify the remaining records.'));
      }
      if (!next.migrationReady) {
        setError(translateText('The inventory still contains records that need review. Strict encryption enforcement remains disabled.'));
      }
    } catch {
      setMigrationCursor(cursor);
      setMigratedCount(totalMigrated);
      setError(translateText('Encryption migration failed. No source records were deleted.'));
    } finally {
      setMigrating(false);
    }
  };

  const canMigrate = Boolean(inventory && inventory.plaintextRecords > 0);

  return (
    <section class="settings-panel space-y-3" aria-labelledby="marginDigestSecurityTitle">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id="marginDigestSecurityTitle" class="text-xs font-bold uppercase tracking-wider text-slate-300">
          {translateText('Margin Intelligence encryption migration')}
        </h3>
        <button type="button" disabled={loading || migrating} onClick={() => void refresh()}
          class="rounded border border-slate-700 px-2.5 py-1.5 text-[11px] text-slate-200 disabled:opacity-50">
          {loading ? translateText('Loading…') : translateText('Scan saved digests')}
        </button>
      </div>
      <p class="text-xs leading-5 text-slate-400">
        {translateText('Inventory reports counts only; it never returns saved analysis or article content.')}
      </p>
      {inventory ? (
        <dl class="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div><dt class="text-slate-500">{translateText('Saved digest records')}</dt><dd class="font-semibold text-slate-100 tabular-nums">{inventory.totalRecords}</dd></div>
          <div><dt class="text-slate-500">{translateText('Plaintext records')}</dt><dd class={inventory.plaintextRecords ? 'font-semibold text-amber-300 tabular-nums' : 'font-semibold text-slate-100 tabular-nums'}>{inventory.plaintextRecords}</dd></div>
          <div><dt class="text-slate-500">{translateText('AES-GCM v2 records')}</dt><dd class="font-semibold text-slate-100 tabular-nums">{inventory.encryptedV2Records}</dd></div>
          <div><dt class="text-slate-500">{translateText('Older encrypted records')}</dt><dd class="font-semibold text-slate-100 tabular-nums">{inventory.legacyEncryptedRecords}</dd></div>
          <div><dt class="text-slate-500">{translateText('Unreadable records')}</dt><dd class="font-semibold text-slate-100 tabular-nums">{inventory.unreadableRecords}</dd></div>
          <div><dt class="text-slate-500">{translateText('Status')}</dt><dd class={inventory.migrationReady ? 'font-semibold text-emerald-300' : 'font-semibold text-amber-300'}>{inventory.migrationReady ? translateText('Ready') : translateText('Review required')}</dd></div>
        </dl>
      ) : !loading ? (
        <p class="text-xs text-slate-500">{translateText('No inventory scan has been run on this device.')}</p>
      ) : null}
      <div class="flex flex-wrap items-center gap-2">
        <button type="button" disabled={migrating || loading || !canMigrate}
          onClick={() => void migrate()}
          class="rounded bg-cyan-900 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50">
          {migrating
            ? translateText('Migrating saved digest records…')
            : migrationCursor
              ? translateText('Continue migration')
              : translateText('Encrypt legacy plaintext digests')}
        </button>
        {migratedCount > 0 && <span class="text-[11px] text-slate-400 tabular-nums">
          {translateText('Migrated plaintext records:')} {migratedCount}
        </span>}
        {conflictCount > 0 && <span class="text-[11px] text-amber-300 tabular-nums">
          {translateText('Records changed during migration:')} {conflictCount}
        </span>}
      </div>
      <p class="text-[10px] leading-4 text-slate-500">
        {translateText('Each run processes up to 500 records. Continue to resume from the last completed batch.')}
      </p>
      {status && <p class="text-[11px] text-cyan-200" role="status">{status}</p>}
      {error && <p class="text-[11px] text-amber-200" role="alert">{error}</p>}
      {inventory?.legacyEncryptedRecords ? <p class="text-[10px] leading-4 text-amber-200">
        {translateText('Older encrypted records are not processed by the batch tool. Open each saved review in Margin Intelligence to decrypt and upgrade it.')}
      </p> : null}
      {inventory?.unreadableRecords ? <p class="text-[10px] leading-4 text-amber-200">
        {translateText('Unreadable records are preserved. Review or recover them before deciding whether any retention or deletion action is appropriate.')}
      </p> : null}
      <p class="text-[10px] leading-4 text-slate-500">
        {translateText('This report does not prove that every active client has stopped sending legacy writes.')}
      </p>
    </section>
  );
}
