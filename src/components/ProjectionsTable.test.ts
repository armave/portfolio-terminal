import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ProjectionsTable.tsx', import.meta.url), 'utf8');

describe('Projection Table account balance', () => {
  it('projects the signed account balance instead of position-allocated debt', () => {
    expect(source).toContain('calculateProjectedAccountBalanceAfterSale');
    expect(source).toContain('const netSaleProceeds = liquidatedTickers.reduce');
    expect(source).toContain('calculateSaleCommission(shares, grossProceeds, state.brokerAssumptions)');
    expect(source).toContain('Number(state.balance ?? 0), freeCash, netSaleProceeds, dailyRate, daysFromToday');
    expect(source).toContain('{formatUSD(projectedAccountBalance)}');
  });

  it('uses compact, right-aligned financial cells while keeping the date column separate', () => {
    expect(source).toContain('projection-value-cell');
    expect(source).toContain('projection-date-cell');
    expect(source).toContain('tabular-nums');
    expect(source).not.toContain('marginFee');
  });
});
