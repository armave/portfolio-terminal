import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatBuyMoreTableAmount } from './BuyMoreModal';

describe('Buy More blocked preview presentation', () => {
  it('does not show a previously saved comparison while the current scenario is blocked', () => {
    const source = readFileSync(new URL('./BuyMoreModal.tsx', import.meta.url), 'utf8');
    expect(source).toContain('const displayedResult = resultError ? null : resultData ?? savedResult;');
    expect(source).toContain('const marginLimitError = typeof preview?.maxSafeShares === \'number\'');
    expect(source).toContain('translateText(\'Maximum additional shares at this price\', language)');
    expect(source).toContain('setSharesInput(String(preview.maxSafeShares!))');
    expect(source).toContain("const displayedSummary = resultError ? ''");
    expect(source).toContain('const isSavedFallback = !resultError && !resultData && Boolean(savedResult);');
  });
});


describe('Buy More table amount formatting', () => {
  it('groups positive and negative balance amounts in English', () => {
    expect(formatBuyMoreTableAmount('-$22363.64', 'en')).toBe('-$22,363.64');
    expect(formatBuyMoreTableAmount('−$74287.83', 'en')).toBe('−$74,287.83');
    expect(formatBuyMoreTableAmount('+$5895.20', 'en')).toBe('+$5,895.20');
  });

  it('uses narrow no-break spaces for Russian thousands grouping', () => {
    expect(formatBuyMoreTableAmount('-$22363.64', 'ru')).toBe('-$22\u202f363.64');
  });

  it('preserves dates, smaller values, and already grouped balances', () => {
    expect(formatBuyMoreTableAmount('2026-11-10', 'en')).toBe('2026-11-10');
    expect(formatBuyMoreTableAmount('169.77 (9.19)', 'en')).toBe('169.77 (9.19)');
    expect(formatBuyMoreTableAmount('-$22,363.64', 'en')).toBe('-$22,363.64');
  });
});
