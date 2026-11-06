# Wave 3 PT-09 — Deterministic whole-portfolio scenarios and forward projections

**Tracking issue:** #337  
**Existing UI primitives:** ScenarioComparisonModal.tsx, ScenarioReportModal.tsx, terminal scenario contracts  
**Dedicated branch:** feat/wave3-pt09-scenario-projections  
**Target:** dev

## Objective

Move beyond narrow trade/exit comparisons and let an investor compare plausible whole-portfolio paths over explicit time horizons. A projection is a reproducible scenario, not a point forecast or promise.

## Scope

- Define a typed, immutable scenario input containing a portfolio snapshot, valuation time, currency, horizon, scenario assumptions, source timestamps and data-quality state.
- Implement deterministic bull/base/bear and user-defined paths.
- Model price changes, staged buys/sells, contributions/withdrawals, dividends, commissions/fees, margin borrow rate, daily rollover and financing costs using the existing published financial contracts.
- Calculate portfolio equity, capital flows, realized/unrealized change and risk/margin path by period.
- Support one-factor and correlated multi-position shocks through explicit input assumptions; use PT-08 stress calculation outputs without changing its methodology.
- Compare scenarios over daily/weekly/monthly horizons and show range/driver explanations, assumptions, as-of time, source quality and limitations.
- Reuse existing scenario modals/presentation patterns where they fit; do not replace existing command-driven trade comparison behavior.
- Save/reopen user scenarios only after PT-05 scope and storage ownership are approved. Until then, scenario execution remains ephemeral or device-local and must not be presented as shared multi-user state.

## Boundaries

- No portfolio, position, transaction, cashflow, lot, target or broker order mutation.
- No AI-generated authoritative calculations and no autonomous trading.
- No guaranteed target, expected-return claim or broker liquidation/maintenance promise.
- Missing, stale, mixed-currency or incomplete input returns unavailable/provisional as defined; no fabricated values or implicit FX.
- Do not duplicate PT-06 performance or PT-08 risk formulas; consume their deterministic outputs/contracts.
- Preserve existing CLI scenario commands and current confirmation safeguards.

## Acceptance criteria

- The same scenario input and calculation version produce the same output.
- Scenario input and outputs include model/calculation version, currency, valuation time, assumptions and source-quality metadata.
- Bull/base/bear/user scenarios are visibly assumptions and not predictions.
- Margin debt, financing costs, cashflows and maintenance-buffer estimates evolve consistently under the selected path.
- Live portfolio state remains byte-for-byte unchanged by a projection run.
- Each output driver can be traced to a position, cashflow, fee/interest assumption or price shock.

## Required tests and QA

Known-answer scenario fixtures; buy/sell/staged-exit sequences; deposits/withdrawals; dividends/fees/commission; rollover/day-count/timezone; missing/stale price; mixed currency; leverage/equity below zero; stress shocks; deterministic replay; input versioning; explicit zero-mutation tests against PortfolioStore. Responsive UI and English/Russian translations if surfaces are added.
