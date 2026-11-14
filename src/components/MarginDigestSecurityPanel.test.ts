
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MarginDigestSecurityPanel', () => {
  it('uses aggregate inventory and bounded resumable migration calls', () => {
    const source = readFileSync(new URL('./MarginDigestSecurityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('fetchMarginDigestMigrationInventory');
    expect(source).toContain('const MIGRATION_BATCH_SIZE = 25;');
    expect(source).toContain('migrateMarginDigestBatch({ cursor, limit: MIGRATION_BATCH_SIZE })');
    expect(source).toContain('No source records were deleted');
    expect(source).toContain('MAX_MIGRATION_BATCHES_PER_RUN = 20');
    expect(source).toContain('const [migrationCursor, setMigrationCursor] = useState<string | null>(null)');
    expect(source).toContain('setMigrationCursor(cursor)');
    expect(source).toContain("translateText('Continue migration')");
    expect(source).toContain('Each run processes up to 500 records. Continue to resume from the last completed batch.');
    expect(source).toContain('settings-panel space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3');
    expect(source).toContain('grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3');
    expect(source).toContain('min-w-0 rounded-lg bg-slate-900/70 px-3 py-2');
    expect(source).toContain("const refresh = async () => {");
    expect(source).toContain("onClick={() => void refresh()}");
    expect(source).not.toContain("useEffect(");
    expect(source).toContain('result.conflicts');
    expect(source).toContain('if (totalConflicts > 0) cursor = null;');
    expect(source).toContain('// records are skipped idempotently.');
    expect(source).toContain('Older encrypted records are not processed by the batch tool.');
    expect(source).toContain('Unreadable records are preserved.');
  });
});
