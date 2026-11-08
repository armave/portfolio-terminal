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

export function MarginDigestSecurityPanel({ currentUserId }: MarginDigestSecurityPanelProps) {
  const [inventory, setInventory] = useState<MarginDigestMigrationInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [migratedCount, setMigratedCount] = useState(0);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      const next = await fetchMarginDigestMigrationInventory();
      setInventory(next);
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
    setMigratedCount(0);
    let cursor: string | null = null;
    let totalMigrated = 0;
    let batches = 0;
    try {
      do {
        const result = await migrateMarginDigestBatch({ cursor, limit: 25 });
        totalMigrated += result.migrated;
        batches += 1;
        setMigratedCount(totalMigrated);
        cursor = result.nextCursor;
        if (batches > 1000 || (cursor && result.scanned === 0)) {
          throw new Error('Migration cursor did not advance.');
        }
      } while (cursor);
      const next = await fetchMarginDigestMigrationInventory();
      setInventory(next);
      setStatus(translateText('Migration complete. Re-scan to verify the remaining records.'));
      if (!next.migrationReady) {
        setError(translateText('The inventory still contains records that need review. Strict encryption enforcement remains disabled.'));
      }
    } catch {
      setError(translateText('Encryption migration failed. No source records were deleted.'));
    } finally {
      setMigrating(false);
    }
  };

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
        <button type="button" disabled={migrating || loading || !inventory || inventory.plaintextRecords === 0}
          onClick={() => void migrate()}
          class="rounded bg-cyan-900 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 disabled:opacity-50">
          {migrating ? translateText('Migrating saved digest records…') : translateText('Encrypt legacy plaintext digests')}
        </button>
        {migrating && <span class="text-[11px] text-slate-400 tabular-nums">{translateText('Migrated plaintext records:')} {migratedCount}</span>}
      </div>
      {status && <p class="text-[11px] text-cyan-200" role="status">{status}</p>}
      {error && <p class="text-[11px] text-amber-200" role="alert">{error}</p>}
      <p class="text-[10px] leading-4 text-slate-500">
        {translateText('This report does not prove that every active client has stopped sending legacy writes.')}
      </p>
    </section>
  );
}
