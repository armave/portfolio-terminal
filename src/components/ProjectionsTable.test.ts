import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ProjectionsTable.tsx', import.meta.url), 'utf8');

describe('Projection Table account balance', () => {
  it('projects the signed account balance instead of position-allocated debt', () => {
    expect(source).toContain('calculateProjectedAccountBalance');
    expect(source).toContain('Number(state.balance ?? 0), dailyRate, daysFromToday');
    expect(source).toContain('{formatUSD(projectedAccountBalance)}');
    expect(source).not.toContain('-{formatUSD(projectedDebt)}');
  });
});
