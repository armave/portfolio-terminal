
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MarginDigestSecurityPanel', () => {
  it('uses aggregate inventory and bounded resumable migration calls', () => {
    const source = readFileSync(new URL('./MarginDigestSecurityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('fetchMarginDigestMigrationInventory');
    expect(source).toContain('migrateMarginDigestBatch({ cursor, limit: 25 })');
    expect(source).toContain('No source records were deleted');
    expect(source).toContain('MAX_MIGRATION_BATCHES_PER_RUN = 20');
    expect(source).toContain('const [migrationCursor, setMigrationCursor] = useState<string | null>(null)');
    expect(source).toContain('setMigrationCursor(cursor)');
    expect(source).toContain("translateText('Continue migration')");
    expect(source).toContain('Each run processes up to 500 records. Continue to resume from the last completed batch.');
    expect(source).toContain('currentUserId');
  });
});
