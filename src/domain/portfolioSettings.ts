export interface PortfolioSettings {
  /** Minimum hypothetical signed account balance after a breakeven sale, in USD. */
  breakevenMinimumRemainingBalanceUsd: number;
  /** App-side Buy More equity floor, as a decimal ratio. */
  buyMoreMinimumEquityRatio: number;
  /** Additional app-side equity reserve above broker maintenance, as a decimal ratio. */
  buyMoreMaintenanceReserveRatio: number;
  /** Reference used to label the account-equity health gauge and risk classification. */
  accountEquityHealthReferenceRatio: number;
  /** Default upside target for a newly observed margin position, as a decimal ratio. */
  defaultMarginTargetUpsideRatio: number;
  /** Funding type assigned to newly observed broker purchase operations. */
  defaultActiveTrancheType: 'cash' | 'margin';
}

export const DEFAULT_PORTFOLIO_SETTINGS: PortfolioSettings = {
  breakevenMinimumRemainingBalanceUsd: -450,
  buyMoreMinimumEquityRatio: 0.20,
  buyMoreMaintenanceReserveRatio: 0.10,
  accountEquityHealthReferenceRatio: 0.40,
  defaultMarginTargetUpsideRatio: 0.05,
  defaultActiveTrancheType: 'margin'
};

function boundedNumber(
  source: Record<string, unknown>,
  key: keyof Omit<PortfolioSettings, 'defaultActiveTrancheType'>,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

/** Normalize optional planning metadata without rewriting portfolio accounting inputs. */
export function normalizePortfolioSettings(value: unknown): PortfolioSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const defaultActiveTrancheType = source.defaultActiveTrancheType === 'cash'
    ? 'cash'
    : source.defaultActiveTrancheType === 'margin'
      ? 'margin'
      : DEFAULT_PORTFOLIO_SETTINGS.defaultActiveTrancheType;
  return {
    breakevenMinimumRemainingBalanceUsd: boundedNumber(
      source, 'breakevenMinimumRemainingBalanceUsd',
      DEFAULT_PORTFOLIO_SETTINGS.breakevenMinimumRemainingBalanceUsd, -1_000_000, 1_000_000
    ),
    buyMoreMinimumEquityRatio: boundedNumber(
      source, 'buyMoreMinimumEquityRatio',
      DEFAULT_PORTFOLIO_SETTINGS.buyMoreMinimumEquityRatio, 0, 1
    ),
    buyMoreMaintenanceReserveRatio: boundedNumber(
      source, 'buyMoreMaintenanceReserveRatio',
      DEFAULT_PORTFOLIO_SETTINGS.buyMoreMaintenanceReserveRatio, 0, 1
    ),
    accountEquityHealthReferenceRatio: boundedNumber(
      source, 'accountEquityHealthReferenceRatio',
      DEFAULT_PORTFOLIO_SETTINGS.accountEquityHealthReferenceRatio, 0.01, 1
    ),
    defaultMarginTargetUpsideRatio: boundedNumber(
      source, 'defaultMarginTargetUpsideRatio',
      DEFAULT_PORTFOLIO_SETTINGS.defaultMarginTargetUpsideRatio, 0, 2
    ),
    defaultActiveTrancheType
  };
}

export function isPortfolioSettings(value: unknown): value is PortfolioSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const normalized = normalizePortfolioSettings(value);
  const source = value as Record<string, unknown>;
  return Object.keys(DEFAULT_PORTFOLIO_SETTINGS).every((key) =>
    source[key] === normalized[key as keyof PortfolioSettings]
  );
}
