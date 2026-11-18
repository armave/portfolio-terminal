import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ProjectionsTable.tsx', import.meta.url), 'utf8');

describe('Projection Table account balance', () => {
  it('projects the signed account balance at the position PT after selling', () => {
    expect(source).toContain('calculateProjectedAccountBalanceAfterSale');
    expect(source).toContain('getPortfolioNetSaleProceeds(');
    expect(source).toContain('calculatePostSaleBalanceFloorHorizon');
    expect(source).toContain('MAX_POST_SALE_BALANCE_FLOOR_SEARCH_DAYS');
    expect(source).toContain('projectionState,\n    state.brokerAssumptions,\n    liquidatedTickers');
    expect(source).toContain("'balance-floor'");
    expect(source).toContain('signedBalance, freeCash, netSaleProceeds, dailyRate, daysFromToday');
    expect(source).toContain("projectedAccountBalance === null ? '—' : formatUSD(projectedAccountBalance)");
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
