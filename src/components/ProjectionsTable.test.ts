import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ProjectionsTable.tsx', import.meta.url), 'utf8');

describe('Projection Table account balance', () => {
  it('projects the signed account balance instead of position-allocated debt', () => {
    expect(source).toContain('calculateProjectedAccountBalanceAfterSale');
    expect(source).toContain('getPortfolioNetSaleProceeds(');
    expect(source).toContain('const breakevenBalanceConstraint = {');
    expect(source).toContain('MAX_BREAKEVEN_SEARCH_DAYS,\n      breakevenBalanceConstraint');
    expect(source).toContain('projectionState,\\n    state.brokerAssumptions,\\n    liquidatedTickers');
    expect(source).toContain('Number(state.balance ?? 0), freeCash, netSaleProceeds, dailyRate, daysFromToday');
    expect(source).toContain('{formatUSD(projectedAccountBalance)}');
  });

  it('renders content-sized financial columns and a constrained spanning entry description', () => {
    expect(source).toContain('projection-date-cell');
    expect(source).toContain('projection-number-cell');
    expect(source).toContain('projection-entry-cell');
    expect(source).toContain('projection-entry-description');
    expect(source).toContain('tabular-nums');
    expect(source).not.toContain('marginFee');
  });
});
