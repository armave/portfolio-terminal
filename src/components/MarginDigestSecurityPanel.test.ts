
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MarginDigestSecurityPanel', () => {
  it('uses aggregate inventory and bounded resumable migration calls', () => {
    const source = readFileSync(new URL('./MarginDigestSecurityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('fetchMarginDigestMigrationInventory');
    expect(source).toContain('migrateMarginDigestBatch({ cursor, limit: 25 })');
    expect(source).toContain('No source records were deleted');
    expect(source).toContain('if (batches > 1000 || (cursor && result.scanned === 0))');
    expect(source).toContain('currentUserId');
  });
});
