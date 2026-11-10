import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Buy More blocked preview presentation', () => {
  it('does not show a previously saved comparison while the current scenario is blocked', () => {
    const source = readFileSync(new URL('./BuyMoreModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const displayedResult = resultError ? null : resultData ?? savedResult;');
    expect(source).toContain('typeof preview?.maxSafeShares === \'number\' && preview.maxSafeShares > 0');
    expect(source).toContain('setSharesInput(String(preview.maxSafeShares))');
    expect(source).toContain("const displayedSummary = resultError ? ''");
    expect(source).toContain('const isSavedFallback = !resultError && !resultData && Boolean(savedResult);');
  });
});
