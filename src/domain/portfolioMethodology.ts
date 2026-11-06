export interface PortfolioMethodologySection {
  id: string;
  title: string;
  description: string;
  points: readonly string[];
  note?: string;
}

/**
 * User-facing explanations of calculations and limitations that are already
 * present in the current financial baseline. This is descriptive content only:
 * it must not become a second source of formulas or mutate portfolio state.
 */
export const PORTFOLIO_METHODOLOGY_SECTIONS: readonly PortfolioMethodologySection[] = [
  {
    id: 'valuation',
    title: 'Portfolio value and equity',
    description: 'The current valuation combines the signed broker account balance, separately tracked free cash, and the market value of recorded holdings.',
    points: [
      'A positive signed account balance is cash; a negative signed account balance represents margin debt.',
      'Positive account cash and positive free cash are added. Margin debt is subtracted from cash and holdings to calculate equity.',
      'A holding market value is its positive quantity multiplied by a valid positive market price. Cash holdings may use the saved price as a fallback when the current price is unavailable.'
    ],
    note: 'The valuation function returns availability and unpriced-holding counts as well as numeric values. A numeric fallback must not be presented as complete equity when required inputs are missing.'
  },
  {
    id: 'reliability',
    title: 'Current, provisional, and incomplete values',
    description: 'The reliability label describes input quality separately from the numeric estimate.',
    points: [
      'Current means the account balance is available, every positive-quantity holding has a usable price, and no required source is stale, delayed, unknown, or unavailable.',
      'Provisional means a finite estimate can be calculated, but at least one source is stale, delayed, has an unknown observation time, or is otherwise not fully current.',
      'Incomplete takes precedence when the account balance is unavailable or any positive-quantity holding cannot be priced.'
    ],
    note: 'A recently received quote is not necessarily a recently observed market price. Observation time and receipt time are different facts.'
  },
  {
    id: 'unrealized',
    title: 'Unrealized P&L versus target projections',
    description: 'Current unrealized P&L and a target-price projection answer different questions and must remain separate.',
    points: [
      'For an open margin position, gross unrealized P&L is current market value minus the cost basis of its open acquisition tranches.',
      'Gross unrealized P&L excludes commissions, financing fees or interest, taxes, and estimated future selling costs. It is not net liquidation value.',
      'A target-price projection uses the configured target price and may subtract projected sell commission and modeled margin charges. It is not current unrealized P&L.'
    ],
    note: 'When a positive-quantity holding cannot be priced, combined unrealized P&L is unavailable rather than a partial total presented as complete.'
  },
  {
    id: 'commission',
    title: 'Trading commissions',
    description: 'The configured commission model combines a per-share charge, a percentage of transaction value, and a minimum per order.',
    points: [
      'For a positive-quantity order, commission is the greater of the minimum order commission and the per-share charge plus the transaction-value charge.',
      'The percentage setting is stored as a decimal multiplier. For example, 0.0012 represents 0.12%, not 1.2%.',
      'Where commissions are calculated per tranche or order, the minimum can apply independently to each one before the amounts are added.'
    ],
    note: 'Different existing call sites have different rounding points. Do not assume every commission result is rounded at the same stage.'
  },
  {
    id: 'financing',
    title: 'Margin financing and risk estimates',
    description: 'Financing and margin-risk figures depend on the broker assumptions configured in Settings.',
    points: [
      'Margin interest uses the configured annual borrowing rate and day-count basis, eligible tranche principal, margin utilization, and daily compounding.',
      'The rollover calculation uses the configured Asia/Yerevan time; the documented default is 04:00. Runtime and legacy-import paths have distinct time-boundary and rounding behavior.',
      'Margin-call and stop-out displays are estimates derived from configured maintenance and stop-out equity thresholds. They are not live broker risk indicators or guaranteed liquidation prices.'
    ],
    note: 'Confirm borrowing rates, day-count conventions, maintenance requirements, and stop-out rules with the broker. The application settings are assumptions, not broker confirmation.'
  },
  {
    id: 'provenance',
    title: 'Broker data and market quote provenance',
    description: 'Broker-reported facts, app-maintained accounting, and market observations are related but are not interchangeable.',
    points: [
      'Broker-reported balances and aggregate positions remain separate from app-owned acquisition lots, cost basis, and funding classifications.',
      'A partial or malformed broker snapshot must not replace the last accepted account snapshot; the last-known-good data is retained and marked stale.',
      'Quote observation time is the provider timestamp when available. Receipt time records when this application received the quote and must not be used as a substitute for observation time.'
    ],
    note: 'Unknown, delayed, stale, missing, and unavailable data are distinct states. A numeric price alone does not prove that a quote is current.'
  },
  {
    id: 'limitations',
    title: 'Current methodology limitations',
    description: 'Some portfolio-wide capabilities require additional contracts and are not part of the verified current valuation baseline.',
    points: [
      'The current portfolio valuation API has no currency or FX conversion contract. Do not add values denominated in different currencies or invent an exchange rate.',
      'Historical FX requires an explicit base currency, pair direction, provider, observation timestamp, and stale-rate policy before consolidated multi-currency valuation is valid.',
      'Full portfolio time-weighted and money-weighted return methodology is being developed in Wave 2. Current gross P&L must not be described as a cash-flow-adjusted or annualized portfolio return.'
    ],
    note: 'These limitations will change only when the relevant performance and market-data contracts are implemented, reviewed, and validated.'
  }
] as const;
