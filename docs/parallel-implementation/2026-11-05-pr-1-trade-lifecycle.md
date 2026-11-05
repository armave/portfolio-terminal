# PR 1 — Complete the trade and portfolio lifecycle

**Status:** Implementation complete; exact-head automated validation passed on 2026-11-05.  
**Base:** `dev` at `8194cfb9ea0fd86761a5edbf74a8003c10d56c17` (2026-11-05), including merged PR #324.  
**Branch:** `work/trade-lifecycle-e2e-2026-11-05`  
**Priority:** Critical  
**Ownership:** Terminal commands, transaction journeys, and their regression coverage.

## Goal

Prove that the user can manage a position from initial entry through partial and full exits, including cash-funded and margin-funded cases, and recover the exact committed state after reload. The existing deterministic domain functions and `PortfolioStore` remain the source of truth for accounting.

This work adds missing journey-level verification and fixes only reproducible defects exposed by those journeys. It is not a rewrite of the financial engine and does not add real broker order execution.

## Confirmed baseline

- Financial-domain coverage already exists for FIFO allocation, commissions, margin-interest allocation, staged exits, debt-first settlement, realized P&L, rollover, and risk calculations.
- `src/features/terminal/commandDispatcher.test.ts` covers command routing, validation, persistence failures, scenario reads, and hypothetical buy-more simulation.
- `src/store/portfolioStore.test.ts` covers committed state, buy/sell accounting, cash holdings, persistence, quote ordering, and closed-position recovery.
- The production browser journey covers broker partial failure, backup import/reset, guest assignment, and account separation, but it does not complete a buy → partial exit → final exit → reload journey using the actual trade UI.

## Implementation scope

### 1. End-to-end trade lifecycle

- [x] Add an isolated production-browser journey for a new position: buy, inspect the resulting holding, verify quantity/cost basis/commission, and reload.
- [x] Add an additional-buy journey and verify aggregate shares and entry lots remain correct.
- [x] Change the target price through the supported UI/command and verify it persists.
- [x] Execute a partial sale and verify FIFO lot allocation, remaining shares, realized costs and debt/cash settlement.
- [x] Execute the final sale and verify the active position disappears while Closed History retains the complete lifecycle.
- [x] Reload and verify no closed position is resurrected and no closed-history record is lost.
- [x] Cover equivalent cash-funded and margin-funded paths where the UI supports them.
- [x] Verify a rejected oversized sale and a sale with missing/unreliable acquisition cost never partially mutate state.

### 2. Persistence and duplicate-action protection

- [x] Verify a persistence failure leaves the prior committed portfolio visible and shows an actionable failure.
- [x] Verify a successful operation is committed and published once.
- [x] Verify rapid duplicate submission cannot double-apply quantity, commission, or sale proceeds.
- [ ] Verify a refresh/reload during an in-flight or failed save cannot advertise an uncommitted operation as successful. (not separately simulated in the browser journey; persistence rejection and committed-snapshot behavior remain covered by existing Vitest tests.)
- [x] Preserve the IndexedDB commit/recovery contract and legacy snapshot compatibility.

### 3. Financial parity guardrails

- [x] Reuse existing FIFO, commission, interest, rollover and sale-accounting domain functions.
- [ ] Add regression tests only for observed mismatches; record before/after values and compatibility impact.
- [ ] Confirm terminal and other validated mutation paths produce equivalent accounting for equivalent inputs.
- [x] Confirm no formula changes are made merely to make the UI test pass.

## Likely files and boundaries

Primary ownership:
- `src/components/TradingConsole.tsx`
- `src/features/terminal/commandDispatcher.ts` and its tests
- Focused store/command integration tests in new, dedicated files
- A new isolated Playwright journey, e.g. `scripts/browser-smoke-trades.mjs`
- A dedicated workflow file for this journey if the shared CI workflow would otherwise conflict with parallel PRs

Do not edit the shared monolithic `scripts/browser-smoke.mjs` or shared CI workflow while PRs 2 and 3 are being developed. Keep any browser harness helper local to this journey or propose a separately reviewed common helper.

## Validation evidence

GitHub Actions workflow run [#42062939379](https://github.com/armave/portfolio-terminal/actions/runs/42062939379) passed on PR head `7ff2939e63555445af636c65f10baa0de129d6eb`, based on `dev` at `8194cfb9ea0fd86761a5edbf74a8003c10d56c17`. It passed the full unit suite, typecheck, production build, existing app browser smoke, trade lifecycle browser smoke, dead-code validation, and both dependency audits.

## Non-goals

- No live broker order placement or routing.
- No change to broker-reported account authority or reconciliation rules.
- No independent portfolio store or second state owner.
- No financial formula, rounding, fee, rollover or debt-settlement change without a proven regression and explicit compatibility explanation.
- No Worker, Durable Object, Cloudflare secret, or deployment change absent a demonstrated server-side defect.
- No broad UI redesign.

## Acceptance criteria

1. A user can complete buy → partial sale → full sale through the actual app UI.
2. Position quantities, entry basis, commissions, fees, realized accounting and cash/debt balances agree with the established domain rules.
3. Closed positions are absent from active holdings and remain correctly represented in history after reload.
4. Failed or duplicate submissions cannot create false success or double accounting.
5. Cash and margin workflows remain separate and correct.
6. New user-visible copy is localized through the existing English/Russian dictionaries.
7. Vitest covers all new integration boundaries and failure branches.
8. The dedicated production-browser journey and repository validation gates pass on the final PR head.

## Validation checklist

- [x] `npm ci`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run validate:dead-code`
- [x] `npm run audit:dependencies`
- [x] `npm run audit:production`
- [x] `npm run build`
- [x] Dedicated production-browser trade journey
- [x] English/Russian copy and accessibility regression suite
- [x] Final diff review for financial semantics, IndexedDB/persisted data, broker reconciliation and duplicate actions

Do not mark this PR ready or merge it until the code-bearing implementation and all required checks are complete.
