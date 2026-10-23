# Risk Snapshot Contract

**Status:** Design contract for Phase 1; implementation follows only after Phase 0 baseline verification.  
**Goal:** Provide one read-only, deterministic risk summary shared by mobile and desktop without changing existing portfolio accounting.

## 1. Non-negotiable constraints

- Do not change existing financial calculations, rounding, commission allocation, rollover behavior, or persistence schemas in this phase.
- Treat `PortfolioState.positions` as the canonical active margin-position map.
- Consume canonical portfolio state and quote metadata; do not maintain a second portfolio store.
- Keep this module pure: no browser APIs, network calls, persistence, timers, or UI dependencies.
- Do not infer actual broker maintenance margin or liquidation levels from incomplete app data.
- A missing or stale required input must not be presented as a healthy/normal risk state.
- Keep the existing portfolio engine as the source of truth for existing calculations. New formulas require explicit definitions and regression tests before implementation.

## 2. Proposed API shape

The exact TypeScript types must be reconciled with the current domain and quote types during implementation. This is a contract, not a claim that these exports already exist.

```ts
type DataValidity = "valid" | "stale" | "missing" | "invalid";

type RiskLevel = "normal" | "warning" | "critical" | "unknown";

interface RiskMetric<T = number> {
  value: T | null;
  validity: DataValidity;
  asOf: number | null;
  explanation?: string;
}

interface RiskSnapshot {
  calculatedAt: number;
  equity: RiskMetric;
  grossExposure: RiskMetric;
  cash: RiskMetric;
  marginDebt: RiskMetric;
  estimatedFinancingCost: RiskMetric;
  marginBuffer: RiskMetric;
  level: RiskLevel;
  warnings: string[];
}
```

This API is illustrative. Do not implement or expose a metric until its accounting definition and required source fields have been verified against the current application and broker assumptions.

## 3. Metric definitions required before coding

For each metric, document its definition, source fields, currency, timestamp rules, stale-data policy, and tests.

- **Equity:** Determine whether existing state represents account equity, cash balance, invested cost, or debt. Do not equate `balance` with equity without verifying the app's established semantics.
- **Gross exposure:** Define which active margin positions and cash-cushion holdings are included, how quantities and quote prices are valued, and how missing prices are handled.
- **Cash:** Reconcile `cashCushion.freeCash`, compatibility fields such as `cashBalance`, and debt settlement semantics. Avoid double counting.
- **Margin debt:** Verify the sign convention of `balance` and how accumulated interest/rollover is reflected.
- **Financing cost:** Reuse existing interest/rollover functions and assumptions where appropriate. Do not independently recreate the current accrual model.
- **Margin buffer:** Do not calculate a broker-style maintenance-margin buffer until the maintenance rate, eligible collateral, currency conversions, and liquidation convention are explicitly available. If they are unavailable, return `unknown` with an explanation instead of fabricating a number.
- **Quote validity:** Use the application's existing quote timestamps, provider provenance, market session, and freshness rules. Never infer freshness solely from the time the UI received a response.

## 4. Risk-level semantics

- `normal`: all inputs required for the particular risk conclusion are valid and current enough, and no configured threshold is breached.
- `warning`: a user-configured warning threshold is met, or data quality is degraded in a way that limits confidence.
- `critical`: a configured critical threshold is crossed using valid inputs.
- `unknown`: required data or a defensible metric definition is unavailable.

A single global level must not hide a critical condition in one metric or imply certainty when another critical input is unknown. The implementation should retain per-metric validity and expose warnings for the UI.

Thresholds must be user-configurable or sourced from explicit broker assumptions. Never hardcode an unverified broker liquidation threshold.

## 5. Required tests

- Same normalized inputs produce identical snapshots.
- No input object is mutated.
- Missing, non-finite, zero, negative, and stale quote cases are handled according to the documented domain constraints.
- Unknown inputs cannot produce a healthy risk conclusion for the affected metric.
- Threshold equality and crossing behavior is tested.
- Existing financial outputs remain byte-for-byte or tolerance-equivalent to the approved regression fixtures, as appropriate.
- Active positions and cash holdings are not double counted.
- A hypothetical snapshot does not mutate the canonical portfolio store.
- No new UI code contains duplicated financial formulas.

## 6. Implementation sequence

1. Complete Phase 0 checks from issue #102 and record the tested commit.
2. Inspect the current quote metadata and broker-assumption types.
3. Finalize metric definitions using current source semantics.
4. Implement the smallest pure domain module and its tests.
5. Review the API against desktop and mobile needs.
6. Only then consume the snapshot in the UI.

## 7. Release gate

This contract is not approval to guess at account equity or maintenance margin. If source semantics are ambiguous, document the ambiguity and return an unknown metric until it is resolved. Existing financial formulas remain untouched.
