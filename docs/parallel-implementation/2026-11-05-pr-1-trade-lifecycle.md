# PR 1 — Complete the trade and portfolio lifecycle

**Status:** Draft execution plan; implementation not yet started.  
**Base:** `main` at `056211e03fcc4154538c45f969bc608268120dac` (2026-11-05).  
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

- [ ] Add an isolated production-browser journey for a new position: buy, inspect the resulting holding, verify quantity/cost basis/commission, and reload.
- [ ] Add an additional-buy journey and verify aggregate shares and entry lots remain correct.
- [ ] Change the target price through the supported UI/command and verify it persists.
- [ ] Execute a partial sale and verify FIFO lot allocation, remaining shares, realized costs and debt/cash settlement.
- [ ] Execute the final sale and verify the active position disappears while Closed History retains the complete lifecycle.
- [ ] Reload and verify no closed position is resurrected and no closed-history record is lost.
- [ ] Cover equivalent cash-funded and margin-funded paths where the UI supports them.
- [ ] Verify a rejected oversized sale and a sale with missing/unreliable acquisition cost never partially mutate state.

### 2. Persistence and duplicate-action protection

- [ ] Verify a persistence failure leaves the prior committed portfolio visible and shows an actionable failure.
- [ ] Verify a successful operation is committed and published once.
- [ ] Verify rapid duplicate submission cannot double-apply quantity, commission, or sale proceeds.
- [ ] Verify a refresh/reload during an in-flight or failed save cannot advertise an uncommitted operation as successful.
- [ ] Preserve the IndexedDB commit/recovery contract and legacy snapshot compatibility.

### 3. Financial parity guardrails

- [ ] Reuse existing FIFO, commission, interest, rollover and sale-accounting domain functions.
- [ ] Add regression tests only for observed mismatches; record before/after values and compatibility impact.
- [ ] Confirm terminal and other validated mutation paths produce equivalent accounting for equivalent inputs.
- [ ] Confirm no formula changes are made merely to make the UI test pass.

## Likely files and boundaries

Primary ownership:
- `src/components/TradingConsole.tsx`
- `src/features/terminal/commandDispatcher.ts` and its tests
- Focused store/command integration tests in new, dedicated files
- A new isolated Playwright journey, e.g. `scripts/browser-smoke-trades.mjs`
- A dedicated workflow file for this journey if the shared CI workflow would otherwise conflict with parallel PRs

Do not edit the shared monolithic `scripts/browser-smoke.mjs` or shared CI workflow while PRs 2 and 3 are being developed. Keep any browser harness helper local to this journey or propose a separately reviewed common helper.

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

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run validate:dead-code`
- [ ] `npm run audit:dependencies`
- [ ] `npm run audit:production`
- [ ] `npm run build`
- [ ] Dedicated production-browser trade journey
- [ ] English/Russian copy and accessible-name regression coverage
- [ ] Final diff review for financial semantics, IndexedDB/persisted data, broker reconciliation and duplicate actions

Do not mark this PR ready or merge it until the code-bearing implementation and all required checks are complete.
