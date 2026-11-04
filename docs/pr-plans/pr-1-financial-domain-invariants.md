# PR 1 — Financial-domain invariants and accounting parity

**Status:** Draft planning scaffold. This initial commit contains the implementation specification only; production-code changes and regression tests are still to be added.

**Proposed PR title:** `test(finance): strengthen portfolio domain invariants and accounting parity`

**Branch:** `refactor/financial-domain-invariants-2026-11`  
**Base:** `main`  
**Priority:** High. This is the first implementation PR and establishes the financial behavior that the store work in PR 2 must preserve.

## Goal

Complete a focused audit of the pure financial domain and close demonstrated correctness and regression-coverage gaps without changing established financial semantics as incidental cleanup.

Financial calculations must remain deterministic and independent of UI, browser storage, network requests, and Worker APIs.

## Scope

Review only the pure domain boundary and directly related tests, including the existing files and their actual callers:

- `src/domain/portfolioTransactions.ts`
- `src/domain/portfolioValuation.ts`
- `src/domain/saleCostBasis.ts`
- `src/domain/rolloverCalendar.ts`
- Other existing `src/domain/` modules when a direct dependency is demonstrated.
- Corresponding existing Vitest tests; add focused tests where coverage is missing.
- `src/types/portfolio.ts` only when a domain contract is incomplete and a backward-compatible type correction is required.
- A concise audit note documenting findings, unchanged behavior, and any confirmed correction.

Do not modify PortfolioStore mutation logic, UI components, API transports, or Worker code in this PR.

## Implementation checklist

- [ ] Inventory financial calculation entry points and identify one canonical implementation for each calculation.
- [ ] Trace direct callers and compatibility surfaces before moving or deleting helpers.
- [ ] Verify FIFO allocation for full and partial exits, fractional quantities, incomplete legacy lot-fee data, and invalid cost-basis records.
- [ ] Verify commission assumptions, minimum commissions, per-share/per-trade fees, and fee normalization at zero, fractional, missing, invalid, and boundary values.
- [ ] Verify margin-interest calculations around the configured rollover cutoff, immediately before and after the cutoff, across multiple days, and with absent or invalid assumptions.
- [ ] Verify per-cycle cent rounding parity between accrued debt and projected debt.
- [ ] Verify sale accounting parity for gross proceeds, allocated buy fees, sell commissions, margin-interest allocation, net realized result, and debt-first settlement.
- [ ] Verify valuation semantics for signed account cash/debt, app-tracked free cash, margin positions, cash holdings, priced/unpriced assets, and missing/invalid account balances.
- [ ] Verify closed-trade compatibility: identifiers, timestamp precedence, aliases, holding-day rounding, and persisted fields.
- [ ] Add deterministic table-driven regression tests for non-finite values, zero/negative quantities, fractional shares, invalid dates, absent assumptions, and rounding boundaries.
- [ ] Compare transaction-path outputs against characterized expected results before and after any refactor.
- [ ] Consolidate duplicated pure calculations only after equivalence is proven by tests.
- [ ] For any discovered financial defect, document previous behavior, corrected behavior, compatibility impact, and a dedicated regression test.
- [ ] Update the refinement tracker with reviewed areas, changes, and deferred items.

## Non-goals and guardrails

- No incidental change to financial meaning, interest assumptions, fee policy, FIFO ordering, rollover timing, debt settlement, realized P&L, or rounding.
- No portfolio state ownership or persistence changes.
- No broker endpoint, quote freshness, cloud sync, encryption, authentication, or Worker changes.
- No new property-testing dependency without a demonstrated need; prefer the existing Vitest stack.
- Do not delete a helper until all direct and dynamic/compatibility callers have been checked.

## Acceptance criteria

- [ ] Important financial calculations have clearly identified canonical implementations.
- [ ] Regression tests cover the listed boundaries and any confirmed defects.
- [ ] Existing financial outputs remain unchanged unless a confirmed defect is explicitly explained.
- [ ] Domain functions remain pure and do not import UI, storage, network, or Worker modules.
- [ ] No duplicate calculation implementation remains after callers are migrated and verified.
- [ ] No persisted schema or external API contract change is introduced.
- [ ] TypeScript, Vitest, dead-code validation, audits, and production build pass on the exact PR head.

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

Review the final diff specifically for calculation semantics, rounding, type-contract changes, and accidental state-layer edits.

## Suggested commit sequence

```text
test(finance): characterize portfolio calculation boundaries
refactor(domain): consolidate verified pure calculation paths
test(finance): cover rounding and invalid-input regressions
docs: record financial-domain audit results
```

## Relationship to the full cleanup plan

PR 1 is the financial-correctness foundation. PR 2 depends on its established domain contracts. PR 3 consumes the stable domain/store boundaries after PR 1 and PR 2 are merged.

The application remains a Preact/TypeScript frontend with Cloudflare Workers and Durable Objects as separate server boundaries. This PR does not alter those boundaries.
