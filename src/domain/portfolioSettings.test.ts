import { describe, expect, it } from 'vitest';
import { DEFAULT_PORTFOLIO_SETTINGS, isPortfolioSettings, normalizePortfolioSettings } from './portfolioSettings';

describe('portfolio planning settings', () => {
  it('preserves the established application defaults', () => {
    expect(normalizePortfolioSettings(undefined)).toEqual(DEFAULT_PORTFOLIO_SETTINGS);
    expect(DEFAULT_PORTFOLIO_SETTINGS).toMatchObject({
      breakevenMinimumRemainingBalanceUsd: -450,
      buyMoreMinimumEquityRatio: 0.20,
      buyMoreMaintenanceReserveRatio: 0.10,
      accountEquityHealthReferenceRatio: 0.40,
      defaultMarginTargetUpsideRatio: 0.05,
      defaultActiveTrancheType: 'margin'
    });
  });

  it('accepts bounded custom policy values without conflating them with broker rules', () => {
    const custom = {
      ...DEFAULT_PORTFOLIO_SETTINGS,
      breakevenMinimumRemainingBalanceUsd: -250,
      buyMoreMinimumEquityRatio: 0.25,
      buyMoreMaintenanceReserveRatio: 0.15,
      accountEquityHealthReferenceRatio: 0.45,
      defaultMarginTargetUpsideRatio: 0.08,
      defaultActiveTrancheType: 'cash'
    } as const;
    expect(normalizePortfolioSettings(custom)).toEqual(custom);
    expect(isPortfolioSettings(custom)).toBe(true);
  });

  it('falls back for malformed optional settings and rejects the malformed object as a valid contract', () => {
    const malformed = {
      ...DEFAULT_PORTFOLIO_SETTINGS,
      breakevenMinimumRemainingBalanceUsd: Number.NaN,
      buyMoreMinimumEquityRatio: 2,
      accountEquityHealthReferenceRatio: 0,
      defaultMarginTargetUpsideRatio: -1,
      defaultActiveTrancheType: 'mix'
    };
    expect(normalizePortfolioSettings(malformed)).toEqual(DEFAULT_PORTFOLIO_SETTINGS);
    expect(isPortfolioSettings(malformed)).toBe(false);
  });
});
