# PR 5 — Margin-risk input validity and scenario coverage

**Status:** Draft implementation scaffold. This branch currently contains the scoped implementation plan only; code changes and regression tests are pending.

**Proposed PR title:** `fix(finance): fail closed on invalid margin-risk assumptions`

**Branch:** `fix/margin-risk-scenario-contract-2026-11-05`  
**Base:** `main`  
**Priority:** High  
**Dependency:** None. PRs 5–7 are independent workstreams.

## Goal

Make margin-risk estimates deterministic and safe when account values or configured broker thresholds are missing, invalid, non-finite, negative, or outside their supported ranges. Preserve the current calculations for valid inputs. Make unavailable estimates explicit instead of showing an infinite/NaN metric or implying that no warning means the portfolio is safe.

This is a focused follow-up, not a repeat of merged PR #303. PR #303 already addressed sale-accounting input validation, commission fallback behavior, debt settlement finiteness, and associated accounting invariants. This PR owns the margin-risk model and its direct presentation only.

## Evidence and current boundary

- `src/domain/marginRisk.ts` calculates assets, equity ratio, maintenance/stop-out thresholds, and buffers directly from inputs and currently has only two focused tests in `src/domain/marginRisk.test.ts`.
- The module assumes finite non-negative debt, position value, collateral, and valid configured threshold ratios. Inputs outside those assumptions can produce non-finite or misleading values.
- `src/domain/portfolioValuation.ts` already distinguishes unavailable account balances and incomplete/provisional valuation reliability. Preserve that existing contract; do not duplicate it or weaken its tests.
- Current consumers include `src/App.tsx` and `src/components/SummaryMetricsGrid.tsx`. Review both before changing the return type or visible state.

## Scope

- `src/domain/marginRisk.ts` and its focused Vitest suite.
- Direct consumers of `calculateMarginRiskMetrics`, currently `src/App.tsx` and `src/components/SummaryMetricsGrid.tsx`, only as needed to render an explicit unavailable state.
- English/Russian translation entries and localization tests only if user-visible copy is added or changed.
- A concise finance-risk audit note and refinement-tracker update.

Do not modify FIFO, sale accounting, commission rules, margin-interest/rollover formulas, PortfolioStore mutations, local/cloud persistence, broker transports, or Cloudflare Worker files.

## Implementation checklist

- [ ] Trace all callers and characterize current valid-input outputs before changing the contract.
- [ ] Define and document supported input constraints for debt, position value, collateral, maintenance ratio, and stop-out ratio.
- [ ] Reject or explicitly classify non-finite values, negative monetary inputs, invalid threshold ordering, and ratios that make a denominator zero or negative.
- [ ] Handle zero debt, zero assets, negative equity, debt exceeding assets, zero collateral, and threshold equality without NaN/Infinity output.
- [ ] Ensure invalid assumptions cannot be converted into a reassuring "no margin call" or "no stop-out" state.
- [ ] Add an explicit unavailable/invalid result contract and update every direct consumer; do not silently coerce bad inputs to zero.
- [ ] Preserve current values and threshold semantics for all valid inputs and configured broker assumptions.
- [ ] Keep configured maintenance/stop-out thresholds clearly labeled as estimates, not verified live broker rules.
- [ ] Add deterministic table-driven tests for valid boundaries, invalid inputs, and every UI-visible unavailable state.
- [ ] Add English/Russian copy and translation-parity assertions for any new state.
- [ ] Update the refinement tracker with covered scenarios and any assumptions that still require broker confirmation.

## Non-goals and guardrails

- No change to margin-interest, day-count, rollover, FIFO, commissions, realized P/L, or debt-settlement formulas.
- No new broker threshold assumptions or claims about actual Freedom Finance liquidation rules.
- No persisted schema, backup, cloud API, or Worker contract change.
- No new testing dependency; use the existing Vitest stack.
- Do not duplicate the valuation reliability classifier already in `portfolioValuation.ts`.

## Acceptance criteria

- [ ] The risk calculator never returns NaN or Infinity for a supported call.
- [ ] Unsupported or invalid inputs produce an explicit unavailable result, not a false "healthy" result.
- [ ] Existing outputs for valid inputs remain unchanged and are characterized by regression tests.
- [ ] Both application and summary-metrics consumers handle unavailable results correctly.
- [ ] New visible strings are localized in English and Russian.
- [ ] No financial accounting formula or persisted format changes.
- [ ] TypeScript, full Vitest, localization checks, dead-code validation, dependency audits, production build, and relevant browser smoke tests pass on the exact PR head.

## Required validation

```bash
npm ci
npm run typecheck
npm test
npm run validate:dead-code
npm run audit:dependencies
npm run audit:production
npm run build
```

Verify risk displays with zero debt, negative equity, missing valuation, invalid broker assumptions, and threshold-edge values. Record the exact commands and CI run for the final head.
