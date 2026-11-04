# PR #303 — Financial-domain implementation audit

**Branch:** `refactor/financial-domain-invariants-2026-11`  
**Base reviewed:** `main` at `4d4980b09fce33670abe5062023a8e200063b5ff`  
**Implementation status:** Code and regression tests committed; full PR CI is pending.

## Existing coverage confirmed

The repository already contains dedicated domain modules and Vitest suites for FIFO sale allocation, cost-basis validation, margin-interest and rollover calculations, per-cycle projected-debt rounding, portfolio valuation, and sale accounting. The existing architecture tracker records earlier fixes for configurable rollover cutoffs and per-cycle cent rounding. This PR deliberately does not duplicate those fixes or change the established accounting formulas.

## Confirmed boundary gaps addressed

1. **Commission fallback could hide invalid fee configuration.** The sale commission wrapper had a second formula in its catch path. Invalid configuration could therefore return an invalid or misleading fallback amount. The wrapper now validates the sale quantity/proceeds, delegates to the single canonical `calculateCommission` implementation, rounds the result to cents, and propagates invalid assumptions instead of suppressing them.
2. **Sale accounting accepted inconsistent or invalid inputs.** The helper did not validate the sale quantity against the open position, the signed balance, fee/proceeds/cost inputs, annual borrow rate, day-count basis, explicit calculation clock, or the tranche investment values used for portfolio debt weighting. It also caught all margin-interest calculation errors and converted them to zero. The helper now validates these boundaries, checks that the selected position is represented in the portfolio investment ledger, bounds the investment weight, and lets invalid calculations fail closed rather than silently understate interest.
3. **Settlement could propagate Infinity.** Negative legacy settlement amounts are intentionally still clamped to zero, but NaN/Infinity could previously flow into the returned debt/cash values. Settlement now rejects non-finite inputs and checks that the resulting free-cash total remains finite.

## Regression coverage added

- Non-finite sale quantity and proceeds.
- Invalid commission assumptions.
- Sale quantity exceeding the open position.
- Non-finite proceeds, invalid day-count basis, invalid account balance, and invalid calculation clock.
- Selected-position investment missing from the portfolio ledger.
- Non-finite tranche investment used for margin allocation.
- Non-finite settlement amounts while retaining negative-value clamping.

## Compatibility and invariants

- FIFO ordering and allocation formulas are unchanged.
- Normal commission calculation still uses the shared commission calculation and cent rounding.
- Margin-interest formula, debt allocation basis, and position-level recorded-charge floor are unchanged for valid inputs.
- Sale proceeds continue to repay debt before contributing cash (store ownership unchanged).
- Negative debt/cash/proceeds passed to the settlement helper continue to clamp to zero as covered by the existing test.
- No persisted schema, broker/API, UI, store mutation, cloud sync, authentication, or Worker contract was changed.
- Only `src/domain/portfolioTransactions.ts` and its direct Vitest test file are changed in application code; this audit note documents the result.

## Validation status

- [x] Implementation and focused regression tests committed to the PR branch.
- [ ] TypeScript check on exact PR head.
- [ ] Full Vitest suite on exact PR head.
- [ ] Production build and bundle budget on exact PR head.
- [ ] Production browser smoke on exact PR head.
- [ ] Dead-code validation and dependency audits on exact PR head.
- [ ] Final diff review after CI.

The local container could not resolve `github.com`, so project validation must be taken from the GitHub Actions run for the exact PR head. No tests are claimed as passed until that workflow reports success.
